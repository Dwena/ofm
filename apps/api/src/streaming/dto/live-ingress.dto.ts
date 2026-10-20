import { IsIn, IsOptional } from 'class-validator';

/** Video source of a live: the creator's browser camera, or OBS through its ingress */
export const LIVE_SOURCES = ['BROWSER', 'OBS'] as const;
export type LiveSource = (typeof LIVE_SOURCES)[number];

export class SetIngressInputDto {
  /** WHIP (recommended, OBS 30+, no transcoding) or RTMP (any software, transcoded) */
  @IsIn(['WHIP', 'RTMP'])
  inputType: 'WHIP' | 'RTMP';
}

export class StartStreamDto {
  /** Video source of the live (defaults to the one chosen at creation) */
  @IsOptional()
  @IsIn(LIVE_SOURCES)
  source?: LiveSource;
}
