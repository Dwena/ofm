import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LiveTipsService } from '../streaming/live-tips.service';
import { parseOverlayWidget } from './overlay-settings';
import { OVERLAY_TEST_EVENTS, OverlaysGateway, OverlayTestEvent, TOKEN_ROTATED } from './overlays.gateway';
import { isOverlayTokenFormat, OverlaysService } from './overlays.service';

/**
 * OBS overlay widgets of the logged-in creator ("Widgets OBS")
 */
@Controller('overlays/me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CREATOR')
export class OverlaysController {
  constructor(
    private readonly overlays: OverlaysService,
    private readonly gateway: OverlaysGateway,
    private readonly liveTips: LiveTipsService,
  ) {}

  /**
   * Overlay URLs (token-based) and settings of every widget
   */
  @Get()
  getOwnOverlays(@CurrentUser('id') userId: string) {
    return this.overlays.getOwnOverlays(userId);
  }

  /**
   * New overlay URLs: the old ones stop working and the overlays still open
   * with them are disconnected
   */
  @Post('rotate-token')
  @HttpCode(200)
  async rotateToken(@CurrentUser('id') userId: string) {
    const token = await this.overlays.rotateToken(userId);
    this.gateway.disconnectCreator(userId, TOKEN_ROTATED);
    return this.overlays.toOwnOverlays(token, await this.overlays.getSettings(userId));
  }

  /**
   * Save the settings of one widget (partial update, validated per widget);
   * the open overlays apply them right away
   */
  @Put('widgets/:widget')
  async updateWidget(
    @CurrentUser('id') userId: string,
    @Param('widget') widgetParam: string,
    // Free-form JSON (validated by validateWidgetSettings, not by a DTO)
    @Body() body: Record<string, unknown>,
  ) {
    const widget = parseOverlayWidget(widgetParam);
    if (!widget) {
      throw new BadRequestException('Unknown overlay widget');
    }
    const input = body && typeof body === 'object' && 'settings' in body ? body.settings : body;
    const settings = await this.overlays.updateSettings(userId, widget, input);
    this.gateway.notifySettingsUpdated(userId, widget, settings);
    return { widget, settings };
  }

  /**
   * Fake event shown only by the creator's overlays (alert, menu request,
   * milestone reached, chat message), never sent to viewers
   */
  @Post('test/:event')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async sendTest(@CurrentUser('id') userId: string, @Param('event') event: string) {
    if (!(OVERLAY_TEST_EVENTS as readonly string[]).includes(event)) {
      throw new BadRequestException(`Test event must be one of: ${OVERLAY_TEST_EVENTS.join(', ')}`);
    }
    const menu = event === 'menu-request' ? await this.liveTips.getActiveMenu(userId) : [];
    this.gateway.emitTest(userId, event as OverlayTestEvent, menu);
    return { sent: true, event, overlaysConnected: this.gateway.hasOverlays(userId) };
  }
}

/**
 * Public, read-only state of an overlay (OBS browser sources have no session:
 * the secret token in the URL is the only credential)
 */
@Controller('overlays')
export class OverlayPublicController {
  constructor(private readonly overlays: OverlaysService) {}

  @Get(':token/state')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  getState(@Param('token') token: string) {
    if (!isOverlayTokenFormat(token)) {
      throw new BadRequestException('Invalid overlay token');
    }
    return this.overlays.getPublicState(token);
  }
}
