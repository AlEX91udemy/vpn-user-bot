import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BOT_TOKEN: z.string().min(1),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['error', 'warn', 'log', 'debug', 'verbose'])
    .default('log'),
  PORT: z.coerce.number().int().positive().default(3000),
  PAYMENT_PROVIDER: z.literal('telegram_stars').default('telegram_stars'),
  REMNAWAVE_API_URL: z.string().url().optional(),
  REMNAWAVE_API_TOKEN: z.string().min(1).optional(),
  REMNAWAVE_INTERNAL_SQUAD_UUID: z.string().uuid().optional(),
  REMNAWAVE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  FULFILLMENT_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  FULFILLMENT_RETRY_DELAYS_MS: z
    .string()
    .default('60000,300000,900000,3600000'),
  MTPROTO_INTERNAL_API_URL: z.string().url().optional(),
  MTPROTO_INTERNAL_API_KEY: z.string().min(32).optional(),
  MTPROTO_INTERNAL_API_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  MTPROTO_TARGET_HOST: z.string().min(1).optional(),
  MTPROTO_SSH_USER: z.string().min(1).optional(),
  MTPROTO_SSH_MT_USER: z.string().min(1).optional(),
  MTPROTO_SSH_PRIVATE_KEY_PATH: z.string().min(1).optional(),
  MTPROTO_SSH_PORT: z.coerce.number().int().positive().default(22),
  MTPROTO_SSH_CONNECT_TIMEOUT: z.coerce.number().int().positive().default(10),
  MTPROTO_SSH_COMMAND_TIMEOUT: z.coerce.number().int().positive().default(30),
  MTPROTO_SSH_CONTROL_PERSIST: z.coerce.number().int().nonnegative().default(60),
  MTPROTO_SSH_CONTROL_PATH_DIR: z.string().min(1).optional(),
  MTG_CONTAINER_NAME: z.string().min(1).default('mtg'),
  MTG_PORT: z.coerce.number().int().positive().default(9443),
  MTG_CONFIG_PATH: z.string().min(1).default('/opt/mtg/mtg.toml'),
  MTG_DOCKER_IMAGE: z.string().min(1).default('nineseconds/mtg:2'),
  MTPROTO_PROVIDER_COMMAND_TIMEOUT_S: z.coerce.number().int().positive().default(30),
  MTPROTO_BACKUP_DIR: z.string().min(1).default('/opt/mtg/backups'),
  MTPROTO_BACKUP_RETENTION_COUNT: z.coerce.number().int().positive().default(10),
  SCANNER_BINARY_PATH: z.string().min(1).default('/opt/mtproto/bin/RealiTLScanner'),
  SCANNER_WORK_DIR: z.string().min(1).default('/opt/mtproto/scan'),
  SCANNER_WHITELIST: z.string().default(''),
  SCANNER_THREAD_COUNT: z.coerce.number().int().positive().max(16).default(4),
  SCANNER_PER_HOST_TIMEOUT_S: z.coerce.number().int().positive().default(10),
  SCANNER_COMMAND_TIMEOUT_S: z.coerce.number().int().positive().default(120),
  HEALTH_CHECK_RETRIES: z.coerce.number().int().nonnegative().default(3),
  HEALTH_CHECK_RETRY_DELAY_MS: z.coerce.number().int().nonnegative().default(1000),
  HEALTH_CHECK_TIMEOUT_S: z.coerce.number().int().positive().default(8),
  SELECTOR_ALLOWED_COUNTRIES: z.string().default(''),
  SELECTOR_BLOCKED_ISSUERS: z.string().default(''),
  MTPROTO_LUMINTO_CACHE_TTL_MS: z.coerce.number().int().positive().default(1_800_000),
  MTPROTO_ACCESS_HOST: z.string().min(1).optional(),
  MTPROTO_ACCESS_USER: z.string().min(1).optional(),
  MTPROTO_ACCESS_SSH_PRIVATE_KEY_PATH: z.string().min(1).optional(),
  MTPROTO_ACCESS_SSH_PORT: z.coerce.number().int().positive().default(22),
  MTPROTO_ACCESS_PATH: z.string().min(1).default('/root/mtproto-access.json'),
  MTPROTO_ACCESS_PUBLIC_HOST: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.5-flash'),
  LLM_PRIORITY_CHAIN: z.string().default('gemini,groq,openrouter,cerebras,nvidia'),
  LLM_RETRY_COUNT: z.coerce.number().int().positive().default(2),
  LLM_RETRY_DELAY_MS: z.coerce.number().int().nonnegative().default(500),
  LLM_HEALTH_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(3),
  LLM_HEALTH_COOLDOWN_MS: z.coerce.number().int().positive().default(60_000),
  LLM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  HTTPS_PROXY: z.string().url().optional(),
  GROQ_API_KEY: z.string().min(1).optional(),
  GROQ_MODEL: z.string().min(1).optional(),
  GROQ_BASE_URL: z.string().url().optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_MODEL: z.string().min(1).optional(),
  OPENROUTER_BASE_URL: z.string().url().optional(),
  CEREBRAS_API_KEY: z.string().min(1).optional(),
  CEREBRAS_MODEL: z.string().min(1).optional(),
  CEREBRAS_BASE_URL: z.string().url().optional(),
  NVIDIA_API_KEY: z.string().min(1).optional(),
  NVIDIA_MODEL: z.string().min(1).optional(),
  NVIDIA_BASE_URL: z.string().url().optional(),
});

export type Environment = z.infer<typeof schema>;

export function validateEnvironment(
  values: Record<string, unknown>,
): Environment {
  return schema.parse(values);
}
