import { IsIn, IsOptional } from 'class-validator';

export class LiveKitTokenDto {
  /**
   * 'viewer' lets the creator watch its own live without replacing its
   * broadcast; ignored for everyone else (always viewers)
   */
  @IsOptional()
  @IsIn(['publisher', 'viewer'])
  role?: 'publisher' | 'viewer';
}
