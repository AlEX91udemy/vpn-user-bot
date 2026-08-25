import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TrialModule } from '../trial/trial.module';
import { FulfillmentService } from './fulfillment.service';
import { ProvisioningWorker } from './provisioning-worker.service';

@Module({
  imports: [SubscriptionsModule, TrialModule],
  providers: [FulfillmentService, ProvisioningWorker],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}
