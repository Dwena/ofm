import { IsString, IsOptional, IsNumber, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCommentDto {
  @IsString()
  contentId: string;

  @IsString()
  text: string;
}

export class UpdateCommentDto {
  @IsString()
  text: string;
}

export class GetCommentsDto {
  @IsString()
  contentId: string;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;
}

export class FollowCreatorDto {
  @IsString()
  creatorId: string;
}

export class DiscoverCreatorsDto {
  @IsString()
  @IsOptional()
  query?: string;

  @IsEnum(['POPULAR', 'NEW', 'RECOMMENDED'])
  @IsOptional()
  sortBy?: 'POPULAR' | 'NEW' | 'RECOMMENDED' = 'POPULAR';

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(50)
  @IsOptional()
  limit?: number = 20;
}

export class MarkNotificationReadDto {
  @IsString()
  notificationId: string;
}
