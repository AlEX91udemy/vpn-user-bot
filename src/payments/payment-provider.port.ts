import type { OrderRecord } from '../orders/order.types';

export interface InvoiceSpec {
  title: string;
  description: string;
  payload: string;
  currency: 'XTR';
  prices: readonly [{ label: string; amount: number }];
  startParameter: string;
}

export interface PaymentProvider {
  readonly id: 'TELEGRAM_STARS';
  createInvoice(order: OrderRecord): InvoiceSpec;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
