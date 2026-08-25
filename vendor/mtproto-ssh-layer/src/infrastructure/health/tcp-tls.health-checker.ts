import * as tls from 'node:tls';
import type {
  HealthChecker,
  HealthCheckSpec,
  HealthStageResult,
} from '../../domain/health-checker.port';

type TlsConnector = (options: tls.ConnectionOptions, callback?: () => void) => tls.TLSSocket;

const HTTP_STATUS_LINE = /^HTTP\/\d\.\d \d{3}/;

/**
 * `HealthChecker` implementation for stages 3-4 ("TLS handshake succeeds",
 * "fake TLS responds correctly") — a plain TCP/TLS client with zero
 * knowledge of MTG, Docker, or SSH. Connects from wherever this process
 * runs, over the public internet, exactly like a real client (or a real
 * censor's probe) would — this is deliberately *not* run over the SSH
 * tunnel, because "can we reach it as SSH root" and "does it look like a
 * normal HTTPS server to the outside world" are different questions.
 *
 * `connect` is injectable (defaults to the real `tls.connect`) so tests
 * never open a real socket — same "mock at the actual I/O boundary"
 * approach as `SshPoolService`'s tests, just via constructor injection
 * instead of `jest.mock` since `tls.connect` doesn't need module-level
 * interception the way a non-configurable `child_process` export does.
 */
export class TcpTlsHealthChecker implements HealthChecker {
  constructor(
    private readonly timeoutMs: number,
    private readonly connect: TlsConnector = tls.connect,
  ) {}

  async checkTlsHandshake(spec: HealthCheckSpec): Promise<HealthStageResult> {
    const start = Date.now();
    try {
      const socket = await this.openTlsSocket(spec);
      socket.destroy();
      return {
        stage: 'tlsHandshake',
        ok: true,
        detail: `TLS handshake with SNI "${spec.sniDomain}" completed`,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        stage: 'tlsHandshake',
        ok: false,
        detail: errorMessage(error),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Sends a plain HTTP/1.1 request over the TLS session and checks the
   * response starts with a normal `HTTP/x.y NNN` status line — a real
   * front website (or a well-behaved fake-TLS proxy convincingly imitating
   * one) answers this; a broken/misconfigured proxy typically resets the
   * connection or returns nothing, which is exactly the tell that would
   * out it to an actual observer, so it's what this stage exists to catch
   * before an admin ships that config.
   */
  async checkFakeTlsResponse(spec: HealthCheckSpec): Promise<HealthStageResult> {
    const start = Date.now();
    try {
      const response = await this.probeHttpResponse(spec);
      const ok = HTTP_STATUS_LINE.test(response);
      return {
        stage: 'fakeTlsResponse',
        ok,
        detail: ok
          ? 'front domain answered with a normal HTTP response'
          : `unexpected response (first 80 chars): ${JSON.stringify(response.slice(0, 80))}`,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        stage: 'fakeTlsResponse',
        ok: false,
        detail: errorMessage(error),
        durationMs: Date.now() - start,
      };
    }
  }

  private openTlsSocket(spec: HealthCheckSpec): Promise<tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = this.connect(
        {
          host: spec.host,
          port: spec.port,
          servername: spec.sniDomain,
          // Deliberate, not an oversight: this connection never carries
          // anything secret (no MTG secret, no backup content — those
          // stay on the authenticated SSH channel) and this code never
          // acts on the response as a trust decision, only as a health
          // signal. The whole point of fake-TLS is that the front may
          // present a real third party's certificate we have no CA
          // relationship with; requiring chain validation here would
          // make the health check fail on a *correctly* configured proxy.
          // Our threat model for this one probe is the same as a
          // censor's — "does this look like ordinary HTTPS" — which
          // doesn't involve certificate trust either. Worst case if this
          // specific probe is MITM'd: a wrong health verdict (spurious
          // pass or spurious rollback), never credential or data exposure.
          rejectUnauthorized: false,
          timeout: this.timeoutMs,
        },
        () => {
          if (settled) return;
          settled = true;
          resolve(socket);
        },
      );
      socket.once('error', (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
      socket.once('timeout', () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new Error(`TLS connect to ${spec.host}:${spec.port} timed out`));
      });
    });
  }

  private probeHttpResponse(spec: HealthCheckSpec): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let data = '';
      const socket = this.connect(
        {
          host: spec.host,
          port: spec.port,
          servername: spec.sniDomain,
          rejectUnauthorized: false, // see the identical option in openTlsSocket() for why
          timeout: this.timeoutMs,
        },
        () => {
          socket.write(`GET / HTTP/1.1\r\nHost: ${spec.sniDomain}\r\nConnection: close\r\n\r\n`);
        },
      );
      socket.on('data', (chunk: Buffer) => {
        data += chunk.toString('utf8');
      });
      const finish = (): void => {
        if (settled) return;
        settled = true;
        resolve(data);
      };
      socket.once('end', finish);
      socket.once('close', finish);
      socket.once('error', (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
      socket.once('timeout', () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new Error(`Response from ${spec.host}:${spec.port} timed out`));
      });
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
