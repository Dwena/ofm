import { IsString, IsEnum, IsOptional, IsInt, Min, MaxLength, Matches } from 'class-validator';

export enum StoryType {
  PHOTO = 'PHOTO',
  VIDEO = 'VIDEO',
  TEXT = 'TEXT',
}

export enum StoryVisibility {
  PUBLIC = 'PUBLIC',
  SUBSCRIBERS_ONLY = 'SUBSCRIBERS_ONLY',
  PRIVATE = 'PRIVATE',
}

export class CreateStoryDto {
  @IsEnum(StoryType)
  type: StoryType;

  /**
   * Storage key returned by POST /media/upload/{image,video} (`key`), or an absolute URL
   */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  mediaUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  caption?: string;

  /**
   * Background color of text stories (#RRGGBB)
   */
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'backgroundColor must be a hex color (#RRGGBB)' })
  backgroundColor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  duration?: number;

  @IsOptional()
  @IsInt()
  width?: number;

  @IsOptional()
  @IsInt()
  height?: number;

  @IsOptional()
  @IsEnum(StoryVisibility)
  visibility?: StoryVisibility;
}
