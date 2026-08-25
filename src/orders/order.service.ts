import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import {
  ORDER_REPOSITORY,
  type OrderRecord,
  type OrderRepository,
} from './order.types';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  constructor(
    private readonly catalog: CatalogService,
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
  ) {}

  async createCheckout(
    customerId: string,
    tariffId: string,
  ): Promise<OrderRecord> {
    const tariff = await this.catalog.selectActiveTariff(tariffId);
    if (tariff.amountXtr === null || tariff.amountXtr <= 0)
      throw new BadRequestException('Цена в Telegram Stars пока не настроена');
    const { order, created } = await this.orders.createOrReusePending(
      customerId,
      tariff,
    );
    if (created)
      this.logger.log({
        event: 'order_created',
        orderId: order.id,
        customerId,
        provider: 'telegram_stars',
        currency: order.currency,
        amountXtr: order.amountXtr,
        status: order.status,
      });
    return order;
  }

  findByPayload(payload: string): Promise<OrderRecord | null> {
    return this.orders.findByPayload(payload);
  }
}
