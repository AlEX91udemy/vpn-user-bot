import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import {
  MtprotoAssignmentError,
  type MtprotoAssignment,
  type MtprotoAssignmentPort,
} from './mtproto-assignment.port';

const responseSchema = z.object({
  assigned: z.literal(true),
  proxy: z.object({
    server: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    secret: z.string().min(1),
    status: z.literal('ONLINE'),
    latencyMs: z.number().int().nonnegative().nullable(),
  }),
});

@Injectable()
export class InternalMtprotoAssignmentAdapter implements MtprotoAssignmentPort {
  private readonly baseUrl?: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('mtproto.apiUrl')?.replace(/\/$/, '');
    this.apiKey = config.get<string>('mtproto.apiKey');
    this.timeoutMs = config.get<number>('mtproto.timeoutMs') ?? 5000;
  }

  getCurrentAssignment(id: number): Promise<MtprotoAssignment | null> {
    return this.assignment('', id, 'GET');
  }

  rotateAssignment(id: number): Promise<MtprotoAssignment | null> {
    return this.assignment('/rotate', id, 'POST');
  }

  async getShareLink(id: number): Promise<string | null> {
    const assignment = await this.assignment('/share', id, 'GET');
    return assignment?.proxyUrl ?? null;
  }

  checkAssignment(id: number): Promise<MtprotoAssignment | null> {
    return this.assignment('/check', id, 'GET');
  }

  private async assignment(path: string, id: number, method: 'GET' | 'POST') {
    if (!this.baseUrl || !this.apiKey)
      throw new MtprotoAssignmentError('SERVICE_UNAVAILABLE');
    try {
      const url = new URL(`${this.baseUrl}/internal/mtproto/assignment${path}`);
      url.searchParams.set('telegramUserId', String(id));
      const response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 503 || response.status === 404) return null;
      if (!response.ok) throw new MtprotoAssignmentError('SERVICE_UNAVAILABLE');
      const { proxy } = responseSchema.parse(await response.json());
      const link = new URL('https://t.me/proxy');
      link.searchParams.set('server', proxy.server);
      link.searchParams.set('port', String(proxy.port));
      link.searchParams.set('secret', proxy.secret);
      return { proxyUrl: link.toString(), latencyMs: proxy.latencyMs };
    } catch (error) {
      if (error instanceof MtprotoAssignmentError) throw error;
      throw new MtprotoAssignmentError('SERVICE_UNAVAILABLE');
    }
  }
}
