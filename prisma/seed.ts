import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const developmentTariffs = [
  {
    id: 'trial-5-days',
    name: 'Пробный доступ',
    description: '10 ГБ, до 5 устройств',
    durationDays: 5,
    amountMinor: 0,
    currency: 'RUB',
    amountXtr: null,
    deviceLimit: 5,
    trafficLimitBytes: 10n * 1024n ** 3n,
    isActive: false,
  },
  {
    id: 'month-31-days',
    name: 'VPN — 31 день',
    description: 'До 5 устройств, без автосписаний',
    durationDays: 31,
    amountMinor: 17_900,
    currency: 'RUB',
    amountXtr: null,
    deviceLimit: 5,
    isActive: true,
  },
  {
    id: 'year-365-days',
    name: 'VPN — 365 дней',
    description: 'До 5 устройств, без автосписаний',
    durationDays: 365,
    amountMinor: 169_000,
    currency: 'RUB',
    amountXtr: null,
    deviceLimit: 5,
    isActive: true,
  },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Development tariff seed must not run in production');
  }
  for (const tariff of developmentTariffs) {
    await prisma.tariff.upsert({
      where: { id: tariff.id },
      update: tariff,
      create: tariff,
    });
  }
}

main().finally(() => prisma.$disconnect());
