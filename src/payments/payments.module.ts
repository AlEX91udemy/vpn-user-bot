import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PAYMENT_PROVIDER } from './payment-provider.port';
import { PaymentService } from './payment.service';
import { PAYMENT_REPOSITORY } from './payment.types';
import { PrismaPaymentRepository } from './prisma-payment.repository';
import { TelegramStarsPaymentProvider } from './telegram-stars-payment.provider';

@Module({
  imports: [OrdersModule],
  providers: [
    PaymentService,
    TelegramStarsPaymentProvider,
    PrismaPaymentRepository,
    { provide: PAYMENT_PROVIDER, useExisting: TelegramStarsPaymentProvider },
    { provide: PAYMENT_REPOSITORY, useExisting: PrismaPaymentRepository },
  ],
  exports: [PaymentService, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
