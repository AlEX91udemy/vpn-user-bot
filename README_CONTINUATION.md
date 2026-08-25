# Точка продолжения проекта

Этот файл фиксирует текущее состояние для продолжения работы над VPN User Bot.

## Репозиторий

- Рабочая директория: `/tmp/vpn-user-bot-audit`
- Production-проект: `/opt/vpn-user-bot`
- Production service: `vpn-user-bot.service`
- Старый бот-источник MTProto: `/opt/vpn-tg-bot`
- Старый service `vpn-tg-bot.service` не изменяется при работе с User Bot.

## Реализовано

### AI

AI-помощник перенесён и работает через кнопку `🤖 ИИ-помощник`. Команда `/ai` отсутствует. Динамические команды `/home` и `/reset` сохранены.

### MTProto

В User Bot перенесён рабочий flow старого бота:

```text
Luminto source
→ parsing tg://proxy links
→ validation server/port/secret
→ TCP probe and Ping
→ PostgreSQL proxy storage
→ per-user assignment by telegramUserId
→ MTProto URL
```

Поддерживаются получение, обновление и share уже назначенного proxy. Секреты и proxy URLs в этот файл не записываются.

### FAQ

FAQ открывается через раздел поддержки меню (`support:faq`) и содержит 7 компактных вопросов. В списке `◀️ Назад` возвращает в поддержку, а `🏠 Домой` — в главное меню. Ответы редактируют текущее сообщение и также содержат обе кнопки навигации.

### Share

`📤 Поделиться прокси` использует Telegram `answerCallbackQuery({ url })` с `t.me/share/url`, поэтому отдельный экран бота не создаётся. Используется текущая назначенная ссылка.

## Проверки

Последний локальный результат:

- unit tests: `108/108 PASS`;
- handler tests: `25/25 PASS`;
- PostgreSQL integration: `9/9 PASS`;
- typecheck: PASS;
- build: PASS;
- lint: PASS;
- `git diff --check`: PASS.

Последний production status:

- `vpn-user-bot.service`: active;
- `vpn-tg-bot.service`: active, не перезапускался;
- production build содержит FAQ callbacks и прямой share URL механизм.

## Безопасность

`.env`, API keys, Telegram tokens, passwords, proxy secrets и credentialed proxy URLs не должны добавляться в Git или README.

## Следующее продолжение

Перед новыми изменениями проверить:

```bash
git status
git log -1 --oneline
npm run typecheck
npm test -- --runInBand
```

Production не перезапускать без отдельного подтверждения.
