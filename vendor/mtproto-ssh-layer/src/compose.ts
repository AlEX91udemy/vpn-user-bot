import { loadMtprotoConfig } from './config/mtproto-config';
import { loadSshConfig } from './ssh/ssh-config';
import { SshFileTransferService } from './ssh/ssh-file-transfer.service';
import { SshPoolService } from './ssh/ssh-pool.service';
import { mtprotoTarget, resolveSshConnection } from './ssh/ssh.types';
import { CandidateSelector } from './application/candidate-selector';
import { HealthCheckRunner } from './application/health-check-runner';
import { RollbackManager } from './application/rollback-manager';
import { UpdateJobRunner } from './application/update-job-runner';
import { UpdateMtprotoUseCase } from './application/update-mtproto.usecase';
import { MtprotoConfigurationError } from './domain/errors';
import type { ScanRequest } from './domain/scanner-adapter.port';
import { TcpTlsHealthChecker } from './infrastructure/health/tcp-tls.health-checker';
import { MTGProvider } from './infrastructure/mtproto/mtg.provider';
import { SshBackupStore } from './infrastructure/backup/ssh-backup.store';
import { RealitlscannerAdapter } from './infrastructure/scanner/realitlscanner.adapter';

/** `${backupDir}/.update-in-progress` — kept next to the backups it's protecting, not a separately-configured path (one less env var, and it's meaningless without a backup dir anyway). */
function lockMarkerPathFor(backupDir: string): string {
  return `${backupDir}/.update-in-progress`;
}

/**
 * The composition root: the one place every concrete `infrastructure/`
 * class is ever `new`'d up and wired to the `domain/`/`application/`
 * interfaces it implements. A caller (a Telegram handler, a CLI, a test
 * harness) gets back a single `UpdateMtprotoUseCase` and never needs to
 * know `MTGProvider`, `RealitlscannerAdapter`, or any SSH type exists.
 *
 * Unlike `loadSshConfig`/`loadMtprotoConfig` (which deliberately tolerate
 * missing values so the process can boot unconfigured), this function
 * fails eagerly: it's called on demand, right before an update is
 * actually attempted, not at process startup — so surfacing a bad/missing
 * `MTPROTO_TARGET_HOST` or `SSH_USER` here, immediately, is strictly
 * better than discovering it three steps into a live update.
 */
export function createUpdateMtprotoUseCase(
  env: NodeJS.ProcessEnv = process.env,
): UpdateMtprotoUseCase {
  const sshConfig = loadSshConfig(env);
  const mtprotoConfig = loadMtprotoConfig(env);

  if (!mtprotoConfig.targetHost) {
    throw new MtprotoConfigurationError('MTPROTO_TARGET_HOST is not set');
  }
  const target = mtprotoTarget(mtprotoConfig.targetHost);
  const connection = resolveSshConnection(sshConfig, target);

  const pool = new SshPoolService(sshConfig);
  const fileTransfer = new SshFileTransferService(pool, mtprotoConfig.providerCommandTimeoutS);

  const scanner = new RealitlscannerAdapter(pool, fileTransfer, target, connection, {
    binaryPath: mtprotoConfig.scannerBinaryPath,
    workDir: mtprotoConfig.scannerWorkDir,
    threadCount: mtprotoConfig.scannerThreadCount,
    perHostTimeoutS: mtprotoConfig.scannerPerHostTimeoutS,
    commandTimeoutS: mtprotoConfig.scannerCommandTimeoutS,
  });

  const selector = new CandidateSelector({
    allowedCountries: mtprotoConfig.selectorAllowedCountries,
    blockedIssuers: mtprotoConfig.selectorBlockedIssuers,
  });

  const provider = new MTGProvider(pool, fileTransfer, target, connection, {
    containerName: mtprotoConfig.containerName,
    port: mtprotoConfig.port,
    configPath: mtprotoConfig.configPath,
    dockerImage: mtprotoConfig.dockerImage,
    commandTimeoutS: mtprotoConfig.providerCommandTimeoutS,
  });

  const backupStore = new SshBackupStore(fileTransfer, target, connection, mtprotoConfig.backupDir);

  const healthChecker = new TcpTlsHealthChecker(mtprotoConfig.healthCheckTimeoutS * 1000);
  const healthCheckRunner = new HealthCheckRunner(
    healthChecker,
    mtprotoConfig.healthCheckRetries,
    mtprotoConfig.healthCheckRetryDelayMs,
  );

  const rollbackManager = new RollbackManager(provider, backupStore, healthCheckRunner);

  const jobRunner = new UpdateJobRunner(
    fileTransfer,
    target,
    connection,
    lockMarkerPathFor(mtprotoConfig.backupDir),
  );

  const scanRequest: ScanRequest = {
    whitelist: mtprotoConfig.scannerWhitelist,
    threadCount: mtprotoConfig.scannerThreadCount,
    timeoutS: mtprotoConfig.scannerPerHostTimeoutS,
  };

  return new UpdateMtprotoUseCase({
    scanner,
    selector,
    provider,
    backupStore,
    healthCheckRunner,
    rollbackManager,
    jobRunner,
    scanRequest,
    backupRetentionCount: mtprotoConfig.backupRetentionCount,
  });
}
