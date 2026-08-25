/** What a protocol-level health probe needs — nothing MTG-specific, so `HealthChecker` implementations never import a provider. */
export interface HealthCheckSpec {
  readonly host: string;
  readonly port: number;
  readonly sniDomain: string;
}

export type HealthStageName = 'container' | 'port' | 'tlsHandshake' | 'fakeTlsResponse';

export interface HealthStageResult {
  readonly stage: HealthStageName;
  readonly ok: boolean;
  readonly detail: string;
  readonly durationMs: number;
}

export interface HealthCheckResult {
  /** True only if every stage that ran was ok. A stage list shorter than 4 means an earlier stage failed and later ones were skipped — see `HealthCheckRunner`. */
  readonly ok: boolean;
  readonly stages: readonly HealthStageResult[];
}

/**
 * Protocol-level checks only — stages 3 ("TLS handshake succeeds") and 4
 * ("fake TLS responds correctly"). Stages 1-2 (container running, port
 * listening) are infrastructure-specific and live on `MtprotoProvider`
 * instead; `HealthCheckRunner` (application layer) composes all four into
 * one `HealthCheckResult`. Keeping this port free of container/SSH
 * concepts is what lets `TcpTlsHealthChecker` stay a plain TCP/TLS client
 * with zero knowledge of Docker, MTG, or even that a provider exists.
 */
export interface HealthChecker {
  checkTlsHandshake(spec: HealthCheckSpec): Promise<HealthStageResult>;
  checkFakeTlsResponse(spec: HealthCheckSpec): Promise<HealthStageResult>;
}
