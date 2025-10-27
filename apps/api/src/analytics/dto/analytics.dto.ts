import { IsString, IsEnum, IsOptional, IsNumber, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export enum AnalyticsInterval {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
  YEAR = 'YEAR',
}

export enum MetricType {
  VIEWS = 'VIEWS',
  LIKES = 'LIKES',
  COMMENTS = 'COMMENTS',
  SUBSCRIBERS = 'SUBSCRIBERS',
  REVENUE = 'REVENUE',
}

export class GetAnalyticsDto {
  @IsEnum(AnalyticsInterval)
  @IsOptional()
  interval?: AnalyticsInterval = AnalyticsInterval.DAY;

  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  periods?: number = 30;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}

export class TrackViewDto {
  @IsString()
  contentId: string;

  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  ipAddress?: string;

  @IsString()
  @IsOptional()
  userAgent?: string;
}

export class GetContentAnalyticsDto extends GetAnalyticsDto {
  @IsString()
  @IsOptional()
  contentId?: string;

  @IsEnum(['POST', 'IMAGE', 'VIDEO', 'AUDIO'])
  @IsOptional()
  contentType?: string;
}

export class GetEngagementDto {
  @IsEnum(AnalyticsInterval)
  @IsOptional()
  interval?: AnalyticsInterval = AnalyticsInterval.DAY;

  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  periods?: number = 30;
}
