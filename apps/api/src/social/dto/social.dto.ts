import { IsString, IsOptional, IsNumber, Min, Max, IsEnum, MaxLength, IsNotEmpty } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export const COMMENT_MAX_LENGTH = 500;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateCommentDto {
  @IsString()
  contentId: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Le commentaire ne peut pas être vide' })
  @MaxLength(COMMENT_MAX_LENGTH, { message: `Le commentaire ne peut pas dépasser ${COMMENT_MAX_LENGTH} caractères` })
  text: string;
}

export class UpdateCommentDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Le commentaire ne peut pas être vide' })
  @MaxLength(COMMENT_MAX_LENGTH, { message: `Le commentaire ne peut pas dépasser ${COMMENT_MAX_LENGTH} caractères` })
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

  @IsEnum(['POPULAR', 'NEW', 'RECOMMENDED', 'PRICE_ASC', 'PRICE_DESC'])
  @IsOptional()
  sortBy?: 'POPULAR' | 'NEW' | 'RECOMMENDED' | 'PRICE_ASC' | 'PRICE_DESC' = 'POPULAR';

  /** Minimum monthly price (euros) of the creator's cheapest active tier */
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @IsOptional()
  minPrice?: number;

  /** Maximum monthly price (euros) of the creator's cheapest active tier */
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @IsOptional()
  maxPrice?: number;

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

export class SearchCreatorsDto {
  @IsString()
  @MaxLength(100)
  q: string;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(50)
  @IsOptional()
  limit?: number = 10;
}
