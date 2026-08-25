import { Module } from '@nestjs/common';
import { RemnawaveModule } from '../remnawave/remnawave.module';
import { CustomerSubscriptionService } from './customer-subscription.service';

@Module({
  imports: [RemnawaveModule],
  providers: [CustomerSubscriptionService],
  exports: [CustomerSubscriptionService],
})
export class SubscriptionsModule {}
