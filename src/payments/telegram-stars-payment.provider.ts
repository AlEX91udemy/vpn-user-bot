import { Injectable } from '@nestjs/common';
import type { OrderRecord } from '../orders/order.types';
import type { InvoiceSpec, PaymentProvider } from './payment-provider.port';

@Injectable()
export class TelegramStarsPaymentProvider implements PaymentProvider {
  readonly id = 'TELEGRAM_STARS' as const;

  createInvoice(order: OrderRecord): InvoiceSpec {
    if (order.currency !== 'XTR' || order.amountXtr <= 0)
      throw new Error('INVALID_STARS_ORDER');
    return {
      title: `VPN — ${order.durationDaysSnapshot} дней`,
      description: `${order.tariffNameSnapshot}. Без автосписаний.`,
      payload: order.telegramInvoicePayload,
      currency: 'XTR',
      prices: [{ label: order.tariffNameSnapshot, amount: order.amountXtr }],
      startParameter: `order-${order.id}`,
    };
  }
}
