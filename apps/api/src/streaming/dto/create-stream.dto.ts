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
  IsArray,
  IsUUID,
  ArrayMaxSize,
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

  /** Verified co-performers (CoPerformer ids) taking part in the live */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(20)
  coPerformerIds?: string[];
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

  /** Replaces the co-performers of the live (verified ones only) */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(20)
  coPerformerIds?: string[];
}

/** A moderator cuts a live: the reason is sent to the creator */
export class ModeratorEndStreamDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
