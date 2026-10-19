import { IsString, IsEnum, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Status filter of the creator's content list. SCHEDULED is a draft with a
 * publication date; REVIEW groups content under review or rejected by moderation.
 */
export enum MyContentStatusFilter {
  ALL = 'ALL',
  PUBLISHED = 'PUBLISHED',
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  ARCHIVED = 'ARCHIVED',
  REVIEW = 'REVIEW',
}

export class MyContentQueryDto {
  @IsEnum(MyContentStatusFilter)
  @IsOptional()
  status?: MyContentStatusFilter;

  @IsString()
  @IsOptional()
  search?: string;

  @IsInt()
  @Type(() => Number)
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @IsInt()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;
}
