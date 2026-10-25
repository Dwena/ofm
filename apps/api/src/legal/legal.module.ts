import { Module } from '@nestjs/common';

import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

/** Versions of the legal documents and users' acceptances (LegalAcceptance) */
@Module({
  controllers: [LegalController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
