ALTER TABLE "customers" ADD COLUMN "remnawaveUserId" TEXT;
ALTER TABLE "customers" ADD COLUMN "remnawaveUsername" TEXT;

CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'DISABLED', 'PROVISIONING', 'ERROR');
CREATE TYPE "TrialClaimStatus" AS ENUM ('PENDING', 'FULFILLED', 'FAILED');
CREATE TYPE "FulfillmentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "subscriptions" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "remnawaveUserId" TEXT NOT NULL,
  "tariffId" TEXT,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'PROVISIONING',
  "expiresAt" TIMESTAMP(3),
  "trafficLimitBytes" BIGINT,
  "deviceLimit" INTEGER,
  "subscriptionUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastSyncedAt" TIMESTAMP(3),
  "lastSyncError" TEXT,
  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "trial_claims" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "status" "TrialClaimStatus" NOT NULL DEFAULT 'PENDING',
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fulfilledAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "nextRetryAt" TIMESTAMP(3),
  "targetExpiresAt" TIMESTAMP(3),
  "lockToken" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "trial_claims_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_fulfillments" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "status" "FulfillmentStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "nextRetryAt" TIMESTAMP(3),
  "targetExpiresAt" TIMESTAMP(3),
  "lockToken" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_fulfillments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_provisioning_locks" (
  "customerId" TEXT NOT NULL,
  "lockToken" TEXT,
  "lockedUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_provisioning_locks_pkey" PRIMARY KEY ("customerId")
);

CREATE UNIQUE INDEX "customers_remnawaveUserId_key" ON "customers"("remnawaveUserId");
CREATE UNIQUE INDEX "customers_remnawaveUsername_key" ON "customers"("remnawaveUsername");
CREATE UNIQUE INDEX "subscriptions_customerId_key" ON "subscriptions"("customerId");
CREATE UNIQUE INDEX "subscriptions_remnawaveUserId_key" ON "subscriptions"("remnawaveUserId");
CREATE UNIQUE INDEX "trial_claims_customerId_key" ON "trial_claims"("customerId");
CREATE UNIQUE INDEX "trial_claims_lockToken_key" ON "trial_claims"("lockToken");
CREATE UNIQUE INDEX "order_fulfillments_orderId_key" ON "order_fulfillments"("orderId");
CREATE UNIQUE INDEX "order_fulfillments_lockToken_key" ON "order_fulfillments"("lockToken");
CREATE UNIQUE INDEX "customer_provisioning_locks_lockToken_key" ON "customer_provisioning_locks"("lockToken");
CREATE INDEX "order_fulfillments_status_nextRetryAt_idx" ON "order_fulfillments"("status", "nextRetryAt");
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_fulfillments" ADD CONSTRAINT "order_fulfillments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_provisioning_locks" ADD CONSTRAINT "customer_provisioning_locks_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
