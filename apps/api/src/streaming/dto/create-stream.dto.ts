import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsNumber,
  IsDateString,
  IsIn,
  IsNotEmpty,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { LIVE_SOURCES, type LiveSource } from './live-ingress.dto';

export enum StreamVisibility {
  PUBLIC = 'PUBLIC',
  SUBSCRIBERS_ONLY = 'SUBSCRIBERS_ONLY',
  PREMIUM_SUBSCRIBERS = 'PREMIUM_SUBSCRIBERS',
  PRIVATE = 'PRIVATE',
}

export class CreateStreamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsEnum(StreamVisibility)
  visibility?: StreamVisibility;

  @IsOptional()
  @IsBoolean()
  isPpv?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  ppvPrice?: number;

  @IsOptional()
  @IsDateString()
  scheduledFor?: string;

  /** BROWSER (camera, default) or OBS (LiveKit transport only) */
  @IsOptional()
  @IsIn(LIVE_SOURCES)
  source?: LiveSource;
}

export class UpdateStreamDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsEnum(StreamVisibility)
  visibility?: StreamVisibility;

  @IsOptional()
  @IsBoolean()
  isPpv?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  ppvPrice?: number;

  @IsOptional()
  @IsDateString()
  scheduledFor?: string;
}
