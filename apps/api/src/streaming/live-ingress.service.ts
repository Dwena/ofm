import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Subject } from 'rxjs';
import {
  IngressAudioEncodingPreset,
  IngressAudioOptions,
  IngressClient,
  IngressInput,
  IngressVideoEncodingOptions,
  IngressVideoEncodingPreset,
  IngressVideoOptions,
  TrackSource,
  VideoCodec,
  type IngressInfo,
  type WebhookEvent,
} from 'livekit-server-sdk';
import { PrismaService } from '../common/database/prisma.service';
import { LIVEKIT_REQUEST_TIMEOUT_SECONDS, LiveKitService, liveKitRoomName, streamIdFromRoom } from './livekit.service';

/** Protocol OBS pushes with (Prisma enum LiveIngressInput) */
export type IngressInputType = 'WHIP' | 'RTMP';
export const INGRESS_INPUT_TYPES: IngressInputType[] = ['WHIP', 'RTMP'];

/**
 * What OBS is doing, for the creator:
 * - offline: nothing received
 * - connecting: OBS is connected, the ingress is buffering (no track published yet)
 * - live: the ingress publishes OBS's video / audio in the room
 */
export type ObsStatus = 'offline' | 'connecting' | 'live';

export interface ObsStatusEvent {
  creatorId: string;
  /** Live the ingress is bound to, null while it waits in its idle room */
  streamId: string | null;
  status: ObsStatus;
}

/** Creator-only view of the ingress (holds the stream key: never for anyone else) */
export interface LiveIngressView {
  inputType: IngressInputType;
  /** OBS "Serveur" (RTMP) / "Serveur" of the WHIP service */
  serverUrl: string;
  /** RTMP stream key / WHIP bearer token (the same secret) */
  streamKey: string;
  status: ObsStatus;
  /** Live receiving OBS's video, null when no live is bound */
  streamId: string | null;
  /** WHIP: the input forwards OBS's encoding as is (no transcoding) */
  bypassTranscoding: boolean;
  updatedAt: Date;
}

/** API error codes (BadRequest / ServiceUnavailable messages, mapped to French by the web) */
export const INGRESS_UNAVAILABLE = 'INGRESS_UNAVAILABLE';
export const INGRESS_SERVICE_UNREACHABLE = 'INGRESS_SERVICE_UNREACHABLE';

/**
 * Room of an ingress while no live is bound: nobody ever gets a token for it
 * (tokens are only issued for live-<streamId> rooms of LIVE streams), so an
 * OBS push between two lives is not visible anywhere.
 */
export const INGRESS_IDLE_ROOM_PREFIX = 'obs-idle-';
export const ingressIdleRoomName = (creatorId: string) => `${INGRESS_IDLE_ROOM_PREFIX}${creatorId}`;

// LiveKit protocol values (ParticipantInfo.Kind / IngressState.Status are not re-exported by the SDK)
const PARTICIPANT_KIND_INGRESS = 1;
const INGRESS_STATE = { INACTIVE: 0, BUFFERING: 1, PUBLISHING: 2, ERROR: 3, COMPLETE: 4 } as const;
const VIDEO_QUALITY = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;

const RTMP_VIDEO_PRESETS: Record<string, IngressVideoEncodingPreset> = {
  '720p': IngressVideoEncodingPreset.H264_720P_30FPS_3_LAYERS,
  '1080p': IngressVideoEncodingPreset.H264_1080P_30FPS_3_LAYERS,
};

/**
 * Public URLs OBS connects to. Default to what the LiveKit server announces
 * (`ingress.rtmp_base_url` / `ingress.whip_base_url` of livekit.yaml);
 * LIVEKIT_INGRESS_RTMP_URL / LIVEKIT_INGRESS_WHIP_URL override them.
 */
export function readIngressUrls(env: NodeJS.ProcessEnv = process.env) {
  return {
    rtmp: env.LIVEKIT_INGRESS_RTMP_URL?.trim() || undefined,
    whip: env.LIVEKIT_INGRESS_WHIP_URL?.trim() || undefined,
  };
}

const isNotFound = (error: unknown) => {
  const err = error as { status?: number; code?: string; message?: string };
  return err?.status === 404 || err?.code === 'not_found' || /not.?found|does not exist/i.test(String(err?.message ?? ''));
};

const errorText = (error: unknown) => String((error as { message?: string })?.message ?? error);

/**
 * "Diffuser avec OBS": one persistent LiveKit Ingress per creator (WHIP or
 * RTMP), so the OBS settings never change between lives. The ingress is
 * bound to the room of the live in progress (`live-<streamId>`, participant
 * identity = creator id, like a browser broadcast, so the viewers play it
 * unchanged) when a live starts in OBS mode, and moved back to its idle room
 * when the live ends. Its status comes from the LiveKit webhooks
 * (ingress_started / ingress_ended / track_published) and from the ingress
 * state LiveKit reports.
 *
 * Only available with the LiveKit transport (the P2P mesh has no server to
 * push to): INGRESS_UNAVAILABLE otherwise.
 */
@Injectable()
export class LiveIngressService implements OnModuleDestroy {
  private readonly logger = new Logger(LiveIngressService.name);
  private client?: IngressClient;
  // creatorId -> what its ingress is doing (from the webhooks / LiveKit state)
  private readonly statuses = new Map<string, { status: ObsStatus; room: string }>();
  private readonly statusSubject = new Subject<ObsStatusEvent>();
  /** OBS status changes, for the creator's socket (`obs-status`) */
  readonly obsStatus$ = this.statusSubject.asObservable();

  constructor(
    private readonly prisma: PrismaService,
    private readonly liveKit: LiveKitService,
  ) {}

  onModuleDestroy() {
    this.statusSubject.complete();
  }

  /** OBS mode needs the LiveKit server (and its Ingress service) */
  get available(): boolean {
    return this.liveKit.enabled;
  }

  assertAvailable() {
    if (!this.available) throw new BadRequestException(INGRESS_UNAVAILABLE);
  }

  /**
   * The creator's ingress (created as WHIP on first use), with its live status
   */
  async getIngress(creatorId: string): Promise<LiveIngressView> {
    this.assertAvailable();
    let record = await this.prisma.liveIngress.findUnique({ where: { creatorId } });
    if (!record) {
      record = await this.createIngress(creatorId, 'WHIP');
    } else {
      await this.syncState(creatorId, record.ingressId);
    }
    return this.toView(record);
  }

  /**
   * (Re)create the creator's ingress with another protocol: new LiveKit
   * ingress (and new stream key), the previous one is deleted
   */
  async setInputType(creatorId: string, inputType: IngressInputType): Promise<LiveIngressView> {
    this.assertAvailable();
    if (!INGRESS_INPUT_TYPES.includes(inputType)) {
      throw new BadRequestException('INVALID_INPUT_TYPE');
    }
    return this.toView(await this.createIngress(creatorId, inputType));
  }

  /**
   * New stream key: the LiveKit ingress is deleted and created again (same protocol)
   */
  async resetKey(creatorId: string): Promise<LiveIngressView> {
    this.assertAvailable();
    const record = await this.prisma.liveIngress.findUnique({ where: { creatorId }, select: { inputType: true } });
    return this.toView(await this.createIngress(creatorId, record?.inputType ?? 'WHIP'));
  }

  /**
   * Make sure the creator has an ingress before a live starts in OBS mode
   */
  async ensureIngress(creatorId: string) {
    this.assertAvailable();
    const record = await this.prisma.liveIngress.findUnique({ where: { creatorId } });
    return record ?? this.createIngress(creatorId, 'WHIP');
  }

  /**
   * Send OBS's video to a live: the ingress publishes in `live-<streamId>`
   * as the creator. If OBS is already pushing (to the idle room), LiveKit
   * ends that session and OBS reconnects to the live's room.
   */
  async bindToStream(creatorId: string, streamId: string) {
    const record = await this.ensureIngress(creatorId);
    const room = liveKitRoomName(streamId);
    try {
      await this.update(record.ingressId, creatorId, room);
    } catch (error) {
      if (!isNotFound(error)) throw this.unreachable('bind', error);
      // The LiveKit side lost it (e.g. its Redis was reset): a new key is needed
      this.logger.warn(`Ingress of ${creatorId} not found on LiveKit, creating a new one`);
      await this.createIngress(creatorId, record.inputType, room);
    }
    // A session in progress (idle room) was ended by the update: OBS reconnects,
    // ingress_started / track_published then report it in the live's room
    this.setStatus(creatorId, room, 'offline');
    this.logger.log(`Ingress of ${creatorId} bound to ${room}`);
  }

  /**
   * The live ended: back to the idle room (a later OBS push shows nowhere).
   * Never throws.
   */
  async unbind(creatorId: string) {
    if (!this.available) return;
    const record = await this.prisma.liveIngress.findUnique({ where: { creatorId }, select: { ingressId: true } });
    if (!record) return;
    try {
      await this.update(record.ingressId, creatorId, ingressIdleRoomName(creatorId));
      this.logger.log(`Ingress of ${creatorId} unbound`);
    } catch (error) {
      this.logger.warn(`Unable to unbind the ingress of ${creatorId}: ${errorText(error)}`);
    }
    this.setStatus(creatorId, ingressIdleRoomName(creatorId), 'offline');
  }

  /**
   * OBS status of a live (offline unless the creator's ingress is bound to it)
   */
  getStreamObsStatus(creatorId: string, streamId: string): ObsStatus {
    const entry = this.statuses.get(creatorId);
    return entry && entry.room === liveKitRoomName(streamId) ? entry.status : 'offline';
  }

  /**
   * LiveKit webhooks: ingress_started / ingress_ended and the tracks the
   * ingress participant publishes
   */
  async handleWebhookEvent(event: WebhookEvent) {
    if (!this.available) return;
    switch (event.event) {
      case 'ingress_started':
      case 'ingress_ended': {
        const info = event.ingressInfo;
        if (!info?.ingressId) return;
        const record = await this.prisma.liveIngress.findUnique({
          where: { ingressId: info.ingressId },
          select: { creatorId: true },
        });
        // An ingress deleted meanwhile (key reset): its events no longer matter
        if (!record) return;
        const status: ObsStatus =
          event.event === 'ingress_ended' ? 'offline' : this.statusFromState(info);
        this.setStatus(record.creatorId, info.roomName, status);
        break;
      }
      case 'track_published':
      case 'participant_left': {
        const participant = event.participant;
        const room = event.room?.name;
        if (!participant || !room || participant.kind !== PARTICIPANT_KIND_INGRESS) return;
        const creatorId = participant.identity;
        if (event.event === 'participant_left') {
          // Ignore the end of an older session (e.g. the idle room after binding)
          if (this.statuses.get(creatorId)?.room === room) this.setStatus(creatorId, room, 'offline');
          return;
        }
        this.setStatus(creatorId, room, 'live');
        await this.closeIfNotLive(creatorId, room);
        break;
      }
      default:
        break;
    }
  }

  // ---- Internals --------------------------------------------------------------

  /**
   * Safety net: an ingress publishing in the room of a live that is not LIVE
   * (ended, deleted...) is cut and sent back to its idle room
   */
  private async closeIfNotLive(creatorId: string, room: string) {
    const streamId = streamIdFromRoom(room);
    if (!streamId) return;
    const stream = await this.prisma.liveStream.findUnique({
      where: { id: streamId },
      select: { status: true, creatorId: true },
    });
    if (stream?.status === 'LIVE' && stream.creatorId === creatorId) return;
    this.logger.warn(`Ingress of ${creatorId} publishing in ${room} (live not in progress): closing it`);
    await this.unbind(creatorId);
    await this.liveKit.deleteRoom(streamId);
  }

  private async createIngress(creatorId: string, inputType: IngressInputType, roomName?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { username: true, displayName: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const existing = await this.prisma.liveIngress.findUnique({ where: { creatorId } });
    // Keep the binding when the creator changes protocol / key during an OBS live
    const room = roomName ?? (await this.currentRoom(creatorId));
    const client = this.getClient();
    const isWhip = inputType === 'WHIP';

    let info: IngressInfo;
    try {
      info = await client.createIngress(isWhip ? IngressInput.WHIP_INPUT : IngressInput.RTMP_INPUT, {
        name: `obs-${creatorId}`,
        roomName: room,
        participantIdentity: creatorId,
        participantName: user.displayName || user.username,
        // WHIP: OBS's H.264 / Opus forwarded as is (low CPU, sub-second latency).
        // RTMP: transcoded into simulcast layers (viewers get the layer that fits).
        enableTranscoding: !isWhip,
        bypassTranscoding: isWhip,
        ...(isWhip
          ? {}
          : {
              video: new IngressVideoOptions({
                source: TrackSource.CAMERA,
                encodingOptions: this.rtmpVideoEncoding(),
              }),
              audio: new IngressAudioOptions({
                source: TrackSource.MICROPHONE,
                encodingOptions: { case: 'preset', value: IngressAudioEncodingPreset.OPUS_STEREO_96KBPS },
              }),
            }),
      });
    } catch (error) {
      throw this.unreachable('create', error);
    }

    const url = this.publicUrl(inputType, info.url);
    const record = await this.prisma.liveIngress.upsert({
      where: { creatorId },
      create: { creatorId, inputType, ingressId: info.ingressId, streamKey: info.streamKey, url },
      update: { inputType, ingressId: info.ingressId, streamKey: info.streamKey, url },
    });

    // The old key stops working right away
    if (existing && existing.ingressId !== info.ingressId) {
      await this.deleteRemote(existing.ingressId);
    }
    this.setStatus(creatorId, room, 'offline');
    this.logger.log(`Ingress ${info.ingressId} (${inputType}) created for ${creatorId}`);
    return record;
  }

  /** Room the ingress must publish to: the creator's OBS live in progress, else its idle room */
  private async currentRoom(creatorId: string) {
    const live = await this.prisma.liveStream.findFirst({
      where: { creatorId, status: 'LIVE', source: 'OBS' },
      select: { id: true },
    });
    return live ? liveKitRoomName(live.id) : ingressIdleRoomName(creatorId);
  }

  private async update(ingressId: string, creatorId: string, roomName: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { username: true, displayName: true },
    });
    return this.getClient().updateIngress(ingressId, {
      name: `obs-${creatorId}`,
      roomName,
      participantIdentity: creatorId,
      participantName: user?.displayName || user?.username || undefined,
    });
  }

  private async deleteRemote(ingressId: string) {
    try {
      await this.getClient().deleteIngress(ingressId);
    } catch (error) {
      if (!isNotFound(error)) this.logger.warn(`Unable to delete ingress ${ingressId}: ${errorText(error)}`);
    }
  }

  /**
   * Refresh the status from LiveKit (webhooks may be missing, e.g. API
   * restarted or webhook URL unreachable). Heals the binding of an OBS live
   * in progress whose ingress is elsewhere.
   */
  private async syncState(creatorId: string, ingressId: string) {
    let info: IngressInfo | undefined;
    try {
      [info] = await this.getClient().listIngress({ ingressId });
    } catch (error) {
      this.logger.warn(`Unable to read the state of ingress ${ingressId}: ${errorText(error)}`);
      return;
    }
    if (!info) return;
    this.setStatus(creatorId, info.roomName, this.statusFromState(info));

    const expected = await this.currentRoom(creatorId);
    if (info.roomName !== expected) {
      try {
        await this.update(ingressId, creatorId, expected);
        this.logger.log(`Ingress of ${creatorId} re-bound to ${expected}`);
      } catch (error) {
        this.logger.warn(`Unable to re-bind the ingress of ${creatorId}: ${errorText(error)}`);
      }
    }
  }

  private statusFromState(info: IngressInfo): ObsStatus {
    const state = info.state;
    switch (state?.status) {
      // Set once the ingress joined the room with its tracks (Ingress v1.4 leaves state.tracks empty)
      case INGRESS_STATE.PUBLISHING:
        return 'live';
      case INGRESS_STATE.BUFFERING:
        return 'connecting';
      default:
        return 'offline';
    }
  }

  private setStatus(creatorId: string, room: string, status: ObsStatus) {
    const previous = this.statuses.get(creatorId);
    this.statuses.set(creatorId, { status, room });
    if (previous?.status === status && previous.room === room) return;
    this.statusSubject.next({ creatorId, streamId: streamIdFromRoom(room) ?? null, status });
  }

  private toView(record: {
    creatorId: string;
    inputType: IngressInputType;
    streamKey: string;
    url: string;
    updatedAt: Date;
  }): LiveIngressView {
    const entry = this.statuses.get(record.creatorId);
    return {
      inputType: record.inputType,
      serverUrl: record.url,
      streamKey: record.streamKey,
      status: entry?.status ?? 'offline',
      streamId: streamIdFromRoom(entry?.room) ?? null,
      bypassTranscoding: record.inputType === 'WHIP',
      updatedAt: record.updatedAt,
    };
  }

  private publicUrl(inputType: IngressInputType, announced: string) {
    const urls = readIngressUrls();
    return (inputType === 'WHIP' ? urls.whip : urls.rtmp) || announced;
  }

  /**
   * Transcoding of the RTMP inputs: H.264 simulcast preset (720p by default,
   * LIVEKIT_INGRESS_RTMP_PRESET=1080p), or VP8 layers with
   * LIVEKIT_INGRESS_RTMP_CODEC=vp8 (for browsers without H.264 WebRTC
   * decoding, e.g. some Linux Chromium builds; costs more CPU)
   */
  private rtmpVideoEncoding(): IngressVideoOptions['encodingOptions'] {
    const preset = process.env.LIVEKIT_INGRESS_RTMP_PRESET?.trim().toLowerCase() || '720p';
    if (process.env.LIVEKIT_INGRESS_RTMP_CODEC?.trim().toLowerCase() !== 'vp8') {
      return { case: 'preset', value: RTMP_VIDEO_PRESETS[preset] ?? RTMP_VIDEO_PRESETS['720p'] };
    }
    const full = preset === '1080p' ? { width: 1920, height: 1080, bitrate: 4_500_000 } : { width: 1280, height: 720, bitrate: 2_500_000 };
    return {
      case: 'options',
      value: new IngressVideoEncodingOptions({
        videoCodec: VideoCodec.VP8,
        frameRate: 30,
        layers: [
          { quality: VIDEO_QUALITY.HIGH, ...full },
          { quality: VIDEO_QUALITY.MEDIUM, width: 640, height: 360, bitrate: 600_000 },
          { quality: VIDEO_QUALITY.LOW, width: 320, height: 180, bitrate: 150_000 },
        ],
      }),
    };
  }

  /** LiveKit (or its Ingress service, which needs Redis) did not answer */
  private unreachable(action: string, error: unknown) {
    if (error instanceof NotFoundException || error instanceof BadRequestException) return error;
    this.logger.error(`Ingress ${action} failed: ${errorText(error)}`);
    return new ServiceUnavailableException(INGRESS_SERVICE_UNREACHABLE);
  }

  private getClient() {
    const config = this.liveKit.getConfig();
    if (!config) throw new BadRequestException(INGRESS_UNAVAILABLE);
    if (!this.client) {
      this.client = new IngressClient(config.apiUrl, config.apiKey, config.apiSecret, {
        requestTimeout: LIVEKIT_REQUEST_TIMEOUT_SECONDS,
      });
    }
    return this.client;
  }
}
