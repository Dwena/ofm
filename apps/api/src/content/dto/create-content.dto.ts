import { IsString, IsEnum, IsOptional, IsBoolean, IsNumber, Min, IsArray, IsUUID, IsDate, MaxLength, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';

export enum ContentType {
  PHOTO = 'PHOTO',
  VIDEO = 'VIDEO',
  AUDIO = 'AUDIO',
  TEXT = 'TEXT',
  ALBUM = 'ALBUM',
}

export enum ContentVisibility {
  PUBLIC = 'PUBLIC',
  SUBSCRIBERS_ONLY = 'SUBSCRIBERS_ONLY',
  PREMIUM_SUBSCRIBERS = 'PREMIUM_SUBSCRIBERS',
  PPV = 'PPV',
  PRIVATE = 'PRIVATE',
}

export class CreateContentDto {
  @IsEnum(ContentType)
  type: ContentType;

  @IsEnum(ContentVisibility)
  @IsOptional()
  visibility?: ContentVisibility;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  title?: string;

  @IsString()
  @MaxLength(5000)
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  caption?: string;

  @IsBoolean()
  @IsOptional()
  isPpv?: boolean;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  ppvPrice?: number;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  fileIds?: string[];

  /** Publication date in the future: the content stays a draft until then */
  @IsDate()
  @Type(() => Date)
  @IsOptional()
  scheduledFor?: Date;

  /** Publish right away (ignored when scheduledFor is set) */
  @IsBoolean()
  @IsOptional()
  publish?: boolean;

  /**
   * "Seulement moi" (default true). false = other people appear in the
   * content: coPerformerIds must list them (verified co-performers only)
   */
  @IsBoolean()
  @IsOptional()
  soloContent?: boolean;

  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(20)
  @IsOptional()
  coPerformerIds?: string[];
}
