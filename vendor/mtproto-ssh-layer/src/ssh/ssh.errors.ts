/**
 * Four distinct failure categories instead of vpn-tg-bot's single
 * `SshExecutionError` for everything. `classifySshFailure` (bottom of this
 * file) is what actually assigns a raw execFile failure to one of them —
 * see its own comment for the exact rules.
 */

/** Caller error: SSH isn't configured, or asked for a command name the registry doesn't have. Never reaches child_process. */
export class SshConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshConfigurationError';
  }
}

/** The `ssh` client itself couldn't establish or maintain the connection (refused, auth failed, host unreachable, DNS failure, binary missing). */
export class SshConnectionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly exitCode?: number,
  ) {
    super(message);
    this.name = 'SshConnectionError';
  }
}

/** Connected, but the command (or the connection attempt) didn't finish inside the configured timeout and was killed. */
export class SshTimeoutError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SshTimeoutError';
  }
}

/** Connected and ran, but the remote command itself exited non-zero. */
export class SshExecutionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly exitCode?: number,
  ) {
    super(message);
    this.name = 'SshExecutionError';
  }
}

export type SshFailure = SshConnectionError | SshTimeoutError | SshExecutionError;

/** Shape of the error Node's `child_process.execFile` passes to its callback on failure. */
interface ExecFileFailure {
  readonly code?: number | string | null;
  readonly killed?: boolean;
  readonly signal?: string | null;
}

function isExecFileFailure(error: unknown): error is ExecFileFailure {
  return typeof error === 'object' && error !== null;
}

/**
 * Turns a raw `execFile('ssh', ...)` failure into one of the three runtime
 * error types, using two properties Node/OpenSSH already give us for free
 * rather than parsing stderr text (which we also must never log — see
 * `SshExecutorService`):
 *
 * - `error.killed === true` — the `timeout` option we pass to `execFile`
 *   fired and Node killed the process itself. Always a timeout, whether it
 *   happened during the handshake or mid-command.
 * - `error.code === 255` — OpenSSH's own documented convention: the `ssh`
 *   client exits 255 specifically when *it* failed (refused, auth, DNS,
 *   host key, protocol) as opposed to relaying the remote command's exit
 *   status, which is always 0-254. So 255 unambiguously means "never
 *   reached / never ran the remote command".
 * - A *string* `code` (Node's convention for spawn-level errors, e.g.
 *   `ENOENT` when the `ssh` binary itself can't be found) means the
 *   process never even started — also a connection-layer failure.
 * - No code at all and not killed (rare, but not impossible) is treated as
 *   the safest bucket, connection failure, rather than guessing it was the
 *   remote command.
 * - Any other numeric code is the remote command's own non-zero exit —
 *   `SshExecutionError`.
 */
export function classifySshFailure(error: unknown, context: string): SshFailure {
  if (!isExecFileFailure(error)) {
    return new SshExecutionError(`${context}: unknown failure`, error);
  }
  if (error.killed) {
    return new SshTimeoutError(`${context}: timed out`, error);
  }
  if (typeof error.code === 'string') {
    return new SshConnectionError(`${context}: could not invoke ssh (${error.code})`, error);
  }
  if (error.code === 255) {
    return new SshConnectionError(`${context}: connection failed`, error, error.code);
  }
  if (error.code === undefined || error.code === null) {
    return new SshConnectionError(`${context}: connection failed`, error);
  }
  return new SshExecutionError(
    `${context}: command exited with code ${error.code}`,
    error,
    error.code,
  );
}
