import type { Candidate } from '../../domain/candidate';
import type { ScanRequest, ScannerAdapter } from '../../domain/scanner-adapter.port';
import { MtprotoConfigurationError } from '../../domain/errors';
import type { SshFileTransferService } from '../../ssh/ssh-file-transfer.service';
import type { SshPoolService } from '../../ssh/ssh-pool.service';
import type { ResolvedSshConnection, SshTarget } from '../../ssh/ssh.types';
import { isValidHostname } from './hostname';
import { parseRealitlscannerOutput } from './realitlscanner-line';

export interface RealitlscannerAdapterOptions {
  readonly binaryPath: string;
  readonly workDir: string;
  readonly threadCount: number;
  readonly perHostTimeoutS: number;
  readonly commandTimeoutS: number;
}

/**
 * `ScannerAdapter` implementation over the real RealiTLScanner binary,
 * invoked on the target host itself over the pooled SSH connection (see
 * the architecture review: running the scan from a prod VPS carries a
 * flag/abuse risk the upstream README itself warns about, mitigated here
 * by never mass-scanning — `scan()` only ever probes the caller-supplied
 * whitelist, capped by `threadCount`, manual-trigger-only by construction
 * since nothing in this class schedules itself).
 *
 * The binary path is never downloaded or updated by this class — it's a
 * pinned, pre-deployed path from config (see the review's supply-chain
 * section). This class only ever *runs* it.
 */
export class RealitlscannerAdapter implements ScannerAdapter {
  constructor(
    private readonly pool: SshPoolService,
    private readonly fileTransfer: SshFileTransferService,
    private readonly target: SshTarget,
    private readonly connection: ResolvedSshConnection,
    private readonly options: RealitlscannerAdapterOptions,
  ) {}

  async scan(request: ScanRequest): Promise<Candidate[]> {
    if (request.whitelist.length === 0) {
      return [];
    }
    for (const domain of request.whitelist) {
      if (!isValidHostname(domain)) {
        throw new MtprotoConfigurationError(
          `Invalid whitelist entry (not a hostname): "${domain}"`,
        );
      }
    }
    if (request.threadCount > this.options.threadCount) {
      throw new MtprotoConfigurationError(
        `Requested thread count ${request.threadCount} exceeds the configured cap ${this.options.threadCount}`,
      );
    }

    const inputPath = `${this.options.workDir}/scan-in.txt`;
    await this.fileTransfer.ensureDir(this.target, this.connection, this.options.workDir);
    await this.fileTransfer.putFileContent(
      this.target,
      this.connection,
      `${request.whitelist.join('\n')}\n`,
      inputPath,
    );

    // Every interpolated piece here is either our own deterministic path
    // or a number that has already passed zod's `.int()` validation in
    // `mtproto-config.ts` — never a value that could carry shell syntax.
    const command = `'${this.options.binaryPath}' -in '${inputPath}' -thread ${request.threadCount} -timeout ${request.timeoutS}`;
    const stdout = await this.pool.run(
      this.target,
      this.connection,
      command,
      this.options.commandTimeoutS,
      `RealiTLScanner scan on ${this.target.host}`,
    );

    return parseRealitlscannerOutput(stdout);
  }
}
