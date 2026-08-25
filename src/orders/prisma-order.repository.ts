import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TariffRecord } from '../catalog/catalog.types';
import { PrismaService } from '../database/prisma.service';
import type { OrderRecord, OrderRepository } from './order.types';

@Injectable()
export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createOrReusePending(
    customerId: string,
    tariff: TariffRecord,
  ): Promise<{ order: OrderRecord; created: boolean }> {
    if (tariff.amountXtr === null || tariff.amountXtr <= 0)
      throw new Error('TARIFF_XTR_NOT_CONFIGURED');
    const pendingCheckoutKey = `${customerId}:${tariff.id}`;
    const existing = await this.prisma.order.findUnique({
      where: { pendingCheckoutKey },
    });
    if (existing) return { order: existing as OrderRecord, created: false };
    const id = randomUUID();
    try {
      const order = await this.prisma.order.create({
        data: {
          id,
          customerId,
          tariffId: tariff.id,
          tariffNameSnapshot: tariff.name,
          durationDaysSnapshot: tariff.durationDays,
          amountXtr: tariff.amountXtr,
          currency: 'XTR',
          deviceLimitSnapshot: tariff.deviceLimit,
          trafficLimitBytesSnapshot: tariff.trafficLimitBytes,
          telegramInvoicePayload: `order:${id}`,
          pendingCheckoutKey,
        },
      });
      return { order: order as OrderRecord, created: true };
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      )
        throw error;
      const order = await this.prisma.order.findUniqueOrThrow({
        where: { pendingCheckoutKey },
      });
      return { order: order as OrderRecord, created: false };
    }
  }

  async findByPayload(payload: string): Promise<OrderRecord | null> {
    return this.prisma.order.findUnique({
      where: { telegramInvoicePayload: payload },
    }) as Promise<OrderRecord | null>;
  }
}
