/**
 * The fixed, per-name command registry `SshExecutorService` is allowed to
 * run. There is no code path anywhere in this layer that accepts a raw
 * command string from a caller — `execute()`/`executeBatch()` only ever
 * take a *name* that must be a key here (see `isKnownSshCommand`). This is
 * the same "no path from business logic to arbitrary shell text" rule
 * vpn-tg-bot applies via its own `SSH_COMMANDS` — see
 * `src/ssh/ssh-command-registry.ts` there — kept intact because it's the
 * actual security boundary of this whole module, not something specific to
 * that project.
 *
 * Only generic, host-agnostic entries live here for now. This module's job
 * is the SSH *infrastructure* — connection pooling, batching, typed errors,
 * logging — not MTProto itself (explicitly out of scope for this pass).
 * The names below exist only to exercise that infrastructure end-to-end
 * against a real host.
 *
 * Reserved for Stage 2, once the target proxy software is chosen and its
 * exact commands/config paths are confirmed (see vpn-tg-bot's
 * ssh-command-registry.ts header for the standard of "confirmed via live
 * recon before it goes in the registry" this project should hold itself
 * to). Naming convention to keep: `mtproto.<resource>[.<sub-resource>].<action>`.
 *   mtproto.status
 *   mtproto.restart
 *   mtproto.reload
 *   mtproto.logs
 *   mtproto.proxy.generate
 *   mtproto.proxy.check
 *   mtproto.firewall.status
 *   mtproto.backup
 */
export const SSH_COMMANDS: Readonly<Record<string, string>> = Object.freeze({
  'system.whoami': 'whoami',
  'system.uptime': 'uptime',
  'system.disk_usage': "df -h / | awk 'NR==2 {print $5}' | tr -d '%'",
});

export function isKnownSshCommand(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(SSH_COMMANDS, name);
}

/** Throws nothing — returns `undefined` for an unknown name; callers decide how to fail. */
export function getSshCommand(name: string): string | undefined {
  return SSH_COMMANDS[name];
}
