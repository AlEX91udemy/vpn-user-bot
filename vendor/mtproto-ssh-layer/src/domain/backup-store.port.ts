import type { ProviderConfig } from './mtproto-provider.port';

/** `id` is the version — a sortable timestamp like `2026-08-05_01-15`, never a fixed filename like `backup.toml`. */
export interface BackupRecord {
  readonly id: string;
  readonly createdAt: Date;
  readonly configHash: string;
}

/**
 * Port for versioned backup storage. `SshBackupStore` is the only
 * implementation (backups live in `backups/<id>/` on the target host,
 * moved there the same way `MTGProvider` moves configs — see
 * `SshFileTransferService`), but nothing above this port knows that.
 */
export interface BackupStore {
  create(config: ProviderConfig): Promise<BackupRecord>;
  latest(): Promise<BackupRecord | undefined>;
  read(id: string): Promise<ProviderConfig>;
  /** Deletes every record beyond `retentionCount`, oldest first. Returns what was pruned. */
  prune(retentionCount: number): Promise<BackupRecord[]>;
}
