import { IsString, IsOptional, IsEnum, IsBoolean, IsNumber, IsDateString, Min } from 'class-validator';

export enum StreamVisibility {
  PUBLIC = 'PUBLIC',
  SUBSCRIBERS_ONLY = 'SUBSCRIBERS_ONLY',
  PRIVATE = 'PRIVATE',
}

export class CreateStreamDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
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
  ppvPrice?: number;

  @IsOptional()
  @IsDateString()
  scheduledFor?: string;
}

export class UpdateStreamDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
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
  ppvPrice?: number;

  @IsOptional()
  @IsDateString()
  scheduledFor?: string;
}
