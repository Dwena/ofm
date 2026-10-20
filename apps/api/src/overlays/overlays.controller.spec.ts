import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { DEFAULT_OVERLAY_SETTINGS } from './overlay-settings';
import { OverlayPublicController, OverlaysController } from './overlays.controller';
import { TOKEN_ROTATED } from './overlays.gateway';
import { generateOverlayToken } from './overlays.service';

describe('OverlaysController', () => {
  const overlays = {
    getOwnOverlays: jest.fn(),
    rotateToken: jest.fn(),
    getSettings: jest.fn(),
    toOwnOverlays: jest.fn(),
    updateSettings: jest.fn(),
    getPublicState: jest.fn(),
  };
  const gateway = {
    disconnectCreator: jest.fn(),
    notifySettingsUpdated: jest.fn(),
    emitTest: jest.fn(),
    hasOverlays: jest.fn(() => true),
  };
  const liveTips = { getActiveMenu: jest.fn() };

  const controller = new OverlaysController(overlays as any, gateway as any, liveTips as any);
  const publicController = new OverlayPublicController(overlays as any);

  beforeEach(() => jest.clearAllMocks());

  it('is reserved to creators', () => {
    expect(Reflect.getMetadata(ROLES_KEY, OverlaysController)).toEqual(['CREATOR']);
    // The public state endpoint has no role / JWT requirement
    expect(Reflect.getMetadata('__guards__', OverlayPublicController)).toBeUndefined();
  });

  it('rotates the token, then disconnects the overlays of the old one', async () => {
    const rotated = { token: 'new' };
    overlays.rotateToken.mockResolvedValue(rotated);
    overlays.getSettings.mockResolvedValue(DEFAULT_OVERLAY_SETTINGS);
    overlays.toOwnOverlays.mockReturnValue({ token: 'new' });
    expect(await controller.rotateToken('creator-1')).toEqual({ token: 'new' });
    expect(gateway.disconnectCreator).toHaveBeenCalledWith('creator-1', TOKEN_ROTATED);
    expect(overlays.rotateToken.mock.invocationCallOrder[0]).toBeLessThan(
      gateway.disconnectCreator.mock.invocationCallOrder[0],
    );
  });

  it('saves widget settings (slug or enum, wrapped or not) and pushes them live', async () => {
    overlays.updateSettings.mockResolvedValue({ ...DEFAULT_OVERLAY_SETTINGS.CHAT, tipsOnly: true });
    await controller.updateWidget('creator-1', 'chat', { settings: { tipsOnly: true } });
    expect(overlays.updateSettings).toHaveBeenCalledWith('creator-1', 'CHAT', { tipsOnly: true });
    await controller.updateWidget('creator-1', 'TIP_MENU', { columns: 2 });
    expect(overlays.updateSettings).toHaveBeenLastCalledWith('creator-1', 'TIP_MENU', { columns: 2 });
    expect(gateway.notifySettingsUpdated).toHaveBeenCalledWith('creator-1', 'CHAT', {
      ...DEFAULT_OVERLAY_SETTINGS.CHAT,
      tipsOnly: true,
    });
  });

  it('refuses an unknown widget', async () => {
    await expect(controller.updateWidget('creator-1', 'video', {})).rejects.toThrow(BadRequestException);
    expect(overlays.updateSettings).not.toHaveBeenCalled();
  });

  it('sends test events to the creator overlays only, with the menu for a request', async () => {
    liveTips.getActiveMenu.mockResolvedValue([{ id: 'item-1' }]);
    expect(await controller.sendTest('creator-1', 'menu-request')).toEqual({
      sent: true,
      event: 'menu-request',
      overlaysConnected: true,
    });
    expect(gateway.emitTest).toHaveBeenCalledWith('creator-1', 'menu-request', [{ id: 'item-1' }]);
    await controller.sendTest('creator-1', 'chat');
    expect(gateway.emitTest).toHaveBeenLastCalledWith('creator-1', 'chat', []);
    await expect(controller.sendTest('creator-1', 'stream-ended')).rejects.toThrow(BadRequestException);
  });

  it('serves the public state by token, refusing malformed tokens', async () => {
    const token = generateOverlayToken();
    overlays.getPublicState.mockResolvedValue({ live: null });
    expect(await publicController.getState(token)).toEqual({ live: null });
    expect(() => publicController.getState('me')).toThrow(BadRequestException);
    expect(overlays.getPublicState).toHaveBeenCalledTimes(1);
  });
});
