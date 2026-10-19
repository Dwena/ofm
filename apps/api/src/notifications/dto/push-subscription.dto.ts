import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PushSubscriptionKeysDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  auth: string;
}

/** Shape of `PushSubscription.toJSON()` sent by the browser. */
export class CreatePushSubscriptionDto {
  @IsUrl({ protocols: ['https'], require_tld: false })
  @MaxLength(2048)
  endpoint: string;

  @IsOptional()
  @IsNumber()
  expirationTime?: number | null;

  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys: PushSubscriptionKeysDto;
}

export class RemovePushSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  endpoint: string;
}
