import { Injectable } from '@nestjs/common';
import { Socket } from 'node:net';
import { PrismaService } from '../database/prisma.service';
import {
  MtprotoAssignmentError,
  type MtprotoAssignment,
  type MtprotoAssignmentPort,
} from './mtproto-assignment.port';

type Candidate = { host: string; port: number; secret: string; pingMs: number | null };
type Checked = Candidate & { status: 'ONLINE' | 'OFFLINE' | 'INVALID' | 'UNKNOWN' };
const SOURCE_URL = 'https://lumintomc.ru/mt/';
const MAX_RESPONSE_BYTES = 1_000_000;
const PROBE_TIMEOUT_MS = 4_000;

@Injectable()
export class LumintoMtprotoAssignmentAdapter implements MtprotoAssignmentPort {
  private refreshInFlight?: Promise<void>;
  private lastSuccessAt = 0;
  private readonly ttlMs: number;

  constructor(private readonly db: PrismaService) {
    this.ttlMs = Number(process.env.MTPROTO_LUMINTO_CACHE_TTL_MS ?? 1_800_000);
  }

  async getCurrentAssignment(telegramUserId: number): Promise<MtprotoAssignment | null> {
    const existing = await this.getAssigned(telegramUserId);
    if (existing) {
      const checked = await probe(existing);
      await this.saveProxy(checked);
      if (checked.status === 'ONLINE') return this.toAssignment(checked);
    }
    await this.ensureFreshList();
    const replacement = (await this.listOnline())[0];
    if (!replacement) return null;
    await this.assign(telegramUserId, replacement);
    return this.toAssignment(replacement);
  }

  async rotateAssignment(telegramUserId: number): Promise<MtprotoAssignment | null> {
    await this.ensureFreshList(true);
    const current = await this.getAssigned(telegramUserId);
    const online = await this.listOnline();
    const replacement = online.find((p) => !current || p.id !== current.id) ?? online[0];
    if (!replacement) return null;
    await this.assign(telegramUserId, replacement);
    return this.toAssignment(replacement);
  }

  async getShareLink(telegramUserId: number): Promise<string | null> {
    const assignment = await this.getAssigned(telegramUserId);
    return assignment ? this.link(assignment) : null;
  }

  async checkAssignment(telegramUserId: number): Promise<MtprotoAssignment | null> {
    const assignment = await this.getAssigned(telegramUserId);
    if (!assignment) return null;
    const checked = await probe(assignment);
    await this.saveProxy(checked);
    return checked.status === 'ONLINE' ? this.toAssignment(checked) : null;
  }

  private async ensureFreshList(force = false): Promise<void> {
    if (!force && this.lastSuccessAt && Date.now() - this.lastSuccessAt < this.ttlMs) return;
    this.refreshInFlight ??= this.refreshFromSite().finally(() => { this.refreshInFlight = undefined; });
    await this.refreshInFlight;
  }

  private async refreshFromSite(): Promise<void> {
    let response: Response;
    try {
      response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(12_000), redirect: 'error' });
    } catch { throw new MtprotoAssignmentError('SERVICE_UNAVAILABLE'); }
    if (!response.ok) throw new MtprotoAssignmentError('SERVICE_UNAVAILABLE');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new MtprotoAssignmentError('SERVICE_UNAVAILABLE');
    const candidates = parseLumintoHtml(new TextDecoder().decode(bytes));
    if (!candidates.length) throw new MtprotoAssignmentError('SERVICE_UNAVAILABLE');
    const checked = await mapWithConcurrency(candidates, 20, probe);
    await Promise.all(checked.map((proxy) => this.saveProxy(proxy)));
    if (!checked.some((proxy) => proxy.status === 'ONLINE')) throw new MtprotoAssignmentError('PROXY_UNAVAILABLE');
    this.lastSuccessAt = Date.now();
  }

  private async getAssigned(telegramUserId: number) {
    return this.db.mtprotoAssignment.findUnique({ where: { telegramUserId: BigInt(telegramUserId) }, include: { proxy: true } }).then((row) => row?.proxy ?? null);
  }

  private async listOnline() {
    return this.db.mtprotoProxy.findMany({ where: { status: 'ONLINE' }, orderBy: [{ pingMs: 'asc' }, { updatedAt: 'desc' }], take: 50 });
  }

  private async saveProxy(proxy: Checked): Promise<void> {
    await this.db.mtprotoProxy.upsert({
      where: { host_port_secret: { host: proxy.host, port: proxy.port, secret: proxy.secret } },
      create: { host: proxy.host, port: proxy.port, secret: proxy.secret, status: proxy.status, pingMs: proxy.pingMs },
      update: { status: proxy.status, pingMs: proxy.pingMs },
    });
  }

  private async assign(telegramUserId: number, proxy: { id: string }): Promise<void> {
    await this.db.mtprotoAssignment.upsert({
      where: { telegramUserId: BigInt(telegramUserId) },
      create: { telegramUserId: BigInt(telegramUserId), proxyId: proxy.id },
      update: { proxyId: proxy.id },
    });
  }

  private toAssignment(proxy: Candidate): MtprotoAssignment { return { proxyUrl: this.link(proxy), latencyMs: proxy.pingMs }; }
  private link(proxy: Candidate): string { const url = new URL('https://t.me/proxy'); url.searchParams.set('server', proxy.host); url.searchParams.set('port', String(proxy.port)); url.searchParams.set('secret', proxy.secret); return url.toString(); }
}

export function parseLumintoHtml(html: string): Candidate[] {
  const result: Candidate[] = []; const seen = new Set<string>();
  const pattern = /href\s*=\s*["'](tg:\/\/proxy\?[^"']+)["']/gi;
  for (let match; (match = pattern.exec(html)) && result.length < 500;) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, '&'));
      const host = (url.searchParams.get('server') ?? '').trim().toLowerCase();
      const port = Number(url.searchParams.get('port')); const secret = (url.searchParams.get('secret') ?? '').trim().toLowerCase();
      const key = `${host}:${port}:${secret}`;
      if (!seen.has(key) && validate(host, port, secret)) { seen.add(key); result.push({ host, port, secret, pingMs: sourcePing(html, match.index) }); }
    } catch { /* skip malformed links */ }
  }
  return result;
}

function validate(host: string, port: number, secret: string): boolean { return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$|^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) && Number.isInteger(port) && port > 0 && port <= 65535 && /^[0-9a-f]{32,512}$/i.test(secret) && secret.length % 2 === 0; }
function sourcePing(html: string, offset: number): number | null { const m = [...html.slice(Math.max(0, offset - 1200), offset).matchAll(/(\d{1,5})\s*ms/gi)].at(-1)?.[1]; return m ? Number(m) : null; }
async function probe(proxy: Candidate): Promise<Checked> {
  if (!validate(proxy.host, proxy.port, proxy.secret)) return { ...proxy, status: 'INVALID' };
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = new Socket(); let settled = false;
    const finish = (status: Checked['status']) => { if (settled) return; settled = true; socket.destroy(); resolve({ ...proxy, status, pingMs: status === 'ONLINE' ? Date.now() - started : proxy.pingMs }); };
    socket.setTimeout(PROBE_TIMEOUT_MS); socket.once('connect', () => finish('ONLINE')); socket.once('timeout', () => finish('OFFLINE')); socket.once('error', (e: NodeJS.ErrnoException) => finish(e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN' ? 'UNKNOWN' : 'OFFLINE')); socket.connect(proxy.port, proxy.host);
  });
}
async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> { const results = new Array<R>(items.length); let next = 0; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { for (;;) { const i = next++; if (i >= items.length) return; results[i] = await mapper(items[i]); } })); return results; }
