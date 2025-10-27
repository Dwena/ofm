import { IsString, IsEnum, IsOptional, IsBoolean, IsDecimal, IsArray, IsUUID } from 'class-validator';

export enum ContentType {
  POST = 'POST',
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  AUDIO = 'AUDIO',
}

export enum ContentVisibility {
  PUBLIC = 'PUBLIC',
  SUBSCRIBERS_ONLY = 'SUBSCRIBERS_ONLY',
  TIER_SPECIFIC = 'TIER_SPECIFIC',
}

export class CreateContentDto {
  @IsEnum(ContentType)
  type: ContentType;

  @IsEnum(ContentVisibility)
  @IsOptional()
  visibility?: ContentVisibility;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  caption?: string;

  @IsBoolean()
  @IsOptional()
  isPpv?: boolean;

  @IsDecimal()
  @IsOptional()
  ppvPrice?: number;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  fileIds?: string[];

  @IsOptional()
  scheduledFor?: Date;
}
