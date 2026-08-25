import { Module } from '@nestjs/common';
import { MTPROTO_ASSIGNMENT_PORT } from './mtproto-assignment.port';
import { MtprotoService } from './mtproto.service';
import { LumintoMtprotoAssignmentAdapter } from './luminto-mtproto-assignment.adapter';

@Module({
  providers: [
    MtprotoService,
    LumintoMtprotoAssignmentAdapter,
    {
      provide: MTPROTO_ASSIGNMENT_PORT,
      useExisting: LumintoMtprotoAssignmentAdapter,
    },
  ],
  exports: [MtprotoService],
})
export class MtprotoModule {}
