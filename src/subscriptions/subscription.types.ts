export type LocalSubscriptionStatus =
  'ACTIVE' | 'EXPIRED' | 'DISABLED' | 'PROVISIONING' | 'ERROR';

export interface SubscriptionRecord {
  id: string;
  customerId: string;
  remnawaveUserId: string;
  tariffId: string | null;
  status: LocalSubscriptionStatus;
  expiresAt: Date | null;
  trafficLimitBytes: bigint | null;
  deviceLimit: number | null;
  subscriptionUrl: string | null;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
}

export interface Entitlement {
  tariffId: string | null;
  targetExpiresAt: Date;
  trafficLimitBytes: bigint | null;
  deviceLimit: number | null;
}

export type SubscriptionReissueResult =
  | { kind: 'REISSUED'; subscription: SubscriptionRecord }
  | { kind: 'RECENTLY_REISSUED'; subscription: SubscriptionRecord };

export class SubscriptionOperationError extends Error {
  constructor(readonly code: 'SUBSCRIPTION_NOT_FOUND' | 'REISSUE_BUSY') {
    super(code);
  }
}
