import type { ConfigService } from '@nestjs/config';
import { RemnawaveHttpClient } from '../../src/remnawave/remnawave-http.client';

const remote = (overrides: Record<string, unknown> = {}) => ({
  response: {
    id: 7,
    uuid: '11111111-1111-4111-8111-111111111111',
    username: 'vpn_customer1',
    status: 'ACTIVE',
    expireAt: '2026-09-12T00:00:00.000Z',
    trafficLimitBytes: 10_737_418_240,
    hwidDeviceLimit: 5,
    subscriptionUrl: 'https://sub.example/safe',
    ...overrides,
  },
});

const response = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

function client(): RemnawaveHttpClient {
  return new RemnawaveHttpClient({
    get: (key: string) =>
      ({
        'remnawave.apiUrl': 'https://panel.example',
        'remnawave.apiToken': 'configured-secret',
        'remnawave.internalSquadUuid': '22222222-2222-4222-8222-222222222222',
        'remnawave.timeoutMs': 1000,
      })[key],
  } as ConfigService);
}

const input = {
  username: 'vpn_customer1',
  knownUserId: null,
  targetExpiresAt: new Date('2026-09-12T00:00:00.000Z'),
  trafficLimitBytes: 10n * 1024n ** 3n,
  deviceLimit: 5,
};

describe('RemnawaveHttpClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('creates a user using confirmed /api/users fields', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(404, {}))
      .mockResolvedValueOnce(response(201, remote()));
    await expect(client().ensureAccess(input)).resolves.toMatchObject({
      id: 7,
      status: 'ACTIVE',
    });
    expect(fetchMock.mock.calls[1][0]).toBe('https://panel.example/api/users');
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body).toMatchObject({
      username: input.username,
      expireAt: input.targetExpiresAt.toISOString(),
      hwidDeviceLimit: 5,
      trafficLimitBytes: 10_737_418_240,
    });
  });

  it.each([409, 500])(
    'reconciles create HTTP %s through stable username',
    async (status) => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(response(404, {}))
        .mockResolvedValueOnce(response(status, {}))
        .mockResolvedValueOnce(response(200, remote()));
      await expect(client().ensureAccess(input)).resolves.toMatchObject({
        username: input.username,
      });
    },
  );

  it('reconciles a lost create response without a blind second create', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(404, {}))
      .mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(response(200, remote()));
    await client().ensureAccess(input);
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith('/api/users') && init?.method === 'POST',
      ),
    ).toHaveLength(1);
  });

  it('uses absolute PATCH for expired and disabled users', async () => {
    for (const status of ['EXPIRED', 'DISABLED']) {
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          response(
            200,
            remote({ status, expireAt: '2026-01-01T00:00:00.000Z' }),
          ),
        )
        .mockResolvedValueOnce(response(200, remote()));
      await client().ensureAccess({ ...input, knownUserId: '7' });
      expect(fetchMock.mock.calls[1][1]?.method).toBe('PATCH');
      expect(
        JSON.parse(String(fetchMock.mock.calls[1][1]?.body)),
      ).toMatchObject({
        id: 7,
        status: 'ACTIVE',
        expireAt: input.targetExpiresAt.toISOString(),
      });
      fetchMock.mockRestore();
    }
  });

  it('reissues through the confirmed revoke endpoint', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        response(200, remote({ subscriptionUrl: 'https://sub.example/new' })),
      );
    await expect(client().revokeSubscription('7')).resolves.toMatchObject({
      subscriptionUrl: 'https://sub.example/new',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://panel.example/api/users/7/actions/revoke',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
  });

  it('reconciles a renewal timeout against the exact target expiry', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        response(200, remote({ expireAt: '2026-08-01T00:00:00.000Z' })),
      )
      .mockRejectedValueOnce(new TypeError('timeout'))
      .mockResolvedValueOnce(response(200, remote()));
    await expect(
      client().ensureAccess({ ...input, knownUserId: '7' }),
    ).resolves.toMatchObject({ expireAt: input.targetExpiresAt });
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH'),
    ).toHaveLength(1);
  });

  it.each([
    [401, false],
    [422, false],
    [500, true],
  ])('classifies HTTP %s retryable=%s', async (status, retryable) => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(response(status as number, {}));
    await expect(client().getById('7')).rejects.toMatchObject({ retryable });
  });

  it('rejects malformed and invalid-expiry responses as non-retryable', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(response(200, remote({ expireAt: 'invalid' })));
    await expect(client().getById('7')).rejects.toMatchObject({
      retryable: false,
    });
  });
});
