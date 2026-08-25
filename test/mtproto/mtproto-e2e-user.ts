import 'reflect-metadata';
import { Controller, Get, Module, Post } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { CustomersModule } from '../../src/customers/customers.module';
import { CustomerService } from '../../src/customers/customer.service';
import { DatabaseModule } from '../../src/database/database.module';
import { MtprotoModule } from '../../src/mtproto/mtproto.module';
import { MtprotoService } from '../../src/mtproto/mtproto.service';
import { UserAssistantService } from '../../src/user-assistant/user-assistant.service';

const identity = { id: 900000001, is_bot: false, first_name: 'E2E Test' };

@Controller('e2e/mtproto')
class E2eUserController {
  constructor(
    private readonly customers: CustomerService,
    private readonly mtproto: MtprotoService,
    private readonly assistant: UserAssistantService,
  ) {}

  private async id(): Promise<number> {
    const customer = await this.customers.getOrCreateFromTelegram(identity);
    return Number(customer.telegramUserId);
  }

  @Get('current') async current() {
    return this.mtproto.getOwn(await this.id());
  }
  @Post('rotate') async rotate() {
    return this.mtproto.rotateOwn(await this.id());
  }
  @Get('share') async share() {
    return { url: await this.mtproto.shareOwn(await this.id()) };
  }
  @Get('check') async check() {
    return this.mtproto.checkOwn(await this.id());
  }
  @Get('ai') async ai() {
    return { answer: await this.assistant.answer(identity, 'Дай мой MTProto') };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [
        () => ({
          mtproto: {
            apiUrl: process.env.MTPROTO_INTERNAL_API_URL,
            apiKey: process.env.MTPROTO_INTERNAL_API_KEY,
            timeoutMs: 5000,
          },
        }),
      ],
    }),
    DatabaseModule,
    CustomersModule,
    MtprotoModule,
  ],
  controllers: [E2eUserController],
  providers: [
    {
      provide: UserAssistantService,
      useFactory: () => new UserAssistantService(null),
    },
  ],
})
class E2eUserModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(E2eUserModule, {
    logger: ['error', 'warn'],
  });
  await app.listen(Number(process.env.PORT ?? 3011), '127.0.0.1');
  process.send?.('READY');
  const close = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void close());
  process.on('SIGINT', () => void close());
}

void bootstrap();
