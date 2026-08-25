import { Module } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CUSTOMER_REPOSITORY } from './customer.types';
import { PrismaCustomerRepository } from './prisma-customer.repository';

@Module({
  providers: [
    CustomerService,
    PrismaCustomerRepository,
    { provide: CUSTOMER_REPOSITORY, useExisting: PrismaCustomerRepository },
  ],
  exports: [CustomerService],
})
export class CustomersModule {}
