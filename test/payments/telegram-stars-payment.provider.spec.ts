import { TelegramStarsPaymentProvider } from '../../src/payments/telegram-stars-payment.provider';
import type { OrderRecord } from '../../src/orders/order.types';

const order: OrderRecord = {
  id: 'order-1',
  customerId: 'customer-1',
  tariffId: 'month',
  status: 'PENDING_PAYMENT',
  tariffNameSnapshot: 'VPN — 31 день',
  durationDaysSnapshot: 31,
  amountXtr: 125,
  currency: 'XTR',
  deviceLimitSnapshot: 5,
  trafficLimitBytesSnapshot: null,
  telegramInvoicePayload: 'order:order-1',
  telegramPaymentChargeId: null,
  paidAt: null,
  fulfilledAt: null,
};

describe('TelegramStarsPaymentProvider', () => {
  it('creates an XTR invoice with exactly one server-side price', () => {
    const invoice = new TelegramStarsPaymentProvider().createInvoice(order);
    expect(invoice).toMatchObject({
      currency: 'XTR',
      payload: 'order:order-1',
      prices: [{ amount: 125 }],
    });
    expect(invoice.prices).toHaveLength(1);
    expect(invoice).not.toHaveProperty('providerToken');
  });
});
