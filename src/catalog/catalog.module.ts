import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PrismaTariffRepository } from './prisma-tariff.repository';
import { TARIFF_REPOSITORY } from './catalog.types';

@Module({
  providers: [
    CatalogService,
    PrismaTariffRepository,
    { provide: TARIFF_REPOSITORY, useExisting: PrismaTariffRepository },
  ],
  exports: [CatalogService],
})
export class CatalogModule {}
