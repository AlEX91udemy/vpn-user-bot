import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import {
  type EnsureAccessInput,
  type RemnawaveGateway,
  RemnawaveError,
  type RemnawaveUser,
} from './remnawave.types';

const userSchema = z
  .object({
    id: z.number().int(),
    uuid: z.string().uuid(),
    username: z.string(),
    status: z.enum(['ACTIVE', 'DISABLED', 'LIMITED', 'EXPIRED']),
    expireAt: z.string().datetime({ offset: true }),
    trafficLimitBytes: z.number().nonnegative(),
    hwidDeviceLimit: z.number().int().nonnegative().nullable(),
    subscriptionUrl: z.string().url(),
  })
  .passthrough();
const responseSchema = z.object({ response: userSchema });

@Injectable()
export class RemnawaveHttpClient implements RemnawaveGateway {
  private readonly baseUrl?: string;
  private readonly token?: string;
  private readonly squadUuid?: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = (
      config.get<string>('app.remnawave.apiUrl') ??
      config.get<string>('remnawave.apiUrl')
    )?.replace(/\/$/, '');
    this.token =
      config.get<string>('app.remnawave.apiToken') ??
      config.get<string>('remnawave.apiToken');
    this.squadUuid =
      config.get<string>('app.remnawave.internalSquadUuid') ??
      config.get<string>('remnawave.internalSquadUuid');
    this.timeoutMs =
      config.get<number>('app.remnawave.timeoutMs') ??
      config.get<number>('remnawave.timeoutMs') ??
      10_000;
  }

  async ensureAccess(input: EnsureAccessInput): Promise<RemnawaveUser> {
    let user = input.knownUserId
      ? await this.getById(input.knownUserId)
      : await this.getByUsername(input.username);
    const targetExpiry = input.targetExpiresAt;

    if (!user) {
      try {
        user = await this.create({ ...input, targetExpiry });
      } catch (error) {
        if (!(error instanceof RemnawaveError) || !error.retryable) throw error;
        user = await this.getByUsername(input.username);
        if (!user) throw error;
      }
    }

    if (this.matches(user, targetExpiry, input)) return user;
    try {
      return await this.update(user, targetExpiry, input);
    } catch (error) {
      if (!(error instanceof RemnawaveError) || !error.retryable) throw error;
      const reconciled = await this.getById(String(user.id));
      if (reconciled && this.matches(reconciled, targetExpiry, input))
        return reconciled;
      throw error;
    }
  }

  async getById(id: string): Promise<RemnawaveUser | null> {
    return this.get(`/api/users/${encodeURIComponent(id)}`);
  }

  async revokeSubscription(id: string): Promise<RemnawaveUser> {
    const response = await this.request(
      `/api/users/${encodeURIComponent(id)}/actions/revoke`,
      { method: 'POST', body: '{}' },
      true,
    );
    return this.parse(response);
  }

  private getByUsername(username: string): Promise<RemnawaveUser | null> {
    return this.get(`/api/users/by-username/${encodeURIComponent(username)}`);
  }

  private async get(path: string): Promise<RemnawaveUser | null> {
    const response = await this.request(path, undefined, false);
    if (response === null) return null;
    return this.parse(response);
  }

  private async create(
    input: EnsureAccessInput & { targetExpiry: Date },
  ): Promise<RemnawaveUser> {
    const response = await this.request(
      '/api/users',
      {
        method: 'POST',
        body: JSON.stringify({
          username: input.username,
          status: 'ACTIVE',
          expireAt: input.targetExpiry.toISOString(),
          trafficLimitBytes: Number(input.trafficLimitBytes ?? 0n),
          trafficLimitStrategy: 'NO_RESET',
          hwidDeviceLimit: input.deviceLimit,
          activeInternalSquads: this.squadUuid ? [this.squadUuid] : undefined,
        }),
      },
      true,
    );
    return this.parse(response);
  }

  private async update(
    user: RemnawaveUser,
    targetExpiry: Date,
    input: EnsureAccessInput,
  ): Promise<RemnawaveUser> {
    const response = await this.request(
      '/api/users',
      {
        method: 'PATCH',
        body: JSON.stringify({
          id: user.id,
          status: 'ACTIVE',
          expireAt: targetExpiry.toISOString(),
          trafficLimitBytes: Number(input.trafficLimitBytes ?? 0n),
          trafficLimitStrategy: 'NO_RESET',
          hwidDeviceLimit: input.deviceLimit,
          activeInternalSquads: this.squadUuid ? [this.squadUuid] : undefined,
        }),
      },
      true,
    );
    return this.parse(response);
  }

  private matches(
    user: RemnawaveUser,
    target: Date,
    input: EnsureAccessInput,
  ): boolean {
    return (
      user.status === 'ACTIVE' &&
      user.expireAt.getTime() === target.getTime() &&
      (input.deviceLimit === null ||
        user.hwidDeviceLimit === input.deviceLimit) &&
      (input.trafficLimitBytes === null ||
        user.trafficLimitBytes === input.trafficLimitBytes)
    );
  }

  private parse(value: unknown): RemnawaveUser {
    try {
      const user = responseSchema.parse(value).response;
      return {
        ...user,
        expireAt: new Date(user.expireAt),
        trafficLimitBytes: BigInt(user.trafficLimitBytes),
      };
    } catch {
      throw new RemnawaveError('REMNAWAVE_INVALID_RESPONSE', false);
    }
  }

  private async request(
    path: string,
    init?: RequestInit,
    mutation = false,
  ): Promise<unknown | null> {
    if (!this.baseUrl || !this.token)
      throw new RemnawaveError('REMNAWAVE_NOT_CONFIGURED', false);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 404 && !mutation) return null;
      if (response.status === 409)
        throw new RemnawaveError('REMNAWAVE_CONFLICT', true, mutation);
      if (response.status === 401 || response.status === 403)
        throw new RemnawaveError('REMNAWAVE_AUTH_ERROR', false);
      if (response.status === 400 || response.status === 422)
        throw new RemnawaveError('REMNAWAVE_VALIDATION_ERROR', false);
      if (response.status >= 500)
        throw new RemnawaveError('REMNAWAVE_TEMPORARY_ERROR', true, mutation);
      if (!response.ok)
        throw new RemnawaveError('REMNAWAVE_REQUEST_ERROR', false);
      return response.json();
    } catch (error) {
      if (error instanceof RemnawaveError) throw error;
      throw new RemnawaveError('REMNAWAVE_NETWORK_ERROR', true, mutation);
    }
  }
}
