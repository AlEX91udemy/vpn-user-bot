import * as path from 'node:path';
import { z } from 'zod';
import { MtprotoConfigurationError } from '../domain/errors';

export interface MtprotoConfig {
  /** SSH host of the node MTG runs on — separate from any `Candidate.domain` (the front domain a candidate scan found), which is never a login target. */
  readonly targetHost?: string;
  readonly containerName: string;
  readonly port: number;
  readonly configPath: string;
  readonly dockerImage: string;
  /** Budget for provider-level SSH ops (generate-secret, restart, infra checks) and every `SshFileTransferService` call (backup/apply file moves) — short, since these are all lightweight commands, unlike the scanner's own much larger timeout. */
  readonly providerCommandTimeoutS: number;

  readonly backupDir: string;
  readonly backupRetentionCount: number;

  readonly scannerBinaryPath: string;
  readonly scannerWorkDir: string;
  readonly scannerWhitelist: readonly string[];
  readonly scannerThreadCount: number;
  readonly scannerPerHostTimeoutS: number;
  readonly scannerCommandTimeoutS: number;

  readonly healthCheckRetries: number;
  readonly healthCheckRetryDelayMs: number;
  readonly healthCheckTimeoutS: number;

  /** Empty = no country filtering (permissive default — most candidates won't have a country at all, see `Candidate.countryCode`'s own doc comment). */
  readonly selectorAllowedCountries: readonly string[];
  /** Substring match against `Candidate.certIssuer`, case-insensitive. Empty = no issuer filtering. */
  readonly selectorBlockedIssuers: readonly string[];
}

/**
 * Same rule as `ssh-config.ts`: nothing here fails the app's boot. A
 * missing `MTG_CONTAINER_NAME`/`MTPROTO_BACKUP_DIR`/etc. only becomes an
 * error the moment `UpdateMtprotoUseCase` is actually invoked, via
 * whichever component first needs the missing value — this schema only
 * rejects a value that's *present but malformed*.
 */
const envSchema = z.object({
  // Optional at the schema level for the same reason SSH_USER is: this
  // project should still boot without it configured, and fail with a
  // clear error only when an actual update is attempted.
  MTPROTO_TARGET_HOST: z.string().min(1).optional(),
  MTG_CONTAINER_NAME: z.string().min(1).default('mtg'),
  MTG_PORT: z.coerce.number().int().positive().default(9443),
  MTG_CONFIG_PATH: z.string().min(1).default('/opt/mtg/mtg.toml'),
  // `nineseconds/mtg:2` on Docker Hub is the real, documented image
  // (confirmed against the project's own README, 2026-08-04) — not a
  // `ghcr.io` guess. Pinned to the major-version tag, never `:latest` or
  // `:stable`: MTG's own README explicitly warns against both ("Please do
  // not choose `latest` or `stable` if you want to avoid surprises.
  // Always choose some version tag.") — the same supply-chain concern the
  // architecture review raised, confirmed by upstream itself.
  MTG_DOCKER_IMAGE: z.string().min(1).default('nineseconds/mtg:2'),
  MTPROTO_PROVIDER_COMMAND_TIMEOUT_S: z.coerce.number().int().positive().default(30),

  MTPROTO_BACKUP_DIR: z.string().min(1).default('/opt/mtg/backups'),
  MTPROTO_BACKUP_RETENTION_COUNT: z.coerce.number().int().positive().default(10),

  SCANNER_BINARY_PATH: z.string().min(1).default('/opt/mtproto/bin/RealiTLScanner'),
  SCANNER_WORK_DIR: z.string().min(1).default('/opt/mtproto/scan'),
  // Comma-separated curated whitelist — never a CIDR. Empty by default so
  // an unconfigured deployment fails obviously (`NoCandidateFoundError`)
  // rather than scanning nothing silently or something unintended.
  SCANNER_WHITELIST: z.string().default('').transform(splitCsv),
  SCANNER_THREAD_COUNT: z.coerce.number().int().positive().max(16).default(4),
  SCANNER_PER_HOST_TIMEOUT_S: z.coerce.number().int().positive().default(10),
  SCANNER_COMMAND_TIMEOUT_S: z.coerce.number().int().positive().default(120),

  HEALTH_CHECK_RETRIES: z.coerce.number().int().nonnegative().default(3),
  HEALTH_CHECK_RETRY_DELAY_MS: z.coerce.number().int().nonnegative().default(1000),
  HEALTH_CHECK_TIMEOUT_S: z.coerce.number().int().positive().default(8),

  SELECTOR_ALLOWED_COUNTRIES: z
    .string()
    .default('')
    .transform((value) => splitCsv(value).map((v) => v.toUpperCase())),
  SELECTOR_BLOCKED_ISSUERS: z.string().default('').transform(splitCsv),
});

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function loadMtprotoConfig(env: NodeJS.ProcessEnv = process.env): MtprotoConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new MtprotoConfigurationError(`Invalid MTProto environment configuration: ${issues}`);
  }
  const data = parsed.data;

  return {
    targetHost: data.MTPROTO_TARGET_HOST,
    containerName: data.MTG_CONTAINER_NAME,
    port: data.MTG_PORT,
    configPath: path.posix.normalize(data.MTG_CONFIG_PATH),
    dockerImage: data.MTG_DOCKER_IMAGE,
    providerCommandTimeoutS: data.MTPROTO_PROVIDER_COMMAND_TIMEOUT_S,

    backupDir: path.posix.normalize(data.MTPROTO_BACKUP_DIR),
    backupRetentionCount: data.MTPROTO_BACKUP_RETENTION_COUNT,

    scannerBinaryPath: data.SCANNER_BINARY_PATH,
    scannerWorkDir: path.posix.normalize(data.SCANNER_WORK_DIR),
    scannerWhitelist: data.SCANNER_WHITELIST,
    scannerThreadCount: data.SCANNER_THREAD_COUNT,
    scannerPerHostTimeoutS: data.SCANNER_PER_HOST_TIMEOUT_S,
    scannerCommandTimeoutS: data.SCANNER_COMMAND_TIMEOUT_S,

    healthCheckRetries: data.HEALTH_CHECK_RETRIES,
    healthCheckRetryDelayMs: data.HEALTH_CHECK_RETRY_DELAY_MS,
    healthCheckTimeoutS: data.HEALTH_CHECK_TIMEOUT_S,

    selectorAllowedCountries: data.SELECTOR_ALLOWED_COUNTRIES,
    selectorBlockedIssuers: data.SELECTOR_BLOCKED_ISSUERS,
  };
}
