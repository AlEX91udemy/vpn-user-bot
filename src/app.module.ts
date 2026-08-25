import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CatalogModule } from './catalog/catalog.module';
import configuration from './config/configuration';
import { validateEnvironment } from './config/env';
import { CustomersModule } from './customers/customers.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { TelegramModule } from './telegram/telegram.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { FulfillmentModule } from './fulfillment/fulfillment.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { TrialModule } from './trial/trial.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnvironment,
    }),
    DatabaseModule,
    CustomersModule,
    CatalogModule,
    OrdersModule,
    PaymentsModule,
    FulfillmentModule,
    SubscriptionsModule,
    TrialModule,
    TelegramModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
