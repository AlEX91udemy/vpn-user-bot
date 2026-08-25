import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FulfillmentService } from './fulfillment.service';
import { TrialService } from '../trial/trial.service';

@Injectable()
export class ProvisioningWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(
    private readonly fulfillment: FulfillmentService,
    private readonly trials: TrialService,
    private readonly config: ConfigService,
  ) {}
  onModuleInit(): void {
    if (
      !(
        this.config.get<boolean>('app.fulfillment.workerEnabled') ??
        this.config.get<boolean>('fulfillment.workerEnabled')
      )
    )
      return;
    this.timer = setInterval(() => void this.runOnce(), 30_000);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await Promise.allSettled([
        this.fulfillment.retryDue(),
        this.trials.retryDue(),
      ]);
    } finally {
      this.running = false;
    }
  }
}
