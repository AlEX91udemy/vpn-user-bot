/**
 * One scan result the selector can choose between. Deliberately shaped
 * around what a *front domain for fake-TLS* needs, not around
 * RealiTLScanner's own output format — `ScannerAdapter` implementations
 * translate their tool-specific output into this before it ever leaves
 * `infrastructure/`.
 *
 * `countryCode`/`rttMs` are optional, not oversights: RealiTLScanner only
 * reports country when a GeoIP database happens to be installed next to
 * the binary, and reports no RTT at all — `CandidateSelector` degrades
 * gracefully (treats missing data as "unknown", never as disqualifying)
 * rather than a different `ScannerAdapter` being forced to fabricate
 * values it doesn't have.
 */
export interface Candidate {
  readonly domain: string;
  readonly ip: string;
  readonly tlsVersion: string;
  readonly certIssuer: string;
  readonly countryCode?: string;
  readonly rttMs?: number;
}
