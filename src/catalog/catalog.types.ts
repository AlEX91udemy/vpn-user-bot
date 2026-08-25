export interface TariffRecord {
  id: string;
  name: string;
  description: string;
  durationDays: number;
  amountMinor: number;
  currency: string;
  amountXtr: number | null;
  deviceLimit: number | null;
  trafficLimitBytes: bigint | null;
  isActive: boolean;
}

export interface TariffRepository {
  findActive(): Promise<TariffRecord[]>;
  findActiveById(id: string): Promise<TariffRecord | null>;
}

export const TARIFF_REPOSITORY = Symbol('TARIFF_REPOSITORY');
