import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class StartConversationDto {
  /** Id or username of the user to talk to */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  user: string;
}
