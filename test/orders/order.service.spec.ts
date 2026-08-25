import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CatalogService } from '../../src/catalog/catalog.service';
import { OrderService } from '../../src/orders/order.service';
import type {
  OrderRecord,
  OrderRepository,
} from '../../src/orders/order.types';
import type { TariffRecord } from '../../src/catalog/catalog.types';
import {
  activeTariff,
  InMemoryTariffRepository,
} from '../helpers/in-memory.repositories';

class Orders implements OrderRepository {
  rows: OrderRecord[] = [];
  async createOrReusePending(customerId: string, tariff: TariffRecord) {
    const existing = this.rows.find(
      (row) =>
        row.customerId === customerId &&
        row.tariffId === tariff.id &&
        row.status === 'PENDING_PAYMENT',
    );
    if (existing) return { order: existing, created: false };
    const order: OrderRecord = {
      id: 'order-1',
      customerId,
      tariffId: tariff.id,
      status: 'PENDING_PAYMENT',
      tariffNameSnapshot: tariff.name,
      durationDaysSnapshot: tariff.durationDays,
      amountXtr: tariff.amountXtr!,
      currency: 'XTR',
      deviceLimitSnapshot: tariff.deviceLimit,
      trafficLimitBytesSnapshot: tariff.trafficLimitBytes,
      telegramInvoicePayload: 'order:order-1',
      telegramPaymentChargeId: null,
      paidAt: null,
      fulfilledAt: null,
    };
    this.rows.push(order);
    return { order, created: true };
  }
  async findByPayload(payload: string) {
    return (
      this.rows.find((row) => row.telegramInvoicePayload === payload) ?? null
    );
  }
}

describe('OrderService', () => {
  it('creates an order with a server-side tariff snapshot and XTR amount', async () => {
    const repo = new Orders();
    const service = new OrderService(
      new CatalogService(
        new InMemoryTariffRepository([
          activeTariff({ amountMinor: 17_900, amountXtr: 125 }),
        ]),
      ),
      repo,
    );
    const order = await service.createCheckout('customer-1', 'opaque-30');
    expect(order).toMatchObject({
      customerId: 'customer-1',
      amountXtr: 125,
      currency: 'XTR',
      tariffNameSnapshot: 'VPN на 30 дней',
      durationDaysSnapshot: 30,
    });
  });

  it('reuses one pending checkout for rapid repeated clicks', async () => {
    const repo = new Orders();
    const service = new OrderService(
      new CatalogService(new InMemoryTariffRepository([activeTariff()])),
      repo,
    );
    const [first, second] = await Promise.all([
      service.createCheckout('customer-1', 'opaque-30'),
      service.createCheckout('customer-1', 'opaque-30'),
    ]);
    expect(first.id).toBe(second.id);
    expect(repo.rows).toHaveLength(1);
  });

  it('rejects unconfigured XTR, inactive and invalid tariff IDs', async () => {
    const noXtr = new OrderService(
      new CatalogService(
        new InMemoryTariffRepository([activeTariff({ amountXtr: null })]),
      ),
      new Orders(),
    );
    await expect(
      noXtr.createCheckout('customer-1', 'opaque-30'),
    ).rejects.toBeInstanceOf(BadRequestException);
    const inactive = new OrderService(
      new CatalogService(
        new InMemoryTariffRepository([activeTariff({ isActive: false })]),
      ),
      new Orders(),
    );
    await expect(
      inactive.createCheckout('customer-1', 'opaque-30'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      inactive.createCheckout('customer-1', 'opaque-30:999:XTR'),
    ).rejects.toThrow();
  });
});
