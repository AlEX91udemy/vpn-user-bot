import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type {
  CustomerRecord,
  CustomerRepository,
  TelegramIdentity,
} from './customer.types';

@Injectable()
export class PrismaCustomerRepository implements CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertFromTelegram(
    identity: TelegramIdentity,
  ): Promise<CustomerRecord> {
    return this.prisma.customer.upsert({
      where: { telegramUserId: BigInt(identity.id) },
      create: {
        telegramUserId: BigInt(identity.id),
        username: identity.username ?? null,
        firstName: identity.first_name,
        lastName: identity.last_name ?? null,
        languageCode: identity.language_code ?? null,
      },
      update: {
        username: identity.username ?? null,
        firstName: identity.first_name,
        lastName: identity.last_name ?? null,
        languageCode: identity.language_code ?? null,
      },
    });
  }

  async findByTelegramUserId(
    telegramUserId: bigint,
  ): Promise<CustomerRecord | null> {
    return this.prisma.customer.findUnique({ where: { telegramUserId } });
  }
}
