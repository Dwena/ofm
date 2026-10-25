import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { KycService } from './kyc.service';
import { CoPerformersService } from './co-performers.service';
import { VerificationReviewService } from './verification-review.service';
import {
  CoPerformersController,
  CreatorVerificationController,
  VerificationAdminController,
} from './verification.controller';

/**
 * Identity verification: creator KYC, co-performers, and the moderator
 * queues. Publication gates live in publication-gate.ts (used by content,
 * stories and streaming).
 */
@Module({
  imports: [StorageModule],
  controllers: [CreatorVerificationController, CoPerformersController, VerificationAdminController],
  providers: [KycService, CoPerformersService, VerificationReviewService],
  exports: [KycService, CoPerformersService, VerificationReviewService],
})
export class VerificationModule {}
