/* eslint-disable @typescript-eslint/no-explicit-any */
import { TrialService } from '../../src/trial/trial.service';
import type { CustomerSubscriptionService } from '../../src/subscriptions/customer-subscription.service';

function harness(failFirst = false) {
  let claim: any = null;
  let transactionTail = Promise.resolve();
  let calls = 0;
  const db: any = {
    trialClaim: {
      findUnique: jest.fn(async () => claim),
      create: jest.fn(
        async ({ data }: any) =>
          (claim = { id: 'trial-1', fulfilledAt: null, ...data }),
      ),
      updateMany: jest.fn(async ({ data }: any) => {
        if (claim?.status !== 'FAILED') return { count: 0 };
        claim = {
          ...claim,
          status: data.status,
          attempts: claim.attempts + 1,
          lockToken: data.lockToken,
        };
        return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn(async () => claim),
      update: jest.fn(async ({ data }: any) => (claim = { ...claim, ...data })),
      findMany: jest.fn(async () => []),
    },
    subscription: { findUnique: jest.fn(async () => null) },
    order: { findFirst: jest.fn(async () => null) },
  };
  db.$transaction = (fn: (client: any) => unknown) => {
    const result = transactionTail.then(() => fn(db));
    transactionTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const provision = jest.fn(async () => {
    calls += 1;
    if (failFirst && calls === 1) throw new Error('timeout');
    return {};
  });
  return {
    service: new TrialService(db, {
      withCustomerLease: async (
        _customerId: string,
        operation: () => Promise<unknown>,
      ) => operation(),
      provisionWithLease: provision,
    } as unknown as CustomerSubscriptionService),
    provision,
    getClaim: () => claim,
  };
}

describe('TrialService', () => {
  it('creates and fulfills the first claim', async () => {
    const h = harness();
    await expect(h.service.claim('customer-1')).resolves.toMatchObject({
      kind: 'FULFILLED',
    });
    expect(h.getClaim()).toMatchObject({ status: 'FULFILLED', attempts: 1 });
  });

  it('rejects a second fulfilled claim without provisioning', async () => {
    const h = harness();
    await h.service.claim('customer-1');
    await expect(h.service.claim('customer-1')).resolves.toMatchObject({
      kind: 'ALREADY_USED',
    });
    expect(h.provision).toHaveBeenCalledTimes(1);
  });

  it('allows one provisioning operation for 10 concurrent claims', async () => {
    const h = harness();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => h.service.claim('customer-1')),
    );
    expect(
      results.filter((result) => result.kind === 'FULFILLED'),
    ).toHaveLength(1);
    expect(h.provision).toHaveBeenCalledTimes(1);
  });

  it('retains a failed claim and retries the same entitlement', async () => {
    const h = harness(true);
    await expect(h.service.claim('customer-1')).resolves.toMatchObject({
      kind: 'DEFERRED',
    });
    const target = h.getClaim().targetExpiresAt;
    h.getClaim().nextRetryAt = new Date(0);
    await expect(h.service.claim('customer-1')).resolves.toMatchObject({
      kind: 'FULFILLED',
    });
    expect(h.getClaim().targetExpiresAt).toEqual(target);
    expect(h.getClaim().attempts).toBe(2);
  });
});
