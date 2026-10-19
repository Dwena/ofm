import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator';

import { NOTIFICATION_CATEGORIES, NotificationCategory } from '../notification-preferences';

export class ChannelPreferencesDto {
  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  @IsOptional()
  @IsBoolean()
  push?: boolean;
}

/** Partial update: only the categories / channels sent are changed */
export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferencesDto)
  messages?: ChannelPreferencesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferencesDto)
  subscribers?: ChannelPreferencesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferencesDto)
  followers?: ChannelPreferencesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferencesDto)
  comments?: ChannelPreferencesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferencesDto)
  purchases?: ChannelPreferencesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferencesDto)
  payouts?: ChannelPreferencesDto;
}

export class GetNotificationsQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  unreadOnly?: string;

  @IsOptional()
  @IsIn(NOTIFICATION_CATEGORIES as unknown as string[])
  category?: NotificationCategory;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
