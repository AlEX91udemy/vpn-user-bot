import type {
  TariffRecord,
  TariffRepository,
} from '../../src/catalog/catalog.types';
import type {
  CustomerRecord,
  CustomerRepository,
  TelegramIdentity,
} from '../../src/customers/customer.types';

export class InMemoryCustomerRepository implements CustomerRepository {
  private readonly rows = new Map<bigint, CustomerRecord>();

  async upsertFromTelegram(
    identity: TelegramIdentity,
  ): Promise<CustomerRecord> {
    await Promise.resolve();
    const key = BigInt(identity.id);
    const existing = this.rows.get(key);
    const row: CustomerRecord = {
      id: existing?.id ?? `customer-${identity.id}`,
      telegramUserId: key,
      username: identity.username ?? null,
      firstName: identity.first_name,
      lastName: identity.last_name ?? null,
      languageCode: identity.language_code ?? null,
      status: existing?.status ?? 'ACTIVE',
    };
    this.rows.set(key, row);
    return row;
  }

  async findByTelegramUserId(
    telegramUserId: bigint,
  ): Promise<CustomerRecord | null> {
    return this.rows.get(telegramUserId) ?? null;
  }

  get size(): number {
    return this.rows.size;
  }
}

export class InMemoryTariffRepository implements TariffRepository {
  constructor(public readonly rows: TariffRecord[]) {}

  async findActive(): Promise<TariffRecord[]> {
    return this.rows.filter((row) => row.isActive);
  }

  async findActiveById(id: string): Promise<TariffRecord | null> {
    return this.rows.find((row) => row.id === id && row.isActive) ?? null;
  }
}

export const activeTariff = (
  overrides: Partial<TariffRecord> = {},
): TariffRecord => ({
  id: 'opaque-30',
  name: 'VPN на 30 дней',
  description: 'Базовый тариф',
  durationDays: 30,
  amountMinor: 39_900,
  currency: 'RUB',
  amountXtr: 250,
  deviceLimit: 3,
  trafficLimitBytes: null,
  isActive: true,
  ...overrides,
});
