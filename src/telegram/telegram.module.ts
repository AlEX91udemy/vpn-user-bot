import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { UserBotHandlers } from './handlers/user-bot.handlers';
import { TelegramService } from './telegram.service';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TrialModule } from '../trial/trial.module';
import { MtprotoModule } from '../mtproto/mtproto.module';
import { UserAssistantModule } from '../user-assistant/user-assistant.module';

@Module({
  imports: [
    CustomersModule,
    CatalogModule,
    OrdersModule,
    PaymentsModule,
    FulfillmentModule,
    SubscriptionsModule,
    TrialModule,
    MtprotoModule,
    UserAssistantModule,
  ],
  providers: [UserBotHandlers, TelegramService],
})
export class TelegramModule {}
