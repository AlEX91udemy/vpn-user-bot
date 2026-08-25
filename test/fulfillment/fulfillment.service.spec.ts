/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ConfigService } from '@nestjs/config';
import { FulfillmentService } from '../../src/fulfillment/fulfillment.service';
import type { CustomerSubscriptionService } from '../../src/subscriptions/customer-subscription.service';

function harness(options: { orderStatus?: string; fail?: Error } = {}) {
  const order = {
    id: 'order-1',
    customerId: 'customer-1',
    tariffId: 'month',
    status: options.orderStatus ?? 'PAID',
    durationDaysSnapshot: 31,
    trafficLimitBytesSnapshot: null,
    deviceLimitSnapshot: 5,
    customer: { subscription: null },
    fulfilledAt: null,
  };
  let fulfillment: any = null;
  let txTail = Promise.resolve();
  const tx = {
    order: {
      findUnique: jest.fn(async () => order),
      findUniqueOrThrow: jest.fn(async () => order),
      update: jest.fn(async ({ data }: any) => Object.assign(order, data)),
    },
    orderFulfillment: {
      createMany: jest.fn(async () => {
        fulfillment ??= {
          id: 'f-1',
          orderId: order.id,
          status: 'PENDING',
          attempts: 0,
          lockToken: null,
          targetExpiresAt: null,
          nextRetryAt: null,
        };
        return { count: 1 };
      }),
      updateMany: jest.fn(async ({ data }: any) => {
        if (!['PENDING', 'FAILED'].includes(fulfillment.status))
          return { count: 0 };
        fulfillment = {
          ...fulfillment,
          status: data.status,
          lockToken: data.lockToken,
          attempts: fulfillment.attempts + 1,
          startedAt: data.startedAt,
        };
        return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn(async () => fulfillment),
      update: jest.fn(
        async ({ data }: any) => (fulfillment = { ...fulfillment, ...data }),
      ),
      findMany: jest.fn(async () => []),
    },
    subscription: {
      findUnique: jest.fn(async () => null),
    },
    $transaction: (fn: (client: any) => unknown) => {
      const result = txTail.then(() => fn(tx));
      txTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  const provision = jest.fn(async () => {
    if (options.fail) throw options.fail;
    await Promise.resolve();
    return {};
  });
  const service = new FulfillmentService(
    tx as never,
    {
      withCustomerLease: async (
        _customerId: string,
        operation: () => Promise<unknown>,
      ) => operation(),
      provisionWithLease: provision,
    } as unknown as CustomerSubscriptionService,
    { get: () => [1, 5, 15, 60] } as unknown as ConfigService,
  );
  return { service, order, provision, getFulfillment: () => fulfillment };
}

describe('FulfillmentService', () => {
  it('moves PAID to FULFILLED only after provisioning succeeds', async () => {
    const h = harness();
    await expect(h.service.fulfillPaidOrder('order-1')).resolves.toMatchObject({
      kind: 'FULFILLED',
    });
    expect(h.order.status).toBe('FULFILLED');
    expect(h.provision).toHaveBeenCalledTimes(1);
  });

  it('moves paid order to FULFILLMENT_FAILED with retry metadata', async () => {
    const h = harness({ fail: new Error('temporary') });
    await expect(h.service.fulfillPaidOrder('order-1')).resolves.toMatchObject({
      kind: 'DEFERRED',
    });
    expect(h.order.status).toBe('FULFILLMENT_FAILED');
    expect(h.getFulfillment()).toMatchObject({ status: 'FAILED', attempts: 1 });
  });

  it('allows only one operation for 10 concurrent fulfillments', async () => {
    const h = harness();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => h.service.fulfillPaidOrder('order-1')),
    );
    expect(
      results.filter((result) => result.kind === 'FULFILLED'),
    ).toHaveLength(1);
    expect(h.provision).toHaveBeenCalledTimes(1);
    expect(h.order.status).toBe('FULFILLED');
  });

  it('does not fulfill an unpaid order', async () => {
    const h = harness({ orderStatus: 'PENDING_PAYMENT' });
    await expect(h.service.fulfillPaidOrder('order-1')).rejects.toThrow(
      'ORDER_NOT_PAID',
    );
    expect(h.provision).not.toHaveBeenCalled();
  });
});
