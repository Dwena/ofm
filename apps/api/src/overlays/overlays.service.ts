import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/database/prisma.service';
import { LiveTipsService, TipActionView, TipGoalView, TipMenuItemView } from '../streaming/live-tips.service';
import { LiveChatMessage, StreamingGateway } from '../streaming/streaming.gateway';
import {
  DEFAULT_OVERLAY_SETTINGS,
  normalizeWidgetSettings,
  OVERLAY_WIDGET_SIZES,
  OVERLAY_WIDGET_SLUGS,
  OVERLAY_WIDGETS,
  OverlaySettingsMap,
  OverlayWidget,
  validateWidgetSettings,
} from './overlay-settings';

/** Overlay tokens are base64url, at least 32 random bytes (43 characters) */
export const OVERLAY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
/** Chat lines sent with the overlay state */
export const OVERLAY_CHAT_HISTORY = 30;

export const generateOverlayToken = () => randomBytes(32).toString('base64url');

export const isOverlayTokenFormat = (token: unknown): token is string =>
  typeof token === 'string' && OVERLAY_TOKEN_PATTERN.test(token);

/** Public info of the creator shown by the overlays */
export interface OverlayCreator {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
}

/** The creator's current live, as shown by the overlays */
export interface OverlayLive {
  streamId: string;
  title: string;
  startedAt: string | null;
  /** Euros */
  tipTotal: number;
  goals: TipGoalView[];
  /** Pending requests (oldest first), then the latest done / skipped ones */
  actions: TipActionView[];
  /** Latest chat lines, oldest first */
  messages: LiveChatMessage[];
}

/** GET /overlays/:token/state: everything an overlay page needs, public data only */
export interface OverlayState {
  creator: OverlayCreator;
  settings: OverlaySettingsMap;
  /** Active items of the creator's tip menu (shown even without a live) */
  menu: TipMenuItemView[];
  live: OverlayLive | null;
}

export interface OverlayWidgetInfo {
  widget: OverlayWidget;
  slug: string;
  url: string;
  width: number;
  height: number;
  settings: OverlaySettingsMap[OverlayWidget];
}

/** GET /overlays/me */
export interface OwnOverlays {
  token: string;
  baseUrl: string;
  createdAt: string;
  rotatedAt: string | null;
  widgets: OverlayWidgetInfo[];
}

const CREATOR_SELECT = { id: true, username: true, displayName: true, avatar: true, role: true, status: true } as const;

/**
 * OBS overlay widgets of the creators: secret overlay URLs (one token per
 * creator), per-widget settings and the public read-only state they show
 */
@Injectable()
export class OverlaysService {
  private readonly logger = new Logger(OverlaysService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private liveTips: LiveTipsService,
    private streamingGateway: StreamingGateway,
  ) {}

  /** Origin of the web app the overlay URLs point to */
  get webUrl(): string {
    const url = this.config.get<string>('WEB_URL') || this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    return url.replace(/\/+$/, '');
  }

  /**
   * The creator's overlay token, created on first use
   */
  async getOrCreateToken(creatorId: string) {
    const existing = await this.prisma.overlayToken.findUnique({ where: { creatorId } });
    if (existing) return existing;
    try {
      return await this.prisma.overlayToken.create({ data: { creatorId, token: generateOverlayToken() } });
    } catch (error) {
      // Created concurrently (two tabs): use that one
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const created = await this.prisma.overlayToken.findUnique({ where: { creatorId } });
        if (created) return created;
      }
      throw error;
    }
  }

  /**
   * New token: every overlay URL of the creator changes, the old ones stop
   * working (the controller disconnects the overlays still open)
   */
  async rotateToken(creatorId: string) {
    await this.getOrCreateToken(creatorId);
    const rotated = await this.prisma.overlayToken.update({
      where: { creatorId },
      data: { token: generateOverlayToken(), rotatedAt: new Date() },
    });
    this.logger.log(`Overlay token rotated for creator ${creatorId}`);
    return rotated;
  }

  /**
   * Settings of every widget of the creator (defaults for the ones never saved)
   */
  async getSettings(creatorId: string): Promise<OverlaySettingsMap> {
    const rows = await this.prisma.overlayWidgetSettings.findMany({ where: { creatorId } });
    const stored = new Map(rows.map((row) => [row.widget as OverlayWidget, row.settings]));
    const settings = {} as Record<OverlayWidget, unknown>;
    for (const widget of OVERLAY_WIDGETS) {
      settings[widget] = stored.has(widget)
        ? normalizeWidgetSettings(widget, stored.get(widget))
        : { ...DEFAULT_OVERLAY_SETTINGS[widget] };
    }
    return settings as OverlaySettingsMap;
  }

  /**
   * Validate and save the settings of one widget (partial update on top of
   * the current settings). Returns the full settings of the widget.
   */
  async updateSettings<W extends OverlayWidget>(creatorId: string, widget: W, input: unknown): Promise<OverlaySettingsMap[W]> {
    const row = await this.prisma.overlayWidgetSettings.findUnique({
      where: { creatorId_widget: { creatorId, widget } },
    });
    const current = row ? normalizeWidgetSettings(widget, row.settings) : DEFAULT_OVERLAY_SETTINGS[widget];
    const settings = validateWidgetSettings(widget, input, current);
    const json = settings as unknown as Prisma.InputJsonValue;
    await this.prisma.overlayWidgetSettings.upsert({
      where: { creatorId_widget: { creatorId, widget } },
      create: { creatorId, widget, settings: json },
      update: { settings: json },
    });
    return settings;
  }

  /**
   * Overlay URLs and settings of the creator's widgets
   */
  async getOwnOverlays(creatorId: string): Promise<OwnOverlays> {
    const [token, settings] = await Promise.all([this.getOrCreateToken(creatorId), this.getSettings(creatorId)]);
    return this.toOwnOverlays(token, settings);
  }

  toOwnOverlays(
    token: { token: string; createdAt: Date; rotatedAt: Date | null },
    settings: OverlaySettingsMap,
  ): OwnOverlays {
    const baseUrl = `${this.webUrl}/overlay/${token.token}`;
    return {
      token: token.token,
      baseUrl,
      createdAt: token.createdAt.toISOString(),
      rotatedAt: token.rotatedAt ? token.rotatedAt.toISOString() : null,
      widgets: OVERLAY_WIDGETS.map((widget) => ({
        widget,
        slug: OVERLAY_WIDGET_SLUGS[widget],
        url: `${baseUrl}/${OVERLAY_WIDGET_SLUGS[widget]}`,
        ...OVERLAY_WIDGET_SIZES[widget],
        settings: settings[widget],
      })),
    };
  }

  /**
   * Creator of an overlay token (null for an unknown token or a creator who
   * cannot go live any more: banned, suspended, not a creator)
   */
  async resolveToken(token: unknown): Promise<OverlayCreator | null> {
    if (!isOverlayTokenFormat(token)) return null;
    const row = await this.prisma.overlayToken.findUnique({
      where: { token },
      select: { creator: { select: CREATOR_SELECT } },
    });
    const creator = row?.creator;
    if (!creator || creator.role !== 'CREATOR' || creator.status === 'BANNED' || creator.status === 'SUSPENDED') {
      return null;
    }
    return { id: creator.id, username: creator.username, displayName: creator.displayName, avatar: creator.avatar };
  }

  /**
   * Public state of the overlays of a token (404 for an unknown token)
   */
  async getPublicState(token: string): Promise<OverlayState> {
    const creator = await this.resolveToken(token);
    if (!creator) {
      throw new NotFoundException('Overlay not found');
    }
    return this.getStateOf(creator);
  }

  /**
   * Public state of a creator's overlays
   */
  async getStateOf(creator: OverlayCreator): Promise<OverlayState> {
    const [settings, menu, live] = await Promise.all([
      this.getSettings(creator.id),
      this.liveTips.getActiveMenu(creator.id),
      this.getCurrentLive(creator.id),
    ]);
    return { creator, settings, menu, live };
  }

  /**
   * The creator's live in progress with its tip total, milestones, requests
   * and latest chat lines (null when the creator is not live)
   */
  async getCurrentLive(creatorId: string): Promise<OverlayLive | null> {
    const stream = await this.prisma.liveStream.findFirst({
      where: { creatorId, status: 'LIVE' },
      orderBy: [{ startedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: { id: true, title: true, startedAt: true, tipTotal: true },
    });
    if (!stream) return null;

    const [goals, actions, messages] = await Promise.all([
      this.liveTips.getGoals(stream.id),
      this.liveTips.getRecentActions(stream.id),
      this.streamingGateway.getChatHistory(stream.id, creatorId, OVERLAY_CHAT_HISTORY),
    ]);
    return {
      streamId: stream.id,
      title: stream.title,
      startedAt: stream.startedAt ? stream.startedAt.toISOString() : null,
      tipTotal: Number(stream.tipTotal),
      goals,
      actions,
      messages,
    };
  }

  /**
   * Creator of a stream (relay of the events whose creator is unknown)
   */
  async getStreamCreatorId(streamId: string): Promise<string | null> {
    const stream = await this.prisma.liveStream.findUnique({ where: { id: streamId }, select: { creatorId: true } });
    return stream?.creatorId ?? null;
  }
}
