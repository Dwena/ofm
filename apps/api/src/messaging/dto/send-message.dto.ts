import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const MESSAGE_MAX_LENGTH = 5000;
export const MESSAGE_PPV_MIN_PRICE = 1;
export const MESSAGE_PPV_MAX_PRICE = 500;

export class SendMessageDto {
  @IsUUID()
  recipientId: string;

  @IsString()
  @IsOptional()
  @MaxLength(MESSAGE_MAX_LENGTH)
  content?: string;

  /** URL returned by POST /media/upload */
  @IsString()
  @IsOptional()
  @MaxLength(2048)
  @Matches(/^https?:\/\//, { message: 'attachmentUrl must be an http(s) URL' })
  attachmentUrl?: string;

  /** Price in euros: the message is locked for the recipient until paid (creators only) */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MESSAGE_PPV_MIN_PRICE)
  @Max(MESSAGE_PPV_MAX_PRICE)
  @IsOptional()
  ppvPrice?: number;
}
