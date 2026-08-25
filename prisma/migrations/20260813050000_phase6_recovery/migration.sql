ALTER TABLE "trial_claims"
  ADD COLUMN "lockExpiresAt" TIMESTAMP(3),
  ADD COLUMN "retryable" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "order_fulfillments"
  ADD COLUMN "lockExpiresAt" TIMESTAMP(3),
  ADD COLUMN "retryable" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "trial_claims_status_nextRetryAt_lockExpiresAt_idx"
  ON "trial_claims"("status", "nextRetryAt", "lockExpiresAt");
