export type CustomerStatus = 'ACTIVE' | 'BLOCKED';

export interface CustomerRecord {
  id: string;
  telegramUserId: bigint;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  remnawaveUserId?: string | null;
  remnawaveUsername?: string | null;
  status: CustomerStatus;
}

export interface TelegramIdentity {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
  language_code?: string;
}

export interface CustomerRepository {
  upsertFromTelegram(identity: TelegramIdentity): Promise<CustomerRecord>;
  findByTelegramUserId(telegramUserId: bigint): Promise<CustomerRecord | null>;
}

export const CUSTOMER_REPOSITORY = Symbol('CUSTOMER_REPOSITORY');
