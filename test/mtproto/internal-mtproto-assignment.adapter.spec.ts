import type { ConfigService } from '@nestjs/config';
import { InternalMtprotoAssignmentAdapter } from '../../src/mtproto/internal-mtproto-assignment.adapter';

function adapter(fetchMock: jest.Mock<Promise<unknown>, [URL, RequestInit]>) {
  global.fetch = fetchMock as unknown as typeof fetch;
  return new InternalMtprotoAssignmentAdapter({
    get: (key: string) =>
      ({
        'mtproto.apiUrl': 'http://127.0.0.1:3999',
        'mtproto.apiKey': 'k'.repeat(32),
        'mtproto.timeoutMs': 1000,
      })[key],
  } as unknown as ConfigService);
}

const ok = (_url: URL, _init: RequestInit): Promise<unknown> =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({
      assigned: true,
      proxy: {
        server: 'verified.example',
        port: 443,
        secret: 'owner-secret',
        status: 'ONLINE',
        latencyMs: 15,
      },
    }),
  });

describe('InternalMtprotoAssignmentAdapter', () => {
  it('fails closed without configuration and makes no request', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new InternalMtprotoAssignmentAdapter({
      get: () => undefined,
    } as unknown as ConfigService);
    await expect(client.getCurrentAssignment(42)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('authenticates and sends only the owner Telegram ID', async () => {
    const fetchMock = jest.fn<Promise<unknown>, [URL, RequestInit]>(ok);
    const result = await adapter(fetchMock).getCurrentAssignment(42);
    expect(result?.proxyUrl).toContain('owner-secret');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('telegramUserId=42');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${'k'.repeat(32)}`,
    );
  });

  it('share uses the share endpoint and never rotates', async () => {
    const fetchMock = jest.fn<Promise<unknown>, [URL, RequestInit]>(ok);
    await adapter(fetchMock).getShareLink(42);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/share?');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('/rotate');
  });

  it('maps empty pool and unavailable service safely', async () => {
    await expect(
      adapter(
        jest
          .fn<Promise<unknown>, [URL, RequestInit]>()
          .mockResolvedValue({ ok: false, status: 503 }),
      ).getCurrentAssignment(42),
    ).resolves.toBeNull();
    const result = adapter(
      jest
        .fn<Promise<unknown>, [URL, RequestInit]>()
        .mockRejectedValue(new Error('secret details')),
    ).getCurrentAssignment(42);
    await expect(result).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    await expect(result).rejects.not.toThrow('secret details');
  });
});
