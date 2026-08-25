/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  RemnawaveError,
  type RemnawaveGateway,
} from '../../src/remnawave/remnawave.types';
import { CustomerSubscriptionService } from '../../src/subscriptions/customer-subscription.service';

const remoteUser = {
  id: 7,
  uuid: '11111111-1111-4111-8111-111111111111',
  username: 'vpn_customer-1',
  status: 'ACTIVE' as const,
  expireAt: new Date('2026-09-12T00:00:00Z'),
  trafficLimitBytes: 10n,
  hwidDeviceLimit: 5,
  subscriptionUrl: 'https://sub.example/private',
};

function harness() {
  const customer: any = {
    id: 'customer-1',
    remnawaveUserId: null,
    remnawaveUsername: null,
  };
  let subscription: any = null;
  let reissueLock: any = null;
  let currentRemote = { ...remoteUser };
  const db: any = {
    customer: {
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        if (where.id !== customer.id) throw new Error('not found');
        return customer;
      }),
      update: jest.fn(async ({ data }: any) => Object.assign(customer, data)),
    },
    customerProvisioningLock: {
      createMany: jest.fn(async () => ({ count: 1 })),
      updateMany: jest.fn(async ({ data }: any) =>
        data.lockToken ? { count: 1 } : { count: 1 },
      ),
    },
    subscriptionReissueLock: {
      createMany: jest.fn(async () => {
        reissueLock ??= { customerId: customer.id, lockToken: null };
        return { count: 1 };
      }),
      findUnique: jest.fn(async () => reissueLock),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (data.lockToken) {
          const now = new Date();
          if (
            reissueLock.lockToken ||
            (reissueLock.cooldownUntil && reissueLock.cooldownUntil > now)
          )
            return { count: 0 };
        } else if (
          where.lockToken &&
          reissueLock.lockToken !== where.lockToken
        ) {
          return { count: 0 };
        }
        Object.assign(reissueLock, data);
        return { count: 1 };
      }),
    },
    subscription: {
      upsert: jest.fn(
        async ({ create, update }: any) =>
          (subscription = { id: 'sub-1', ...(subscription ? update : create) }),
      ),
      findUnique: jest.fn(async ({ where }: any) =>
        where.customerId === customer.id ? subscription : null,
      ),
      update: jest.fn(
        async ({ data }: any) => (subscription = { ...subscription, ...data }),
      ),
    },
  };
  db.$transaction = (fn: (client: any) => unknown) => fn(db);
  const gateway: RemnawaveGateway = {
    ensureAccess: jest.fn(async () => currentRemote),
    getById: jest.fn(async () => currentRemote),
    revokeSubscription: jest.fn(async () => {
      currentRemote = {
        ...currentRemote,
        subscriptionUrl: 'https://sub.example/reissued',
      };
      return currentRemote;
    }),
  };
  return {
    service: new CustomerSubscriptionService(db, gateway),
    gateway,
    customer,
    db,
    getSubscription: () => subscription,
  };
}

describe('CustomerSubscriptionService', () => {
  it('uses deterministic server identity and stores the own projection', async () => {
    const h = harness();
    await h.service.provision('customer-1', {
      tariffId: 'month',
      targetExpiresAt: remoteUser.expireAt,
      trafficLimitBytes: 10n,
      deviceLimit: 5,
    });
    expect(h.gateway.ensureAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'vpn_customer-1',
        knownUserId: null,
      }),
    );
    expect(h.customer.remnawaveUserId).toBe('7');
    expect(h.getSubscription()).toMatchObject({
      customerId: 'customer-1',
      status: 'ACTIVE',
      tariffId: 'month',
    });
  });

  it('loads subscription only by server-side customer ownership', async () => {
    const h = harness();
    await h.service.provision('customer-1', {
      tariffId: null,
      targetExpiresAt: remoteUser.expireAt,
      trafficLimitBytes: 10n,
      deviceLimit: 5,
    });
    await expect(h.service.getOwn('customer-1')).resolves.toMatchObject({
      customerId: 'customer-1',
    });
    await expect(h.service.getOwn('foreign-customer')).resolves.toBeNull();
  });

  it('refreshes status and expiry from Remnawave without accepting a remote UUID', async () => {
    const h = harness();
    await h.service.provision('customer-1', {
      tariffId: 'month',
      targetExpiresAt: remoteUser.expireAt,
      trafficLimitBytes: 10n,
      deviceLimit: 5,
    });
    await h.service.refreshOwn('customer-1');
    expect(h.gateway.getById).toHaveBeenCalledWith('7');
  });

  it('reissues the owned subscription and persists the new URL', async () => {
    const h = harness();
    await h.service.provision('customer-1', {
      tariffId: 'month',
      targetExpiresAt: remoteUser.expireAt,
      trafficLimitBytes: 10n,
      deviceLimit: 5,
    });
    const result = await h.service.reissueOwn('customer-1');
    expect(result).toMatchObject({
      kind: 'REISSUED',
      subscription: { subscriptionUrl: 'https://sub.example/reissued' },
    });
    expect(h.gateway.revokeSubscription).toHaveBeenCalledWith('7');
  });

  it('does not revoke again during the cooldown', async () => {
    const h = harness();
    await h.service.provision('customer-1', {
      tariffId: 'month',
      targetExpiresAt: remoteUser.expireAt,
      trafficLimitBytes: 10n,
      deviceLimit: 5,
    });
    await h.service.reissueOwn('customer-1');
    await expect(h.service.reissueOwn('customer-1')).resolves.toMatchObject({
      kind: 'RECENTLY_REISSUED',
    });
    expect(h.gateway.revokeSubscription).toHaveBeenCalledTimes(1);
  });

  it('allows only one parallel revoke for the same customer', async () => {
    const h = harness();
    await h.service.provision('customer-1', {
      tariffId: 'month',
      targetExpiresAt: remoteUser.expireAt,
      trafficLimitBytes: 10n,
      deviceLimit: 5,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    (h.gateway.revokeSubscription as jest.Mock).mockImplementationOnce(
      async () => {
        await gate;
        return {
          ...remoteUser,
          subscriptionUrl: 'https://sub.example/reissued',
        };
      },
    );
    const first = h.service.reissueOwn('customer-1');
    await new Promise((resolve) => setImmediate(resolve));
    await expect(h.service.reissueOwn('customer-1')).rejects.toMatchObject({
      code: 'REISSUE_BUSY',
    });
    release();
    await expect(first).resolves.toMatchObject({ kind: 'REISSUED' });
    expect(h.gateway.revokeSubscription).toHaveBeenCalledTimes(1);
  });

  it('keeps the current local subscription when revoke fails', async () => {
    const h = harness();
    await h.service.provision('customer-1', {
      tariffId: 'month',
      targetExpiresAt: remoteUser.expireAt,
      trafficLimitBytes: 10n,
      deviceLimit: 5,
    });
    (h.gateway.revokeSubscription as jest.Mock).mockRejectedValueOnce(
      new Error('remote unavailable'),
    );
    await expect(h.service.reissueOwn('customer-1')).rejects.toThrow(
      'remote unavailable',
    );
    expect(h.getSubscription().subscriptionUrl).toBe(
      'https://sub.example/private',
    );
  });

  it('reconciles an ambiguous revoke response without a second mutation', async () => {
    const h = harness();
    await h.service.provision('customer-1', {
      tariffId: 'month',
      targetExpiresAt: remoteUser.expireAt,
      trafficLimitBytes: 10n,
      deviceLimit: 5,
    });
    (h.gateway.revokeSubscription as jest.Mock).mockRejectedValueOnce(
      new RemnawaveError('REMNAWAVE_NETWORK_ERROR', true, true),
    );
    (h.gateway.getById as jest.Mock).mockResolvedValueOnce({
      ...remoteUser,
      subscriptionUrl: 'https://sub.example/reconciled',
    });
    await expect(h.service.reissueOwn('customer-1')).resolves.toMatchObject({
      kind: 'REISSUED',
      subscription: { subscriptionUrl: 'https://sub.example/reconciled' },
    });
    expect(h.gateway.revokeSubscription).toHaveBeenCalledTimes(1);
  });

  it('cannot reissue another customer subscription', async () => {
    const h = harness();
    await expect(
      h.service.reissueOwn('foreign-customer'),
    ).rejects.toMatchObject({
      code: 'SUBSCRIPTION_NOT_FOUND',
    });
    expect(h.gateway.revokeSubscription).not.toHaveBeenCalled();
  });
});
