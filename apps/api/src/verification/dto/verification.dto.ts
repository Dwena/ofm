import { IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { IDENTITY_DOCUMENT_TYPES, IdentityDocumentKind } from '../identity-documents';

/**
 * Creator identity verification (multipart/form-data). Files:
 * documentFront (required), documentBack (required for ID_CARD /
 * RESIDENCE_PERMIT), selfie (the creator holding the document, required).
 */
export class SubmitKycDto {
  @IsIn(IDENTITY_DOCUMENT_TYPES as unknown as string[])
  documentType: IdentityDocumentKind;

  /** YYYY-MM-DD */
  @IsDateString()
  dateOfBirth: string;
}

/**
 * Co-performer declaration (multipart/form-data). Files: documentFront
 * (required), documentBack (optional), releaseForm (signed release: PDF or
 * image, required), selfie (optional).
 */
export class CreateCoPerformerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  legalFirstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  legalLastName: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  stageName?: string;

  /** YYYY-MM-DD */
  @IsDateString()
  dateOfBirth: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  /** Username on FanVIP, when the co-performer has an account */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  platformUsername?: string;

  @IsIn(IDENTITY_DOCUMENT_TYPES as unknown as string[])
  documentType: IdentityDocumentKind;

  /** Date the release was signed (YYYY-MM-DD or ISO) */
  @IsDateString()
  consentSignedAt: string;
}

/**
 * Resubmission of a rejected co-performer: every field optional, new files
 * replace nothing (previous documents are kept on file) but are added.
 */
export class UpdateCoPerformerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  legalFirstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  legalLastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  stageName?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsIn(IDENTITY_DOCUMENT_TYPES as unknown as string[])
  documentType?: IdentityDocumentKind;

  @IsOptional()
  @IsDateString()
  consentSignedAt?: string;
}

export enum VerificationDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class ReviewCoPerformerDto {
  @IsEnum(VerificationDecision)
  decision: VerificationDecision;

  /** Required when rejecting */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export const KYC_QUEUE_STATUSES = ['PENDING', 'UNDER_REVIEW', 'RESUBMIT_REQUIRED', 'VERIFIED', 'REJECTED'] as const;

export class ListKycDto {
  /** Default: waiting for a decision (PENDING + UNDER_REVIEW) */
  @IsOptional()
  @IsIn(KYC_QUEUE_STATUSES as unknown as string[])
  status?: (typeof KYC_QUEUE_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class ListCoPerformersReviewDto {
  @IsOptional()
  @IsIn(['PENDING', 'VERIFIED', 'REJECTED'])
  status?: 'PENDING' | 'VERIFIED' | 'REJECTED';

  @IsOptional()
  @IsUUID()
  creatorId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
