import { IsString, IsEnum, IsOptional, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export enum ContentSortBy {
  RECENT = 'RECENT',
  POPULAR = 'POPULAR',
  VIEWS = 'VIEWS',
  LIKES = 'LIKES',
}

export class SearchContentDto {
  @IsString()
  @IsOptional()
  query?: string;

  @IsString()
  @IsOptional()
  creatorId?: string;

  @IsEnum(['POST', 'IMAGE', 'VIDEO', 'AUDIO'])
  @IsOptional()
  type?: string;

  @IsEnum(['PUBLIC', 'SUBSCRIBERS_ONLY', 'TIER_SPECIFIC'])
  @IsOptional()
  visibility?: string;

  @IsBoolean()
  @Type(() => Boolean)
  @IsOptional()
  isPpv?: boolean;

  @IsEnum(ContentSortBy)
  @IsOptional()
  sortBy?: ContentSortBy;

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
