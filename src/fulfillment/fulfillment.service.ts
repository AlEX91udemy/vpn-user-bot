import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type OrderFulfillment } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RemnawaveError } from '../remnawave/remnawave.types';
import { CustomerSubscriptionService } from '../subscriptions/customer-subscription.service';

export type FulfillmentResult =
  | { kind: 'FULFILLED'; fulfillment: OrderFulfillment }
  | { kind: 'DEFERRED'; fulfillment: OrderFulfillment };

@Injectable()
export class FulfillmentService {
  private readonly logger = new Logger(FulfillmentService.name);
  private readonly delays: number[];
  private readonly jobLeaseMs = 300_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: CustomerSubscriptionService,
    config: ConfigService,
  ) {
    this.delays = (
      config.get<number[]>('app.fulfillment.retryDelaysMs') ??
      config.get<number[]>('fulfillment.retryDelaysMs') ?? [
        60_000, 300_000, 900_000, 3_600_000,
      ]
    ).filter((value) => Number.isFinite(value) && value > 0);
  }

  async fulfillPaidOrder(orderId: string): Promise<FulfillmentResult> {
    const claim = await this.claim(orderId);
    const claimed = claim.fulfillment;
    if (!claim.acquired)
      return {
        kind: claimed.status === 'SUCCEEDED' ? 'FULFILLED' : 'DEFERRED',
        fulfillment: claimed,
      };
    try {
      const order = await this.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      return await this.subscriptions.withCustomerLease(
        order.customerId,
        async () => {
          const targetExpiresAt = await this.ensureTarget(
            claimed,
            order.customerId,
            order.durationDaysSnapshot,
          );
          await this.subscriptions.provisionWithLease(order.customerId, {
            tariffId: order.tariffId,
            targetExpiresAt,
            trafficLimitBytes: order.trafficLimitBytesSnapshot,
            deviceLimit: order.deviceLimitSnapshot,
          });
          const fulfillment = await this.prisma.$transaction(async (tx) => {
            const updated = await tx.orderFulfillment.update({
              where: { lockToken: claimed.lockToken! },
              data: {
                status: 'SUCCEEDED',
                lockToken: null,
                lockExpiresAt: null,
                completedAt: new Date(),
                nextRetryAt: null,
                lastError: null,
                retryable: false,
              },
            });
            await tx.order.update({
              where: { id: orderId },
              data: { status: 'FULFILLED', fulfilledAt: new Date() },
            });
            return updated;
          });
          return { kind: 'FULFILLED', fulfillment } as const;
        },
      );
    } catch (error) {
      const retryable = !(error instanceof RemnawaveError) || error.retryable;
      const fulfillment = await this.fail(claimed, error, retryable);
      return { kind: 'DEFERRED', fulfillment };
    }
  }

  async retryDue(limit = 20): Promise<void> {
    const now = new Date();
    const [due, paidWithoutJob] = await Promise.all([
      this.prisma.orderFulfillment.findMany({
        where: {
          OR: [
            { status: 'FAILED', retryable: true, nextRetryAt: { lte: now } },
            { status: 'PROCESSING', lockExpiresAt: { lte: now } },
          ],
        },
        select: { orderId: true },
        take: limit,
      }),
      this.prisma.order.findMany({
        where: { status: 'PAID', fulfillment: null },
        select: { id: true },
        take: limit,
      }),
    ]);
    const orderIds = [
      ...new Set([
        ...due.map(({ orderId }) => orderId),
        ...paidWithoutJob.map(({ id }) => id),
      ]),
    ].slice(0, limit);
    await Promise.allSettled(
      orderIds.map((orderId) => this.fulfillPaidOrder(orderId)),
    );
  }

  private async claim(
    orderId: string,
  ): Promise<{ fulfillment: OrderFulfillment; acquired: boolean }> {
    const token = randomUUID();
    return this.withSerializableRetry(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { customer: { include: { subscription: true } } },
      });
      if (!order) throw new Error('ORDER_NOT_FOUND');
      if (
        order.status !== 'PAID' &&
        order.status !== 'FULFILLMENT_FAILED' &&
        order.status !== 'FULFILLED'
      )
        throw new Error('ORDER_NOT_PAID');
      await tx.orderFulfillment.createMany({
        data: [{ orderId }],
        skipDuplicates: true,
      });
      const now = new Date();
      const changed = await tx.orderFulfillment.updateMany({
        where: {
          orderId,
          OR: [
            { status: 'PENDING' },
            {
              status: 'FAILED',
              retryable: true,
              nextRetryAt: { lte: now },
            },
            { status: 'PROCESSING', lockExpiresAt: { lte: now } },
          ],
        },
        data: {
          status: 'PROCESSING',
          lockToken: token,
          lockExpiresAt: new Date(now.getTime() + this.jobLeaseMs),
          attempts: { increment: 1 },
          startedAt: now,
        },
      });
      const fulfillment = await tx.orderFulfillment.findUniqueOrThrow({
        where: changed.count === 1 ? { lockToken: token } : { orderId },
      });
      return { fulfillment, acquired: changed.count === 1 };
    });
  }

  private async ensureTarget(
    claimed: OrderFulfillment,
    customerId: string,
    durationDays: number,
  ): Promise<Date> {
    if (claimed.targetExpiresAt) return claimed.targetExpiresAt;
    return this.withSerializableRetry(async (tx) => {
      const fulfillment = await tx.orderFulfillment.findUniqueOrThrow({
        where: { lockToken: claimed.lockToken! },
      });
      if (fulfillment.targetExpiresAt) return fulfillment.targetExpiresAt;
      const subscription = await tx.subscription.findUnique({
        where: { customerId },
        select: { expiresAt: true },
      });
      const base = Math.max(
        subscription?.expiresAt?.getTime() ?? 0,
        Date.now(),
      );
      const target = new Date(base + durationDays * 86_400_000);
      await tx.orderFulfillment.update({
        where: { lockToken: claimed.lockToken! },
        data: { targetExpiresAt: target },
      });
      return target;
    });
  }

  private async fail(
    claimed: OrderFulfillment,
    error: unknown,
    retryable: boolean,
  ): Promise<OrderFulfillment> {
    const code =
      error instanceof Error ? error.message.slice(0, 120) : 'UNKNOWN';
    const delay = retryable
      ? this.delays[Math.min(claimed.attempts - 1, this.delays.length - 1)]
      : undefined;
    const nextRetryAt =
      delay === undefined ? null : new Date(Date.now() + delay);
    this.logger.warn({
      event: 'fulfillment_failed',
      orderId: claimed.orderId,
      status: retryable ? 'retryable' : 'terminal',
      attempts: claimed.attempts,
    });
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.orderFulfillment.update({
        where: { lockToken: claimed.lockToken! },
        data: {
          status: 'FAILED',
          lockToken: null,
          lockExpiresAt: null,
          lastError: code,
          nextRetryAt,
          retryable,
        },
      });
      await tx.order.update({
        where: { id: claimed.orderId },
        data: { status: 'FULFILLMENT_FAILED' },
      });
      return result;
    });
  }

  private async withSerializableRetry<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          attempt >= 3 ||
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034'
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 10));
      }
    }
  }
}
