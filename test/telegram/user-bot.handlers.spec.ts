import { Bot, Context } from 'grammy';
import type { Update } from 'grammy/types';
import { CatalogService } from '../../src/catalog/catalog.service';
import { CustomerService } from '../../src/customers/customer.service';
import { UserBotHandlers } from '../../src/telegram/handlers/user-bot.handlers';
import type { OrderService } from '../../src/orders/order.service';
import type { PaymentService } from '../../src/payments/payment.service';
import { TelegramStarsPaymentProvider } from '../../src/payments/telegram-stars-payment.provider';
import type { MtprotoService } from '../../src/mtproto/mtproto.service';
import type { UserAssistantService } from '../../src/user-assistant/user-assistant.service';
import {
  activeTariff,
  InMemoryCustomerRepository,
  InMemoryTariffRepository,
} from '../helpers/in-memory.repositories';

function createHarness(
  options: {
    payments?: PaymentService;
    orders?: OrderService;
    subscription?: Record<string, unknown> | null;
    assignment?: { proxyUrl: string; latencyMs: number } | null;
    trialResult?: { kind: string; claim?: Record<string, unknown> | null };
  } = {},
) {
  const customers = new InMemoryCustomerRepository();
  const tariffs = new InMemoryTariffRepository([activeTariff()]);
  const bot = new Bot<Context>('1:TEST', {
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: 'VPN User Bot',
      username: 'vpn_user_test_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    },
  });
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  bot.api.config.use((_prev, method, rawPayload) => {
    const payload = rawPayload as Record<string, unknown>;
    calls.push({ method, payload });
    return Promise.resolve({
      ok: true,
      result: {
        message_id: 10,
        date: 0,
        chat: { id: 42, type: 'private' },
        text: String(payload.text ?? ''),
      },
    }) as never;
  });
  const mtproto = {
    getOwn: jest.fn().mockResolvedValue(options.assignment ?? null),
    rotateOwn: jest.fn().mockResolvedValue(options.assignment ?? null),
    shareOwn: jest.fn().mockResolvedValue(options.assignment?.proxyUrl ?? null),
  } as unknown as MtprotoService;
  const subscriptionService = {
    getOwn: jest.fn().mockResolvedValue(options.subscription ?? null),
    refreshOwn: jest.fn().mockResolvedValue(options.subscription ?? null),
    reissueOwn: jest.fn().mockResolvedValue({
      kind: 'REISSUED',
      subscription: options.subscription,
    }),
  };
  const assistant = {
    answer: jest.fn().mockResolvedValue('Безопасный ответ USER AI'),
    reset: jest.fn(),
    detectIntent: jest.fn((text: string) =>
      /сервер|нод/i.test(text) ? 'SERVER_AVAILABILITY_UNAVAILABLE' : 'FALLBACK',
    ),
    getOwnSubscription: jest.fn().mockResolvedValue('Ваша подписка'),
    getOwnMtproto: jest
      .fn()
      .mockResolvedValue(
        options.assignment
          ? `Ваш MTProto\n${options.assignment.proxyUrl}`
          : 'У вас пока нет назначенного MTProto.',
      ),
    searchFaq: jest.fn().mockReturnValue('FAQ'),
  } as unknown as UserAssistantService;
  new UserBotHandlers(
    new CustomerService(customers),
    new CatalogService(tariffs),
    options.orders ??
      ({
        createCheckout: jest.fn(),
        findByPayload: jest.fn(),
      } as unknown as OrderService),
    options.payments ??
      ({
        verifyPreCheckout: jest.fn(),
        handleSuccessfulPayment: jest.fn(),
      } as unknown as PaymentService),
    new TelegramStarsPaymentProvider(),
    {
      fulfillPaidOrder: jest.fn().mockResolvedValue({
        kind: 'DEFERRED',
        fulfillment: { status: 'FAILED' },
      }),
    } as never,
    subscriptionService as never,
    {
      claim: jest
        .fn()
        .mockResolvedValue(options.trialResult ?? { kind: 'FULFILLED', claim: {} }),
    } as never,
    mtproto,
    assistant,
  ).register(bot);
  return {
    bot,
    calls,
    customers,
    tariffs,
    mtproto,
    assistant,
    subscriptionService,
  };
}

const from = { id: 42, is_bot: false, first_name: 'Alice', username: 'alice' };
const messageUpdate = (text: string, id = 42, messageId = 1) => ({
  update_id: messageId,
  message: {
    message_id: messageId,
    date: 0,
    chat: { id, type: 'private' as const },
    from: { ...from, id },
    text,
    entities: [
      { offset: 0, length: text.length, type: 'bot_command' as const },
    ],
  },
});
const textUpdate = (text: string, id = 42, messageId = 3) => ({
  update_id: messageId + 2,
  message: {
    message_id: messageId,
    date: 0,
    chat: { id, type: 'private' as const },
    from: { ...from, id },
    text,
  },
});
const callbackUpdate = (data: string) => ({
  update_id: 2,
  callback_query: {
    id: 'cb',
    chat_instance: 'ci',
    from,
    data,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 42, type: 'private' as const },
      text: 'menu',
    },
  },
});
const preCheckoutUpdate = () => ({
  update_id: 3,
  pre_checkout_query: {
    id: 'pre-1',
    from,
    currency: 'XTR',
    total_amount: 250,
    invoice_payload: 'order:order-1',
  },
});
const successfulPaymentUpdate = () => ({
  update_id: 4,
  message: {
    message_id: 2,
    date: 0,
    chat: { id: 42, type: 'private' as const, first_name: 'Alice' },
    from,
    successful_payment: {
      currency: 'XTR',
      total_amount: 250,
      invoice_payload: 'order:order-1',
      telegram_payment_charge_id: 'charge-1',
      provider_payment_charge_id: '',
    },
  },
});

describe('UserBotHandlers', () => {
  it('/start registers customer and sends the welcome with Buy VPN in the main menu', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(messageUpdate('/start') as Update);
    expect(h.customers.size).toBe(1);
    const serialized = JSON.stringify(h.calls);
    expect(serialized).toContain('Rubridge VPN');
    expect(serialized).toContain('10 Гбит/с');
    expect(h.calls.map((call) => call.method)).toEqual([
      'setMyCommands',
      'sendMessage',
      'deleteMessage',
      'sendMessage',
    ]);
    expect(h.calls.at(-1)?.payload).toHaveProperty('reply_markup');
    const commands = h.calls[0].payload.commands as Array<{ command: string }>;
    expect(commands.map(({ command }) => command)).toEqual(['start', 'home']);
    expect(commands.map(({ command }) => command)).not.toContain('reset');
    expect(serialized).toContain('🛒 Купить VPN');
    expect(serialized).toContain('menu:buy');
    expect(serialized).not.toContain('menu:connection');
    expect(serialized).not.toContain('FAQ');
    expect(serialized).not.toContain('Не подключается');
    expect(serialized).not.toContain('Проблема с оплатой');
  });

  it('debounces repeated commands per user without blocking callbacks', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      const h = createHarness();
      await h.bot.handleUpdate(messageUpdate('/home', 42, 10) as Update);
      await h.bot.handleUpdate(messageUpdate('/home', 42, 11) as Update);
      await h.bot.handleUpdate(messageUpdate('/home', 42, 12) as Update);
      const inlineMenus = () =>
        h.calls.filter(
          (call) =>
            call.method === 'sendMessage' &&
            Boolean(
              call.payload.reply_markup &&
                'inline_keyboard' in (call.payload.reply_markup as object),
            ),
        );
      expect(inlineMenus()).toHaveLength(1);

      await h.bot.handleUpdate(callbackUpdate('menu:buy') as Update);
      expect(h.calls.some((call) => call.method === 'editMessageText')).toBe(true);

      now.mockReturnValue(2_001);
      await h.bot.handleUpdate(messageUpdate('/home', 42, 13) as Update);
      expect(inlineMenus()).toHaveLength(2);
    } finally {
      now.mockRestore();
    }
  });

  it('does not share command cooldowns between users or commands', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      const h = createHarness();
      await h.bot.handleUpdate(messageUpdate('/home', 42, 20) as Update);
      await h.bot.handleUpdate(messageUpdate('/home', 43, 21) as Update);
      const inlineMenus = () =>
        h.calls.filter(
          (call) =>
            call.method === 'sendMessage' &&
            Boolean(
              call.payload.reply_markup &&
                'inline_keyboard' in (call.payload.reply_markup as object),
            ),
        );
      expect(inlineMenus()).toHaveLength(2);

      await h.bot.handleUpdate(messageUpdate('/start', 42, 22) as Update);
      expect(inlineMenus()).toHaveLength(3);
    } finally {
      now.mockRestore();
    }
  });

  it('debounces start and reset independently', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      const h = createHarness();
      await h.bot.handleUpdate(messageUpdate('/start', 42, 30) as Update);
      await h.bot.handleUpdate(messageUpdate('/start', 42, 31) as Update);
      const inlineMenus = () =>
        h.calls.filter(
          (call) =>
            call.method === 'sendMessage' &&
            Boolean(
              call.payload.reply_markup &&
                'inline_keyboard' in (call.payload.reply_markup as object),
            ),
        );
      expect(inlineMenus()).toHaveLength(1);

      await h.bot.handleUpdate(callbackUpdate('menu:ai') as Update);
      await h.bot.handleUpdate(messageUpdate('/reset', 42, 32) as Update);
      await h.bot.handleUpdate(messageUpdate('/reset', 42, 33) as Update);
      expect(h.assistant.reset).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  it('opens USER AI, handles a question, resets and exits to Home', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(callbackUpdate('menu:ai') as Update);
    await h.bot.handleUpdate(textUpdate('Как подключиться?') as Update);
    await h.bot.handleUpdate(messageUpdate('/reset') as Update);
    await h.bot.handleUpdate(messageUpdate('/home') as Update);
    await h.bot.handleUpdate(textUpdate('Этот текст уже вне AI') as Update);
    expect(h.assistant.answer).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(h.calls);
    expect(serialized).toContain('Здесь можно свободно пообщаться');
    expect(h.assistant.reset).toHaveBeenCalledWith(42);
    expect(serialized).toContain('Диалог очищен');
    expect(serialized).not.toContain('Главное меню');
  });

  it('uses scoped Telegram commands without an AI reply keyboard', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(callbackUpdate('menu:ai') as Update);
    await h.bot.handleUpdate(textUpdate('Первый вопрос') as Update);
    await h.bot.handleUpdate(textUpdate('Второй вопрос', 42, 4) as Update);

    const assistantIntro = h.calls.find(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.payload.text).includes('Здесь можно свободно пообщаться'),
    );
    expect(assistantIntro?.payload.reply_markup).toEqual({ remove_keyboard: true });
    const commandCalls = h.calls.filter((call) => call.method === 'setMyCommands');
    expect(commandCalls).toHaveLength(1);
    expect(commandCalls[0].payload.scope).toEqual({ type: 'chat', chat_id: 42 });
    const commands = commandCalls[0].payload.commands as Array<{ command: string }>;
    expect(commands.map(({ command }) => command)).toEqual(['home', 'reset']);
    expect(commands.map(({ command }) => command)).not.toContain('ai');
    expect(commands.map(({ command }) => command)).not.toContain('start');
    const answers = h.calls.filter(
      (call) =>
        call.method === 'sendMessage' &&
        call.payload.text === 'Безопасный ответ USER AI',
    );
    expect(answers).toHaveLength(2);
    for (const answer of answers)
      expect(answer.payload).not.toHaveProperty('reply_markup');
    expect(JSON.stringify(assistantIntro?.payload.reply_markup)).not.toContain(
      'Сбросить диалог',
    );
  });

  it('/reset clears history, remains in AI mode and keeps AI commands', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(callbackUpdate('menu:ai') as Update);
    await h.bot.handleUpdate(messageUpdate('/reset') as Update);
    await h.bot.handleUpdate(textUpdate('Продолжаем') as Update);
    expect(h.assistant.reset).toHaveBeenCalledWith(42);
    expect(h.assistant.answer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42 }),
      'Продолжаем',
    );
    const lastCommands = h.calls.filter((call) => call.method === 'setMyCommands').at(-1);
    expect(lastCommands?.payload.commands).toEqual([
      { command: 'home', description: '🏠 Домой' },
      { command: 'reset', description: '🧹 Сбросить диалог' },
    ]);
  });

  it('/home exits AI, shows main menu and restores normal commands', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(callbackUpdate('menu:ai') as Update);
    await h.bot.handleUpdate(messageUpdate('/home') as Update);
    await h.bot.handleUpdate(textUpdate('вне AI') as Update);
    expect(h.assistant.answer).not.toHaveBeenCalled();
    const lastCommands = h.calls.filter((call) => call.method === 'setMyCommands').at(-1);
    expect(lastCommands?.payload.commands).toEqual([
      { command: 'start', description: 'Start' },
      { command: 'home', description: '🏠 Домой' },
    ]);
    expect(JSON.stringify(h.calls)).not.toContain('Главное меню');
    expect(JSON.stringify(h.calls)).toContain('menu:buy');
  });

  it('routes every repeated AI text message independently', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(callbackUpdate('menu:ai') as Update);
    await h.bot.handleUpdate(
      textUpdate('проверь доступность серверов', 42, 3) as Update,
    );
    await h.bot.handleUpdate(
      textUpdate('проверь доступность серверов', 42, 4) as Update,
    );
    expect(h.assistant.answer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 42 }),
      'проверь доступность серверов',
    );
    expect(h.assistant.answer).toHaveBeenCalledTimes(2);
    const replies = h.calls.filter(
      (call) =>
        call.method === 'sendMessage' &&
        call.payload.text === 'Безопасный ответ USER AI',
    );
    expect(replies).toHaveLength(2);
    for (const reply of replies)
      expect(reply.payload).not.toHaveProperty('reply_markup');
  });

  it('keeps subscription, MTProto and support outside AI callbacks', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(callbackUpdate('ai:subscription') as Update);
    await h.bot.handleUpdate(callbackUpdate('ai:mtproto') as Update);
    expect(h.calls).toHaveLength(0);
  });

  it('renders FAQ, connection and payment help from static templates', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(callbackUpdate('support:faq') as Update);
    await h.bot.handleUpdate(callbackUpdate('support:connection') as Update);
    await h.bot.handleUpdate(callbackUpdate('support:payment') as Update);
    const text = JSON.stringify(h.calls);
    expect(text).toContain('faq:devices');
    expect(text).toContain('faq:additional');
    expect(text).toContain('Обновите подписку');
    expect(text).toContain('Telegram Stars');
    expect(h.assistant.answer).not.toHaveBeenCalled();
  });

  it('renders the compact FAQ and returns to its question list by editing the message', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(callbackUpdate('faq:back') as Update);
    await h.bot.handleUpdate(callbackUpdate('faq:devices') as Update);
    expect(JSON.stringify(h.calls)).toContain('5 устройств');
    expect(JSON.stringify(h.calls)).toContain('◀️ Назад');
    expect(JSON.stringify(h.calls)).toContain('🏠 Домой');
    await h.bot.handleUpdate(callbackUpdate('faq:back') as Update);
    expect(h.calls.filter((call) => call.method === 'editMessageText')).toHaveLength(3);
    expect(JSON.stringify(h.calls)).toContain('faq:ai');
  });

  it('opens each compact FAQ answer with both navigation actions', async () => {
    const h = createHarness();
    for (const callback of [
      'faq:devices',
      'faq:apps',
      'faq:download',
      'faq:additional',
      'faq:refund',
      'faq:connection',
      'faq:ai',
    ]) {
      await h.bot.handleUpdate(callbackUpdate(callback) as Update);
    }
    const answers = h.calls.filter((call) => call.method === 'editMessageText');
    expect(answers).toHaveLength(7);
    for (const answer of answers) {
      expect(JSON.stringify(answer.payload)).toContain('faq:back');
      expect(JSON.stringify(answer.payload)).toContain('menu:home');
    }
  });

  it('shows, rotates and shares only the current customer MTProto assignment', async () => {
    const assignment = {
      proxyUrl: 'tg://proxy?server=test&secret=owner',
      latencyMs: 25,
    };
    const h = createHarness({ assignment });
    await h.bot.handleUpdate(callbackUpdate('menu:mtproto') as Update);
    await h.bot.handleUpdate(callbackUpdate('mtproto:rotate') as Update);
    await h.bot.handleUpdate(callbackUpdate('mtproto:share') as Update);
    expect(h.mtproto.getOwn).toHaveBeenCalledWith(42);
    expect(h.mtproto.rotateOwn).toHaveBeenCalledWith(42);
    const serialized = JSON.stringify(h.calls);
    expect(serialized).toContain('🛡 Мой MTProto');
    expect(serialized).toContain('Ping: 25 мс');
    expect(serialized).toContain('Прокси проверен и назначен вам автоматически.');
    expect(serialized).toContain('Поделиться прокси');
    expect(h.calls.filter((call) => call.method === 'editMessageText').at(-1)?.payload.text).not.toContain(
      'Поделиться своим MTProto-прокси',
    );
    expect(serialized).toContain('https://t.me/share/url');
    expect(serialized).not.toContain('mtproto:share:');
    expect(h.calls.filter((call) => call.method === 'answerCallbackQuery')).toHaveLength(3);
  });

  it('shows absence and rejects MTProto callback tampering', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(callbackUpdate('menu:mtproto') as Update);
    await h.bot.handleUpdate(callbackUpdate('mtproto:share') as Update);
    await h.bot.handleUpdate(
      callbackUpdate('mtproto:rotate:customer-foreign') as Update,
    );
    expect(JSON.stringify(h.calls)).toContain('нет назначенного MTProto');
    expect(h.mtproto.getOwn).toHaveBeenCalledTimes(1);
    expect(h.mtproto.shareOwn).toHaveBeenCalledWith(42);
    expect(h.mtproto.getOwn).toHaveBeenCalledWith(42);
  });

  it('does not accept callback fields for user, amount, currency, subscription or Remnawave ids', async () => {
    const h = createHarness();
    for (const payload of [
      'buy:tariff:opaque-30:999:USD',
      'buy:tariff:opaque-30:telegram:7',
      'buy:tariff:opaque-30:subscription:x',
      'buy:tariff:opaque-30:remnawave:x',
    ]) {
      await h.bot.handleUpdate(callbackUpdate(payload) as Update);
    }
    expect(
      h.calls.filter((call) => call.method === 'editMessageText'),
    ).toHaveLength(0);
  });

  it('does not register the removed /menu command', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(messageUpdate('/menu') as Update);
    expect(h.calls).toHaveLength(0);
  });

  it('shows the configured Trial without provisioning on menu open', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(callbackUpdate('menu:trial') as Update);
    expect(JSON.stringify(h.calls)).toContain('5 дней');
    expect(JSON.stringify(h.calls)).toContain('10 ГБ');
  });

  it('claims Trial and renders the resulting subscription actions', async () => {
    const h = createHarness({
      trialResult: { kind: 'FULFILLED', claim: {} },
    });
    await h.bot.handleUpdate(callbackUpdate('menu:trial') as Update);
    await h.bot.handleUpdate(callbackUpdate('trial:claim') as Update);
    expect(JSON.stringify(h.calls)).toContain('Пробный доступ активирован');
    expect(JSON.stringify(h.calls)).toContain('subscription:connect');
  });

  it('does not accept remote identifiers in subscription callback', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(callbackUpdate('menu:subscription') as Update);
    await h.bot.handleUpdate(
      callbackUpdate('subscription:refresh:uuid=foreign') as Update,
    );
    expect(JSON.stringify(h.calls)).toContain('нет активной подписки');
  });

  it('shows the subscription actions and Home without old buttons', async () => {
    const subscription = {
      customerId: 'customer-42',
      tariffId: 'month',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 86_400_000),
      trafficLimitBytes: 10n * 1024n ** 3n,
      deviceLimit: 5,
      subscriptionUrl: 'https://vpn.example.test/subscription/customer-42',
    };
    const active = createHarness({ subscription });
    await active.bot.handleUpdate(
      callbackUpdate('menu:subscription') as Update,
    );
    const menu = JSON.stringify(active.calls);
    for (const label of [
      '⚡ Подключиться',
      '📱 Устройства онлайн',
      '🔄 Перевыпустить подписку',
      '🏠 Домой',
    ])
      expect(menu).toContain(label);
    for (const removed of [
      'Пробный период',
      'Пробный доступ',
      'Запасное подключение',
      'Запасное подключение #2',
      '🛒 Купить VPN',
    ])
      expect(menu).not.toContain(removed);
    expect(menu).not.toContain(subscription.subscriptionUrl);

    const unconfirmed = createHarness({
      subscription: { ...subscription, status: 'ERROR' },
    });
    await unconfirmed.bot.handleUpdate(
      callbackUpdate('menu:subscription') as Update,
    );
    expect(JSON.stringify(unconfirmed.calls)).not.toContain(
      subscription.subscriptionUrl,
    );
  });

  it('returns the owned personal cabinet URL only after Connect', async () => {
    const subscription = {
      customerId: 'customer-42',
      tariffId: 'month',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 86_400_000),
      trafficLimitBytes: 10n,
      deviceLimit: 5,
      subscriptionUrl: 'https://vpn.example.test/subscription/customer-42',
    };
    const h = createHarness({ subscription });
    await h.bot.handleUpdate(callbackUpdate('subscription:connect') as Update);
    expect(h.subscriptionService.getOwn).toHaveBeenCalledWith('customer-42');
    expect(JSON.stringify(h.calls)).toContain(subscription.subscriptionUrl);
    expect(JSON.stringify(h.calls)).toContain('Открыть личный кабинет');
  });

  it('reports online device information unavailable without a remote call', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(
      callbackUpdate('subscription:online-devices') as Update,
    );
    expect(JSON.stringify(h.calls)).toContain(
      'Информация об онлайн-устройствах пока недоступна',
    );
    expect(h.subscriptionService.getOwn).not.toHaveBeenCalled();
  });

  it('reissues only the current customer subscription and returns its new URL', async () => {
    const subscription = {
      customerId: 'customer-42',
      tariffId: 'month',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 86_400_000),
      trafficLimitBytes: 10n,
      deviceLimit: 5,
      subscriptionUrl: 'https://vpn.example.test/subscription/reissued',
    };
    const h = createHarness({ subscription });
    await h.bot.handleUpdate(callbackUpdate('subscription:reissue') as Update);
    expect(h.subscriptionService.reissueOwn).toHaveBeenCalledWith(
      'customer-42',
    );
    expect(JSON.stringify(h.calls)).toContain(subscription.subscriptionUrl);
  });

  it('keeps technical reissue errors user-safe', async () => {
    const h = createHarness();
    h.subscriptionService.reissueOwn.mockRejectedValueOnce(
      new Error('remote secret detail'),
    );
    await h.bot.handleUpdate(callbackUpdate('subscription:reissue') as Update);
    const output = JSON.stringify(h.calls);
    expect(output).toContain('Текущая подписка сохранена');
    expect(output).not.toContain('remote secret detail');
  });

  it('rejects subscription action callback tampering', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(
      callbackUpdate('subscription:reissue:customer-foreign') as Update,
    );
    await h.bot.handleUpdate(
      callbackUpdate('subscription:connect:7') as Update,
    );
    expect(h.subscriptionService.reissueOwn).not.toHaveBeenCalled();
    expect(h.subscriptionService.getOwn).not.toHaveBeenCalled();
  });

  it('keeps Buy VPN out of My subscription and opens its main-menu callback', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(callbackUpdate('menu:subscription') as Update);
    expect(JSON.stringify(h.calls)).not.toContain('🛒 Купить VPN');
    await h.bot.handleUpdate(callbackUpdate('menu:buy') as Update);
    expect(JSON.stringify(h.calls)).toContain('Выбрать:');
  });

  it('navigates Buy VPN Back to the existing main menu', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(callbackUpdate('menu:buy') as Update);
    const catalog = JSON.stringify(h.calls);
    expect(catalog).toContain('⬅️ Назад');
    expect(catalog).toContain('menu:home');
    expect(catalog).not.toContain(
      '⬅️ Назад","callback_data":"menu:subscription',
    );
    await h.bot.handleUpdate(callbackUpdate('menu:home') as Update);
    const homeCall = h.calls.at(-1);
    expect(homeCall?.method).toBe('editMessageReplyMarkup');
    expect(JSON.stringify(homeCall)).toContain('menu:buy');
    expect(JSON.stringify(homeCall)).not.toContain('Главное меню');
  });

  it('keeps tariff Back on catalog and Home on the main menu', async () => {
    const h = createHarness();
    await h.bot.handleUpdate(callbackUpdate('buy:tariff:opaque-30') as Update);
    const tariff = JSON.stringify(h.calls);
    expect(tariff).toContain('⬅️ К тарифам');
    expect(tariff).toContain('menu:buy');
    expect(tariff).toContain('🏠 Домой');
    expect(tariff).toContain('menu:home');
  });

  it('handles pre-checkout and successful_payment through PaymentService', async () => {
    const verifyPreCheckout = jest.fn().mockResolvedValue({ ok: true });
    const handleSuccessfulPayment = jest
      .fn()
      .mockResolvedValue({ kind: 'PAID', order: { id: 'order-1' } });
    const h = createHarness({
      payments: {
        verifyPreCheckout,
        handleSuccessfulPayment,
      } as unknown as PaymentService,
    });
    await h.bot.handleUpdate(preCheckoutUpdate() as Update);
    await h.bot.handleUpdate(successfulPaymentUpdate() as Update);
    expect(verifyPreCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'customer-42',
        currency: 'XTR',
        totalAmount: 250,
      }),
    );
    expect(handleSuccessfulPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'customer-42',
        telegramPaymentChargeId: 'charge-1',
      }),
    );
    expect(
      h.calls.some(
        (call) =>
          call.method === 'answerPreCheckoutQuery' && call.payload.ok === true,
      ),
    ).toBe(true);
    expect(JSON.stringify(h.calls)).toContain('Оплата получена');
  });
});
