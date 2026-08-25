export type RemnawaveStatus = 'ACTIVE' | 'DISABLED' | 'LIMITED' | 'EXPIRED';

export interface RemnawaveUser {
  id: number;
  uuid: string;
  username: string;
  status: RemnawaveStatus;
  expireAt: Date;
  trafficLimitBytes: bigint;
  hwidDeviceLimit: number | null;
  subscriptionUrl: string;
}

export interface EnsureAccessInput {
  username: string;
  knownUserId: string | null;
  targetExpiresAt: Date;
  trafficLimitBytes: bigint | null;
  deviceLimit: number | null;
}

export const REMNAWAVE_GATEWAY = Symbol('REMNAWAVE_GATEWAY');

export interface RemnawaveGateway {
  ensureAccess(input: EnsureAccessInput): Promise<RemnawaveUser>;
  getById(id: string): Promise<RemnawaveUser | null>;
  revokeSubscription(id: string): Promise<RemnawaveUser>;
}

export class RemnawaveError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly ambiguousMutation = false,
  ) {
    super(message);
  }
}
