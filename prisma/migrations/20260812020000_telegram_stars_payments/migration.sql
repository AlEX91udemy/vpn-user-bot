ALTER TABLE "tariffs" ADD COLUMN "amountXtr" INTEGER;

CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'FULFILLED', 'CANCELED', 'PAYMENT_FAILED', 'FULFILLMENT_FAILED');
CREATE TYPE "PaymentProviderType" AS ENUM ('TELEGRAM_STARS');
CREATE TYPE "PaymentStatus" AS ENUM ('SUCCEEDED');

CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tariffId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "tariffNameSnapshot" TEXT NOT NULL,
    "durationDaysSnapshot" INTEGER NOT NULL,
    "amountXtr" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XTR',
    "deviceLimitSnapshot" INTEGER,
    "trafficLimitBytesSnapshot" BIGINT,
    "telegramInvoicePayload" TEXT NOT NULL,
    "telegramPaymentChargeId" TEXT,
    "pendingCheckoutKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" "PaymentProviderType" NOT NULL,
    "providerPaymentId" TEXT,
    "providerEventId" TEXT,
    "amountXtr" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XTR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'SUCCEEDED',
    "referenceMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orders_telegramInvoicePayload_key" ON "orders"("telegramInvoicePayload");
CREATE UNIQUE INDEX "orders_telegramPaymentChargeId_key" ON "orders"("telegramPaymentChargeId");
CREATE UNIQUE INDEX "orders_pendingCheckoutKey_key" ON "orders"("pendingCheckoutKey");
CREATE INDEX "orders_customerId_status_idx" ON "orders"("customerId", "status");
CREATE UNIQUE INDEX "payments_orderId_key" ON "payments"("orderId");
CREATE UNIQUE INDEX "payments_provider_providerPaymentId_key" ON "payments"("provider", "providerPaymentId");
CREATE UNIQUE INDEX "payments_provider_providerEventId_key" ON "payments"("provider", "providerEventId");
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "tariffs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
