# VPN User Bot

Отдельный пользовательский Telegram-бот для покупки VPN и self-service. Он не импортирует и не запускает административную инфраструктуру `vpn-tg-bot`.

## Current scope

Реализованы foundation, Customer, Catalog, Telegram Stars и VPN fulfillment:

- NestJS + grammY;
- PostgreSQL + Prisma;
- безопасная конфигурация;
- регистрация Customer по `ctx.from.id`;
- каталог активных тарифов;
- server-side snapshot тарифа в Order;
- Telegram Stars invoice (`XTR`), `pre_checkout_query` и `successful_payment`;
- атомарная и идемпотентная фиксация Payment и `Order -> PAID`;
- Trial 5 дней / 10 ГБ / 5 устройств с `UNIQUE(customerId)`;
- Remnawave create/update и reconciliation по стабильному server-generated username;
- локальная customer-owned Subscription projection;
- идемпотентный `PAID -> FULFILLED` и retryable `FULFILLMENT_FAILED`;
- базовая навигация Telegram;
- `GET /health`.

**PAYMENT PROVIDER: TELEGRAM STARS**

**RUB PRICES ARE DEVELOPMENT DATA. XTR PRICES MUST BE CONFIGURED EXPLICITLY.**

MTProto runtime, AI и support tickets не реализованы. VPN считается выданным только после подтверждённого Remnawave provisioning и синхронизации Subscription.

## Remnawave

Используются подтверждённые API операции:

- `GET /api/users/:id`;
- `GET /api/users/by-username/:username`;
- `POST /api/users`;
- `PATCH /api/users`.

Для retry-safe renew задаётся абсолютный `expireAt`; неидемпотентный extend endpoint не используется. После timeout/5xx выполняется GET reconciliation. Повторный blind create запрещён. Для доступа пользователя к VPN необходимо явно настроить `REMNAWAVE_INTERNAL_SQUAD_UUID`.

Retry worker включается только через `FULFILLMENT_WORKER_ENABLED=true`. Задержки задаются `FULFILLMENT_RETRY_DELAYS_MS`.

## Telegram Stars pricing

Telegram Stars — отдельная валюта, поэтому RUB не конвертируется в XTR автоматически. Поле `Tariff.amountXtr` настраивается явно. При `null` кнопка оплаты не показывается и invoice не создаётся. Development seed не выбирает курс и оставляет `amountXtr=null`.

## Payment invariants

- Callback содержит только opaque Tariff ID.
- Order хранит server-side snapshot цены и параметров тарифа.
- Invoice payload содержит только `order:<uuid>`.
- `pre_checkout_query` повторно сверяет Customer, status, currency и amount.
- `successful_payment` атомарно создаёт один Payment и переводит Order в `PAID`.
- Идемпотентность защищают transaction, unique constraints и `telegram_payment_charge_id`.

## Local setup

1. Требуется Node.js 22+ и PostgreSQL.
2. Скопируйте `.env.example` в `.env` и заполните локальные значения.
3. Выполните `npm install`.
4. Выполните `npm run prisma:generate` и `npm run prisma:migrate:dev`.
5. Только для development можно выполнить `npm run prisma:seed`.
6. Запустите `npm run start:dev`.

Никогда не добавляйте `.env` в Git. Development seed намеренно отказывается работать при `NODE_ENV=production`.

## Commands

```bash
npm run typecheck
npm run build
npm test -- --runInBand
npm run lint
```

## Identity and callback security

- Customer определяется исключительно через `ctx.from.id`.
- Telegram username используется только как display data.
- Callback тарифа содержит только `buy:tariff:<opaque-id>` или `pay:tariff:<opaque-id>`.
- Цена, валюта и параметры тарифа повторно загружаются из PostgreSQL.
- Callback не принимает Telegram ID, subscription URL или Remnawave UUID.
