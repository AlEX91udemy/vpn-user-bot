import * as path from 'node:path';
import * as os from 'node:os';
import { z } from 'zod';
import { SshConfigurationError } from './ssh.errors';
import type { SshConfig } from './ssh.types';

/**
 * Every field is optional/defaulted at the schema level, even `SSH_USER`
 * and `SSH_PRIVATE_KEY_PATH` which nothing can actually run without —
 * matching vpn-tg-bot's rule that a missing SSH setup must not fail the
 * whole app's boot. `SshExecutorService` is what refuses to run and throws
 * `SshConfigurationError` when a real call is attempted without them. This
 * schema only rejects env values that are present but malformed (e.g.
 * `SSH_PORT=not-a-number`), which *is* a config bug worth failing loudly on.
 */
const envSchema = z.object({
  SSH_USER: z.string().min(1).optional(),
  SSH_MT_USER: z.string().min(1).optional(),
  SSH_PRIVATE_KEY_PATH: z.string().min(1).optional(),
  SSH_PORT: z.coerce.number().int().positive().default(22),
  SSH_CONNECT_TIMEOUT: z.coerce.number().int().positive().default(10),
  SSH_COMMAND_TIMEOUT: z.coerce.number().int().positive().default(30),
  SSH_CONTROL_PERSIST: z.coerce.number().int().nonnegative().default(60),
  SSH_CONTROL_PATH_DIR: z.string().min(1).optional(),
});

/**
 * The sole place this layer reads `process.env`. Everything else — pool,
 * registry, executor — takes a fully-resolved `SshConfig` value, never env
 * vars directly, so they stay testable without env mutation and reusable
 * outside a process that necessarily has these vars set.
 */
export function loadSshConfig(env: NodeJS.ProcessEnv = process.env): SshConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new SshConfigurationError(`Invalid SSH environment configuration: ${issues}`);
  }
  const data = parsed.data;

  return {
    user: data.SSH_USER,
    mtUser: data.SSH_MT_USER,
    privateKeyPath: data.SSH_PRIVATE_KEY_PATH
      ? path.resolve(process.cwd(), data.SSH_PRIVATE_KEY_PATH)
      : undefined,
    port: data.SSH_PORT,
    connectTimeoutS: data.SSH_CONNECT_TIMEOUT,
    commandTimeoutS: data.SSH_COMMAND_TIMEOUT,
    controlPersistS: data.SSH_CONTROL_PERSIST,
    controlPathDir: data.SSH_CONTROL_PATH_DIR
      ? path.resolve(process.cwd(), data.SSH_CONTROL_PATH_DIR)
      : path.join(os.tmpdir(), 'mtproto-ssh-control'),
  };
}
