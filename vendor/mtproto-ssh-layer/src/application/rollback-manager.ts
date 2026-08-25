import type { BackupRecord, BackupStore } from '../domain/backup-store.port';
import { hashProviderConfig } from '../domain/config-hash';
import { RollbackFailedError } from '../domain/errors';
import type { MtprotoProvider } from '../domain/mtproto-provider.port';
import type { RollbackResult } from '../domain/update-report';
import type { HealthCheckRunner } from './health-check-runner';

/**
 * `restore → restart → health`, and — the one property the raw sequence
 * doesn't give you for free — idempotent and never silent. Idempotent:
 * `restore` compares the target backup's hash against whatever config is
 * currently live and skips `apply()` entirely when they already match, so
 * calling `rollback()` twice in a row (e.g. a retry after a transient SSH
 * blip) never double-applies or corrupts anything. Never silent: *every*
 * failure path — a thrown error from any step, or a clean run that still
 * comes back unhealthy — surfaces as `RollbackFailedError`, never a
 * quietly-returned `succeeded: false`. `UpdateMtprotoUseCase` is the one
 * place that catches it, to attach full context to `UpdateReport`.
 */
export class RollbackManager {
  constructor(
    private readonly provider: MtprotoProvider,
    private readonly backupStore: BackupStore,
    private readonly healthCheckRunner: HealthCheckRunner,
  ) {}

  async rollback(target: BackupRecord): Promise<RollbackResult> {
    try {
      const backupConfig = await this.backupStore.read(target.id);

      const current = await this.provider.currentConfig();
      const alreadyMatches =
        current !== undefined && hashProviderConfig(current) === target.configHash;
      if (!alreadyMatches) {
        await this.provider.apply(backupConfig);
      }

      await this.provider.restart();

      const health = await this.healthCheckRunner.run(this.provider, backupConfig);
      if (!health.ok) {
        throw new RollbackFailedError(
          `Rollback to backup "${target.id}" did not restore a healthy state`,
          health,
        );
      }

      return { attempted: true, succeeded: true, restoredBackupId: target.id, health };
    } catch (error) {
      if (error instanceof RollbackFailedError) throw error;
      throw new RollbackFailedError(
        `Rollback to backup "${target.id}" failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        error,
      );
    }
  }
}
