import type { BackupStore } from '../domain/backup-store.port';
import type { Candidate } from '../domain/candidate';
import { hashProviderConfig } from '../domain/config-hash';
import type { HealthCheckResult } from '../domain/health-checker.port';
import type { MtprotoProvider } from '../domain/mtproto-provider.port';
import type { ScanRequest, ScannerAdapter } from '../domain/scanner-adapter.port';
import type {
  ApplyResult,
  BackupResult,
  RestartResult,
  RollbackResult,
  UpdateReport,
} from '../domain/update-report';
import type { CandidateSelector } from './candidate-selector';
import type { HealthCheckRunner } from './health-check-runner';
import type { RollbackManager } from './rollback-manager';
import type { UpdateJobRunner } from './update-job-runner';

export interface UpdateMtprotoUseCaseDeps {
  readonly scanner: ScannerAdapter;
  readonly selector: CandidateSelector;
  readonly provider: MtprotoProvider;
  readonly backupStore: BackupStore;
  readonly healthCheckRunner: HealthCheckRunner;
  readonly rollbackManager: RollbackManager;
  readonly jobRunner: UpdateJobRunner;
  readonly scanRequest: ScanRequest;
  readonly backupRetentionCount: number;
  readonly clock?: () => Date;
}

/**
 * The only class a Telegram handler (or any other caller) should ever
 * import from this project: coordinates Scanner → CandidateSelector →
 * MtprotoProvider → HealthChecker → RollbackManager and returns one
 * `UpdateReport`, success or failure. Contains no SSH, no TOML, no
 * scanner-CLI-flag knowledge itself — every step below is one call to a
 * collaborator that owns that concern. `UpdateJobRunner.run()` (mutex +
 * remote lock-marker) wraps the whole thing, so `UpdateAlreadyRunningError`/
 * `OrphanedUpdateDetectedError` propagate out of `execute()` directly —
 * they mean "no run happened at all", not "the run failed", so they're
 * deliberately never turned into an `UpdateReport`.
 */
export class UpdateMtprotoUseCase {
  private readonly clock: () => Date;

  constructor(private readonly deps: UpdateMtprotoUseCaseDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async execute(): Promise<UpdateReport> {
    return this.deps.jobRunner.run(() => this.runOnce());
  }

  private async runOnce(): Promise<UpdateReport> {
    const startedAt = this.clock();
    const previousConfig = await this.deps.provider.currentConfig();

    let selectedCandidate: Candidate | undefined;
    let backup: BackupResult | undefined;
    let apply: ApplyResult | undefined;
    let restart: RestartResult | undefined;
    let health: HealthCheckResult | undefined;
    let rollback: RollbackResult | undefined;
    let failureReason: string | undefined;

    try {
      const candidates = await this.deps.scanner.scan(this.deps.scanRequest);
      selectedCandidate = this.deps.selector.select(candidates);
      const newConfig = await this.deps.provider.generateConfig(selectedCandidate);

      // A backup only makes sense — and rollback only becomes possible —
      // once there's a previously-live config to preserve. A first-ever
      // deployment to a fresh host has nothing to roll back to if it
      // fails; that's a legitimate "setup didn't succeed" outcome, not a
      // service that was working and is now broken.
      if (previousConfig !== undefined) {
        const record = await this.deps.backupStore.create(previousConfig);
        await this.deps.backupStore.prune(this.deps.backupRetentionCount);
        backup = { record };
      }

      await this.deps.provider.apply(newConfig);
      apply = { configHash: hashProviderConfig(newConfig) };

      await this.deps.provider.restart();
      restart = { restartedAt: this.clock() };

      health = await this.deps.healthCheckRunner.run(this.deps.provider, newConfig);
      if (!health.ok) {
        throw new Error('Health check failed after applying the new configuration');
      }
    } catch (error) {
      failureReason = errorMessage(error);

      // Only worth attempting a rollback if a backup actually exists —
      // a failure during scan/select/generateConfig, before any backup
      // was created, never touched the live server, so there's nothing
      // to restore.
      if (backup) {
        try {
          rollback = await this.deps.rollbackManager.rollback(backup.record);
        } catch (rollbackError) {
          // RollbackManager.rollback() never fails silently — it always
          // throws on any failure — so this branch is the "panic + full
          // report" case: captured here, never swallowed or retried.
          rollback = { attempted: true, succeeded: false, restoredBackupId: backup.record.id };
          failureReason = `${failureReason}; rollback also failed: ${errorMessage(rollbackError)}`;
        }
      }
    }

    const finishedAt = this.clock();
    return {
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      previousConfig,
      selectedCandidate,
      backup,
      apply,
      restart,
      health,
      rollback,
      success: failureReason === undefined,
      failureReason,
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
