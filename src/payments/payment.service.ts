import { Inject, Injectable, Logger } from '@nestjs/common';
import { OrderService } from '../orders/order.service';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
  type PaymentResult,
  type SuccessfulStarsPayment,
} from './payment.types';

export interface PreCheckoutInput {
  customerId: string;
  invoicePayload: string;
  currency: string;
  totalAmount: number;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  constructor(
    private readonly orders: OrderService,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
  ) {}

  async verifyPreCheckout(
    input: PreCheckoutInput,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const order = await this.orders.findByPayload(input.invoicePayload);
    const reject = (error: string) => {
      this.logger.warn({
        event: 'pre_checkout_rejected',
        customerId: input.customerId,
        provider: 'telegram_stars',
        currency: input.currency,
        amountXtr: input.totalAmount,
        status: error,
      });
      return { ok: false as const, error };
    };
    if (!order) return reject('Заказ не найден. Создайте новый счёт.');
    if (order.customerId !== input.customerId)
      return reject('Этот счёт принадлежит другому пользователю.');
    if (order.status !== 'PENDING_PAYMENT')
      return reject('Этот счёт уже обработан или недоступен.');
    if (input.currency !== 'XTR' || order.currency !== 'XTR')
      return reject('Неверная валюта счёта.');
    if (input.totalAmount !== order.amountXtr)
      return reject('Цена заказа изменилась. Создайте новый счёт.');
    this.logger.log({
      event: 'pre_checkout_accepted',
      orderId: order.id,
      customerId: input.customerId,
      provider: 'telegram_stars',
      currency: 'XTR',
      amountXtr: order.amountXtr,
      status: order.status,
    });
    return { ok: true };
  }

  async handleSuccessfulPayment(
    input: SuccessfulStarsPayment,
  ): Promise<PaymentResult> {
    this.logger.log({
      event: 'payment_received',
      customerId: input.customerId,
      provider: 'telegram_stars',
      currency: input.currency,
      amountXtr: input.totalAmount,
      status: 'received',
    });
    const result = await this.payments.markStarsPaymentPaid(input);
    this.logger.log({
      event: result.kind === 'PAID' ? 'order_marked_paid' : 'payment_duplicate',
      orderId: result.order.id,
      customerId: input.customerId,
      provider: 'telegram_stars',
      currency: result.order.currency,
      amountXtr: result.order.amountXtr,
      status: result.order.status,
    });
    return result;
  }
}
