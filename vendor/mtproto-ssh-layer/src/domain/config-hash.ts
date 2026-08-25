import { createHash } from 'node:crypto';
import type { ProviderConfig } from './mtproto-provider.port';

/**
 * Pure, no I/O — used by both `BackupStore` implementations (to tag a
 * backup record) and `RollbackManager` (to decide whether a restore is a
 * no-op because the target already matches, which is what makes rollback
 * idempotent). Hashes `raw` only: two configs with the same serialized
 * content are the same config regardless of which candidate produced them.
 */
export function hashProviderConfig(config: ProviderConfig): string {
  return createHash('sha256').update(config.raw).digest('hex');
}
