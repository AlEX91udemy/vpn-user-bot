import type { Candidate } from '../domain/candidate';
import { NoCandidateFoundError } from '../domain/errors';

export interface CandidateSelectorOptions {
  /** Empty/unset = no country filtering. */
  readonly allowedCountries?: readonly string[];
  /** Case-insensitive substring match against `certIssuer`. Empty/unset = no issuer filtering. */
  readonly blockedIssuers?: readonly string[];
}

/**
 * Pure — no I/O, no SSH, no knowledge of RealiTLScanner or MTG. Picks one
 * `Candidate` out of whatever `ScannerAdapter` found. RealiTLScanner only
 * ever reports targets it already considers `feasible` (valid cert, TLS
 * handshake succeeded), so this doesn't re-filter on TLS validity — that
 * would just duplicate a check the scanner already did, with no
 * additional signal. What it *does* add: an optional country/issuer
 * policy, and preferring TLS 1.3 + lower RTT as a scoring tiebreaker
 * when several candidates are otherwise equally valid.
 *
 * `countryCode`/`rttMs` are frequently absent (see `Candidate`'s own doc
 * comment) — a candidate missing either is never disqualified for that
 * alone, only scored as "no signal" on that dimension.
 */
export class CandidateSelector {
  constructor(private readonly options: CandidateSelectorOptions = {}) {}

  select(candidates: readonly Candidate[]): Candidate {
    const allowed = candidates.filter((candidate) => this.isAllowed(candidate));
    if (allowed.length === 0) {
      throw new NoCandidateFoundError();
    }
    return allowed.reduce((best, current) =>
      this.score(current) > this.score(best) ? current : best,
    );
  }

  private isAllowed(candidate: Candidate): boolean {
    const { allowedCountries, blockedIssuers } = this.options;

    if (allowedCountries?.length && candidate.countryCode !== undefined) {
      if (!allowedCountries.includes(candidate.countryCode)) return false;
    }
    if (blockedIssuers?.length) {
      const issuer = candidate.certIssuer.toLowerCase();
      if (blockedIssuers.some((blocked) => issuer.includes(blocked.toLowerCase()))) return false;
    }
    return true;
  }

  private score(candidate: Candidate): number {
    let score = 0;
    if (candidate.tlsVersion === '1.3') score += 1000;
    if (candidate.rttMs !== undefined) score += Math.max(0, 500 - candidate.rttMs);
    return score;
  }
}
