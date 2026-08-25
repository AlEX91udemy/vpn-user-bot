import { OrphanedUpdateDetectedError, UpdateAlreadyRunningError } from '../domain/errors';
import type { SshFileTransferService } from '../ssh/ssh-file-transfer.service';
import type { ResolvedSshConnection, SshTarget } from '../ssh/ssh.types';

/**
 * Two independent layers of "only one update at a time", not one:
 *
 * 1. An in-process boolean — fast, no network round trip, catches two
 *    button presses in the same running bot process.
 * 2. A remote lock-marker file — survives everything the in-process flag
 *    can't: the bot process crashing or being redeployed mid-update. If
 *    the marker is already there when a new run starts, that's not "busy
 *    right now", it's evidence a *previous* run never got to clean up
 *    after itself and may have left the host half-applied —
 *    `OrphanedUpdateDetectedError` is thrown instead of silently
 *    proceeding, so the caller is forced to resolve it (typically: run a
 *    recovery rollback to the last backup) before a fresh update can
 *    start.
 *
 * The marker is written before the job body runs and removed in a
 * `finally` after it finishes, success or failure — including a rollback
 * outcome, since by the time control returns here the use case has
 * already decided what it's going to report.
 */
export class UpdateJobRunner {
  private running = false;

  constructor(
    private readonly fileTransfer: SshFileTransferService,
    private readonly target: SshTarget,
    private readonly connection: ResolvedSshConnection,
    private readonly lockMarkerPath: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.running) {
      throw new UpdateAlreadyRunningError();
    }
    this.running = true;
    try {
      await this.assertNoOrphanedRun();
      await this.writeLockMarker();
      try {
        return await job();
      } finally {
        await this.fileTransfer.removeFile(this.target, this.connection, this.lockMarkerPath);
      }
    } finally {
      this.running = false;
    }
  }

  private async assertNoOrphanedRun(): Promise<void> {
    const existing = await this.fileTransfer.readFileContent(
      this.target,
      this.connection,
      this.lockMarkerPath,
    );
    if (existing !== undefined) {
      const markerCreatedAt = new Date(existing.trim());
      throw new OrphanedUpdateDetectedError(
        `A previous MTProto update did not finish cleanly (lock marker present since ${existing.trim()}) — resolve before retrying, e.g. by rolling back to the last backup.`,
        Number.isNaN(markerCreatedAt.getTime()) ? undefined : markerCreatedAt,
      );
    }
  }

  private async writeLockMarker(): Promise<void> {
    await this.fileTransfer.putFileContent(
      this.target,
      this.connection,
      this.clock().toISOString(),
      this.lockMarkerPath,
    );
  }
}
