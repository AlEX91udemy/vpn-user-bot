import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TrialService } from './trial.service';

@Module({
  imports: [SubscriptionsModule],
  providers: [TrialService],
  exports: [TrialService],
})
export class TrialModule {}
