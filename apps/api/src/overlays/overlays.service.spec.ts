import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_OVERLAY_SETTINGS } from './overlay-settings';
import { generateOverlayToken, isOverlayTokenFormat, OverlaysService } from './overlays.service';

describe('OverlaysService', () => {
  const prisma = {
    overlayToken: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    overlayWidgetSettings: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() },
    liveStream: { findFirst: jest.fn(), findUnique: jest.fn() },
  };
  const config = { get: jest.fn() };
  const liveTips = { getActiveMenu: jest.fn(), getGoals: jest.fn(), getRecentActions: jest.fn() };
  const streamingGateway = { getChatHistory: jest.fn() };

  let service: OverlaysService;

  const token = generateOverlayToken();
  const tokenRow = { id: 'tok-1', creatorId: 'creator-1', token, createdAt: new Date('2026-10-20T10:00:00Z'), rotatedAt: null };

  const creatorRow = {
    id: 'creator-1',
    username: 'demo_creator',
    displayName: 'Alice Martin',
    avatar: 'https://example.com/a.png',
    role: 'CREATOR',
    status: 'ACTIVE',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockImplementation((key: string) => (key === 'WEB_URL' ? 'https://fanvip.test/' : undefined));
    service = new OverlaysService(prisma as any, config as any, liveTips as any, streamingGateway as any);
    prisma.overlayWidgetSettings.findMany.mockResolvedValue([]);
    liveTips.getActiveMenu.mockResolvedValue([]);
  });

  describe('tokens', () => {
    it('generates url-safe tokens of 32 random bytes, all different', () => {
      const tokens = new Set(Array.from({ length: 50 }, () => generateOverlayToken()));
      expect(tokens.size).toBe(50);
      for (const value of tokens) {
        expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(Buffer.from(value, 'base64url')).toHaveLength(32);
        expect(isOverlayTokenFormat(value)).toBe(true);
      }
    });

    it('rejects malformed tokens before any database lookup', async () => {
      for (const value of [undefined, '', 'me', 'short-token', 'a'.repeat(31), `${'a'.repeat(40)}/..`, 'a'.repeat(129)]) {
        expect(await service.resolveToken(value)).toBeNull();
      }
      expect(prisma.overlayToken.findUnique).not.toHaveBeenCalled();
    });

    it('creates the token on first use and reuses it afterwards', async () => {
      prisma.overlayToken.findUnique.mockResolvedValueOnce(null);
      prisma.overlayToken.create.mockImplementation(async ({ data }) => ({ ...tokenRow, ...data }));
      const created = await service.getOrCreateToken('creator-1');
      expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(prisma.overlayToken.create).toHaveBeenCalledWith({ data: { creatorId: 'creator-1', token: created.token } });

      prisma.overlayToken.findUnique.mockResolvedValueOnce(tokenRow);
      expect(await service.getOrCreateToken('creator-1')).toBe(tokenRow);
      expect(prisma.overlayToken.create).toHaveBeenCalledTimes(1);
    });

    it('uses the token created concurrently when the insert hits the unique constraint', async () => {
      prisma.overlayToken.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(tokenRow);
      prisma.overlayToken.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5' }),
      );
      expect(await service.getOrCreateToken('creator-1')).toBe(tokenRow);
    });

    it('rotates to a brand new token and records when', async () => {
      prisma.overlayToken.findUnique.mockResolvedValue(tokenRow);
      prisma.overlayToken.update.mockImplementation(async ({ data }) => ({ ...tokenRow, ...data }));
      const rotated = await service.rotateToken('creator-1');
      expect(rotated.token).not.toBe(token);
      expect(isOverlayTokenFormat(rotated.token)).toBe(true);
      expect(rotated.rotatedAt).toBeInstanceOf(Date);
      expect(prisma.overlayToken.update).toHaveBeenCalledWith({
        where: { creatorId: 'creator-1' },
        data: { token: rotated.token, rotatedAt: expect.any(Date) },
      });
    });

    it.each([
      ['an unknown token', null],
      ['a banned creator', { creator: { ...creatorRow, status: 'BANNED' } }],
      ['a suspended creator', { creator: { ...creatorRow, status: 'SUSPENDED' } }],
      ['a user who is no longer a creator', { creator: { ...creatorRow, role: 'SUBSCRIBER' } }],
    ])('refuses %s', async (_label, row) => {
      prisma.overlayToken.findUnique.mockResolvedValue(row);
      expect(await service.resolveToken(token)).toBeNull();
      await expect(service.getPublicState(token)).rejects.toThrow(NotFoundException);
    });
  });

  describe('widget URLs and settings', () => {
    it('lists one URL per widget with its recommended size and default settings', async () => {
      prisma.overlayToken.findUnique.mockResolvedValue(tokenRow);
      const own = await service.getOwnOverlays('creator-1');
      expect(own.baseUrl).toBe(`https://fanvip.test/overlay/${token}`);
      expect(own.widgets.map((w) => [w.widget, w.url, w.width, w.height])).toEqual([
        ['ALERTS', `https://fanvip.test/overlay/${token}/alerts`, 800, 600],
        ['GOALS', `https://fanvip.test/overlay/${token}/goals`, 800, 220],
        ['TIP_MENU', `https://fanvip.test/overlay/${token}/menu`, 500, 700],
        ['CHAT', `https://fanvip.test/overlay/${token}/chat`, 450, 700],
        ['REQUESTS', `https://fanvip.test/overlay/${token}/requests`, 500, 500],
      ]);
      expect(own.widgets[0].settings).toEqual(DEFAULT_OVERLAY_SETTINGS.ALERTS);
    });

    it('saves a validated partial update on top of the stored settings', async () => {
      prisma.overlayWidgetSettings.findUnique.mockResolvedValue({
        settings: { ...DEFAULT_OVERLAY_SETTINGS.CHAT, maxMessages: 20 },
      });
      const saved = await service.updateSettings('creator-1', 'CHAT', { tipsOnly: true });
      expect(saved).toEqual({ ...DEFAULT_OVERLAY_SETTINGS.CHAT, maxMessages: 20, tipsOnly: true });
      expect(prisma.overlayWidgetSettings.upsert).toHaveBeenCalledWith({
        where: { creatorId_widget: { creatorId: 'creator-1', widget: 'CHAT' } },
        create: { creatorId: 'creator-1', widget: 'CHAT', settings: saved },
        update: { settings: saved },
      });
    });

    it('does not save invalid settings', async () => {
      prisma.overlayWidgetSettings.findUnique.mockResolvedValue(null);
      await expect(service.updateSettings('creator-1', 'ALERTS', { durationSeconds: 60 })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.overlayWidgetSettings.upsert).not.toHaveBeenCalled();
    });
  });

  describe('public state', () => {
    beforeEach(() => {
      prisma.overlayToken.findUnique.mockResolvedValue({ creator: creatorRow });
    });

    it('returns the creator, the settings and the menu when the creator is not live', async () => {
      prisma.liveStream.findFirst.mockResolvedValue(null);
      liveTips.getActiveMenu.mockResolvedValue([{ id: 'item-1', label: 'Chanson', amount: 20 }]);
      const state = await service.getPublicState(token);
      expect(state).toEqual({
        creator: { id: 'creator-1', username: 'demo_creator', displayName: 'Alice Martin', avatar: 'https://example.com/a.png' },
        settings: DEFAULT_OVERLAY_SETTINGS,
        menu: [{ id: 'item-1', label: 'Chanson', amount: 20 }],
        live: null,
      });
    });

    it('returns the current live with its total, goals, requests and last 30 chat lines, without secrets', async () => {
      // The query only selects public fields, but even a row with secrets must not leak them
      prisma.liveStream.findFirst.mockResolvedValue({
        id: 'stream-1',
        title: 'Live du soir',
        startedAt: new Date('2026-10-20T20:00:00Z'),
        tipTotal: new Prisma.Decimal('42.5'),
        streamKey: 'stream_secret',
      });
      liveTips.getGoals.mockResolvedValue([{ id: 'g1', amount: 50, label: 'Danse' }]);
      liveTips.getRecentActions.mockResolvedValue([{ id: 'a1', label: 'Chanson', status: 'PENDING' }]);
      streamingGateway.getChatHistory.mockResolvedValue([{ id: 'm1', message: 'Salut' }]);

      const state = await service.getPublicState(token);
      expect(state.live).toEqual({
        streamId: 'stream-1',
        title: 'Live du soir',
        startedAt: '2026-10-20T20:00:00.000Z',
        tipTotal: 42.5,
        goals: [{ id: 'g1', amount: 50, label: 'Danse' }],
        actions: [{ id: 'a1', label: 'Chanson', status: 'PENDING' }],
        messages: [{ id: 'm1', message: 'Salut' }],
      });
      expect(streamingGateway.getChatHistory).toHaveBeenCalledWith('stream-1', 'creator-1', 30);
      expect(prisma.liveStream.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { creatorId: 'creator-1', status: 'LIVE' },
          select: { id: true, title: true, startedAt: true, tipTotal: true },
        }),
      );

      const json = JSON.stringify(state);
      for (const secret of ['streamKey', 'stream_secret', 'email', 'password', 'role', 'status":"ACTIVE', token]) {
        expect(json).not.toContain(secret);
      }
    });
  });
});
