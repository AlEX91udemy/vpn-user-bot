import type { BackupRecord, BackupStore } from '../../domain/backup-store.port';
import { hashProviderConfig } from '../../domain/config-hash';
import { MtprotoConfigurationError } from '../../domain/errors';
import type { ProviderConfig } from '../../domain/mtproto-provider.port';
import type { SshFileTransferService } from '../../ssh/ssh-file-transfer.service';
import type { ResolvedSshConnection, SshTarget } from '../../ssh/ssh.types';

// Trailing `-NN` is an optional disambiguator for same-second collisions
// (see `create()`'s `uniqueId` loop) — found live on 193.181.215.204
// 2026-08-05: 6 pipeline runs inside one minute, minute-granularity ids
// collided, and 5 of 6 backups were silently overwritten. Seconds
// granularity alone shrinks the window but doesn't close it (a run can
// complete in under a second); the existence-check loop is what actually
// makes this collision-proof.
const ID_PATTERN = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:-(\d+))?$/;
const CONFIG_FILE_NAME = 'config.json';

function formatBackupId(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}_${pad(date.getUTCHours())}-${pad(date.getUTCMinutes())}-${pad(date.getUTCSeconds())}`;
}

function parseBackupId(id: string): Date {
  const match = ID_PATTERN.exec(id);
  if (!match) return new Date(NaN);
  const [, y, mo, d, h, mi, s] = match;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
}

function isBackupIdFormat(id: string): boolean {
  return ID_PATTERN.test(id);
}

function isProviderConfigShape(value: unknown): value is ProviderConfig {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.domain === 'string' &&
    typeof record.port === 'number' &&
    typeof record.secret === 'string' &&
    typeof record.raw === 'string'
  );
}

/**
 * `BackupStore` implementation over `SshFileTransferService` — versioned
 * `backups/<id>/` directories on the target host, `id` a UTC
 * `YYYY-MM-DD_HH-mm` timestamp (lexicographically sortable, so "latest"
 * and "oldest N" are plain string sorts, no separate index file to keep
 * in sync). Deliberately provider-agnostic: `ProviderConfig` is stored as
 * JSON verbatim (`config.json`), never parsed or reinterpreted — this
 * class doesn't know or care that today's `raw` happens to be MTG TOML.
 */
export class SshBackupStore implements BackupStore {
  constructor(
    private readonly fileTransfer: SshFileTransferService,
    private readonly target: SshTarget,
    private readonly connection: ResolvedSshConnection,
    private readonly backupDir: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async create(config: ProviderConfig): Promise<BackupRecord> {
    const createdAt = this.clock();
    const id = await this.uniqueId(formatBackupId(createdAt));
    const dir = `${this.backupDir}/${id}`;
    await this.fileTransfer.ensureDir(this.target, this.connection, dir);
    await this.fileTransfer.putFileContent(
      this.target,
      this.connection,
      JSON.stringify(config),
      `${dir}/${CONFIG_FILE_NAME}`,
    );
    return { id, createdAt, configHash: hashProviderConfig(config) };
  }

  /** Appends `-02`, `-03`, ... until it finds an id nothing is using yet — the actual collision-proofing (see `ID_PATTERN`'s comment), not just narrower timestamp granularity. */
  private async uniqueId(baseId: string): Promise<string> {
    let candidate = baseId;
    let suffix = 2;
    while (await this.backupExists(candidate)) {
      candidate = `${baseId}-${String(suffix).padStart(2, '0')}`;
      suffix += 1;
    }
    return candidate;
  }

  private async backupExists(id: string): Promise<boolean> {
    const raw = await this.fileTransfer.readFileContent(
      this.target,
      this.connection,
      `${this.backupDir}/${id}/${CONFIG_FILE_NAME}`,
    );
    return raw !== undefined;
  }

  async latest(): Promise<BackupRecord | undefined> {
    const ids = await this.listBackupIds();
    if (ids.length === 0) return undefined;
    return this.recordFor(ids[ids.length - 1]);
  }

  async read(id: string): Promise<ProviderConfig> {
    if (!isBackupIdFormat(id)) {
      throw new MtprotoConfigurationError(`Not a valid backup id: "${id}"`);
    }
    const raw = await this.fileTransfer.readFileContent(
      this.target,
      this.connection,
      `${this.backupDir}/${id}/${CONFIG_FILE_NAME}`,
    );
    if (raw === undefined) {
      throw new MtprotoConfigurationError(`Backup "${id}" not found`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new MtprotoConfigurationError(
        `Backup "${id}" is corrupted (not valid JSON): ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    if (!isProviderConfigShape(parsed)) {
      throw new MtprotoConfigurationError(`Backup "${id}" is corrupted (unexpected shape)`);
    }
    return parsed;
  }

  /** Deletes every backup beyond the newest `retentionCount`, oldest first. Reads each pruned record before deleting it (retention runs at most once per update, so the extra round trips are cheap) so the caller/report can show what was removed. */
  async prune(retentionCount: number): Promise<BackupRecord[]> {
    const ids = await this.listBackupIds();
    const excess = ids.length - retentionCount;
    if (excess <= 0) return [];

    const idsToRemove = ids.slice(0, excess);
    const pruned: BackupRecord[] = [];
    for (const id of idsToRemove) {
      const record = await this.recordFor(id);
      await this.fileTransfer.removeDir(this.target, this.connection, this.backupDir, id);
      pruned.push(record);
    }
    return pruned;
  }

  private async recordFor(id: string): Promise<BackupRecord> {
    const config = await this.read(id);
    return { id, createdAt: parseBackupId(id), configHash: hashProviderConfig(config) };
  }

  /** Ascending (oldest first) — callers that want newest just index from the end. */
  private async listBackupIds(): Promise<string[]> {
    const entries = await this.fileTransfer.listDir(this.target, this.connection, this.backupDir);
    return entries.filter(isBackupIdFormat).sort();
  }
}
