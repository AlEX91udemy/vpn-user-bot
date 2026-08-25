import type { SshPoolService } from './ssh-pool.service';
import { SshConfigurationError } from './ssh.errors';
import type { ResolvedSshConnection, SshTarget } from './ssh.types';

const NOT_FOUND_SENTINEL = '__MTPROTO_FILE_NOT_FOUND__';

/**
 * Absolute, single-quote-safe, no shell metacharacters, no path traversal.
 * Every path this service touches goes through this before it's ever
 * embedded in a remote command string. Paths reaching this service come
 * from generated timestamps/config (`BackupStore`, `MtprotoProvider`),
 * never from Telegram input — but this is the actual enforcement point,
 * not a convention callers have to remember.
 */
export function isSafeRemotePath(remotePath: string): boolean {
  if (!remotePath.startsWith('/')) return false;
  if (remotePath.includes('..')) return false;
  if (/[\s;&|`$()<>"'\\]/.test(remotePath)) return false;
  return true;
}

/**
 * A single path *segment* (no `/` at all) — stricter than
 * `isSafeRemotePath`, for the one place (`removeDir`) where a mistake is
 * destructive. No `.` in the allowed charset on purpose: backup ids are
 * timestamps (`2026-08-05_01-15`) that never need one, and allowing it
 * would let `.` or `..` themselves slip through as "safe" segments —
 * `..` is exactly the traversal this function exists to block.
 */
export function isSafePathSegment(segment: string): boolean {
  return /^[A-Za-z0-9_:-]+$/.test(segment);
}

function assertSafeRemotePath(remotePath: string): void {
  if (!isSafeRemotePath(remotePath)) {
    throw new SshConfigurationError(`Refusing to touch unsafe remote path: "${remotePath}"`);
  }
}

/**
 * Second execFile-only primitive alongside `SshExecutorService`'s fixed
 * command registry — for moving file *content* (generated configs,
 * backups) rather than running a fixed named command. File transfer isn't
 * "a command": the path and content differ on every call, so there's no
 * static string to register. Rather than smuggle it in as an exception to
 * "only the registry", it gets its own narrowly-scoped, equally-audited
 * class. Still routes through `SshPoolService` (same pooled connection,
 * same typed errors) and is still never a shell: `cat`/`mv`/`test`/`ls`/
 * `rm` with a path validated by `isSafeRemotePath` first, and file
 * *content* always travels via stdin (`SshPoolService.runWithInput`),
 * never interpolated into argv or into the command string.
 */
export class SshFileTransferService {
  constructor(
    private readonly pool: SshPoolService,
    private readonly commandTimeoutS: number,
  ) {}

  /**
   * Writes `content` to `remotePath`, overwriting it if present, created
   * `-rw-------` (owner-only) from the very first byte. `umask 077` before
   * `cat` rather than a `chmod 600` afterwards on purpose: a chmod-after
   * leaves a real (if brief) window where a freshly-created file sits at
   * the shell's default mode — normally `644` — which matters here
   * because every file this method writes is either a live proxy secret
   * or a backup of one (found exposed like this live on 193.181.215.204,
   * 2026-08-05: the parent directory was `700`, but the file itself was
   * still world-readable). Not atomic on its own — see `moveFile` for the
   * write-temp-then-rename pattern callers should use for anything "live".
   */
  async putFileContent(
    target: SshTarget,
    connection: ResolvedSshConnection,
    content: string,
    remotePath: string,
  ): Promise<void> {
    assertSafeRemotePath(remotePath);
    await this.pool.runWithInput(
      target,
      connection,
      `umask 077; cat > '${remotePath}'`,
      content,
      this.commandTimeoutS,
      `write ${target.host}:${remotePath}`,
    );
  }

  /** Reads `remotePath`, or `undefined` if it doesn't exist — a legitimate "nothing applied yet" outcome, never thrown as an error. */
  async readFileContent(
    target: SshTarget,
    connection: ResolvedSshConnection,
    remotePath: string,
  ): Promise<string | undefined> {
    assertSafeRemotePath(remotePath);
    const command = `test -f '${remotePath}' && cat '${remotePath}' || echo '${NOT_FOUND_SENTINEL}'`;
    const output = await this.pool.run(
      target,
      connection,
      command,
      this.commandTimeoutS,
      `read ${target.host}:${remotePath}`,
    );
    return output === NOT_FOUND_SENTINEL ? undefined : output;
  }

  /** Atomically renames `fromPath` to `toPath` (same filesystem) — how a provider's `apply()` avoids ever leaving a half-written config as the live one: write to a temp path, then `moveFile` it into place. */
  async moveFile(
    target: SshTarget,
    connection: ResolvedSshConnection,
    fromPath: string,
    toPath: string,
  ): Promise<void> {
    assertSafeRemotePath(fromPath);
    assertSafeRemotePath(toPath);
    await this.pool.run(
      target,
      connection,
      `mv -f '${fromPath}' '${toPath}'`,
      this.commandTimeoutS,
      `move ${target.host}:${fromPath} -> ${toPath}`,
    );
  }

  /**
   * Removes one file at a fixed, non-per-call-varying path (e.g. a lock
   * marker). Unlike `removeDir`, this takes a full path rather than a
   * root+segment pair — acceptable here specifically because callers only
   * ever pass a single well-known path sourced from config, never
   * something built per-run from variable data the way backup ids are;
   * `isSafeRemotePath` is still the enforcement point either way. Safe
   * no-op if the file doesn't exist.
   */
  async removeFile(
    target: SshTarget,
    connection: ResolvedSshConnection,
    remotePath: string,
  ): Promise<void> {
    assertSafeRemotePath(remotePath);
    await this.pool.run(
      target,
      connection,
      `rm -f '${remotePath}'`,
      this.commandTimeoutS,
      `rm ${target.host}:${remotePath}`,
    );
  }

  /** Creates `remoteDir` (and parents), `chmod 700` — for backup directories, which hold the fake-TLS secret and must not be world-readable. */
  async ensureDir(
    target: SshTarget,
    connection: ResolvedSshConnection,
    remoteDir: string,
  ): Promise<void> {
    assertSafeRemotePath(remoteDir);
    await this.pool.run(
      target,
      connection,
      `mkdir -p '${remoteDir}' && chmod 700 '${remoteDir}'`,
      this.commandTimeoutS,
      `mkdir ${target.host}:${remoteDir}`,
    );
  }

  /** Immediate subdirectory/file names of `remoteDir`, `[]` if it doesn't exist. */
  async listDir(
    target: SshTarget,
    connection: ResolvedSshConnection,
    remoteDir: string,
  ): Promise<string[]> {
    assertSafeRemotePath(remoteDir);
    const output = await this.pool.run(
      target,
      connection,
      `ls -1 '${remoteDir}' 2>/dev/null || true`,
      this.commandTimeoutS,
      `ls ${target.host}:${remoteDir}`,
    );
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  /**
   * Removes `${rootDir}/${id}` recursively — used only for pruning backups
   * beyond retention. Deliberately does *not* accept one caller-supplied
   * full path for a `rm -rf`: `id` must be a single path segment
   * (`isSafePathSegment`, no `/` at all), so this can only ever delete one
   * named child of a known-safe root, never something a path-construction
   * bug could point at `/` or `/etc`.
   */
  async removeDir(
    target: SshTarget,
    connection: ResolvedSshConnection,
    rootDir: string,
    id: string,
  ): Promise<void> {
    assertSafeRemotePath(rootDir);
    if (!isSafePathSegment(id)) {
      throw new SshConfigurationError(`Refusing to remove an unsafe backup id: "${id}"`);
    }
    const fullPath = `${rootDir}/${id}`;
    await this.pool.run(
      target,
      connection,
      `rm -rf '${fullPath}'`,
      this.commandTimeoutS,
      `rm ${target.host}:${fullPath}`,
    );
  }
}
