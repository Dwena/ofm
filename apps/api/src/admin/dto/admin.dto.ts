import { IsString, IsOptional, IsEnum, IsNumber, Min, Max, IsDateString, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export enum UserAction {
  SUSPEND = 'SUSPEND',
  BAN = 'BAN',
  ACTIVATE = 'ACTIVATE',
  WARN = 'WARN',
}

export enum ReportStatus {
  PENDING = 'PENDING',
  REVIEWING = 'REVIEWING',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED',
}

export enum ReportType {
  CONTENT = 'CONTENT',
  USER = 'USER',
  COMMENT = 'COMMENT',
  MESSAGE = 'MESSAGE',
}

export class ModerateUserDto {
  @IsString()
  userId: string;

  @IsEnum(UserAction)
  action: UserAction;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsNumber()
  @IsOptional()
  durationDays?: number; // For suspensions
}

export class CreateReportDto {
  @IsEnum(ReportType)
  type: ReportType;

  @IsString()
  targetId: string; // ID of content, user, comment, or message

  @IsString()
  reason: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class HandleReportDto {
  @IsString()
  reportId: string;

  @IsEnum(ReportStatus)
  status: ReportStatus;

  @IsString()
  @IsOptional()
  adminNotes?: string;

  @IsEnum(UserAction)
  @IsOptional()
  action?: UserAction; // Action taken if resolved

  @IsNumber()
  @IsOptional()
  durationDays?: number; // Suspension length when action is SUSPEND

  @IsBoolean()
  @IsOptional()
  removeContent?: boolean; // Remove the reported content when resolving a CONTENT report
}

export class GetReportsDto {
  @IsEnum(ReportStatus)
  @IsOptional()
  status?: ReportStatus;

  @IsEnum(ReportType)
  @IsOptional()
  type?: ReportType;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;
}

export class GetUsersDto {
  @IsString()
  @IsOptional()
  query?: string;

  @IsEnum(['CREATOR', 'SUBSCRIBER', 'ADMIN'])
  @IsOptional()
  role?: string;

  @IsEnum(['ACTIVE', 'SUSPENDED', 'BANNED', 'PENDING_VERIFICATION'])
  @IsOptional()
  status?: string;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;
}

export class GetPlatformStatsDto {
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}

export enum AdminContentFilter {
  ALL = 'ALL',
  FLAGGED = 'FLAGGED',
  REMOVED = 'REMOVED',
}

export class GetAdminContentDto {
  @IsString()
  @IsOptional()
  query?: string;

  @IsEnum(['DRAFT', 'PUBLISHED', 'ARCHIVED', 'UNDER_REVIEW', 'REJECTED'])
  @IsOptional()
  status?: string;

  @IsEnum(['PHOTO', 'VIDEO', 'AUDIO', 'TEXT', 'ALBUM'])
  @IsOptional()
  type?: string;

  @IsEnum(AdminContentFilter)
  @IsOptional()
  filter?: AdminContentFilter = AdminContentFilter.ALL;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;
}

export class ModerateContentDto {
  @IsString()
  @IsOptional()
  reason?: string;
}

export class DeleteUserDto {
  @IsString()
  @IsOptional()
  reason?: string;
}

export class GetAuditLogsDto {
  @IsString()
  @IsOptional()
  action?: string;

  @IsString()
  @IsOptional()
  resource?: string;

  @IsString()
  @IsOptional()
  userId?: string;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 50;
}
