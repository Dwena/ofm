import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Subscription } from 'rxjs';
import { Namespace, Socket } from 'socket.io';
import { StreamingGateway, StreamRelayEvent } from '../streaming/streaming.gateway';
import type { TipMenuItemView } from '../streaming/live-tips.service';
import { OverlaySettingsMap, OverlayWidget } from './overlay-settings';
import { OverlayCreator, OverlaysService } from './overlays.service';

export const overlayRoom = (creatorId: string) => `overlay:${creatorId}`;

/** Live events relayed to the overlays (anything else emitted to a stream room is not) */
export const OVERLAY_RELAYED_EVENTS = new Set([
  'chat-message',
  'chat-message-deleted',
  'tip',
  'tip-goal-progress',
  'tip-goal-reached',
  'tip-goals-updated',
  'tip-goal-updated',
  'tip-action-created',
  'tip-action-updated',
  'viewer-count',
]);

export const OVERLAY_TEST_EVENTS = ['alert', 'menu-request', 'goal-reached', 'chat'] as const;
export type OverlayTestEvent = (typeof OVERLAY_TEST_EVENTS)[number];

/** Error of the connection middleware (connect_error message on the client) */
export const INVALID_OVERLAY_TOKEN = 'INVALID_OVERLAY_TOKEN';
/** Reason sent with `overlay-revoked` before the server disconnects the overlay */
export const TOKEN_ROTATED = 'TOKEN_ROTATED';

export interface OverlaySocket extends Socket {
  overlayCreator?: OverlayCreator;
}

const MAX_CACHED_STREAMS = 1000;

const TEST_FAN = { id: 'overlay-test', username: 'fan_test', displayName: 'Fan de test', avatar: null };

/**
 * Real-time feed of the OBS overlays (namespace `/overlays`).
 *
 * An overlay authenticates with its overlay token (never a user JWT) and
 * joins the room of its creator, `overlay:<creatorId>`. It is read-only: the
 * namespace has no message handler (chat, tips, reactions, stream rooms all
 * live in `/streaming`, which only accepts user JWTs).
 *
 * The public events of the creator's current live are relayed from the
 * streaming gateway; `overlay-live-changed` is sent when the creator starts
 * or ends a live, `settings-updated` when a widget's settings are saved and
 * `overlay-revoked` before the overlays of a rotated token are disconnected.
 */
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/overlays',
})
export class OverlaysGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server: Namespace;

  private logger = new Logger('OverlaysGateway');
  private relaySubscription?: Subscription;
  /** creatorId -> live the overlays currently show (creators with connected overlays only) */
  private currentStreams = new Map<string, string | null>();
  /** streamId -> creatorId, for the relayed events that do not carry it */
  private streamCreators = new Map<string, string>();

  constructor(
    private overlays: OverlaysService,
    private streamingGateway: StreamingGateway,
  ) {}

  onModuleInit() {
    this.relaySubscription = this.streamingGateway.streamEvents$.subscribe((event) => {
      this.relay(event).catch((error) => this.logger.error(`Overlay relay of ${event.event} failed:`, error));
    });
  }

  onModuleDestroy() {
    this.relaySubscription?.unsubscribe();
  }

  /**
   * Authenticate in a middleware so that `connect` only fires on the client
   * once the overlay joined its room
   */
  afterInit(server: Namespace) {
    if (typeof server?.use !== 'function') return;
    server.use((socket, next) => {
      this.authenticate(socket as OverlaySocket)
        .then((ok) => (ok ? next() : next(new Error(INVALID_OVERLAY_TOKEN))))
        .catch(() => next(new Error(INVALID_OVERLAY_TOKEN)));
    });
  }

  async authenticate(client: OverlaySocket): Promise<boolean> {
    const token = client.handshake?.auth?.overlayToken ?? client.handshake?.auth?.token;
    const creator = await this.overlays.resolveToken(token);
    if (!creator) {
      this.logger.warn(`Overlay connection rejected (${client.handshake?.address ?? 'unknown address'})`);
      return false;
    }
    client.overlayCreator = creator;
    return true;
  }

  async handleConnection(client: OverlaySocket) {
    if (!client.overlayCreator && !(await this.authenticate(client))) {
      client.disconnect(true);
      return;
    }
    const creatorId = client.overlayCreator!.id;
    await client.join(overlayRoom(creatorId));
    // Fresh state on every (re)connection: events missed while offline are not replayed
    try {
      const state = await this.overlays.getStateOf(client.overlayCreator!);
      this.currentStreams.set(creatorId, state.live?.streamId ?? null);
      client.emit('overlay-ready', state);
    } catch (error) {
      this.logger.error(`Overlay state of creator ${creatorId} failed:`, error);
      client.emit('overlay-ready', null);
    }
  }

  handleDisconnect(client: OverlaySocket) {
    const creatorId = client.overlayCreator?.id;
    if (creatorId && !this.hasOverlays(creatorId)) {
      this.currentStreams.delete(creatorId);
    }
  }

  /**
   * Relay one public event of a live to the overlays of its creator
   */
  async relay(relayed: StreamRelayEvent) {
    if (!this.server) return;
    const creatorId = relayed.creatorId ?? (await this.creatorOf(relayed.streamId));
    if (!creatorId) return;
    if (relayed.streamId && relayed.creatorId) this.rememberStream(relayed.streamId, relayed.creatorId);
    if (!this.hasOverlays(creatorId)) return;

    const room = overlayRoom(creatorId);
    switch (relayed.event) {
      case 'stream-started':
        await this.refreshLive(creatorId);
        return;
      case 'stream-ended':
        if (this.currentStreams.get(creatorId) === relayed.streamId) {
          this.server.to(room).emit('stream-ended', relayed.payload);
        }
        await this.refreshLive(creatorId);
        return;
      case 'tip-menu-updated':
        this.server.to(room).emit('tip-menu-updated', relayed.payload);
        return;
    }

    if (!OVERLAY_RELAYED_EVENTS.has(relayed.event) || !relayed.streamId) return;
    if (this.currentStreams.get(creatorId) !== relayed.streamId) {
      // A live the overlays do not know yet (started elsewhere): switch to it first
      const live = await this.refreshLive(creatorId);
      if (live !== relayed.streamId) return;
    }
    this.server.to(room).emit(relayed.event, relayed.payload);
  }

  /**
   * Send the creator's current live (or null) to the overlays; returns its id
   */
  async refreshLive(creatorId: string): Promise<string | null> {
    const live = await this.overlays.getCurrentLive(creatorId);
    const streamId = live?.streamId ?? null;
    this.currentStreams.set(creatorId, streamId);
    this.server.to(overlayRoom(creatorId)).emit('overlay-live-changed', { live });
    return streamId;
  }

  /**
   * Push a widget's new settings to the open overlays (live preview in OBS)
   */
  notifySettingsUpdated<W extends OverlayWidget>(creatorId: string, widget: W, settings: OverlaySettingsMap[W]) {
    this.server?.to(overlayRoom(creatorId)).emit('settings-updated', { widget, settings });
  }

  /**
   * Old overlay URLs stop working: tell the open overlays why, then disconnect them
   */
  disconnectCreator(creatorId: string, reason = TOKEN_ROTATED) {
    if (!this.server) return;
    const room = overlayRoom(creatorId);
    this.server.to(room).emit('overlay-revoked', { reason });
    this.server.in(room).disconnectSockets(true);
    this.currentStreams.delete(creatorId);
  }

  /**
   * Fake event for the creator's "Tester" buttons: sent ONLY to the creator's
   * overlays (never to a stream room, so never to viewers or the chat),
   * flagged `test: true`
   */
  emitTest(creatorId: string, kind: OverlayTestEvent, menu: TipMenuItemView[] = []) {
    if (!this.server) return;
    const room = overlayRoom(creatorId);
    const id = `test-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    switch (kind) {
      case 'alert':
        this.server.to(room).emit('tip', {
          streamId: null,
          transactionId: id,
          amount: 10,
          message: 'Ceci est une alerte de test 🎉',
          menuItemLabel: null,
          fromUser: TEST_FAN,
          test: true,
        });
        return;
      case 'menu-request': {
        const item = menu[0];
        const label = item ? `${item.emoji ? `${item.emoji} ` : ''}${item.label}` : 'Une chanson';
        const amount = item?.amount ?? 20;
        this.server.to(room).emit('tip', {
          streamId: null,
          transactionId: id,
          amount,
          message: null,
          menuItemLabel: label,
          fromUser: TEST_FAN,
          test: true,
        });
        this.server.to(room).emit('tip-action-created', {
          action: {
            id,
            streamId: null,
            menuItemId: item?.id ?? null,
            label,
            amount,
            status: 'PENDING',
            createdAt: now,
            completedAt: null,
            fromUser: TEST_FAN,
          },
          test: true,
        });
        return;
      }
      case 'goal-reached':
        this.server.to(room).emit('tip-goal-reached', {
          streamId: null,
          goal: { id, amount: 100, label: 'Objectif de test', position: 0, reachedAt: now, completedAt: null },
          total: 100,
          test: true,
        });
        return;
      case 'chat':
        this.server.to(room).emit('chat-message', {
          id,
          userId: TEST_FAN.id,
          username: TEST_FAN.username,
          displayName: TEST_FAN.displayName,
          avatar: null,
          message: 'Message de test 👋 Bonjour le live !',
          timestamp: now,
          type: 'MESSAGE',
          isCreator: false,
          test: true,
        });
        return;
    }
  }

  /** True when at least one overlay of the creator is connected */
  hasOverlays(creatorId: string): boolean {
    return (this.server?.adapter?.rooms?.get(overlayRoom(creatorId))?.size ?? 0) > 0;
  }

  private async creatorOf(streamId: string | null): Promise<string | null> {
    if (!streamId) return null;
    const cached = this.streamCreators.get(streamId);
    if (cached) return cached;
    const creatorId = await this.overlays.getStreamCreatorId(streamId);
    if (creatorId) this.rememberStream(streamId, creatorId);
    return creatorId;
  }

  private rememberStream(streamId: string, creatorId: string) {
    if (this.streamCreators.get(streamId) === creatorId) return;
    if (this.streamCreators.size >= MAX_CACHED_STREAMS) {
      // Oldest entry first (insertion order)
      const oldest = this.streamCreators.keys().next().value;
      if (oldest !== undefined) this.streamCreators.delete(oldest);
    }
    this.streamCreators.set(streamId, creatorId);
  }
}
