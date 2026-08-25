import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  TARIFF_REPOSITORY,
  type TariffRecord,
  type TariffRepository,
} from './catalog.types';

const TARIFF_ID = /^[A-Za-z0-9_-]{1,64}$/;

@Injectable()
export class CatalogService {
  constructor(
    @Inject(TARIFF_REPOSITORY) private readonly tariffs: TariffRepository,
  ) {}

  listActive(): Promise<TariffRecord[]> {
    return this.tariffs.findActive();
  }

  async selectActiveTariff(opaqueTariffId: string): Promise<TariffRecord> {
    if (!TARIFF_ID.test(opaqueTariffId))
      throw new BadRequestException('Invalid tariff');
    const tariff = await this.tariffs.findActiveById(opaqueTariffId);
    if (!tariff) throw new NotFoundException('Tariff not found');
    return tariff;
  }
}
