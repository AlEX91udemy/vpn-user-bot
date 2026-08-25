import { Inject, Injectable, Logger } from '@nestjs/common';
import { InlineKeyboard, type Bot, type Context } from 'grammy';
import { CatalogService } from '../../catalog/catalog.service';
import type { TariffRecord } from '../../catalog/catalog.types';
import { CustomerService } from '../../customers/customer.service';
import { OrderService } from '../../orders/order.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from '../../payments/payment-provider.port';
import { PaymentService } from '../../payments/payment.service';
import { FulfillmentService } from '../../fulfillment/fulfillment.service';
import { CustomerSubscriptionService } from '../../subscriptions/customer-subscription.service';
import type { SubscriptionRecord } from '../../subscriptions/subscription.types';
import { SubscriptionOperationError } from '../../subscriptions/subscription.types';
import { TrialService } from '../../trial/trial.service';
import { MtprotoService } from '../../mtproto/mtproto.service';
import { MtprotoAssignmentError } from '../../mtproto/mtproto-assignment.port';
import { UserAssistantService } from '../../user-assistant/user-assistant.service';
import { buildMainMenu, homeKeyboard } from '../keyboards/main.keyboard';
import { buildSupportMenu } from '../keyboards/support.keyboard';
import { buildFaqBackKeyboard, buildFaqKeyboard } from '../keyboards/faq.keyboard';

const faqTitle = '❓ Частые вопросы\n\nВыберите вопрос:';
const connectionProblemText =
  '🔌 Не подключается\n\n1. Проверьте интернет без VPN.\n2. Обновите подписку в приложении.\n3. Убедитесь, что выбран актуальный профиль.\n4. Перезапустите приложение и устройство.\n5. Если проблема осталась — напишите оператору через «🆘 Поддержка».';
const paymentProblemText =
  '💳 Проблема с оплатой\n\n• Валюта оплаты — Telegram Stars (XTR).\n• Сумма берётся только из выбранного тарифа.\n• Не оплачивайте повторно, если платёж уже списан.\n• Проверьте «📱 Моя подписка». Если доступ не появился — обратитесь в поддержку.';
const welcomeText =
  '🔥 <b>Rubridge VPN</b>\n' +
  'Быстрый, безлимитный, безопасный.\n\n' +
  '✈️ Скорость до <b>10 Гбит/с</b>.\n\n' +
  '💻 Поддержка: <b>iOS, Android, macOS, Windows, Linux, TV, роутеры</b>.\n\n' +
  '📱 <b>Одна подписка — до 5 одновременных подключений.</b>\n' +
  'Устройства, подключённые к одной сети Wi-Fi, считаются как одно.\n\n' +
  '🌍 <b>Все локации доступны сразу в клиенте</b> — никаких переключений или замен.\n\n' +
  '🔗 Присоединяйтесь к сотням довольных клиентов.';

const normalCommands = [
  { command: 'start', description: 'Start' },
  { command: 'home', description: '🏠 Домой' },
];
const assistantCommands = [
  { command: 'home', description: '🏠 Домой' },
  { command: 'reset', description: '🧹 Сбросить диалог' },
];
const invisibleMenuText = '\u2063';
const commandCooldownMs = 1_000;

@Injectable()
export class UserBotHandlers {
  private readonly logger = new Logger(UserBotHandlers.name);
  private readonly assistantSessions = new Set<number>();
  private readonly processedAssistantMessages = new Set<string>();
  private readonly commandCooldowns = new Map<string, number>();
  constructor(
    private readonly customers: CustomerService,
    private readonly catalog: CatalogService,
    private readonly orders: OrderService,
    private readonly payments: PaymentService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    private readonly fulfillment: FulfillmentService,
    private readonly subscriptions: CustomerSubscriptionService,
    private readonly trials: TrialService,
    private readonly mtproto: MtprotoService,
    private readonly assistant: UserAssistantService,
  ) {}

  register(bot: Bot<Context>): void {
    bot.command('start', this.withCommandCooldown('start', (ctx) => this.start(ctx)));
    bot.command('home', this.withCommandCooldown('home', (ctx) => this.home(ctx)));
    bot.command('reset', this.withCommandCooldown('reset', (ctx) => this.resetAssistant(ctx)));

    bot.callbackQuery('menu:home', (ctx) => this.home(ctx, true));
    bot.callbackQuery('menu:buy', (ctx) => this.showCatalog(ctx));
    bot.callbackQuery(/^buy:tariff:([A-Za-z0-9_-]{1,64})$/, (ctx) =>
      this.selectTariff(ctx, ctx.match[1]),
    );
    bot.callbackQuery(/^pay:tariff:([A-Za-z0-9_-]{1,64})$/, (ctx) =>
      this.createInvoice(ctx, ctx.match[1]),
    );
    bot.callbackQuery('menu:trial', (ctx) => this.showTrial(ctx));
    bot.callbackQuery('trial:claim', (ctx) => this.claimTrial(ctx));
    bot.callbackQuery('menu:subscription', (ctx) =>
      this.showSubscription(ctx, false),
    );
    bot.callbackQuery('subscription:refresh', (ctx) =>
      this.showSubscription(ctx, true),
    );
    bot.callbackQuery('subscription:connect', (ctx) =>
      this.connectSubscription(ctx),
    );
    bot.callbackQuery('subscription:online-devices', (ctx) =>
      this.showOnlineDevicesUnavailable(ctx),
    );
    bot.callbackQuery('subscription:reissue', (ctx) =>
      this.reissueSubscription(ctx),
    );
    bot.callbackQuery('menu:mtproto', (ctx) => this.showMtproto(ctx));
    bot.callbackQuery('mtproto:rotate', (ctx) => this.rotateMtproto(ctx));
    bot.callbackQuery('mtproto:share', (ctx) => this.shareMtproto(ctx));
    bot.callbackQuery('faq:back', (ctx) => this.showFaq(ctx));
    const faqAnswers: Record<string, string> = {
      'faq:devices': '📱 Сколько устройств можно подключить?\n\nДа. До 5 устройств онлайн одновременно на одну подписку. Устройства в одной сети Wi‑Fi считаются как одно.\n\nЕсли нужно больше 5 устройств, можно оформить ещё одну подписку. На один аккаунт доступно до 5 подписок — до 25 устройств онлайн одновременно.',
      'faq:apps': '📲 Какое приложение использовать?\n\nМы рекомендуем Happ — инструкция и сценарий подключения ориентированы именно на него, и корректную работу сервиса мы гарантируем именно в этом клиенте.\n\nТакже можно использовать другие VLESS-клиенты, но для них мы не гарантируем настройку и совместимость.',
      'faq:download': '🔗 Где скачать приложение и получить настройки?\n\nПосле оплаты в личном кабинете появится инструкция по подключению. Обычно достаточно двух действий: скачать приложение и добавить настройки.',
      'faq:additional': '💳 Как оформить ещё одну подписку?\n\nОткройте «🛒 Купить VPN» в главном меню, выберите подходящий тариф и оплатите его через Telegram Stars. Дополнительная подписка будет оформлена на ваш аккаунт.',
      'faq:refund': '💰 Как получить возврат средств?\n\nМы вернём деньги без лишних вопросов, если использованный трафик по аккаунту не превышает 100 ГБ.',
      'faq:connection': '⚡ VPN не подключается или работает медленно?\n\nПроверьте интернет-соединение, убедитесь, что используется актуальная конфигурация, и попробуйте подключиться через рекомендуемое приложение Happ. Если проблема сохраняется — обратитесь в поддержку.',
      'faq:ai': '🤖 Что такое ИИ-помощник?\n\nИИ-помощник помогает разобраться с сервисом, ответить на вопросы и подсказать решение распространённых проблем. Можно написать ему обычным сообщением — без специальных команд.',
    };
    for (const [callback, answer] of Object.entries(faqAnswers)) {
      bot.callbackQuery(callback, (ctx) =>
        ctx.editMessageText(answer, { reply_markup: buildFaqBackKeyboard() }),
      );
    }
    bot.callbackQuery('menu:ai', (ctx) => this.openAssistant(ctx));
    bot.callbackQuery('menu:support', async (ctx) => {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText('🆘 Поддержка\n\nВыберите тему:', {
        reply_markup: buildSupportMenu(),
      });
    });
    bot.callbackQuery('support:faq', (ctx) => this.showFaq(ctx));
    bot.callbackQuery('support:connection', (ctx) =>
      ctx.editMessageText(connectionProblemText, {
        reply_markup: supportBackKeyboard(),
      }),
    );
    bot.callbackQuery('support:payment', (ctx) =>
      ctx.editMessageText(paymentProblemText, {
        reply_markup: supportBackKeyboard(),
      }),
    );
    bot.callbackQuery('support:operator', (ctx) =>
      ctx.editMessageText(
        '🆘 Поддержка\n\nОпишите проблему одним сообщением оператору поддержки.',
        {
          reply_markup: supportBackKeyboard(),
        },
      ),
    );

    bot.on('message:text', async (ctx) => {
      if (!ctx.from || !this.assistantSessions.has(ctx.from.id)) return;
      if (ctx.message.text.startsWith('/')) return;
      const messageKey = `${ctx.chat.id}:${ctx.message.message_id}`;
      if (this.processedAssistantMessages.has(messageKey)) return;
      this.processedAssistantMessages.add(messageKey);
      if (this.processedAssistantMessages.size > 1_000) {
        const oldest = this.processedAssistantMessages.values().next().value;
        if (oldest) this.processedAssistantMessages.delete(oldest);
      }
      const intent = this.assistant.detectIntent(ctx.message.text);
      const answer = await this.assistant.answer(ctx.from, ctx.message.text);
      if (intent === 'SERVER_AVAILABILITY_UNAVAILABLE') {
        await ctx.reply(answer);
        return;
      }
      await ctx.reply(answer);
    });

    bot.on('pre_checkout_query', async (ctx) => {
      const customer = await this.customers.getOrCreateFromTelegram(ctx.from);
      const query = ctx.preCheckoutQuery;
      const result = await this.payments.verifyPreCheckout({
        customerId: customer.id,
        invoicePayload: query.invoice_payload,
        currency: query.currency,
        totalAmount: query.total_amount,
      });
      if (result.ok) await ctx.answerPreCheckoutQuery(true);
      else
        await ctx.answerPreCheckoutQuery(false, {
          error_message: result.error,
        });
    });

    bot.on('message:successful_payment', async (ctx) => {
      const customer = await this.customers.getOrCreateFromTelegram(ctx.from);
      const payment = ctx.message.successful_payment;
      try {
        const result = await this.payments.handleSuccessfulPayment({
          customerId: customer.id,
          invoicePayload: payment.invoice_payload,
          currency: payment.currency,
          totalAmount: payment.total_amount,
          telegramPaymentChargeId: payment.telegram_payment_charge_id,
        });
        const provisioned = await this.fulfillment.fulfillPaidOrder(
          result.order.id,
        );
        if (provisioned.kind === 'FULFILLED') {
          const subscription = await this.subscriptions.getOwn(customer.id);
          await ctx.reply(
            `✅ Оплата получена!\n\n🎉 VPN активирован.\n\nТариф: ${result.order.tariffNameSnapshot}\nДо: ${formatDate(subscription?.expiresAt)}\n\nПерсональная ссылка доступна в разделе «📱 Моя подписка».`,
            { reply_markup: activeSubscriptionKeyboard(subscription) },
          );
        } else {
          await ctx.reply(
            '✅ Оплата получена.\n\n⏳ VPN пока не активирован из-за временной технической ошибки. Мы автоматически повторим выдачу.',
            { reply_markup: pendingSubscriptionKeyboard() },
          );
        }
      } catch {
        await ctx.reply(
          'Платёж получен Telegram, но не удалось безопасно сопоставить заказ. Обратитесь в поддержку.',
          { reply_markup: homeKeyboard() },
        );
      }
    });
  }

  private async start(ctx: Context): Promise<void> {
    if (!ctx.from) return;
    await this.customers.getOrCreateFromTelegram(ctx.from);
    this.assistantSessions.delete(ctx.from.id);
    await this.setCommands(ctx, normalCommands);
    await this.clearLegacyReplyKeyboard(ctx);
    await ctx.reply(welcomeText, {
      parse_mode: 'HTML',
      reply_markup: buildMainMenu(),
    });
  }

  private async openAssistant(ctx: Context): Promise<void> {
    if (!ctx.from) return;
    await this.answerCallback(ctx);
    await this.customers.getOrCreateFromTelegram(ctx.from);
    this.assistantSessions.add(ctx.from.id);
    await this.setCommands(ctx, assistantCommands);
    await ctx.deleteMessage();
    await ctx.reply(
      '🤖 ИИ-помощник\n\nЗдесь можно свободно пообщаться, задать общий вопрос или попросить лёгкую шутку.\n\nНастройки, инструкции и поддержка доступны отдельными кнопками главного меню.',
      { reply_markup: { remove_keyboard: true } },
    );
  }

  private async resetAssistant(ctx: Context): Promise<void> {
    if (!ctx.from || !this.assistantSessions.has(ctx.from.id)) return;
    this.assistant.reset(ctx.from.id);
    await this.setCommands(ctx, assistantCommands);
    await ctx.reply('Диалог очищен. Напишите новый вопрос.');
  }

  private async home(ctx: Context, edit = false): Promise<void> {
    if (!ctx.from) return;
    await this.answerCallback(ctx);
    this.assistantSessions.delete(ctx.from.id);
    await this.setCommands(ctx, normalCommands);
    await this.clearLegacyReplyKeyboard(ctx);
    const menu = buildMainMenu();
    if (edit && 'editMessageReplyMarkup' in ctx) {
      await ctx.editMessageReplyMarkup({ reply_markup: menu });
    } else {
      await ctx.reply(invisibleMenuText, { reply_markup: menu });
    }
  }

  private async setCommands(
    ctx: Context,
    commands: typeof normalCommands,
  ): Promise<void> {
    if (!ctx.chat) return;
    await ctx.api.setMyCommands(commands, {
      scope: { type: 'chat', chat_id: ctx.chat.id },
    });
  }

  private withCommandCooldown(
    command: string,
    handler: (ctx: Context) => Promise<void>,
  ): (ctx: Context) => Promise<void> {
    return async (ctx: Context): Promise<void> => {
      if (!ctx.from) return;
      const key = `${ctx.from.id}:${command}`;
      const now = Date.now();
      const previous = this.commandCooldowns.get(key);
      if (previous !== undefined && now - previous < commandCooldownMs) return;
      if (this.commandCooldowns.size >= 10_000) {
        const expiredAt = now - commandCooldownMs;
        for (const [cooldownKey, timestamp] of this.commandCooldowns) {
          if (timestamp <= expiredAt) this.commandCooldowns.delete(cooldownKey);
        }
      }
      this.commandCooldowns.set(key, now);
      await handler(ctx);
    };
  }

  private async answerCallback(ctx: Context): Promise<void> {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
  }

  private async safeAnswerCallback(
    ctx: Context,
    options?: { text?: string; show_alert?: boolean },
  ): Promise<void> {
    if (!ctx.callbackQuery) return;
    try {
      await ctx.answerCallbackQuery(options);
    } catch {
      // A delayed Telegram callback may already be expired; it must not stop the handler.
    }
  }

  private async clearLegacyReplyKeyboard(ctx: Context): Promise<void> {
    if (!ctx.chat) return;
    const cleanupMessage = await ctx.api.sendMessage(
      ctx.chat.id,
      invisibleMenuText,
      { reply_markup: { remove_keyboard: true } },
    );
    try {
      await ctx.api.deleteMessage(ctx.chat.id, cleanupMessage.message_id);
    } catch {
      // The cleanup message is intentionally invisible; deletion is best effort.
    }
  }

  private async showMtproto(ctx: Context): Promise<void> {
    if (!ctx.from) return;
    await this.safeAnswerCallback(ctx);
    const customer = await this.customers.getOrCreateFromTelegram(ctx.from);
    try {
      const assignment = await this.mtproto.getOwn(
        Number(customer.telegramUserId),
      );
      await ctx.editMessageText(formatMtproto(assignment), {
        reply_markup: mtprotoKeyboard(Boolean(assignment), assignment?.proxyUrl),
      });
    } catch (error) {
      await ctx.editMessageText(mtprotoUnavailable(error), {
        reply_markup: homeKeyboard(),
      });
    }
  }

  private async rotateMtproto(ctx: Context): Promise<void> {
    if (!ctx.from) return;
    await this.safeAnswerCallback(ctx);
    const customer = await this.customers.getOrCreateFromTelegram(ctx.from);
    try {
      const assignment = await this.mtproto.rotateOwn(
        Number(customer.telegramUserId),
      );
      await ctx.editMessageText(formatMtproto(assignment), {
        reply_markup: mtprotoKeyboard(Boolean(assignment), assignment?.proxyUrl),
      });
    } catch (error) {
      await ctx.editMessageText(mtprotoUnavailable(error), {
        reply_markup: homeKeyboard(),
      });
    }
  }

  private async shareMtproto(ctx: Context): Promise<void> {
    if (!ctx.from) return;
    const customer = await this.customers.getOrCreateFromTelegram(ctx.from);
    let proxyUrl: string | null;
    try {
      proxyUrl = await this.mtproto.shareOwn(Number(customer.telegramUserId));
    } catch (error) {
      await ctx.editMessageText(mtprotoUnavailable(error), {
        reply_markup: homeKeyboard(),
      });
      await ctx.answerCallbackQuery({ text: 'Не удалось подготовить ссылку.' });
      return;
    }
    if (!proxyUrl) {
      await ctx.answerCallbackQuery({
        text: 'У вас пока нет назначенного MTProto.',
        show_alert: true,
      });
      return;
    }
    const shareUrl = new URL('https://t.me/share/url');
    shareUrl.searchParams.set('url', proxyUrl);
    shareUrl.searchParams.set('text', 'Рабочий MTProto proxy');
    await this.safeAnswerCallback(ctx);
    await ctx.editMessageReplyMarkup({
      reply_markup: mtprotoKeyboard(true, proxyUrl),
    });
  }

  private async showFaq(ctx: Context): Promise<void> {
    await this.answerCallback(ctx);
    await ctx.editMessageText(faqTitle, { reply_markup: buildFaqKeyboard() });
  }

  private async showFaqBuy(ctx: Context): Promise<void> {
    const tariffs = await this.catalog.listActive();
    const tariffText = tariffs.length
      ? `\n\nДоступные тарифы:\n${tariffs.map((tariff) => `• ${tariff.name} — ${tariff.amountXtr ?? tariff.amountMinor} ${tariff.amountXtr !== null ? 'XTR' : tariff.currency}`).join('\n')}`
      : '';
    await ctx.editMessageText(
      `💳 Как купить подписку?\n\nОткройте раздел «🛒 Купить VPN», выберите подходящий тариф и оплатите его через Telegram Stars. После успешной оплаты бот оформит подписку и предоставит данные для подключения.${tariffText}`,
      { reply_markup: buildFaqBackKeyboard() },
    );
  }

  private async showTrial(ctx: Context): Promise<void> {
    if (!ctx.from) return;
    await this.answerCallback(ctx);
    await this.customers.getOrCreateFromTelegram(ctx.from);
    await ctx.editMessageText(
      '🎁 Пробный доступ\n\nСрок: 5 дней\nТрафик: 10 ГБ\nУстройства: до 5',
      {
        reply_markup: new InlineKeyboard()
          .text('Получить пробный доступ', 'trial:claim')
          .row()
          .text('🏠 Домой', 'menu:home'),
      },
    );
  }

  private async claimTrial(ctx: Context): Promise<void> {
    if (!ctx.from) return;
    const customer = await this.customers.getOrCreateFromTelegram(ctx.from);
    let result;
    try {
      result = await this.trials.claim(customer.id);
    } catch {
      await this.safeAnswerCallback(ctx, {
        text: 'Не удалось оформить пробный доступ. Попробуйте ещё раз позже.',
        show_alert: true,
      });
      return;
    }
    if (result.kind === 'FULFILLED') {
      const subscription = await this.subscriptions.getOwn(customer.id);
      await this.safeAnswerCallback(ctx);
      await ctx.editMessageText(
        `🎉 Пробный доступ активирован\n\nДо: ${formatDate(subscription?.expiresAt)}`,
        { reply_markup: activeSubscriptionKeyboard(subscription) },
      );
    } else if (result.kind === 'ALREADY_USED') {
      await this.safeAnswerCallback(ctx, {
        text: 'Пробный доступ уже был использован.',
        show_alert: true,
      });
    } else if (result.kind === 'INELIGIBLE') {
      await this.safeAnswerCallback(ctx, {
        text: 'Пробный доступ недоступен при существующей или оплаченной подписке.',
        show_alert: true,
      });
    } else {
      await this.safeAnswerCallback(ctx);
      await ctx.editMessageText(
        '⏳ Выдача пробного доступа временно задерживается. Мы автоматически повторим операцию.',
        { reply_markup: pendingSubscriptionKeyboard() },
      );
    }
  }

  private async showSubscription(
    ctx: Context,
    refresh: boolean,
  ): Promise<void> {
    if (!ctx.from) return;
    await this.answerCallback(ctx);
    const customer = await this.customers.getOrCreateFromTelegram(ctx.from);
    let subscription = await this.subscriptions.getOwn(customer.id);
    if (refresh && subscription) {
      try {
        subscription = await this.subscriptions.refreshOwn(customer.id);
      } catch {
        /* keep last safe projection */
      }
    }
    if (!subscription) {
      await ctx.editMessageText('📱 У вас пока нет активной подписки.', {
        reply_markup: subscriptionActionsKeyboard(),
      });
      return;
    }
    if (subscription.status === 'EXPIRED') {
      await ctx.editMessageText('📱 Подписка закончилась.', {
        reply_markup: subscriptionActionsKeyboard(),
      });
      return;
    }
    await ctx.editMessageText(formatSubscription(subscription), {
      reply_markup: activeSubscriptionKeyboard(subscription),
    });
  }

  private async connectSubscription(ctx: Context): Promise<void> {
    if (!ctx.from) return;
    const customer = await this.customers.getOrCreateFromTelegram(ctx.from);
    const subscription = await this.subscriptions.getOwn(customer.id);
    if (!subscription?.subscriptionUrl || subscription.status !== 'ACTIVE') {
      await ctx.answerCallbackQuery({
        text: 'Активная подписка пока недоступна.',
        show_alert: true,
      });
      return;
    }
    await ctx.editMessageText('⚡ Ваш личный кабинет:', {
      reply_markup: new InlineKeyboard()
        .url('Открыть личный кабинет', subscription.subscriptionUrl)
        .row()
        .text('⬅️ Назад', 'menu:subscription'),
    });
  }

  private async showOnlineDevicesUnavailable(ctx: Context): Promise<void> {
    await ctx.editMessageText(
      '📱 Устройства онлайн\n\nИнформация об онлайн-устройствах пока недоступна.',
      {
        reply_markup: new InlineKeyboard().text(
          '⬅️ Назад',
          'menu:subscription',
        ),
      },
    );
  }

  private async reissueSubscription(ctx: Context): Promise<void> {
    if (!ctx.from) return;
    const customer = await this.customers.getOrCreateFromTelegram(ctx.from);
    try {
      const result = await this.subscriptions.reissueOwn(customer.id);
      const message =
        result.kind === 'REISSUED'
          ? '✅ Подписка перевыпущена. Используйте обновлённую ссылку.'
          : 'ℹ️ Подписка уже была перевыпущена недавно.';
      await ctx.editMessageText(message, {
        reply_markup: new InlineKeyboard()
          .url(
            '⚡ Открыть личный кабинет',
            result.subscription.subscriptionUrl!,
          )
          .row()
          .text('⬅️ Назад', 'menu:subscription'),
      });
    } catch (error) {
      const text =
        error instanceof SubscriptionOperationError &&
        error.code === 'REISSUE_BUSY'
          ? '⏳ Подписка уже перевыпускается. Попробуйте немного позже.'
          : error instanceof SubscriptionOperationError &&
              error.code === 'SUBSCRIPTION_NOT_FOUND'
            ? 'Активная подписка пока недоступна.'
            : 'Не удалось перевыпустить подписку. Текущая подписка сохранена.';
      await ctx.editMessageText(text, {
        reply_markup: new InlineKeyboard().text(
          '⬅️ Назад',
          'menu:subscription',
        ),
      });
    }
  }

  private async showCatalog(ctx: Context): Promise<void> {
    if (!ctx.from) return;
    await this.answerCallback(ctx);
    await this.customers.getOrCreateFromTelegram(ctx.from);
    const tariffs = await this.catalog.listActive();
    if (tariffs.length === 0) {
      await ctx.editMessageText('Активных тарифов пока нет.', {
        reply_markup: homeKeyboard(),
      });
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const tariff of tariffs)
      keyboard.text(`Выбрать: ${tariff.name}`, `buy:tariff:${tariff.id}`).row();
    keyboard.text('⬅️ Назад', 'menu:home');
    await ctx.editMessageText(
      `🛒 Купить VPN\n\n${tariffs.map(formatTariff).join('\n\n')}`,
      { reply_markup: keyboard },
    );
  }

  private async selectTariff(ctx: Context, tariffId: string): Promise<void> {
    if (!ctx.from) return;
    await this.customers.getOrCreateFromTelegram(ctx.from);
    const tariff = await this.catalog.selectActiveTariff(tariffId);
    const paymentText =
      tariff.amountXtr === null
        ? 'Цена в Telegram Stars пока не настроена.'
        : `К оплате: ${tariff.amountXtr} ⭐`;
    const keyboard = new InlineKeyboard();
    if (tariff.amountXtr !== null)
      keyboard
        .text(`💳 Оплатить ${tariff.amountXtr} ⭐`, `pay:tariff:${tariff.id}`)
        .row();
    keyboard
      .text('⬅️ К тарифам', 'menu:buy')
      .row()
      .text('🏠 Домой', 'menu:home');
    await ctx.editMessageText(`${formatTariff(tariff)}\n\n${paymentText}`, {
      reply_markup: keyboard,
    });
  }

  private async createInvoice(ctx: Context, tariffId: string): Promise<void> {
    if (!ctx.from) return;
    const customer = await this.customers.getOrCreateFromTelegram(ctx.from);
    try {
      const order = await this.orders.createCheckout(customer.id, tariffId);
      const invoice = this.paymentProvider.createInvoice(order);
      await ctx.replyWithInvoice(
        invoice.title,
        invoice.description,
        invoice.payload,
        invoice.currency,
        invoice.prices,
        { start_parameter: invoice.startParameter },
      );
      this.logger.log({
        event: 'invoice_created',
        orderId: order.id,
        customerId: customer.id,
        provider: 'telegram_stars',
        currency: order.currency,
        amountXtr: order.amountXtr,
        status: order.status,
      });
    } catch {
      await ctx.answerCallbackQuery({
        text: 'Не удалось создать счёт. Проверьте актуальность тарифа.',
        show_alert: true,
      });
    }
  }
}

export function formatTariff(tariff: TariffRecord): string {
  const lines = [
    `🛒 ${tariff.name}`,
    tariff.description,
    `${tariff.durationDays} дней`,
  ];
  if (tariff.deviceLimit !== null)
    lines.push(`До ${tariff.deviceLimit} устройств`);
  if (tariff.trafficLimitBytes !== null)
    lines.push(`Трафик: ${formatBytes(tariff.trafficLimitBytes)}`);
  lines.push(
    new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: tariff.currency,
      maximumFractionDigits: 2,
    }).format(tariff.amountMinor / 100),
  );
  return lines.join('\n');
}

function formatBytes(bytes: bigint): string {
  const gib = bytes / 1024n ** 3n;
  return `${gib} ГБ`;
}

function formatDate(value: Date | null | undefined): string {
  return value
    ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(value)
    : 'уточняется';
}

function formatSubscription(subscription: SubscriptionRecord): string {
  const status =
    subscription.status === 'ACTIVE'
      ? '🟢 Активна'
      : subscription.status === 'DISABLED'
        ? '🔴 Отключена'
        : '🟡 Обновляется';
  return [
    '📱 Моя подписка',
    '',
    `Статус: ${status}`,
    `Тариф: ${subscription.tariffId ?? 'Пробный доступ'}`,
    `До: ${formatDate(subscription.expiresAt)}`,
    subscription.deviceLimit === null
      ? null
      : `Устройства: до ${subscription.deviceLimit}`,
    subscription.trafficLimitBytes === null
      ? null
      : `Трафик: ${formatBytes(subscription.trafficLimitBytes)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function activeSubscriptionKeyboard(
  _subscription?: SubscriptionRecord | null,
): InlineKeyboard {
  return subscriptionActionsKeyboard();
}

function subscriptionActionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('⚡ Подключиться', 'subscription:connect')
    .row()
    .text('📱 Устройства онлайн', 'subscription:online-devices')
    .row()
    .text('🔄 Перевыпустить подписку', 'subscription:reissue')
    .row()
    .text('🏠 Домой', 'menu:home');
}

function pendingSubscriptionKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📱 Моя подписка', 'menu:subscription')
    .row()
    .text('🏠 Домой', 'menu:home');
}

function supportBackKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('⬅️ Назад', 'menu:support')
    .row()
    .text('🏠 Домой', 'menu:home');
}

function mtprotoKeyboard(
  hasAssignment: boolean,
  proxyUrl?: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text(
      hasAssignment ? '🔄 Обновить MTProto' : '🔄 Получить MTProto',
      'mtproto:rotate',
    )
    .row();
  if (hasAssignment)
    (proxyUrl
      ? keyboard.url('📤 Поделиться прокси', buildMtprotoShareUrl(proxyUrl))
      : keyboard.text('📤 Поделиться прокси', 'mtproto:share')).row();
  return keyboard.text('🏠 Домой', 'menu:home');
}

function buildMtprotoShareUrl(proxyUrl: string): string {
  const shareUrl = new URL('https://t.me/share/url');
  shareUrl.searchParams.set('url', proxyUrl);
  shareUrl.searchParams.set('text', 'Рабочий MTProto proxy');
  return shareUrl.toString();
}

function formatMtproto(
  assignment: { proxyUrl: string; latencyMs: number | null } | null,
): string {
  if (!assignment) return 'Сейчас для вас ещё не назначен MTProto.';
  return `🛡 Мой MTProto\n\n${assignment.proxyUrl}\n\nPing: ${assignment.latencyMs === null ? '—' : `${assignment.latencyMs} мс`}\n\nПрокси проверен и назначен вам автоматически.`;
}

function mtprotoUnavailable(error: unknown): string {
  if (
    error instanceof MtprotoAssignmentError &&
    error.code === 'RATE_LIMITED'
  )
    return 'Обновить MTProto можно один раз в 5 минут. Попробуйте немного позже.';
  if (error instanceof MtprotoAssignmentError)
    return 'Сейчас сервер выдачи MTProto недоступен.\nПопробуйте немного позже.';
  return 'Сейчас сервер выдачи MTProto недоступен.\nПопробуйте немного позже.';
}
