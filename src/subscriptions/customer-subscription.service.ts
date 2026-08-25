import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import {
  REMNAWAVE_GATEWAY,
  RemnawaveError,
  type RemnawaveGateway,
  type RemnawaveUser,
} from '../remnawave/remnawave.types';
import {
  SubscriptionOperationError,
  type Entitlement,
  type SubscriptionRecord,
  type SubscriptionReissueResult,
} from './subscription.types';

const REISSUE_LOCK_MS = 60_000;
const REISSUE_COOLDOWN_MS = 60_000;

@Injectable()
export class CustomerSubscriptionService {
  private readonly logger = new Logger(CustomerSubscriptionService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REMNAWAVE_GATEWAY) private readonly remnawave: RemnawaveGateway,
  ) {}

  async provision(
    customerId: string,
    entitlement: Entitlement,
  ): Promise<SubscriptionRecord> {
    return this.withCustomerLease(customerId, () =>
      this.provisionWithLease(customerId, entitlement),
    );
  }

  async withCustomerLease<T>(
    customerId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lease = await this.acquireLease(customerId);
    try {
      return await operation();
    } finally {
      await this.prisma.customerProvisioningLock.updateMany({
        where: { customerId, lockToken: lease },
        data: { lockToken: null, lockedUntil: null },
      });
    }
  }

  async provisionWithLease(
    customerId: string,
    entitlement: Entitlement,
  ): Promise<SubscriptionRecord> {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
    });
    const stableUsername = customer.remnawaveUsername ?? `vpn_${customer.id}`;
    const remote = await this.remnawave.ensureAccess({
      username: stableUsername,
      knownUserId: customer.remnawaveUserId,
      targetExpiresAt: entitlement.targetExpiresAt,
      trafficLimitBytes: entitlement.trafficLimitBytes,
      deviceLimit: entitlement.deviceLimit,
    });
    return this.prisma.$transaction(async (tx) => {
      const fresh = await tx.customer.findUniqueOrThrow({
        where: { id: customerId },
      });
      if (fresh.remnawaveUserId && fresh.remnawaveUserId !== String(remote.id))
        throw new Error('CUSTOMER_REMNAWAVE_IDENTITY_CONFLICT');
      await tx.customer.update({
        where: { id: customerId },
        data: {
          remnawaveUserId: String(remote.id),
          remnawaveUsername: stableUsername,
        },
      });
      return tx.subscription.upsert({
        where: { customerId },
        create: this.projection(customerId, entitlement.tariffId, remote),
        update: this.projection(customerId, entitlement.tariffId, remote),
      }) as Promise<SubscriptionRecord>;
    });
  }

  async getOwn(customerId: string): Promise<SubscriptionRecord | null> {
    return this.prisma.subscription.findUnique({
      where: { customerId },
    }) as Promise<SubscriptionRecord | null>;
  }

  async refreshOwn(customerId: string): Promise<SubscriptionRecord | null> {
    const subscription = await this.getOwn(customerId);
    if (!subscription) return null;
    const remote = await this.remnawave.getById(subscription.remnawaveUserId);
    if (!remote) {
      return this.prisma.subscription.update({
        where: { customerId },
        data: { status: 'ERROR', lastSyncError: 'REMOTE_USER_NOT_FOUND' },
      }) as Promise<SubscriptionRecord>;
    }
    return this.prisma.subscription.update({
      where: { customerId },
      data: this.projection(customerId, subscription.tariffId, remote),
    }) as Promise<SubscriptionRecord>;
  }

  async reissueOwn(customerId: string): Promise<SubscriptionReissueResult> {
    const subscription = await this.getOwn(customerId);
    if (!subscription)
      throw new SubscriptionOperationError('SUBSCRIPTION_NOT_FOUND');

    const token = randomUUID();
    const now = new Date();
    await this.prisma.subscriptionReissueLock.createMany({
      data: [{ customerId }],
      skipDuplicates: true,
    });
    const claimed = await this.prisma.subscriptionReissueLock.updateMany({
      where: {
        customerId,
        AND: [
          { OR: [{ lockToken: null }, { lockedUntil: { lte: now } }] },
          { OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }] },
        ],
      },
      data: {
        lockToken: token,
        lockedUntil: new Date(now.getTime() + REISSUE_LOCK_MS),
      },
    });
    if (claimed.count !== 1) {
      const state = await this.prisma.subscriptionReissueLock.findUnique({
        where: { customerId },
      });
      if (state?.cooldownUntil && state.cooldownUntil > now) {
        const current = await this.getOwn(customerId);
        if (!current)
          throw new SubscriptionOperationError('SUBSCRIPTION_NOT_FOUND');
        return { kind: 'RECENTLY_REISSUED', subscription: current };
      }
      throw new SubscriptionOperationError('REISSUE_BUSY');
    }

    try {
      let remote: RemnawaveUser;
      try {
        remote = await this.remnawave.revokeSubscription(
          subscription.remnawaveUserId,
        );
      } catch (error) {
        if (!(error instanceof RemnawaveError) || !error.ambiguousMutation)
          throw error;
        const reconciled = await this.remnawave.getById(
          subscription.remnawaveUserId,
        );
        if (
          !reconciled ||
          this.urlHash(reconciled.subscriptionUrl) ===
            this.urlHash(subscription.subscriptionUrl)
        )
          throw error;
        remote = reconciled;
      }

      const updated = (await this.prisma.$transaction(async (tx) => {
        const saved = await tx.subscription.update({
          where: { customerId },
          data: this.projection(customerId, subscription.tariffId, remote),
        });
        await tx.subscriptionReissueLock.updateMany({
          where: { customerId, lockToken: token },
          data: {
            lockToken: null,
            lockedUntil: null,
            cooldownUntil: new Date(Date.now() + REISSUE_COOLDOWN_MS),
            lastSucceededAt: new Date(),
          },
        });
        return saved;
      })) as SubscriptionRecord;
      this.logger.log({ event: 'subscription_reissued', customerId });
      return { kind: 'REISSUED', subscription: updated };
    } catch (error) {
      await this.prisma.subscriptionReissueLock.updateMany({
        where: { customerId, lockToken: token },
        data: { lockToken: null, lockedUntil: null },
      });
      this.logger.error({
        event: 'subscription_reissue_failed',
        customerId,
        code:
          error instanceof RemnawaveError
            ? error.message
            : 'SUBSCRIPTION_REISSUE_ERROR',
      });
      throw error;
    }
  }

  private projection(
    customerId: string,
    tariffId: string | null,
    user: RemnawaveUser,
  ) {
    return {
      customerId,
      remnawaveUserId: String(user.id),
      tariffId,
      status: this.normalize(user),
      expiresAt: user.expireAt,
      trafficLimitBytes: user.trafficLimitBytes,
      deviceLimit: user.hwidDeviceLimit,
      subscriptionUrl: user.subscriptionUrl,
      lastSyncedAt: new Date(),
      lastSyncError: null,
    } as const;
  }

  private normalize(user: RemnawaveUser): LocalSubscriptionStatus {
    if (user.status === 'DISABLED') return 'DISABLED';
    if (user.status === 'EXPIRED' || user.expireAt <= new Date())
      return 'EXPIRED';
    return user.status === 'ACTIVE' ? 'ACTIVE' : 'ERROR';
  }

  private urlHash(value: string | null): string {
    return createHash('sha256')
      .update(value ?? '')
      .digest('hex');
  }

  private async acquireLease(customerId: string): Promise<string> {
    const token = randomUUID();
    await this.prisma.customerProvisioningLock.createMany({
      data: [{ customerId }],
      skipDuplicates: true,
    });
    const claimed = await this.prisma.customerProvisioningLock.updateMany({
      where: {
        customerId,
        OR: [{ lockToken: null }, { lockedUntil: { lte: new Date() } }],
      },
      data: { lockToken: token, lockedUntil: new Date(Date.now() + 300_000) },
    });
    if (claimed.count !== 1)
      throw new RemnawaveError('CUSTOMER_PROVISIONING_BUSY', true);
    return token;
  }
}

type LocalSubscriptionStatus = SubscriptionRecord['status'];
