import * as path from 'node:path';
import type { Candidate } from '../../domain/candidate';
import { MtprotoConfigurationError } from '../../domain/errors';
import type { HealthCheckSpec, HealthStageResult } from '../../domain/health-checker.port';
import type {
  InfraStatus,
  MtprotoProvider,
  ProviderConfig,
} from '../../domain/mtproto-provider.port';
import { isValidHostname } from '../scanner/hostname';
import type { SshFileTransferService } from '../../ssh/ssh-file-transfer.service';
import type { SshPoolService } from '../../ssh/ssh-pool.service';
import type { ResolvedSshConnection, SshTarget } from '../../ssh/ssh.types';
import { parseMtgToml, serializeMtgToml } from './mtg-toml';

export interface MtgProviderOptions {
  readonly containerName: string;
  readonly port: number;
  readonly configPath: string;
  readonly dockerImage: string;
  readonly commandTimeoutS: number;
}

/**
 * MTG images in the wild use both `/config.toml` (upstream documentation)
 * and `/config/config.toml` (the image currently deployed on the production
 * Denmark node). Mounting both paths keeps restart/create behavior compatible
 * across image builds and avoids a container that is `Up` but cannot read the
 * intended config after recreation.
 */
const CONTAINER_CONFIG_PATH = '/config.toml';
const COMPAT_CONTAINER_CONFIG_PATH = '/config/config.toml';

/** Extracts the port from a `bind-to` value like `"0.0.0.0:9443"`. `undefined` if missing/malformed — caller decides the fallback. */
function portFromBindTo(bindTo: string | undefined): number | undefined {
  if (!bindTo) return undefined;
  const match = /:(\d+)$/.exec(bindTo);
  if (!match) return undefined;
  const port = Number(match[1]);
  return Number.isInteger(port) ? port : undefined;
}

/**
 * `MtprotoProvider` implementation for MTG (`9seconds/mtg`, Docker Hub
 * image `nineseconds/mtg:2`). Every shell fragment below is built only
 * from: our own fixed remote paths, `options.*` (sourced from validated
 * config, never per-call input), and `candidate.domain` — which is
 * checked with `isValidHostname` before it touches any command string,
 * same guard `RealitlscannerAdapter` applies to whitelist entries.
 */
export class MTGProvider implements MtprotoProvider {
  readonly name = 'mtg';

  constructor(
    private readonly pool: SshPoolService,
    private readonly fileTransfer: SshFileTransferService,
    private readonly target: SshTarget,
    private readonly connection: ResolvedSshConnection,
    private readonly options: MtgProviderOptions,
  ) {}

  async generateConfig(candidate: Candidate): Promise<ProviderConfig> {
    if (!isValidHostname(candidate.domain)) {
      throw new MtprotoConfigurationError(
        `Refusing to generate an MTG config for an invalid domain: "${candidate.domain}"`,
      );
    }
    const secret = await this.generateSecret(candidate.domain);
    const bindTo = `0.0.0.0:${this.options.port}`;
    const raw = serializeMtgToml({ domain: candidate.domain, secret, bindTo });
    return { domain: candidate.domain, port: this.options.port, secret, raw };
  }

  async currentConfig(): Promise<ProviderConfig | undefined> {
    const raw = await this.fileTransfer.readFileContent(
      this.target,
      this.connection,
      this.options.configPath,
    );
    if (raw === undefined) return undefined;
    const parsed = parseMtgToml(raw);
    return {
      domain: parsed.domain ?? 'unknown',
      // Parsed from the config's own `bind-to`, not assumed to equal
      // `this.options.port` — found live (2026-08-05) that a stored
      // config can legitimately disagree with the currently-configured
      // port (e.g. mid-migration to a new MTG_PORT), and reporting the
      // wrong port here silently poisoned a backup's health-check target
      // during a real rollback test on 193.181.215.204.
      port: portFromBindTo(parsed.bindTo) ?? this.options.port,
      secret: parsed.secret ?? '',
      raw,
    };
  }

  /**
   * Writes to `${configPath}.pending` then atomically renames it into
   * place — `apply()` never leaves a half-written file as the live
   * config, even if the write itself is interrupted. Ensures the config's
   * own directory is `700` first rather than assuming whoever provisioned
   * the host already locked it down — found live (2026-08-05) that
   * `/opt/mtg` had been created without one, leaving the secret one
   * `chmod` away from world-readable despite `putFileContent` itself
   * writing the file `600`.
   */
  async apply(config: ProviderConfig): Promise<void> {
    await this.fileTransfer.ensureDir(
      this.target,
      this.connection,
      path.posix.dirname(this.options.configPath),
    );
    const pendingPath = `${this.options.configPath}.pending`;
    await this.fileTransfer.putFileContent(this.target, this.connection, config.raw, pendingPath);
    await this.fileTransfer.moveFile(
      this.target,
      this.connection,
      pendingPath,
      this.options.configPath,
    );
  }

  /**
   * `docker restart` if the container already exists (fast path — the
   * common case, since the bind-mounted config file is what changed, not
   * the container), otherwise creates it — matches MTG's own documented
   * `docker run -d -v config.toml:/config.toml -p host:container --name
   * ... --restart unless-stopped nineseconds/mtg:2` invocation exactly
   * (confirmed 2026-08-04), no invented flags.
   */
  async restart(): Promise<void> {
    const containerName = this.options.containerName;
    const command = [
      `docker inspect '${containerName}' >/dev/null 2>&1`,
      `&& docker restart '${containerName}'`,
      '||',
      `docker run -d --name '${containerName}' --restart unless-stopped`,
      `-p ${this.options.port}:${this.options.port}`,
      `-v '${this.options.configPath}:${CONTAINER_CONFIG_PATH}:ro'`,
      `-v '${this.options.configPath}:${COMPAT_CONTAINER_CONFIG_PATH}:ro'`,
      `'${this.options.dockerImage}'`,
    ].join(' ');
    // Keep a root-only access artifact in sync with every rotation so the
    // Telegram bot can hand clients the current link without exposing the
    // MTG config or requiring a second manual command.
    const accessCommand =
      `docker exec '${containerName}' /mtg access '${COMPAT_CONTAINER_CONFIG_PATH}' > '/root/mtproto-access.json'` +
      ` && chmod 600 '/root/mtproto-access.json'`;
    await this.pool.run(
      this.target,
      this.connection,
      `${command}; ${accessCommand}`,
      this.options.commandTimeoutS,
      `restart mtg on ${this.target.host}`,
    );
  }

  async checkInfra(): Promise<InfraStatus> {
    return {
      containerRunning: await this.checkContainerRunning(),
      portListening: await this.checkPortListening(),
    };
  }

  healthCheckSpec(config: ProviderConfig): HealthCheckSpec {
    return { host: this.target.host, port: config.port, sniDomain: config.domain };
  }

  private async generateSecret(domain: string): Promise<string> {
    // Runs the pinned image directly (`docker run --rm <image> generate-secret --hex <domain>`)
    // rather than `docker exec`ing into the live container — works even
    // before the container has ever been created (first-ever apply on a
    // fresh host), and never depends on the currently-running container.
    const command = `docker run --rm '${this.options.dockerImage}' generate-secret --hex '${domain}'`;
    const output = await this.pool.run(
      this.target,
      this.connection,
      command,
      this.options.commandTimeoutS,
      `mtg generate-secret on ${this.target.host}`,
    );
    return output.trim();
  }

  private async checkContainerRunning(): Promise<HealthStageResult> {
    const start = Date.now();
    const command = `docker inspect -f '{{.State.Running}}' '${this.options.containerName}' 2>/dev/null || echo false`;
    try {
      const output = await this.pool.run(
        this.target,
        this.connection,
        command,
        this.options.commandTimeoutS,
        `check container on ${this.target.host}`,
      );
      const ok = output.trim() === 'true';
      return { stage: 'container', ok, detail: output.trim(), durationMs: Date.now() - start };
    } catch (error) {
      return {
        stage: 'container',
        ok: false,
        detail: error instanceof Error ? error.message : 'unknown error',
        durationMs: Date.now() - start,
      };
    }
  }

  private async checkPortListening(): Promise<HealthStageResult> {
    const start = Date.now();
    const command = `(ss -tln | grep -q ':${this.options.port} ' && echo true) || echo false`;
    try {
      const output = await this.pool.run(
        this.target,
        this.connection,
        command,
        this.options.commandTimeoutS,
        `check port on ${this.target.host}`,
      );
      const ok = output.trim() === 'true';
      return { stage: 'port', ok, detail: output.trim(), durationMs: Date.now() - start };
    } catch (error) {
      return {
        stage: 'port',
        ok: false,
        detail: error instanceof Error ? error.message : 'unknown error',
        durationMs: Date.now() - start,
      };
    }
  }
}
