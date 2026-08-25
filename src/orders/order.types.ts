import type { TariffRecord } from '../catalog/catalog.types';

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'FULFILLED'
  | 'CANCELED'
  | 'PAYMENT_FAILED'
  | 'FULFILLMENT_FAILED';

export interface OrderRecord {
  id: string;
  customerId: string;
  tariffId: string;
  status: OrderStatus;
  tariffNameSnapshot: string;
  durationDaysSnapshot: number;
  amountXtr: number;
  currency: 'XTR';
  deviceLimitSnapshot: number | null;
  trafficLimitBytesSnapshot: bigint | null;
  telegramInvoicePayload: string;
  telegramPaymentChargeId: string | null;
  paidAt: Date | null;
  fulfilledAt: Date | null;
}

export interface OrderRepository {
  createOrReusePending(
    customerId: string,
    tariff: TariffRecord,
  ): Promise<{ order: OrderRecord; created: boolean }>;
  findByPayload(payload: string): Promise<OrderRecord | null>;
}

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');
