/**
 * Standard hostname shape (labels of 1-63 alnum/hyphen chars, not starting
 * or ending with a hyphen, joined by dots, ≤253 chars total). Applied to
 * every whitelist entry before it's written into the remote scanner input
 * file — defense in depth even though the whitelist comes from trusted
 * config, not Telegram input: a hand-edited config typo shouldn't silently
 * corrupt the file RealiTLScanner reads.
 */
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/;

export function isValidHostname(value: string): boolean {
  return HOSTNAME_PATTERN.test(value);
}
