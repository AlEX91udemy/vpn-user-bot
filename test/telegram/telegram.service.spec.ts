import type { Bot, Context } from 'grammy';
import type { UserBotHandlers } from '../../src/telegram/handlers/user-bot.handlers';
import { TelegramService } from '../../src/telegram/telegram.service';

describe('TelegramService menu commands', () => {
  it('registers only the normal default commands before polling', async () => {
    const handlers = { register: jest.fn() } as unknown as UserBotHandlers;
    const service = new TelegramService(
      { botToken: '1:TEST' } as never,
      handlers,
    );
    const bot = (service as unknown as { bot: Bot<Context> }).bot;
    const deleteMyCommands = jest
      .spyOn(bot.api, 'deleteMyCommands')
      .mockResolvedValue(true);
    const setChatMenuButton = jest
      .spyOn(bot.api, 'setChatMenuButton')
      .mockResolvedValue(true);
    const setMyCommands = jest
      .spyOn(bot.api, 'setMyCommands')
      .mockResolvedValue(true);
    const start = jest.spyOn(bot, 'start').mockResolvedValue();

    await service.onModuleInit();

    expect(deleteMyCommands).toHaveBeenCalledTimes(1);
    expect(setMyCommands).toHaveBeenCalledWith([
      { command: 'start', description: 'Start' },
      { command: 'home', description: '🏠 Домой' },
    ]);
    expect(setChatMenuButton).toHaveBeenCalledWith({
      menu_button: { type: 'default' },
    });
    expect(start).toHaveBeenCalledTimes(1);
  });
});
