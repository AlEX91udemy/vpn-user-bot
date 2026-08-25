import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { OrderService } from './order.service';
import { ORDER_REPOSITORY } from './order.types';
import { PrismaOrderRepository } from './prisma-order.repository';

@Module({
  imports: [CatalogModule],
  providers: [
    OrderService,
    PrismaOrderRepository,
    { provide: ORDER_REPOSITORY, useExisting: PrismaOrderRepository },
  ],
  exports: [OrderService, ORDER_REPOSITORY],
})
export class OrdersModule {}
