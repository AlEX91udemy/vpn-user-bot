import * as childProcess from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { classifySshFailure } from './ssh.errors';
import type { ResolvedSshConnection, SshConfig, SshTarget } from './ssh.types';

interface ExecFileError extends Error {
  code?: number | string | null;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

interface PooledConnection {
  readonly controlPath: string;
  readonly user: string;
  readonly host: string;
}

/**
 * Real SSH connection pooling — "don't open a new TCP connection for every
 * command, and close idle ones automatically" — implemented on top of
 * OpenSSH's own `ControlMaster`/`ControlPersist` multiplexing rather than a
 * hand-rolled connection cache or the `ssh2` npm library. This is still
 * exclusively `execFile('ssh', [...])`, never a shell:
 *
 * - Every call passes `-o ControlMaster=auto -o ControlPath=<path>`. The
 *   *first* call for a given user@host opens one real connection and
 *   OpenSSH itself forks a background master process that keeps holding it
 *   open; every later call for the same user@host, while that master is
 *   alive, reuses it — no new handshake.
 * - `-o ControlPersist=<N>s` tells that background master to exit on its
 *   own N seconds after the last multiplexed command finishes — "close
 *   unused connections automatically" is therefore enforced by OpenSSH's
 *   own timer, not by any setInterval/cleanup loop here, so it can't drift
 *   out of sync with what the OS actually has open.
 * - `close()`/`closeAll()` exist for callers that want to tear a
 *   connection down proactively (graceful shutdown, tests) via
 *   `ssh -O exit`, rather than waiting out ControlPersist.
 *
 * Concurrent first-calls to the same not-yet-connected host are safe
 * without any dedupe logic here: OpenSSH's `ControlMaster=auto` already
 * uses file-locking on the control socket path to arbitrate exactly that
 * race (the same mechanism tools like Ansible rely on under parallelism).
 */
export class SshPoolService {
  private readonly connections = new Map<string, PooledConnection>();
  private controlDirEnsured = false;

  constructor(private readonly config: SshConfig) {}

  get activeConnectionCount(): number {
    return this.connections.size;
  }

  /** Runs one remote command against `target` over a pooled connection. Resolves with trimmed stdout, or rejects with a typed `SshFailure`. */
  async run(
    target: SshTarget,
    connection: ResolvedSshConnection,
    remoteCommand: string,
    commandTimeoutS: number,
    context: string,
  ): Promise<string> {
    const args = this.buildArgs(target, connection, remoteCommand);
    try {
      const { stdout } = await this.execFile(args, commandTimeoutS * 1000);
      return stdout.trim();
    } catch (error) {
      throw classifySshFailure(error, context);
    }
  }

  /**
   * Same pooled connection as `run()`, but streams `input` to the remote
   * command's stdin instead of relying on argv — how `SshFileTransferService`
   * writes arbitrary generated file content (e.g. a TOML config) to the
   * remote side of `cat > path` without that content ever being parsed as
   * shell syntax or hitting a local temp file.
   */
  async runWithInput(
    target: SshTarget,
    connection: ResolvedSshConnection,
    remoteCommand: string,
    input: string,
    commandTimeoutS: number,
    context: string,
  ): Promise<string> {
    const args = this.buildArgs(target, connection, remoteCommand);
    try {
      const { stdout } = await this.execFile(args, commandTimeoutS * 1000, input);
      return stdout.trim();
    } catch (error) {
      throw classifySshFailure(error, context);
    }
  }

  private buildArgs(
    target: SshTarget,
    connection: ResolvedSshConnection,
    remoteCommand: string,
  ): string[] {
    this.ensureControlDir();
    const controlPath = this.controlPath(connection.user, target.host);
    this.connections.set(controlPath, { controlPath, user: connection.user, host: target.host });

    return [
      '-o',
      'ControlMaster=auto',
      '-o',
      `ControlPath=${controlPath}`,
      '-o',
      `ControlPersist=${this.config.controlPersistS}s`,
      '-i',
      connection.privateKeyPath,
      '-p',
      String(this.config.port),
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      `ConnectTimeout=${this.config.connectTimeoutS}`,
      `${connection.user}@${target.host}`,
      remoteCommand,
    ];
  }

  /** Explicitly closes the pooled connection to `target`, if one was ever opened by this process. Best-effort — never throws. */
  async close(target: SshTarget, connection: ResolvedSshConnection): Promise<void> {
    const controlPath = this.controlPath(connection.user, target.host);
    const pooled = this.connections.get(controlPath);
    if (!pooled) return;
    this.connections.delete(controlPath);
    await this.closeEntry(pooled);
  }

  /** Closes every pooled connection opened in this process. Call on graceful shutdown. Best-effort — never throws. */
  async closeAll(): Promise<void> {
    const entries = [...this.connections.values()];
    this.connections.clear();
    await Promise.all(entries.map((entry) => this.closeEntry(entry)));
  }

  private async closeEntry(entry: PooledConnection): Promise<void> {
    try {
      await this.execFile(
        ['-S', entry.controlPath, '-O', 'exit', `${entry.user}@${entry.host}`],
        5_000,
      );
    } catch {
      // Already gone (e.g. ControlPersist already expired it, or it never
      // actually connected) — nothing left to clean up.
    }
  }

  private ensureControlDir(): void {
    if (this.controlDirEnsured) return;
    fs.mkdirSync(this.config.controlPathDir, { recursive: true, mode: 0o700 });
    this.controlDirEnsured = true;
  }

  /** Deterministic, short path — Unix socket paths have a ~100 byte limit, so this can't just be `<user>@<host>.sock`. */
  private controlPath(user: string, host: string): string {
    const key = `${user}@${host}:${this.config.port}`;
    const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
    return path.join(this.config.controlPathDir, `${hash}.sock`);
  }

  private execFile(
    args: string[],
    timeoutMs: number,
    input?: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = childProcess.execFile(
        'ssh',
        args,
        { timeout: timeoutMs },
        (error: ExecFileError | null, stdout: string, stderr: string) => {
          if (error) {
            reject(Object.assign(error, { stdout, stderr }));
            return;
          }
          resolve({ stdout, stderr });
        },
      );
      if (input !== undefined) {
        child.stdin?.end(input);
      }
    });
  }
}
