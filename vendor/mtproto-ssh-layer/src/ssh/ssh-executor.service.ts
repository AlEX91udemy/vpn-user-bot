import { getSshCommand, isKnownSshCommand } from './ssh-registry';
import type { SshPoolService } from './ssh-pool.service';
import { SshConfigurationError } from './ssh.errors';
import {
  defaultSshLogger,
  resolveSshConnection,
  type SshConfig,
  type SshLogger,
  type SshTarget,
} from './ssh.types';

/**
 * Marks each command's output boundary inside one batched SSH session (see
 * `executeBatch`) — fixed, not derived from anything external, so it can't
 * collide with real command output in a way that matters (a false-positive
 * split would just corrupt that one value, never anything security-relevant).
 * Ported from vpn-tg-bot's `SshExecutorService` unchanged — same delimiter,
 * same reasoning.
 */
const BATCH_DELIMITER = '__SSH_BATCH_DELIM__';

/**
 * The only path from business logic to a real SSH command in this project.
 * Every command is looked up by *name* in the registry (`ssh-registry.ts`)
 * — there is no code path that accepts a raw command string here — and
 * actually runs via `SshPoolService`, which is itself `execFile`-only, no
 * shell. Callers (a future Use Case layer) must never talk to
 * `SshPoolService` directly; this class is the boundary.
 */
export class SshExecutorService {
  constructor(
    private readonly config: SshConfig,
    private readonly pool: SshPoolService,
    private readonly logger: SshLogger = defaultSshLogger,
  ) {}

  async execute(target: SshTarget, commandName: string): Promise<string> {
    const command = getSshCommand(commandName);
    if (command === undefined) {
      throw new SshConfigurationError(`Unknown SSH command "${commandName}"`);
    }
    const connection = resolveSshConnection(this.config, target);
    const context = `SSH command "${commandName}" on ${target.host}`;
    return this.runLogged(context, () =>
      this.pool.run(target, connection, command, this.config.commandTimeoutS, context),
    );
  }

  /**
   * Runs every named command against `target` over **one** pooled
   * connection instead of one per command — the fix vpn-tg-bot applied
   * after a burst of near-simultaneous new TCP connections to port 22
   * tripped fail2ban-style connection-rate protection on every host in
   * production (2026-08-04). Ported here unchanged: the `; true`
   * terminator and delimiter-split parsing are load-bearing for the same
   * reason they were there — see the inline comments below.
   *
   * A failure in one command doesn't abort the rest — each command name
   * missing from the result map (rather than the whole batch throwing)
   * signals "this one didn't run".
   */
  async executeBatch(target: SshTarget, commandNames: string[]): Promise<Map<string, string>> {
    for (const name of commandNames) {
      if (!isKnownSshCommand(name)) {
        throw new SshConfigurationError(`Unknown SSH command "${name}"`);
      }
    }
    const connection = resolveSshConnection(this.config, target);

    // `; true` at the end is load-bearing: a `;`-joined remote script's
    // exit status is whichever command ran last, so without it one
    // failing *last* command would make the whole ssh invocation look
    // like a connection failure and throw away every other command's
    // already-captured output along with it.
    const script = `${commandNames
      .map((name) => `echo '${BATCH_DELIMITER}${name}${BATCH_DELIMITER}'; ${getSshCommand(name)}`)
      .join('; ')}; true`;
    const context = `SSH batch [${commandNames.join(', ')}] on ${target.host}`;

    return this.runLogged(context, async () => {
      const stdout = await this.pool.run(
        target,
        connection,
        script,
        this.config.commandTimeoutS,
        context,
      );
      return this.parseBatchOutput(stdout);
    });
  }

  private parseBatchOutput(stdout: string): Map<string, string> {
    const result = new Map<string, string>();
    const pattern = new RegExp(`${BATCH_DELIMITER}(.*?)${BATCH_DELIMITER}\\n?`, 'g');
    const segments = stdout.split(pattern);
    // segments[0] is anything printed before the first marker (should be
    // empty); after that it alternates [name, output, name, output, ...].
    for (let i = 1; i < segments.length; i += 2) {
      result.set(segments[i], (segments[i + 1] ?? '').trim());
    }
    return result;
  }

  private async runLogged<T>(context: string, run: () => Promise<T>): Promise<T> {
    const start = Date.now();
    this.logger.info(`${context}: started`);
    try {
      const result = await run();
      this.logger.info(`${context}: finished in ${Date.now() - start}ms`);
      return result;
    } catch (error) {
      this.logFailure(context, start, error);
      throw error;
    }
  }

  // Deliberately never logs `error.cause` (which may carry the remote
  // command's raw stderr) — same rule vpn-tg-bot applies to
  // `RemnawaveApiClient` responses and every LLM adapter's HTTP errors.
  private logFailure(context: string, start: number, error: unknown): void {
    const durationMs = Date.now() - start;
    if (error instanceof Error) {
      const exitCode = 'exitCode' in error ? (error as { exitCode?: number }).exitCode : undefined;
      const suffix = exitCode !== undefined ? `, exit ${exitCode}` : '';
      this.logger.error(
        `${context}: failed after ${durationMs}ms (${error.name}${suffix}): ${error.message}`,
      );
      return;
    }
    this.logger.error(`${context}: failed after ${durationMs}ms with a non-Error value`);
  }
}
