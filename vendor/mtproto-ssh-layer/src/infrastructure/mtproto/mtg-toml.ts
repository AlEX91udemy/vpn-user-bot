/**
 * MTG's own minimal config shape (confirmed against the project's README,
 * 2026-08-04): "All options except `secret` and `bind-to` are optional,
 * so the minimal working configuration is: `secret = "..."` /
 * `bind-to = "0.0.0.0:443"`". This module only ever produces/reads those
 * two keys — no attempt to model MTG's full config surface, which is out
 * of scope for this pass.
 *
 * The domain isn't a real MTG config key at all (it's encoded inside the
 * `ee`-prefixed fake-TLS `secret` itself). Rather than reverse-engineer
 * that binary encoding to recover it on read — a hand-rolled decoder
 * would be exactly the kind of silent version-format drift the
 * `generateConfig` doc comment already flags as a risk — it's stored
 * as a leading TOML comment purely for this project's own bookkeeping
 * (`UpdateReport.previousConfig`, backups). MTG itself ignores comments.
 */
const DOMAIN_COMMENT_PREFIX = '# mtproto-managed-domain: ';

export interface MtgTomlFields {
  readonly domain: string;
  readonly secret: string;
  readonly bindTo: string;
}

export interface ParsedMtgToml {
  readonly domain?: string;
  readonly secret?: string;
  readonly bindTo?: string;
}

export function serializeMtgToml(fields: MtgTomlFields): string {
  return [
    `${DOMAIN_COMMENT_PREFIX}${stripNewlines(fields.domain)}`,
    `secret = ${tomlString(fields.secret)}`,
    `bind-to = ${tomlString(fields.bindTo)}`,
    '',
  ].join('\n');
}

export function parseMtgToml(raw: string): ParsedMtgToml {
  const domainMatch = /^# mtproto-managed-domain: (.*)$/m.exec(raw);
  const secretMatch = /^secret\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(raw);
  const bindToMatch = /^bind-to\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(raw);
  return {
    domain: domainMatch?.[1]?.trim(),
    secret: secretMatch ? unescapeTomlString(secretMatch[1]) : undefined,
    bindTo: bindToMatch ? unescapeTomlString(bindToMatch[1]) : undefined,
  };
}

/** A real TOML basic-string escaper (quotes/backslashes/newlines) — never naive `${value}` interpolation, even though today's callers only ever pass hex secrets and already-validated hostnames. */
function tomlString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

function unescapeTomlString(value: string): string {
  return value
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function stripNewlines(value: string): string {
  return value.replace(/[\r\n]/g, ' ');
}
