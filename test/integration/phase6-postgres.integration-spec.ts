import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { FulfillmentService } from '../../src/fulfillment/fulfillment.service';
import {
  RemnawaveError,
  type EnsureAccessInput,
  type RemnawaveGateway,
  type RemnawaveUser,
} from '../../src/remnawave/remnawave.types';
import { CustomerSubscriptionService } from '../../src/subscriptions/customer-subscription.service';
import { TrialService } from '../../src/trial/trial.service';

class FakeRemnawave implements RemnawaveGateway {
  readonly targets: Date[] = [];
  readonly users = new Map<string, RemnawaveUser>();
  failure?: RemnawaveError;
  delayMs = 0;
  revokeCalls = 0;

  async ensureAccess(input: EnsureAccessInput): Promise<RemnawaveUser> {
    this.targets.push(input.targetExpiresAt);
    if (this.delayMs)
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failure) throw this.failure;
    const existing = this.users.get(input.username);
    const user: RemnawaveUser = {
      id: existing?.id ?? this.users.size + 1,
      uuid: existing?.uuid ?? randomUUID(),
      username: input.username,
      status: 'ACTIVE',
      expireAt: input.targetExpiresAt,
      trafficLimitBytes: input.trafficLimitBytes ?? 0n,
      hwidDeviceLimit: input.deviceLimit,
      subscriptionUrl: `https://vpn.example.test/${input.username}`,
    };
    this.users.set(input.username, user);
    return user;
  }

  async getById(id: string): Promise<RemnawaveUser | null> {
    return (
      [...this.users.values()].find((user) => String(user.id) === id) ?? null
    );
  }

  async revokeSubscription(id: string): Promise<RemnawaveUser> {
    this.revokeCalls += 1;
    if (this.delayMs)
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const user = await this.getById(id);
    if (!user) throw new Error('not found');
    const updated = {
      ...user,
      subscriptionUrl: `https://vpn.example.test/reissued/${user.username}`,
    };
    this.users.set(user.username, updated);
    return updated;
  }
}

const config = {
  get: (key: string) =>
    key === 'fulfillment.retryDelaysMs' ? [1, 5, 10] : undefined,
} as ConfigService;

describe('Phase 6 with PostgreSQL', () => {
  const prisma = new PrismaClient();

  beforeAll(async () => prisma.$connect());
  afterAll(async () => prisma.$disconnect());
  beforeEach(async () => {
    await prisma.payment.deleteMany();
    await prisma.orderFulfillment.deleteMany();
    await prisma.order.deleteMany();
    await prisma.tariff.deleteMany();
    await prisma.trialClaim.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customerProvisioningLock.deleteMany();
    await prisma.customer.deleteMany();
  });

  async function customer(telegramUserId = 1n) {
    return prisma.customer.create({ data: { telegramUserId } });
  }

  async function paidOrder(customerId: string, suffix: string) {
    const tariff = await prisma.tariff.create({
      data: {
        name: `Month ${suffix}`,
        description: '30 days',
        durationDays: 30,
        amountMinor: 10000,
        amountXtr: 100,
        currency: 'RUB',
        deviceLimit: 5,
      },
    });
    return prisma.order.create({
      data: {
        customerId,
        tariffId: tariff.id,
        status: 'PAID',
        tariffNameSnapshot: tariff.name,
        durationDaysSnapshot: tariff.durationDays,
        amountXtr: tariff.amountXtr!,
        currency: 'XTR',
        deviceLimitSnapshot: tariff.deviceLimit,
        telegramInvoicePayload: `order:${suffix}`,
        paidAt: new Date(),
      },
    });
  }

  function services(gateway = new FakeRemnawave()) {
    const subscriptions = new CustomerSubscriptionService(
      prisma as never,
      gateway,
    );
    const fulfillment = new FulfillmentService(
      prisma as never,
      subscriptions,
      config,
    );
    const trial = new TrialService(prisma as never, subscriptions);
    return { gateway, subscriptions, fulfillment, trial };
  }

  it('enforces real unique constraints', async () => {
    const first = await customer(42n);
    await expect(customer(42n)).rejects.toMatchObject({ code: 'P2002' });
    await prisma.trialClaim.create({ data: { customerId: first.id } });
    await expect(
      prisma.trialClaim.create({ data: { customerId: first.id } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    const order = await paidOrder(first.id, 'unique');
    await prisma.orderFulfillment.create({ data: { orderId: order.id } });
    await expect(
      prisma.orderFulfillment.create({ data: { orderId: order.id } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows only one concurrent customer lease', async () => {
    const created = await customer();
    const { subscriptions } = services();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const first = subscriptions.withCustomerLease(created.id, () => held);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await expect(
      subscriptions.withCustomerLease(created.id, async () => undefined),
    ).rejects.toMatchObject({ message: 'CUSTOMER_PROVISIONING_BUSY' });
    release();
    await first;
  });

  it('allows only one concurrent subscription revoke and cools down repeats', async () => {
    const created = await customer();
    const gateway = new FakeRemnawave();
    const { subscriptions } = services(gateway);
    await subscriptions.provision(created.id, {
      tariffId: null,
      targetExpiresAt: new Date(Date.now() + 86_400_000),
      trafficLimitBytes: 10n,
      deviceLimit: 5,
    });
    gateway.delayMs = 100;
    const results = await Promise.allSettled([
      subscriptions.reissueOwn(created.id),
      subscriptions.reissueOwn(created.id),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    expect(gateway.revokeCalls).toBe(1);
    await expect(subscriptions.reissueOwn(created.id)).resolves.toMatchObject({
      kind: 'RECENTLY_REISSUED',
    });
    expect(gateway.revokeCalls).toBe(1);
  });

  it('serializes paid renewals without losing subscription duration', async () => {
    const created = await customer();
    const firstOrder = await paidOrder(created.id, 'first');
    const secondOrder = await paidOrder(created.id, 'second');
    const gateway = new FakeRemnawave();
    gateway.delayMs = 50;
    const { fulfillment } = services(gateway);

    await Promise.all([
      fulfillment.fulfillPaidOrder(firstOrder.id),
      fulfillment.fulfillPaidOrder(secondOrder.id),
    ]);
    await prisma.orderFulfillment.updateMany({
      where: { status: 'FAILED', retryable: true },
      data: { nextRetryAt: new Date(0) },
    });
    await fulfillment.retryDue();

    const orders = await prisma.order.findMany({
      where: { customerId: created.id },
    });
    expect(orders.every((order) => order.status === 'FULFILLED')).toBe(true);
    expect(gateway.targets).toHaveLength(2);
    const targets = gateway.targets.map(Number).sort((a, b) => a - b);
    expect(targets[1] - targets[0]).toBe(30 * 86_400_000);
  });

  it('recovers an expired PROCESSING fulfillment after process death', async () => {
    const created = await customer();
    const order = await paidOrder(created.id, 'crashed');
    await prisma.orderFulfillment.create({
      data: {
        orderId: order.id,
        status: 'PROCESSING',
        attempts: 1,
        lockToken: 'dead-process',
        lockExpiresAt: new Date(0),
      },
    });
    const { fulfillment } = services();
    await fulfillment.retryDue();
    await expect(
      prisma.order.findUnique({ where: { id: order.id } }),
    ).resolves.toMatchObject({
      status: 'FULFILLED',
    });
    await expect(
      prisma.orderFulfillment.findUnique({ where: { orderId: order.id } }),
    ).resolves.toMatchObject({
      status: 'SUCCEEDED',
      attempts: 2,
      lockToken: null,
    });
  });

  it('recovers PAID when the process died before creating a fulfillment job', async () => {
    const created = await customer();
    const order = await paidOrder(created.id, 'pre-job-crash');
    const { fulfillment, gateway } = services();
    await fulfillment.retryDue();
    await expect(
      prisma.order.findUnique({ where: { id: order.id } }),
    ).resolves.toMatchObject({
      status: 'FULFILLED',
    });
    expect(gateway.targets).toHaveLength(1);
  });

  it('recovers an expired PENDING trial without issuing a second trial', async () => {
    const created = await customer();
    const targetExpiresAt = new Date(Date.now() + 5 * 86_400_000);
    await prisma.trialClaim.create({
      data: {
        customerId: created.id,
        status: 'PENDING',
        attempts: 1,
        targetExpiresAt,
        lockToken: 'dead-trial-process',
        lockExpiresAt: new Date(0),
      },
    });
    const { trial, gateway } = services();
    await trial.retryDue();
    await expect(
      prisma.trialClaim.findUnique({ where: { customerId: created.id } }),
    ).resolves.toMatchObject({
      status: 'FULFILLED',
      attempts: 2,
    });
    expect(gateway.targets).toHaveLength(1);
    await expect(trial.claim(created.id)).resolves.toMatchObject({
      kind: 'ALREADY_USED',
    });
    expect(gateway.targets).toHaveLength(1);
  });

  it('does not retry terminal fulfillment errors', async () => {
    const created = await customer();
    const order = await paidOrder(created.id, 'terminal');
    const gateway = new FakeRemnawave();
    gateway.failure = new RemnawaveError('REMNAWAVE_VALIDATION_ERROR', false);
    const { fulfillment } = services(gateway);
    await fulfillment.fulfillPaidOrder(order.id);
    await fulfillment.fulfillPaidOrder(order.id);
    await fulfillment.retryDue();
    expect(gateway.targets).toHaveLength(1);
    await expect(
      prisma.orderFulfillment.findUnique({ where: { orderId: order.id } }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      retryable: false,
      nextRetryAt: null,
    });
  });

  it('never grants trial during a paid-order fulfillment race', async () => {
    const created = await customer();
    const order = await paidOrder(created.id, 'race');
    const gateway = new FakeRemnawave();
    gateway.delayMs = 40;
    const { fulfillment, trial } = services(gateway);
    const [, firstTrialResult] = await Promise.all([
      fulfillment.fulfillPaidOrder(order.id),
      trial.claim(created.id),
    ]);
    expect(['INELIGIBLE', 'DEFERRED']).toContain(firstTrialResult.kind);
    await prisma.orderFulfillment.updateMany({
      where: { status: 'FAILED', retryable: true },
      data: { nextRetryAt: new Date(0) },
    });
    await fulfillment.retryDue();
    await expect(trial.claim(created.id)).resolves.toMatchObject({
      kind: 'INELIGIBLE',
    });
    expect(
      await prisma.trialClaim.count({ where: { customerId: created.id } }),
    ).toBe(0);
    expect(gateway.targets).toHaveLength(1);
  });
});
