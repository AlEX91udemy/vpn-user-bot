import type { Candidate } from './candidate';

export interface ScanRequest {
  /** Small, curated set of domains to probe — never a CIDR/mass scan (see infrastructure/scanner's own docs for why). */
  readonly whitelist: readonly string[];
  readonly threadCount: number;
  readonly timeoutS: number;
}

/**
 * Port for "find candidate front domains". `RealiTLScannerAdapter` is the
 * only implementation today; the interface owes it nothing tool-specific —
 * a future adapter (different scanner, or a hand-rolled TLS prober) can
 * implement this without touching `CandidateSelector` or the use case.
 */
export interface ScannerAdapter {
  scan(request: ScanRequest): Promise<Candidate[]>;
}
