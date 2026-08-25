import type { OrderService } from '../../src/orders/order.service';
import type { OrderRecord } from '../../src/orders/order.types';
import { PaymentService } from '../../src/payments/payment.service';
import type {
  PaymentRepository,
  SuccessfulStarsPayment,
} from '../../src/payments/payment.types';

const pending = (): OrderRecord => ({
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
});

class AtomicPayments implements PaymentRepository {
  paymentCount = 0;
  private locked = false;
  constructor(readonly order: OrderRecord) {}
  async markStarsPaymentPaid(input: SuccessfulStarsPayment) {
    while (this.locked) await Promise.resolve();
    this.locked = true;
    try {
      if (this.order.telegramInvoicePayload !== input.invoicePayload)
        throw new Error('ORDER_NOT_FOUND');
      if (this.order.customerId !== input.customerId)
        throw new Error('ORDER_OWNERSHIP_MISMATCH');
      if (input.currency !== 'XTR')
        throw new Error('PAYMENT_CURRENCY_MISMATCH');
      if (input.totalAmount !== this.order.amountXtr)
        throw new Error('PAYMENT_AMOUNT_MISMATCH');
      if (this.order.status === 'PAID' || this.order.status === 'FULFILLED') {
        if (
          this.order.telegramPaymentChargeId === input.telegramPaymentChargeId
        )
          return { kind: 'DUPLICATE' as const, order: this.order };
        throw new Error('ORDER_ALREADY_PAID');
      }
      if (this.order.status !== 'PENDING_PAYMENT')
        throw new Error('ORDER_NOT_PAYABLE');
      this.order.status = 'PAID';
      this.order.telegramPaymentChargeId = input.telegramPaymentChargeId;
      this.order.paidAt = new Date();
      this.paymentCount += 1;
      return { kind: 'PAID' as const, order: this.order };
    } finally {
      this.locked = false;
    }
  }
}

describe('PaymentService', () => {
  it.each([
    [{ currency: 'XTR', totalAmount: 125, customerId: 'customer-1' }, true],
    [{ currency: 'XTR', totalAmount: 999, customerId: 'customer-1' }, false],
    [{ currency: 'RUB', totalAmount: 125, customerId: 'customer-1' }, false],
    [{ currency: 'XTR', totalAmount: 125, customerId: 'customer-2' }, false],
  ])(
    'validates pre-checkout against the order: %j',
    async (fields, expected) => {
      const order = pending();
      const service = new PaymentService(
        {
          findByPayload: jest.fn().mockResolvedValue(order),
        } as unknown as OrderService,
        new AtomicPayments(order),
      );
      await expect(
        service.verifyPreCheckout({
          invoicePayload: order.telegramInvoicePayload,
          ...fields,
        }),
      ).resolves.toMatchObject({ ok: expected });
    },
  );

  it('rejects unknown, already PAID and already FULFILLED orders at pre-checkout', async () => {
    for (const order of [
      null,
      { ...pending(), status: 'PAID' as const },
      { ...pending(), status: 'FULFILLED' as const },
    ]) {
      const service = new PaymentService(
        {
          findByPayload: jest.fn().mockResolvedValue(order),
        } as unknown as OrderService,
        new AtomicPayments(pending()),
      );
      await expect(
        service.verifyPreCheckout({
          customerId: 'customer-1',
          invoicePayload: 'order:order-1',
          currency: 'XTR',
          totalAmount: 125,
        }),
      ).resolves.toMatchObject({ ok: false });
    }
  });

  it('handles one successful payment and duplicate updates idempotently', async () => {
    const order = pending();
    const repo = new AtomicPayments(order);
    const service = new PaymentService(
      { findByPayload: jest.fn() } as unknown as OrderService,
      repo,
    );
    const input = {
      customerId: 'customer-1',
      invoicePayload: 'order:order-1',
      currency: 'XTR',
      totalAmount: 125,
      telegramPaymentChargeId: 'charge-1',
    };
    await expect(service.handleSuccessfulPayment(input)).resolves.toMatchObject(
      { kind: 'PAID' },
    );
    await expect(service.handleSuccessfulPayment(input)).resolves.toMatchObject(
      { kind: 'DUPLICATE' },
    );
    expect(repo.paymentCount).toBe(1);
    expect(order.status).toBe('PAID');
  });

  it('handles 10 parallel duplicate updates with one state transition and one Payment', async () => {
    const order = pending();
    const repo = new AtomicPayments(order);
    const service = new PaymentService(
      { findByPayload: jest.fn() } as unknown as OrderService,
      repo,
    );
    const input = {
      customerId: 'customer-1',
      invoicePayload: 'order:order-1',
      currency: 'XTR',
      totalAmount: 125,
      telegramPaymentChargeId: 'charge-1',
    };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => service.handleSuccessfulPayment(input)),
    );
    expect(results.filter((result) => result.kind === 'PAID')).toHaveLength(1);
    expect(
      results.filter((result) => result.kind === 'DUPLICATE'),
    ).toHaveLength(9);
    expect(repo.paymentCount).toBe(1);
  });

  it.each([
    { currency: 'RUB', totalAmount: 125 },
    { currency: 'XTR', totalAmount: 999 },
  ])('rejects a successful payment mismatch: %j', async (mismatch) => {
    const order = pending();
    const service = new PaymentService(
      { findByPayload: jest.fn() } as unknown as OrderService,
      new AtomicPayments(order),
    );
    await expect(
      service.handleSuccessfulPayment({
        customerId: 'customer-1',
        invoicePayload: order.telegramInvoicePayload,
        telegramPaymentChargeId: 'charge-1',
        ...mismatch,
      }),
    ).rejects.toThrow();
  });

  it('rejects unknown orders and different charges for PAID/FULFILLED orders', async () => {
    for (const order of [
      {
        ...pending(),
        status: 'PAID' as const,
        telegramPaymentChargeId: 'original',
      },
      {
        ...pending(),
        status: 'FULFILLED' as const,
        telegramPaymentChargeId: 'original',
      },
    ]) {
      const service = new PaymentService(
        { findByPayload: jest.fn() } as unknown as OrderService,
        new AtomicPayments(order),
      );
      await expect(
        service.handleSuccessfulPayment({
          customerId: 'customer-1',
          invoicePayload: 'order:order-1',
          currency: 'XTR',
          totalAmount: 125,
          telegramPaymentChargeId: 'different',
        }),
      ).rejects.toThrow('ORDER_ALREADY_PAID');
    }
    const service = new PaymentService(
      { findByPayload: jest.fn() } as unknown as OrderService,
      new AtomicPayments(pending()),
    );
    await expect(
      service.handleSuccessfulPayment({
        customerId: 'customer-1',
        invoicePayload: 'order:unknown',
        currency: 'XTR',
        totalAmount: 125,
        telegramPaymentChargeId: 'charge',
      }),
    ).rejects.toThrow('ORDER_NOT_FOUND');
  });
});
