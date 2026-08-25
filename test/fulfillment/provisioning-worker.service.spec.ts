import type { ConfigService } from '@nestjs/config';
import type { FulfillmentService } from '../../src/fulfillment/fulfillment.service';
import { ProvisioningWorker } from '../../src/fulfillment/provisioning-worker.service';
import type { TrialService } from '../../src/trial/trial.service';

describe('ProvisioningWorker', () => {
  it('runs fulfillment and trial recovery', async () => {
    const retryFulfillment = jest.fn().mockResolvedValue(undefined);
    const retryTrials = jest.fn().mockResolvedValue(undefined);
    const worker = new ProvisioningWorker(
      { retryDue: retryFulfillment } as unknown as FulfillmentService,
      { retryDue: retryTrials } as unknown as TrialService,
      { get: () => false } as unknown as ConfigService,
    );
    await worker.runOnce();
    expect(retryFulfillment).toHaveBeenCalledTimes(1);
    expect(retryTrials).toHaveBeenCalledTimes(1);
  });

  it('prevents overlapping worker runs', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const retryFulfillment = jest.fn(() => held);
    const retryTrials = jest.fn(() => held);
    const worker = new ProvisioningWorker(
      { retryDue: retryFulfillment } as unknown as FulfillmentService,
      { retryDue: retryTrials } as unknown as TrialService,
      { get: () => false } as unknown as ConfigService,
    );
    const first = worker.runOnce();
    await worker.runOnce();
    expect(retryFulfillment).toHaveBeenCalledTimes(1);
    expect(retryTrials).toHaveBeenCalledTimes(1);
    release();
    await first;
    await worker.runOnce();
    expect(retryFulfillment).toHaveBeenCalledTimes(2);
    expect(retryTrials).toHaveBeenCalledTimes(2);
  });
});
