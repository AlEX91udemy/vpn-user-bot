import { Module } from '@nestjs/common';
import { REMNAWAVE_GATEWAY } from './remnawave.types';
import { RemnawaveHttpClient } from './remnawave-http.client';

@Module({
  providers: [
    RemnawaveHttpClient,
    { provide: REMNAWAVE_GATEWAY, useExisting: RemnawaveHttpClient },
  ],
  exports: [REMNAWAVE_GATEWAY],
})
export class RemnawaveModule {}
