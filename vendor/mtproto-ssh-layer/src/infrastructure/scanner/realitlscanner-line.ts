import type { Candidate } from '../../domain/candidate';

/**
 * Matches RealiTLScanner's real stdout log line format — confirmed
 * 2026-08-05 against the actual pinned v0.2.3 binary running live on
 * 193.181.215.204, e.g.:
 *   time=2026-08-05T03:03:01.798Z level=INFO msg="Connected to target" feasible=true ip=88.221.169.152 origin=www.microsoft.com tls="TLS 1.3" alpn=h2 curve=X25519MLKEM768 cert-length="5879(certs count: 3)" cert-signature=SHA384-RSA cert-publickey=RSA cert-domain=www.microsoft.com cert-issuer="Microsoft Corporation" geo=N/A
 *
 * This is *not* what the project's README demo snippet shows (`host=`,
 * `domain=`, `issuer=`, bare `tls=1.3`) — that shape turned out to be
 * stale/from an older release. The live E2E run against the real binary
 * caught the mismatch (regex never matched, 0 candidates every time); this
 * parses via a generic `key=value`/`key="quoted value"` tokenizer instead
 * of one positional regex specifically so a future field reorder or
 * addition (this binary added `curve`/`cert-length`/`cert-signature`/
 * `cert-publickey`/`geo` since the README was written) doesn't silently
 * break parsing the same way again.
 *
 * Deliberately reading stdout instead of the `-out` CSV file: same
 * reasoning as before — one less remote round trip, and stdout carries
 * `tls`/`alpn` the CSV never did. `geo` is real here (no separate CSV
 * detour needed for it either) but is `N/A` unless a GeoIP database sits
 * next to the binary — confirmed not installed on the deployed host, so
 * `Candidate.countryCode` reliably comes back `undefined` in this
 * deployment, exactly the case its own doc comment already accounts for.
 */
const KV_PATTERN = /(\S+?)=("(?:[^"\\]|\\.)*"|\S+)/g;

function parseLogLineFields(line: string): Map<string, string> {
  const fields = new Map<string, string>();
  KV_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = KV_PATTERN.exec(line)) !== null) {
    const [, key, rawValue] = match;
    fields.set(key, unquoteIfNeeded(rawValue));
  }
  return fields;
}

function unquoteIfNeeded(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return value;
}

/** `undefined` for a non-matching/non-scan-result line, or a `feasible=false` one (only printed with `-v`, but never trusted as a candidate even if present). */
export function parseRealitlscannerLine(line: string): Candidate | undefined {
  const fields = parseLogLineFields(line);
  if (fields.get('feasible') !== 'true') return undefined;

  const ip = fields.get('ip');
  const domain = fields.get('cert-domain') ?? fields.get('origin');
  const tlsVersion = fields.get('tls');
  const certIssuer = fields.get('cert-issuer');
  if (!ip || !domain || !tlsVersion || certIssuer === undefined) return undefined;

  const geo = fields.get('geo');
  const countryCode = geo && geo !== 'N/A' ? geo : undefined;

  return { domain, ip, tlsVersion, certIssuer, countryCode };
}

export function parseRealitlscannerOutput(stdout: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const line of stdout.split('\n')) {
    const candidate = parseRealitlscannerLine(line);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}
