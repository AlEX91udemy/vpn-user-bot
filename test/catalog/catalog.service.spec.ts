import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CatalogService } from '../../src/catalog/catalog.service';
import {
  activeTariff,
  InMemoryTariffRepository,
} from '../helpers/in-memory.repositories';

describe('CatalogService', () => {
  it('shows active and hides inactive tariffs', async () => {
    const service = new CatalogService(
      new InMemoryTariffRepository([
        activeTariff(),
        activeTariff({ id: 'inactive', isActive: false }),
      ]),
    );
    await expect(service.listActive()).resolves.toEqual([
      expect.objectContaining({ id: 'opaque-30' }),
    ]);
  });

  it('loads price and currency from the repository', async () => {
    const service = new CatalogService(
      new InMemoryTariffRepository([
        activeTariff({ amountMinor: 55_500, currency: 'RUB' }),
      ]),
    );
    await expect(service.selectActiveTariff('opaque-30')).resolves.toEqual(
      expect.objectContaining({ amountMinor: 55_500, currency: 'RUB' }),
    );
  });

  it('rejects inactive or unknown tariffs', async () => {
    const service = new CatalogService(
      new InMemoryTariffRepository([activeTariff({ isActive: false })]),
    );
    await expect(
      service.selectActiveTariff('opaque-30'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects payloads that try to inject amount or currency', async () => {
    const service = new CatalogService(
      new InMemoryTariffRepository([activeTariff()]),
    );
    await expect(
      service.selectActiveTariff('opaque-30:1:USD'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
