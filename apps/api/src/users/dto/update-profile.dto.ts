import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Empty strings / null clear the field (see UsersService.updateProfile) */
const isSet = (value: unknown) => value !== undefined && value !== null && value !== '';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string | null;

  @ValidateIf((o) => isSet(o.website))
  @IsUrl({ protocols: ['http', 'https'] }, { message: "L'adresse du site web est invalide (ex. https://exemple.com)" })
  @MaxLength(200)
  website?: string | null;

  /** URL returned by POST /media/upload/image */
  @ValidateIf((o) => isSet(o.avatar))
  @IsString()
  @MaxLength(2048)
  avatar?: string | null;

  @ValidateIf((o) => isSet(o.coverImage))
  @IsString()
  @MaxLength(2048)
  coverImage?: string | null;

  // Creator settings (CreatorProfile), ignored for other roles

  @IsOptional()
  @IsBoolean()
  allowMessages?: boolean;

  @IsOptional()
  @IsBoolean()
  allowTips?: boolean;

  @IsOptional()
  @IsBoolean()
  autoAcceptSubscribers?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  welcomeMessage?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1000)
  minimumTip?: number;
}

export const CREATOR_SETTING_FIELDS = [
  'allowMessages',
  'allowTips',
  'autoAcceptSubscribers',
  'welcomeMessage',
  'minimumTip',
] as const;
