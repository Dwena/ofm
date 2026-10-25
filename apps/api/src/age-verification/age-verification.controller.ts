import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { AgeVerificationCallbackResult, AgeVerificationService, readAgeVerificationHeader } from './age-verification.service';
import { StartAgeVerificationDto } from './dto/start-age-verification.dto';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';

/**
 * Visitor age verification (law n° 2024-449 "SREN", Arcom référentiel).
 *
 * 1. POST /age-verification/start -> { redirectUrl } (the browser goes to the provider)
 * 2. The provider sends the browser to GET|POST /age-verification/callback,
 *    which redirects to the web page /verification-age/retour with the
 *    outcome in the URL fragment (never sent to a server): status, the
 *    anonymous age token when verified, and the path to return to.
 * 3. The web stores the token and sends it in the X-Age-Verification header;
 *    GET /age-verification/status tells whether the requester is verified.
 */
@Controller('age-verification')
@Public()
export class AgeVerificationController {
  constructor(private readonly ageVerification: AgeVerificationService) {}

  @Post('start')
  @HttpCode(200)
  @UseGuards(OptionalJwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  start(@Req() req: Request, @Body() dto: StartAgeVerificationDto) {
    const user = (req as any).user as { id?: string } | null;
    return this.ageVerification.start({
      userId: user?.id ?? null,
      returnTo: dto?.returnTo,
      fallbackOrigin: this.requestOrigin(req),
    });
  }

  /**
   * Return from the provider: query string (GET) or form_post body (POST)
   */
  @Get('callback')
  async callbackGet(@Req() req: Request, @Query() query: Record<string, unknown>, @Res() res: Response) {
    const result = await this.ageVerification.complete(query ?? {}, this.requestOrigin(req));
    this.redirectToWeb(res, result);
  }

  @Post('callback')
  async callbackPost(@Req() req: Request, @Body() body: Record<string, unknown>, @Res() res: Response) {
    const result = await this.ageVerification.complete(body ?? {}, this.requestOrigin(req));
    this.redirectToWeb(res, result);
  }

  @Get('status')
  @UseGuards(OptionalJwtAuthGuard)
  async status(@Req() req: Request) {
    const user = (req as any).user as { id?: string; role?: string } | null;
    const state = await this.ageVerification.getState({
      userId: user?.id,
      role: user?.role,
      token: readAgeVerificationHeader(req as any),
    });
    return {
      verified: state.verified,
      expiresAt: state.expiresAt,
      source: state.source,
      provider: this.ageVerification.providerName,
    };
  }

  private requestOrigin(req: Request) {
    return `${req.protocol}://${req.get('host')}`;
  }

  private redirectToWeb(res: Response, result: AgeVerificationCallbackResult) {
    const fragment = new URLSearchParams({
      status: result.verified ? 'verified' : 'failed',
      returnTo: result.returnTo,
      ...(result.token ? { token: result.token } : {}),
      ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
      ...(result.reason ? { reason: result.reason } : {}),
    });
    // The token travels in the fragment: it is never sent to a server nor logged
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.redirect(303, `${this.ageVerification.settings.webUrl}/verification-age/retour#${fragment.toString()}`);
  }
}
