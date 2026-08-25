import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CUSTOMER_REPOSITORY,
  type CustomerRecord,
  type CustomerRepository,
  type TelegramIdentity,
} from './customer.types';

@Injectable()
export class CustomerService {
  constructor(
    @Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository,
  ) {}

  getOrCreateFromTelegram(from: TelegramIdentity): Promise<CustomerRecord> {
    return this.customers.upsertFromTelegram(from);
  }

  async getCurrentCustomer(telegramUserId: number): Promise<CustomerRecord> {
    const customer = await this.customers.findByTelegramUserId(
      BigInt(telegramUserId),
    );
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }
}
