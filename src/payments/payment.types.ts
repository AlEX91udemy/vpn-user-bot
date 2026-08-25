import type { OrderRecord } from '../orders/order.types';

export interface SuccessfulStarsPayment {
  customerId: string;
  invoicePayload: string;
  currency: string;
  totalAmount: number;
  telegramPaymentChargeId: string;
}

export type PaymentResult =
  | { kind: 'PAID'; order: OrderRecord }
  | { kind: 'DUPLICATE'; order: OrderRecord };

export interface PaymentRepository {
  markStarsPaymentPaid(input: SuccessfulStarsPayment): Promise<PaymentResult>;
}

export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');
