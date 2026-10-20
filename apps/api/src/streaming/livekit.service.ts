import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Subject } from 'rxjs';
import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
  WebhookReceiver,
  type VideoGrant,
  type WebhookEvent,
} from 'livekit-server-sdk';

/** Video transport of the lives: LiveKit SFU when configured, else the P2P mesh */
export type LiveTransport = 'livekit' | 'p2p';

export type LiveKitRole = 'publisher' | 'viewer';

export interface LiveKitConfig {
  /** Public ws(s):// URL handed to the browsers */
  url: string;
  /** http(s):// URL the API uses for the room service (defaults to `url` with http(s)) */
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
}

export interface LiveKitTokenResponse {
  url: string;
  token: string;
  room: string;
  identity: string;
  transport: 'livekit';
  /** Token lifetime in seconds (only needed to join: LiveKit refreshes it once connected) */
  expiresIn: number;
}

export interface LiveKitVideoViewersEvent {
  streamId: string;
  /** Viewers connected to the video (publisher excluded) */
  count: number;
}

/** A token only has to be valid when joining (LiveKit refreshes it for connected clients) */
export const LIVEKIT_TOKEN_TTL_SECONDS = 2 * 60 * 60;
export const LIVEKIT_ROOM_PREFIX = 'live-';
/** The end of a live must not hang on an unreachable LiveKit server */
export const LIVEKIT_REQUEST_TIMEOUT_SECONDS = 5;

export const liveKitRoomName = (streamId: string) => `${LIVEKIT_ROOM_PREFIX}${streamId}`;

export const streamIdFromRoom = (room: string | undefined) =>
  room?.startsWith(LIVEKIT_ROOM_PREFIX) ? room.slice(LIVEKIT_ROOM_PREFIX.length) : undefined;

/**
 * Viewer identities carry a per-connection suffix (`<userId>:<nonce>`) so the
 * same user can watch from two tabs (LiveKit disconnects a participant when
 * another one joins with the same identity). The publisher's identity is the
 * bare user id: a second broadcasting tab replaces the first one, like the
 * socket's `broadcast-replaced`.
 */
export const userIdFromIdentity = (identity: string | undefined) => identity?.split(':')[0];

/**
 * LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET must all be set to enable LiveKit
 */
export function readLiveKitConfig(env: NodeJS.ProcessEnv = process.env): LiveKitConfig | null {
  const url = env.LIVEKIT_URL?.trim();
  const apiKey = env.LIVEKIT_API_KEY?.trim();
  const apiSecret = env.LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) return null;
  const apiUrl = env.LIVEKIT_API_URL?.trim() || url.replace(/^ws(s?):\/\//i, 'http$1://');
  return { url, apiUrl, apiKey, apiSecret };
}

/**
 * LiveKit SFU integration: access tokens for the lives, room cleanup and
 * webhook events. Only active when configured (see readLiveKitConfig);
 * otherwise `transport` is 'p2p' and the lives keep the WebRTC mesh.
 */
@Injectable()
export class LiveKitService implements OnModuleDestroy {
  private readonly logger = new Logger(LiveKitService.name);
  private readonly config: LiveKitConfig | null;
  private roomService?: RoomServiceClient;
  private webhookReceiver?: WebhookReceiver;
  // room -> identities of the viewers connected to the video (from the webhooks)
  private readonly roomViewers = new Map<string, Set<string>>();
  private readonly videoViewersSubject = new Subject<LiveKitVideoViewersEvent>();
  /** Number of viewers connected to a live's video, updated by the LiveKit webhooks */
  readonly videoViewers$ = this.videoViewersSubject.asObservable();

  constructor() {
    this.config = readLiveKitConfig();
    if (this.config) {
      this.logger.log(`LiveKit enabled (${this.config.url})`);
    }
  }

  onModuleDestroy() {
    this.videoViewersSubject.complete();
  }

  get enabled(): boolean {
    return this.config !== null;
  }

  get transport(): LiveTransport {
    return this.config ? 'livekit' : 'p2p';
  }

  /** Server URL and API keys (null in P2P mode), for the other LiveKit API clients (ingress) */
  getConfig(): LiveKitConfig | null {
    return this.config;
  }

  /**
   * Access token to join the live's room. The publisher (the creator) may
   * only publish its camera and microphone; viewers only subscribe and are
   * hidden from the other participants.
   */
  async createToken(params: {
    streamId: string;
    userId: string;
    name?: string | null;
    role: LiveKitRole;
  }): Promise<LiveKitTokenResponse> {
    const config = this.requireConfig();
    const room = liveKitRoomName(params.streamId);
    const isPublisher = params.role === 'publisher';
    const identity = isPublisher ? params.userId : `${params.userId}:${randomBytes(4).toString('hex')}`;

    const token = new AccessToken(config.apiKey, config.apiSecret, {
      identity,
      name: params.name || undefined,
      ttl: LIVEKIT_TOKEN_TTL_SECONDS,
      attributes: { userId: params.userId, role: params.role },
    });
    token.addGrant(this.grantFor(room, params.role));

    return {
      url: config.url,
      token: await token.toJwt(),
      room,
      identity,
      transport: 'livekit',
      expiresIn: LIVEKIT_TOKEN_TTL_SECONDS,
    };
  }

  grantFor(room: string, role: LiveKitRole): VideoGrant {
    if (role === 'publisher') {
      return {
        room,
        roomJoin: true,
        canPublish: true,
        canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
        canSubscribe: false,
        canPublishData: false,
      };
    }
    return {
      room,
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
      canPublishData: false,
      hidden: true,
    };
  }

  /**
   * Close the live's room: every participant is disconnected (live ended).
   * Never throws (the room may not exist, LiveKit may be unreachable).
   */
  async deleteRoom(streamId: string): Promise<boolean> {
    if (!this.config) return false;
    const room = liveKitRoomName(streamId);
    this.forgetRoom(room);
    try {
      await this.getRoomService().deleteRoom(room);
      this.logger.log(`LiveKit room ${room} deleted`);
      return true;
    } catch (error) {
      // 404: nobody ever joined the room, or it was already closed
      if (!/not.?found|does not exist/i.test(String(error?.message ?? error))) {
        this.logger.warn(`Unable to delete LiveKit room ${room}: ${error?.message ?? error}`);
      }
      return false;
    }
  }

  /**
   * Disconnect every connection of a user from the live's video (e.g. access revoked)
   */
  async removeUser(streamId: string, userId: string): Promise<number> {
    if (!this.config) return 0;
    const room = liveKitRoomName(streamId);
    try {
      const service = this.getRoomService();
      const participants = await service.listParticipants(room);
      const identities = participants
        .map((participant) => participant.identity)
        .filter((identity) => userIdFromIdentity(identity) === userId);
      await Promise.all(identities.map((identity) => service.removeParticipant(room, identity)));
      return identities.length;
    } catch (error) {
      this.logger.warn(`Unable to remove ${userId} from LiveKit room ${room}: ${error?.message ?? error}`);
      return 0;
    }
  }

  /**
   * Verify and decode a LiveKit webhook (Authorization header = JWT signed
   * with the API secret, holding the sha256 of the raw body)
   */
  async receiveWebhook(rawBody: string, authorization: string | undefined): Promise<WebhookEvent> {
    const config = this.requireConfig();
    if (!this.webhookReceiver) {
      this.webhookReceiver = new WebhookReceiver(config.apiKey, config.apiSecret);
    }
    return this.webhookReceiver.receive(rawBody, authorization);
  }

  /**
   * Keep the number of viewers connected to each live's video
   */
  handleWebhookEvent(event: WebhookEvent) {
    const room = event.room?.name;
    const streamId = streamIdFromRoom(room);
    if (!room || !streamId) return;

    switch (event.event) {
      case 'participant_joined':
      case 'participant_left':
      case 'participant_connection_aborted': {
        const identity = event.participant?.identity;
        // The publisher's identity is the bare user id, viewers have a suffix
        if (!identity || !identity.includes(':')) return;
        const viewers = this.roomViewers.get(room) ?? new Set<string>();
        if (event.event === 'participant_joined') viewers.add(identity);
        else viewers.delete(identity);
        this.roomViewers.set(room, viewers);
        this.videoViewersSubject.next({ streamId, count: viewers.size });
        break;
      }
      // A new room session (e.g. after a LiveKit restart): the identities of the old one are gone
      case 'room_started':
      case 'room_finished':
        this.forgetRoom(room);
        this.videoViewersSubject.next({ streamId, count: 0 });
        break;
      default:
        break;
    }
  }

  getVideoViewerCount(streamId: string): number | null {
    const viewers = this.roomViewers.get(liveKitRoomName(streamId));
    return viewers ? viewers.size : null;
  }

  private forgetRoom(room: string) {
    this.roomViewers.delete(room);
  }

  private getRoomService() {
    const config = this.requireConfig();
    if (!this.roomService) {
      this.roomService = new RoomServiceClient(config.apiUrl, config.apiKey, config.apiSecret, {
        requestTimeout: LIVEKIT_REQUEST_TIMEOUT_SECONDS,
      });
    }
    return this.roomService;
  }

  private requireConfig(): LiveKitConfig {
    if (!this.config) throw new Error('LiveKit is not configured');
    return this.config;
  }
}
