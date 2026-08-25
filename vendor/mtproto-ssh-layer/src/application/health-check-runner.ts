import type {
  HealthChecker,
  HealthCheckResult,
  HealthStageResult,
} from '../domain/health-checker.port';
import type { MtprotoProvider, ProviderConfig } from '../domain/mtproto-provider.port';

/**
 * Composes all four health stages into one `HealthCheckResult`: stages 1-2
 * (container/port) come from `MtprotoProvider.checkInfra()` — only the
 * provider knows what "running" means for its own backend — stages 3-4
 * come from the protocol-generic `HealthChecker`. Lives here, not on
 * either port, because both `UpdateMtprotoUseCase` (after `apply()`) and
 * `RollbackManager` (after `restore()`) need the exact same four-stage
 * sequence and the same retry policy; duplicating it in both places would
 * risk the two drifting out of sync.
 *
 * Retries (with a delay) only wrap stages 3-4: a TCP/TLS probe over the
 * public internet can fail on one dropped packet, and retrying a
 * *read-only* probe is always safe. Stages 1-2 and the whole "should we
 * even attempt 3-4" gate are never retried here — if the container isn't
 * running, retrying the same infra check five times isn't going to change
 * that outcome.
 */
export class HealthCheckRunner {
  constructor(
    private readonly healthChecker: HealthChecker,
    private readonly retries: number,
    private readonly retryDelayMs: number,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  async run(provider: MtprotoProvider, config: ProviderConfig): Promise<HealthCheckResult> {
    const infra = await provider.checkInfra();
    const stages: HealthStageResult[] = [infra.containerRunning, infra.portListening];
    if (!infra.containerRunning.ok || !infra.portListening.ok) {
      return { ok: false, stages };
    }

    const spec = provider.healthCheckSpec(config);

    const tlsHandshake = await this.withRetry(() => this.healthChecker.checkTlsHandshake(spec));
    stages.push(tlsHandshake);
    if (!tlsHandshake.ok) {
      return { ok: false, stages };
    }

    const fakeTlsResponse = await this.withRetry(() =>
      this.healthChecker.checkFakeTlsResponse(spec),
    );
    stages.push(fakeTlsResponse);
    return { ok: fakeTlsResponse.ok, stages };
  }

  private async withRetry(probe: () => Promise<HealthStageResult>): Promise<HealthStageResult> {
    let last: HealthStageResult = await probe();
    for (let attempt = 1; attempt <= this.retries && !last.ok; attempt += 1) {
      await this.sleep(this.retryDelayMs);
      last = await probe();
    }
    return last;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
