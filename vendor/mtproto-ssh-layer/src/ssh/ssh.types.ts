import { SshConfigurationError } from './ssh.errors';

/**
 * Which configured login user a target should use. Generalizes vpn-tg-bot's
 * `SshTarget.kind: 'node' | 'panel'` (which names Remnawave concepts this
 * project must not depend on) into a role the SSH layer itself understands:
 * "default" always uses SSH_USER; "mtproto" uses SSH_MT_USER, falling back
 * to SSH_USER when unset — the same fallback vpn-tg-bot applies for its
 * panel user, just under a name that isn't tied to Remnawave.
 */
export type SshUserRole = 'default' | 'mtproto';

/** One SSH-reachable host this layer is allowed to run registry commands against. */
export interface SshTarget {
  readonly host: string;
  readonly role: SshUserRole;
}

export function sshTarget(host: string, role: SshUserRole = 'default'): SshTarget {
  return { host, role };
}

/** Shorthand for `sshTarget(host, 'mtproto')`. */
export function mtprotoTarget(host: string): SshTarget {
  return sshTarget(host, 'mtproto');
}

/**
 * Fully-resolved config this layer needs. Everything optional here is
 * optional because it's legal to run this app with SSH unconfigured — see
 * `SshConfigurationError` — not because callers should treat it as
 * partial; `ssh-config.ts` is the only place that reads `process.env`.
 */
export interface SshConfig {
  readonly user?: string;
  readonly mtUser?: string;
  readonly privateKeyPath?: string;
  readonly port: number;
  readonly connectTimeoutS: number;
  readonly commandTimeoutS: number;
  /** How long OpenSSH keeps a pooled connection open after its last command, in seconds. */
  readonly controlPersistS: number;
  /** Directory for ControlMaster multiplexing sockets (kept short — Unix socket path limit). */
  readonly controlPathDir: string;
}

/** The user + key actually used for one call, after role resolution. */
export interface ResolvedSshConnection {
  readonly user: string;
  readonly privateKeyPath: string;
}

/**
 * `role: 'mtproto'` uses `SSH_MT_USER`, falling back to `SSH_USER` when
 * unset. The single implementation of this resolution — `SshExecutorService`
 * and the composition root (wiring `RealitlscannerAdapter`/`MTGProvider`/
 * `SshBackupStore`/`UpdateJobRunner`, which all need a resolved connection
 * but have no registry-command concept of their own) both call this rather
 * than each re-deriving the same fallback logic.
 */
export function resolveSshConnection(config: SshConfig, target: SshTarget): ResolvedSshConnection {
  const user = target.role === 'mtproto' ? (config.mtUser ?? config.user) : config.user;
  if (!user || !config.privateKeyPath) {
    throw new SshConfigurationError(
      'SSH is not configured — set SSH_USER and SSH_PRIVATE_KEY_PATH',
    );
  }
  return { user, privateKeyPath: config.privateKeyPath };
}

export interface SshExecResult {
  readonly stdout: string;
  readonly durationMs: number;
}

/**
 * Minimal logging seam so this module never hardcodes a logging framework —
 * a NestJS `Logger`, pino, or anything else with these three methods can be
 * passed in. `defaultSshLogger` (below) is the fallback when nothing is
 * injected, and deliberately avoids `console.*` so this file stays clean
 * under a `no-console` lint rule that callers may also apply to their own
 * code.
 */
export interface SshLogger {
  // Property (arrow-function-typed) rather than method shorthand: a plain
  // `info(message: string): void` method signature trips
  // `@typescript-eslint/unbound-method` the moment a caller (e.g. a test)
  // passes `logger.info` around by reference, since TS can't tell it's
  // never called unbound. NestJS `Logger` instances and this shape are
  // still structurally interchangeable either way.
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

function write(stream: NodeJS.WriteStream, level: string, message: string): void {
  stream.write(`[${new Date().toISOString()}] ${level} ${message}\n`);
}

export const defaultSshLogger: SshLogger = {
  info: (message) => write(process.stdout, 'INFO', message),
  warn: (message) => write(process.stdout, 'WARN', message),
  error: (message) => write(process.stderr, 'ERROR', message),
};

export const noopSshLogger: SshLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
