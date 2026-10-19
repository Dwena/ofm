import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsNumber,
  IsDateString,
  IsNotEmpty,
  MaxLength,
  Min,
  Max,
} from 'class-validator';

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
