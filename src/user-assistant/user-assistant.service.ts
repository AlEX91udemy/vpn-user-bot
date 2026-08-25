import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TelegramIdentity } from '../customers/customer.types';
import { USER_LLM } from './user-llm.token';
import type { ChatMessage, LlmProvider } from './llm.types';

export type UserAssistantIntent =
  | 'SERVER_AVAILABILITY_UNAVAILABLE'
  | 'SUBSCRIPTION'
  | 'MTPROTO'
  | 'CONNECTION_OR_PAYMENT'
  | 'FORBIDDEN'
  | 'CONVERSATION';

const SYSTEM_PROMPT = `Ты — дружелюбный AI-помощник пользовательского Telegram-бота Rubridge VPN.

Правила:
- По умолчанию отвечай по-русски. Если сообщение явно написано на другом языке, отвечай на нём.
- Поддерживай естественный свободный диалог: приветствия, small talk, шутки и общие вопросы — нормальные запросы.
- Отвечай кратко и по существу. Звучи как знающий собеседник, а не шаблонный бот поддержки.
- Сообщения отправляются в Telegram как plain text. Не используй Markdown-разметку, заголовки с # и обратные кавычки.
- У тебя нет прямого доступа к подписке, платежам, VPN-серверам, настройкам и данным пользователя. Не выдумывай их состояние.
- Если пользователь спрашивает об управлении VPN, подписке, оплате или настройках, мягко подскажи соответствующий раздел главного меню.
- Не раскрывай ключи, токены, внутреннюю инфраструктуру, административные данные или данные других пользователей.
- Не отправляй пользователя в главное меню без причины и не повторяй один шаблонный ответ.`;
const MAX_HISTORY_MESSAGES = 20;
const ERROR_REPLY =
  'Не удалось связаться с ИИ-помощником. Попробуйте ещё раз немного позже.';

@Injectable()
export class UserAssistantService {
  private readonly logger = new Logger(UserAssistantService.name);
  private readonly history = new Map<number, ChatMessage[]>();

  constructor(
    @Inject(USER_LLM) private readonly llm: LlmProvider | null,
  ) {}

  async answer(identity: TelegramIdentity, question: string): Promise<string> {
    const intent = this.detectIntent(question);
    if (intent !== 'CONVERSATION') return this.staticAnswer(intent);
    if (!this.llm) return ERROR_REPLY;

    const messages = this.history.get(identity.id) ?? [];
    messages.push({ role: 'user', content: question });
    try {
      const response = await this.llm.chat({ messages, system: SYSTEM_PROMPT });
      messages.push({ role: 'assistant', content: response.text });
      this.trimHistory(identity.id, messages);
      return response.text;
    } catch (error) {
      this.logger.error(
        `LLM request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      this.trimHistory(identity.id, messages);
      return ERROR_REPLY;
    }
  }

  reset(userId: number): void {
    this.history.delete(userId);
  }

  detectIntent(text: string): UserAssistantIntent {
    const normalized = text.toLocaleLowerCase('ru-RU').trim();
    if (this.isServerAvailabilityRequest(normalized))
      return 'SERVER_AVAILABILITY_UNAVAILABLE';
    if (this.isForbidden(normalized)) return 'FORBIDDEN';
    if (/подпис|тариф|срок|трафик|устройств/i.test(normalized))
      return 'SUBSCRIPTION';
    if (/mtproto|мтпрото|прокс/i.test(normalized)) return 'MTPROTO';
    if (/подключ|не работает|ошиб|оплат|stars|звезд|настрой/i.test(normalized))
      return 'CONNECTION_OR_PAYMENT';
    return 'CONVERSATION';
  }

  private staticAnswer(intent: Exclude<UserAssistantIntent, 'CONVERSATION'>): string {
    const replies = {
      SERVER_AVAILABILITY_UNAVAILABLE:
        'ℹ️ Проверка доступности серверов недоступна в пользовательском боте.',
      SUBSCRIPTION:
        'Откройте раздел «📱 Моя подписка» — там показаны актуальные данные.',
      MTPROTO:
        'Откройте раздел «🛡 Мой MTProto». Я не выдаю и не изменяю назначения.',
      CONNECTION_OR_PAYMENT:
        'Для решения вопроса откройте подходящий раздел главного меню или «🆘 Поддержка».',
      FORBIDDEN:
        'Я не предоставляю идентификаторы, ключи, административные данные или доступ к чужим ресурсам.',
    } satisfies Record<Exclude<UserAssistantIntent, 'CONVERSATION'>, string>;
    return replies[intent];
  }

  private trimHistory(userId: number, messages: ChatMessage[]): void {
    this.history.set(userId, messages.slice(-MAX_HISTORY_MESSAGES));
  }

  private isServerAvailabilityRequest(text: string): boolean {
    return /(?:проверь(?:те)?\s+(?:доступность\s+)?(?:сервер(?:а|ы|ов)?|нод(?:ы)?)|статус\s+(?:сервер(?:а|ов)?|нод(?:ы)?)|какие\s+(?:сервер(?:а|ы)?|ноды)\s+работают)/i.test(text);
  }

  private isForbidden(text: string): boolean {
    return /(чуж|друг(ого|ой).*польз|telegram.?id|remnawave|uuid|api.?key|токен|\.env|ssh|docker|xray|admin|админ|health.?check|логи|инфраструкт)/i.test(text);
  }
}
