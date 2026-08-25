import { HealthController } from '../../src/health/health.controller';

describe('HealthController', () => {
  it('returns only public status', () =>
    expect(new HealthController().check()).toEqual({ status: 'ok' }));
});
