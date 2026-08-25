import { Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { AppModule } from './app.module';
import configuration from './config/configuration';

if (process.env.HTTPS_PROXY) {
  setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigType<typeof configuration>>(configuration.KEY);
  app.useLogger([config.logLevel]);
  await app.listen(config.port, '127.0.0.1');
  Logger.log(
    `User bot HTTP server listening on port ${config.port}`,
    'Bootstrap',
  );
}

void bootstrap();
