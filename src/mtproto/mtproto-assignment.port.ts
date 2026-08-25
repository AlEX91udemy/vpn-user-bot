export interface MtprotoAssignment {
  proxyUrl: string;
  latencyMs: number | null;
}

export interface MtprotoAssignmentPort {
  getCurrentAssignment(telegramUserId: number): Promise<MtprotoAssignment | null>;
  rotateAssignment(telegramUserId: number): Promise<MtprotoAssignment | null>;
  getShareLink(telegramUserId: number): Promise<string | null>;
  checkAssignment(telegramUserId: number): Promise<MtprotoAssignment | null>;
}

export const MTPROTO_ASSIGNMENT_PORT = Symbol('MTPROTO_ASSIGNMENT_PORT');

export class MtprotoAssignmentError extends Error {
  constructor(
    readonly code:
      | 'PROXY_UNAVAILABLE'
      | 'SERVICE_UNAVAILABLE'
      | 'RATE_LIMITED',
  ) {
    super(code);
  }
}
