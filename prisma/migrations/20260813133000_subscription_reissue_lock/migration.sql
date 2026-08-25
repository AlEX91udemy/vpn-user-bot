CREATE TABLE "subscription_reissue_locks" (
    "customerId" TEXT NOT NULL,
    "lockToken" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "cooldownUntil" TIMESTAMP(3),
    "lastSucceededAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_reissue_locks_pkey" PRIMARY KEY ("customerId")
);

CREATE UNIQUE INDEX "subscription_reissue_locks_lockToken_key"
ON "subscription_reissue_locks"("lockToken");

ALTER TABLE "subscription_reissue_locks"
ADD CONSTRAINT "subscription_reissue_locks_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "customers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
