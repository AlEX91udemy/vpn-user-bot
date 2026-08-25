import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { TariffRecord, TariffRepository } from './catalog.types';

@Injectable()
export class PrismaTariffRepository implements TariffRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActive(): Promise<TariffRecord[]> {
    return this.prisma.tariff.findMany({
      where: { isActive: true },
      orderBy: [{ durationDays: 'asc' }, { id: 'asc' }],
    });
  }

  findActiveById(id: string): Promise<TariffRecord | null> {
    return this.prisma.tariff.findFirst({ where: { id, isActive: true } });
  }
}
