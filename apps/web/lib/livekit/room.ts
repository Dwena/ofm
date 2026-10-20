import type { RoomOptions } from 'livekit-client'

/**
 * Room options shared by the creator and the viewers.
 *
 * singlePeerConnection is turned off: the "v1" single peer connection
 * signaling (/rtc/v1) needs a recent LiveKit server, the self-hosted
 * livekit-server v1.8 (docker-compose) only speaks the classic protocol
 * (one publisher + one subscriber connection). Turning it on against v1.8
 * fails the /rtc/v1 websocket first and then times out the negotiation.
 */
export const BASE_ROOM_OPTIONS: Partial<RoomOptions> = {
  singlePeerConnection: false,
  disconnectOnPageLeave: true,
}
