import { Inject, Injectable } from '@nestjs/common';
import {
  MTPROTO_ASSIGNMENT_PORT,
  MtprotoAssignmentError,
  type MtprotoAssignment,
  type MtprotoAssignmentPort,
} from './mtproto-assignment.port';

@Injectable()
export class MtprotoService {
  private static readonly ROTATION_COOLDOWN_MS = 5 * 60 * 1000;
  private readonly lastRotationAt = new Map<number, number>();

  constructor(
    @Inject(MTPROTO_ASSIGNMENT_PORT)
    private readonly assignments: MtprotoAssignmentPort,
  ) {}

  getOwn(telegramUserId: number): Promise<MtprotoAssignment | null> {
    return this.assignments.getCurrentAssignment(telegramUserId);
  }

  async rotateOwn(telegramUserId: number): Promise<MtprotoAssignment | null> {
    const now = Date.now();
    const lastRotationAt = this.lastRotationAt.get(telegramUserId);
    if (
      lastRotationAt !== undefined &&
      now - lastRotationAt < MtprotoService.ROTATION_COOLDOWN_MS
    ) {
      throw new MtprotoAssignmentError('RATE_LIMITED');
    }
    this.lastRotationAt.set(telegramUserId, now);
    try {
      return await this.assignments.rotateAssignment(telegramUserId);
    } catch (error) {
      this.lastRotationAt.delete(telegramUserId);
      throw error;
    }
  }

  shareOwn(telegramUserId: number): Promise<string | null> {
    return this.assignments.getShareLink(telegramUserId);
  }

  checkOwn(telegramUserId: number): Promise<MtprotoAssignment | null> {
    return this.assignments.checkAssignment(telegramUserId);
  }
}
