import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { KycFiles, KycService } from './kyc.service';
import { CoPerformerFiles, CoPerformersService } from './co-performers.service';
import { VerificationReviewService } from './verification-review.service';
import {
  CreateCoPerformerDto,
  ListCoPerformersReviewDto,
  ListKycDto,
  ReviewCoPerformerDto,
  SubmitKycDto,
  UpdateCoPerformerDto,
} from './dto/verification.dto';
import { IDENTITY_FILE_MAX_SIZE } from './identity-documents';

// Multer keeps identity files in memory only (never written to local disk)
const IDENTITY_UPLOAD_LIMITS = { fileSize: IDENTITY_FILE_MAX_SIZE, files: 4, fields: 20 };

/**
 * Creator identity verification (KYC)
 */
@Controller('creator/verification')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CREATOR')
export class CreatorVerificationController {
  constructor(private readonly kycService: KycService) {}

  @Get()
  getStatus(@CurrentUser('id') userId: string) {
    return this.kycService.getStatus(userId);
  }

  /**
   * multipart/form-data: documentType, dateOfBirth (YYYY-MM-DD), files
   * documentFront, documentBack (ID card / residence permit), selfie
   */
  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'documentFront', maxCount: 1 },
        { name: 'documentBack', maxCount: 1 },
        { name: 'selfie', maxCount: 1 },
      ],
      { limits: IDENTITY_UPLOAD_LIMITS },
    ),
  )
  submit(
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitKycDto,
    @UploadedFiles() files: KycFiles,
  ) {
    return this.kycService.submit(userId, dto, files ?? {});
  }
}

const CO_PERFORMER_FILE_FIELDS = [
  { name: 'documentFront', maxCount: 1 },
  { name: 'documentBack', maxCount: 1 },
  { name: 'releaseForm', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
];

/**
 * Co-performers declared by the creator (people appearing in their content)
 */
@Controller('creator/co-performers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CREATOR')
export class CoPerformersController {
  constructor(private readonly coPerformers: CoPerformersService) {}

  @Get()
  list(@CurrentUser('id') creatorId: string, @Query('status') status?: string) {
    return this.coPerformers.list(creatorId, status);
  }

  @Get(':id')
  get(@CurrentUser('id') creatorId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.coPerformers.get(creatorId, id);
  }

  /**
   * multipart/form-data: CreateCoPerformerDto fields + files documentFront,
   * documentBack (optional), releaseForm, selfie (optional)
   */
  @Post()
  @UseInterceptors(FileFieldsInterceptor(CO_PERFORMER_FILE_FIELDS, { limits: IDENTITY_UPLOAD_LIMITS }))
  create(
    @CurrentUser('id') creatorId: string,
    @Body() dto: CreateCoPerformerDto,
    @UploadedFiles() files: CoPerformerFiles,
  ) {
    return this.coPerformers.create(creatorId, dto, files ?? {});
  }

  /** Correct / resubmit a pending or rejected co-performer */
  @Put(':id')
  @UseInterceptors(FileFieldsInterceptor(CO_PERFORMER_FILE_FIELDS, { limits: IDENTITY_UPLOAD_LIMITS }))
  update(
    @CurrentUser('id') creatorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCoPerformerDto,
    @UploadedFiles() files: CoPerformerFiles,
  ) {
    return this.coPerformers.update(creatorId, id, dto, files ?? {});
  }

  @Delete(':id')
  remove(@CurrentUser('id') creatorId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.coPerformers.remove(creatorId, id);
  }
}

/**
 * Back-office: identity verification queues (creators and co-performers).
 * The KYC decision is POST /admin/users/:id/kyc (AdminService.reviewKyc).
 */
@Controller('admin/verification')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MODERATOR')
export class VerificationAdminController {
  constructor(private readonly review: VerificationReviewService) {}

  @Get('kyc')
  listKyc(@Query() dto: ListKycDto) {
    return this.review.listKyc(dto);
  }

  /** Documents as signed URLs valid 5 minutes; the access is audit-logged */
  @Get('kyc/:userId')
  getKyc(
    @CurrentUser('id') moderatorId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Ip() ip: string,
  ) {
    return this.review.getKycDetail(moderatorId, userId, ip);
  }

  @Get('co-performers')
  listCoPerformers(@Query() dto: ListCoPerformersReviewDto) {
    return this.review.listCoPerformers(dto);
  }

  @Get('co-performers/:id')
  getCoPerformer(
    @CurrentUser('id') moderatorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ) {
    return this.review.getCoPerformerDetail(moderatorId, id, ip);
  }

  @Post('co-performers/:id/review')
  reviewCoPerformer(
    @CurrentUser('id') moderatorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewCoPerformerDto,
  ) {
    return this.review.reviewCoPerformer(moderatorId, id, dto);
  }
}
