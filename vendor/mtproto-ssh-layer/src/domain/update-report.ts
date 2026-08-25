import type { BackupRecord } from './backup-store.port';
import type { Candidate } from './candidate';
import type { HealthCheckResult } from './health-checker.port';
import type { ProviderConfig } from './mtproto-provider.port';

export interface BackupResult {
  readonly record: BackupRecord;
}

export interface ApplyResult {
  readonly configHash: string;
}

export interface RestartResult {
  readonly restartedAt: Date;
}

export interface RollbackResult {
  readonly attempted: boolean;
  readonly succeeded: boolean;
  readonly restoredBackupId?: string;
  readonly health?: HealthCheckResult;
}

/**
 * The one object `UpdateMtprotoUseCase` returns, success or failure — a
 * Telegram layer (or anything else) only ever renders this, never touches
 * `application/`/`infrastructure/` types directly. Every field but
 * `startedAt`/`finishedAt`/`durationMs`/`success` is optional because a
 * run can fail at any step, and later steps genuinely didn't happen.
 */
export interface UpdateReport {
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly durationMs: number;

  readonly previousConfig?: ProviderConfig;
  readonly selectedCandidate?: Candidate;

  readonly backup?: BackupResult;
  readonly apply?: ApplyResult;
  readonly restart?: RestartResult;
  readonly health?: HealthCheckResult;
  readonly rollback?: RollbackResult;

  readonly success: boolean;
  readonly failureReason?: string;
}
