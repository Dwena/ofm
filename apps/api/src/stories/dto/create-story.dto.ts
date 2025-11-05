import { IsString, IsEnum, IsOptional, IsInt, Min } from 'class-validator';

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

  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  caption?: string;

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
