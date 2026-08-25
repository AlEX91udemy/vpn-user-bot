// --- SSH layer ---
export * from './ssh/ssh.types';
export * from './ssh/ssh.errors';
export { SSH_COMMANDS, isKnownSshCommand, getSshCommand } from './ssh/ssh-registry';
export { loadSshConfig } from './ssh/ssh-config';
export { SshPoolService } from './ssh/ssh-pool.service';
export { SshExecutorService } from './ssh/ssh-executor.service';
export {
  SshFileTransferService,
  isSafeRemotePath,
  isSafePathSegment,
} from './ssh/ssh-file-transfer.service';

// --- domain (ports, value objects, errors) ---
export * from './domain';

// --- config ---
export { loadMtprotoConfig, type MtprotoConfig } from './config/mtproto-config';

// --- application (orchestration) ---
export { CandidateSelector, type CandidateSelectorOptions } from './application/candidate-selector';
export { HealthCheckRunner } from './application/health-check-runner';
export { RollbackManager } from './application/rollback-manager';
export { UpdateJobRunner } from './application/update-job-runner';
export {
  UpdateMtprotoUseCase,
  type UpdateMtprotoUseCaseDeps,
} from './application/update-mtproto.usecase';

// --- infrastructure (concrete adapters — for callers wiring their own DI container; createUpdateMtprotoUseCase below covers everyone else) ---
export {
  RealitlscannerAdapter,
  type RealitlscannerAdapterOptions,
} from './infrastructure/scanner/realitlscanner.adapter';
export { MTGProvider, type MtgProviderOptions } from './infrastructure/mtproto/mtg.provider';
export { serializeMtgToml, parseMtgToml } from './infrastructure/mtproto/mtg-toml';
export { TcpTlsHealthChecker } from './infrastructure/health/tcp-tls.health-checker';
export { SshBackupStore } from './infrastructure/backup/ssh-backup.store';

// --- composition root ---
export { createUpdateMtprotoUseCase } from './compose';

import { loadSshConfig } from './ssh/ssh-config';
import { SshExecutorService } from './ssh/ssh-executor.service';
import { SshPoolService } from './ssh/ssh-pool.service';
import { defaultSshLogger, type SshLogger } from './ssh/ssh.types';

/**
 * Convenience wiring for apps with no DI container of their own: loads
 * config from `process.env` (or a supplied env-like record — useful in
 * tests) and wires `SshPoolService` + `SshExecutorService` together.
 * Frameworks with DI (NestJS, etc.) should construct `SshPoolService`/
 * `SshExecutorService` directly instead, injecting `loadSshConfig()`'s
 * result as a provider.
 */
export function createSshExecutor(
  env: NodeJS.ProcessEnv = process.env,
  logger: SshLogger = defaultSshLogger,
): SshExecutorService {
  const config = loadSshConfig(env);
  const pool = new SshPoolService(config);
  return new SshExecutorService(config, pool, logger);
}
