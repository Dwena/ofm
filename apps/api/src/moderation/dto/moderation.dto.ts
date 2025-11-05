import { IsString, IsEnum, IsOptional, IsUUID, IsNotEmpty, MaxLength } from 'class-validator';

export enum ReportType {
  USER = 'USER',
  CONTENT = 'CONTENT',
  COMMENT = 'COMMENT',
  MESSAGE = 'MESSAGE',
}

export enum ReportReason {
  SPAM = 'SPAM',
  HARASSMENT = 'HARASSMENT',
  HATE_SPEECH = 'HATE_SPEECH',
  NUDITY = 'NUDITY',
  VIOLENCE = 'VIOLENCE',
  FAKE_NEWS = 'FAKE_NEWS',
  COPYRIGHT = 'COPYRIGHT',
  UNDERAGE = 'UNDERAGE',
  ILLEGAL_CONTENT = 'ILLEGAL_CONTENT',
  OTHER = 'OTHER',
}

export class CreateReportDto {
  @IsEnum(ReportType)
  reportedType: ReportType;

  @IsUUID()
  reportedId: string;

  @IsEnum(ReportReason)
  reason: ReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class ModerationDecisionDto {
  @IsEnum(['APPROVE', 'REJECT', 'FLAG'])
  action: 'APPROVE' | 'REJECT' | 'FLAG';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ContentAnalysisResult {
  containsInappropriateText: boolean;
  containsSpam: boolean;
  containsHateSpeech: boolean;
  containsExplicitContent: boolean;
  flaggedKeywords: string[];
  confidenceScore: number;
  shouldAutoReject: boolean;
  shouldRequireReview: boolean;
}
