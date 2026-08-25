import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Bot, Context } from 'grammy';
import configuration from '../config/configuration';
import { UserBotHandlers } from './handlers/user-bot.handlers';

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private readonly bot: Bot<Context>;

  constructor(
    @Inject(configuration.KEY) config: ConfigType<typeof configuration>,
    handlers: UserBotHandlers,
  ) {
    this.bot = new Bot<Context>(config.botToken);
    handlers.register(this.bot);
  }

  async onModuleInit(): Promise<void> {
    await this.bot.api.deleteMyCommands();
    await this.bot.api.setMyCommands([
      { command: 'start', description: 'Start' },
      { command: 'home', description: '🏠 Домой' },
    ]);
    await this.bot.api.setChatMenuButton({ menu_button: { type: 'default' } });
    this.bot.start({ onStart: () => this.logger.log('User bot started') });
  }

  onModuleDestroy(): void {
    this.bot.stop();
  }
}
