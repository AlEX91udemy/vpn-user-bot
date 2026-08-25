import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, type TrialClaim } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RemnawaveError } from '../remnawave/remnawave.types';
import { CustomerSubscriptionService } from '../subscriptions/customer-subscription.service';

const TRIAL_DURATION_DAYS = 5;
const TRIAL_TRAFFIC_BYTES = 10n * 1024n ** 3n;
const TRIAL_DEVICE_LIMIT = 5;

export type TrialResult =
  | { kind: 'FULFILLED'; claim: TrialClaim }
  | { kind: 'ALREADY_USED'; claim: TrialClaim }
  | { kind: 'INELIGIBLE'; claim: TrialClaim | null }
  | { kind: 'DEFERRED'; claim: TrialClaim | null };

@Injectable()
export class TrialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: CustomerSubscriptionService,
  ) {}

  async claim(customerId: string): Promise<TrialResult> {
    try {
      return await this.subscriptions.withCustomerLease(customerId, () =>
        this.claimWithLease(customerId),
      );
    } catch (error) {
      if (error instanceof RemnawaveError && error.retryable)
        return { kind: 'DEFERRED', claim: null };
      throw error;
    }
  }

  private async claimWithLease(customerId: string): Promise<TrialResult> {
    const existing = await this.prisma.trialClaim.findUnique({
      where: { customerId },
    });
    if (existing?.status === 'FULFILLED')
      return { kind: 'ALREADY_USED', claim: existing };
    if (await this.hasPaidOrActiveAccess(customerId))
      return { kind: 'INELIGIBLE', claim: existing };
    const acquired = await this.acquire(customerId);
    const claim = acquired.claim;
    if (!acquired.acquired)
      return {
        kind: claim.status === 'FULFILLED' ? 'ALREADY_USED' : 'DEFERRED',
        claim,
      };
    try {
      await this.subscriptions.provisionWithLease(customerId, {
        tariffId: null,
        targetExpiresAt: claim.targetExpiresAt!,
        trafficLimitBytes: TRIAL_TRAFFIC_BYTES,
        deviceLimit: TRIAL_DEVICE_LIMIT,
      });
      const fulfilled = await this.prisma.trialClaim.update({
        where: { lockToken: claim.lockToken! },
        data: {
          status: 'FULFILLED',
          lockToken: null,
          lockExpiresAt: null,
          fulfilledAt: new Date(),
          nextRetryAt: null,
          lastError: null,
          retryable: false,
        },
      });
      return { kind: 'FULFILLED', claim: fulfilled };
    } catch (error) {
      const retryable = !(error instanceof RemnawaveError) || error.retryable;
      const failed = await this.prisma.trialClaim.update({
        where: { lockToken: claim.lockToken! },
        data: {
          status: 'FAILED',
          lockToken: null,
          lockExpiresAt: null,
          lastError:
            error instanceof Error ? error.message.slice(0, 120) : 'UNKNOWN',
          nextRetryAt: retryable ? new Date(Date.now() + 60_000) : null,
          retryable,
        },
      });
      return { kind: 'DEFERRED', claim: failed };
    }
  }

  async retryDue(limit = 20): Promise<void> {
    const now = new Date();
    const due = await this.prisma.trialClaim.findMany({
      where: {
        OR: [
          { status: 'FAILED', retryable: true, nextRetryAt: { lte: now } },
          { status: 'PENDING', lockExpiresAt: { lte: now } },
        ],
      },
      select: { customerId: true },
      take: limit,
    });
    await Promise.allSettled(
      due.map(({ customerId }) => this.claim(customerId)),
    );
  }

  private async hasPaidOrActiveAccess(customerId: string): Promise<boolean> {
    const [subscription, paidOrder] = await Promise.all([
      this.prisma.subscription.findUnique({
        where: { customerId },
        select: { status: true, expiresAt: true },
      }),
      this.prisma.order.findFirst({
        where: {
          customerId,
          status: { in: ['PAID', 'FULFILLMENT_FAILED', 'FULFILLED'] },
        },
        select: { id: true },
      }),
    ]);
    return Boolean(
      paidOrder ||
      (subscription?.status === 'ACTIVE' &&
        subscription.expiresAt &&
        subscription.expiresAt > new Date()),
    );
  }

  private async acquire(
    customerId: string,
  ): Promise<{ claim: TrialClaim; acquired: boolean }> {
    const token = randomUUID();
    const now = new Date();
    const lockExpiresAt = new Date(now.getTime() + 300_000);
    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.trialClaim.findUnique({
          where: { customerId },
        });
        if (!existing) {
          try {
            const claim = await tx.trialClaim.create({
              data: {
                customerId,
                status: 'PENDING',
                attempts: 1,
                lockToken: token,
                lockExpiresAt,
                targetExpiresAt: new Date(
                  Date.now() + TRIAL_DURATION_DAYS * 86_400_000,
                ),
              },
            });
            return { claim, acquired: true };
          } catch (error) {
            if (
              !(error instanceof Prisma.PrismaClientKnownRequestError) ||
              error.code !== 'P2002'
            )
              throw error;
          }
        }
        const changed = await tx.trialClaim.updateMany({
          where: {
            customerId,
            OR: [
              {
                status: 'FAILED',
                retryable: true,
                nextRetryAt: { lte: now },
              },
              { status: 'PENDING', lockExpiresAt: { lte: now } },
            ],
          },
          data: {
            status: 'PENDING',
            attempts: { increment: 1 },
            lockToken: token,
            lockExpiresAt,
          },
        });
        const claim = await tx.trialClaim.findUniqueOrThrow({
          where: changed.count === 1 ? { lockToken: token } : { customerId },
        });
        return { claim, acquired: changed.count === 1 };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
