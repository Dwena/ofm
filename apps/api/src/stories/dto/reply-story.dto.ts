import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class ReplyStoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message: string;
}
