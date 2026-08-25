import { validateEnvironment } from '../../src/config/env';

describe('environment validation', () => {
  it('requires database and bot credentials', () =>
    expect(() => validateEnvironment({ NODE_ENV: 'test' })).toThrow());
  it('accepts configured values without returning or logging extras', () => {
    const result = validateEnvironment({
      DATABASE_URL: 'postgresql://local/test',
      BOT_TOKEN: 'configured-secret',
      NODE_ENV: 'test',
    });
    expect(result.BOT_TOKEN).toBe('configured-secret');
    expect(result).not.toHaveProperty('UNRELATED_SECRET');
  });
  it('allows only Telegram Stars as payment provider', () => {
    const base = {
      DATABASE_URL: 'postgresql://local/test',
      BOT_TOKEN: 'configured',
      NODE_ENV: 'test',
    };
    expect(validateEnvironment(base).PAYMENT_PROVIDER).toBe('telegram_stars');
    expect(() =>
      validateEnvironment({ ...base, PAYMENT_PROVIDER: 'fake' }),
    ).toThrow();
  });

  it('parses the fulfillment worker flag strictly', () => {
    expect(
      validateEnvironment({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
        BOT_TOKEN: 'configured',
        FULFILLMENT_WORKER_ENABLED: 'false',
      }).FULFILLMENT_WORKER_ENABLED,
    ).toBe(false);
  });
});
