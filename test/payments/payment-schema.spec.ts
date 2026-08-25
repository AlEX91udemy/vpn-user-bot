import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('payment database constraints', () => {
  const schema = readFileSync(
    join(process.cwd(), 'prisma/schema.prisma'),
    'utf8',
  );
  it('enforces one Payment per order and unique provider identifiers', () => {
    expect(schema).toContain('orderId           String              @unique');
    expect(schema).toContain('@@unique([provider, providerPaymentId])');
    expect(schema).toContain('@@unique([provider, providerEventId])');
  });
  it('enforces one Trial, Subscription and fulfillment per owner', () => {
    expect(schema).toMatch(/model TrialClaim[\s\S]*customerId\s+String\s+@unique/);
    expect(schema).toMatch(/model OrderFulfillment[\s\S]*orderId\s+String\s+@unique/);
    expect(schema).toMatch(/remnawaveUserId\s+String\?\s+@unique/);
    expect(schema).toContain('model CustomerProvisioningLock');
  });
});
