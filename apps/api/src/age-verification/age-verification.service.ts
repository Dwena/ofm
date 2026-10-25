import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/database/prisma.service';
import {
  AGE_VERIFICATION_ATTEMPT_TTL_MS,
  AGE_VERIFICATION_EXEMPT_ROLES,
  AGE_VERIFICATION_HEADER,
  AGE_VERIFICATION_PENDING_RETENTION_MS,
  AGE_VERIFICATION_TOKEN_AUDIENCE,
  AGE_VERIFICATION_TOKEN_TYPE,
} from './age-verification.constants';
import { AgeVerificationSettings, readAgeVerificationSettings, sanitizeReturnTo } from './age-verification.config';
import { AGE_VERIFICATION_PROVIDER, AgeVerificationProvider } from './providers/age-verification-provider.interface';

export interface AgeVerificationState {
  verified: boolean;
  /** When the current verification stops being valid (ISO date), null if not verified */
  expiresAt: string | null;
  /** What makes the requester verified */
  source: 'user' | 'token' | 'staff' | null;
  method: string | null;
}

export interface AgeVerificationCallbackResult {
  verified: boolean;
  returnTo: string;
  /** Anonymous age verification token (only when verified) */
  token?: string;
  expiresAt?: string;
  reason?: string;
}

interface RequestLike {
  user?: { id?: string; role?: string } | null;
  headers?: Record<string, string | string[] | undefined>;
  [key: string]: any;
}

const REQUEST_CACHE_KEY = '__ageVerification';

const randomToken = () => randomBytes(32).toString('base64url');

/**
 * Age verification of visitors (law n° 2024-449 "SREN", Arcom référentiel).
 *
 * Double anonymity: the platform only keeps the outcome. An attempt stores
 * random state / nonce, the provider name, the logged-in user id if any and
 * the web path to return to; the outcome is stored as User.ageVerifiedAt /
 * ageVerificationMethod for logged-in users, and handed to the browser as a
 * signed token without any user identity ({ av: true, method, exp }) sent
 * back in the X-Age-Verification header. No identity data from the
 * provider is ever stored.
 */
@Injectable()
export class AgeVerificationService {
  private readonly logger = new Logger(AgeVerificationService.name);
  readonly settings: AgeVerificationSettings;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
    @Inject(AGE_VERIFICATION_PROVIDER) private readonly provider: AgeVerificationProvider,
  ) {
    this.settings = readAgeVerificationSettings(config);
  }

  get providerName() {
    return this.provider.name;
  }

  /**
   * Callback URL given to the provider (APP_URL + API prefix by default)
   */
  callbackUrl(fallbackOrigin?: string): string {
    if (this.settings.callbackUrl) return this.settings.callbackUrl;
    const origin = (this.settings.appUrl || fallbackOrigin || 'http://localhost:3001').replace(/\/$/, '');
    return `${origin}/${this.settings.apiPrefix.replace(/^\/|\/$/g, '')}/age-verification/callback`;
  }

  /**
   * Create an attempt and return the provider URL to send the browser to
   */
  async start(params: { userId?: string | null; returnTo?: string; fallbackOrigin?: string }) {
    const state = randomToken();
    const nonce = randomToken();
    const returnTo = sanitizeReturnTo(params.returnTo);
    const callbackUrl = this.callbackUrl(params.fallbackOrigin);

    let redirectUrl: string;
    try {
      ({ redirectUrl } = await this.provider.startVerification({ state, nonce, callbackUrl }));
    } catch (error) {
      this.logger.error(`Unable to start the age verification: ${(error as Error)?.message}`);
      throw new ServiceUnavailableException('AGE_VERIFICATION_UNAVAILABLE');
    }

    await this.prisma.ageVerificationAttempt.create({
      data: {
        state,
        nonce,
        provider: this.provider.name,
        userId: params.userId || null,
        returnTo,
      },
    });

    return { redirectUrl };
  }

  /**
   * Complete an attempt from the provider's callback (query or form body).
   * Never throws for a bad answer: the browser is always sent back to the web.
   */
  async complete(params: Record<string, unknown>, fallbackOrigin?: string): Promise<AgeVerificationCallbackResult> {
    const state = typeof params.state === 'string' ? params.state : '';
    const attempt = state
      ? await this.prisma.ageVerificationAttempt.findUnique({ where: { state } })
      : null;

    if (!attempt || attempt.status !== 'pending' || attempt.provider !== this.provider.name) {
      return { verified: false, returnTo: '/', reason: 'UNKNOWN_ATTEMPT' };
    }

    const returnTo = sanitizeReturnTo(attempt.returnTo);

    if (Date.now() - new Date(attempt.createdAt).getTime() > AGE_VERIFICATION_ATTEMPT_TTL_MS) {
      await this.finishAttempt(attempt.id, 'failed');
      return { verified: false, returnTo, reason: 'EXPIRED' };
    }

    let outcome: { verified: boolean; method: string; reason?: string };
    try {
      outcome = await this.provider.completeVerification(params, {
        state: attempt.state,
        nonce: attempt.nonce,
        callbackUrl: this.callbackUrl(fallbackOrigin),
      });
    } catch (error) {
      this.logger.error(`Age verification callback error: ${(error as Error)?.message}`);
      outcome = { verified: false, method: this.provider.name, reason: 'PROVIDER_ERROR' };
    }

    // Single use: a state cannot complete twice (replay)
    const finished = await this.finishAttempt(attempt.id, outcome.verified ? 'verified' : 'failed');
    if (!finished) {
      return { verified: false, returnTo, reason: 'UNKNOWN_ATTEMPT' };
    }

    if (!outcome.verified) {
      return { verified: false, returnTo, reason: outcome.reason ?? 'NOT_VERIFIED' };
    }

    const now = new Date();
    if (attempt.userId) {
      await this.prisma.user.updateMany({
        where: { id: attempt.userId },
        data: { ageVerifiedAt: now, ageVerificationMethod: outcome.method },
      });
    }

    const { token, expiresAt } = await this.issueToken(outcome.method, now);
    this.logger.log(`Age verified (${outcome.method}${attempt.userId ? ', account' : ', anonymous'})`);
    return { verified: true, returnTo, token, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Pending -> verified / failed, only once (false when already completed)
   */
  private async finishAttempt(id: string, status: 'verified' | 'failed') {
    const result = await this.prisma.ageVerificationAttempt.updateMany({
      where: { id, status: 'pending' },
      data: { status, completedAt: new Date() },
    });
    return result.count > 0;
  }

  /**
   * Signed age verification token: no user identity, only the outcome
   */
  async issueToken(method: string, verifiedAt = new Date()) {
    this.assertTokenSecret();
    const expiresAt = new Date(verifiedAt.getTime() + this.settings.tokenTtlMs);
    const token = await this.jwt.signAsync(
      { av: true, method, typ: AGE_VERIFICATION_TOKEN_TYPE },
      {
        secret: this.settings.tokenSecret,
        algorithm: 'HS256',
        audience: AGE_VERIFICATION_TOKEN_AUDIENCE,
        expiresIn: Math.floor(this.settings.tokenTtlMs / 1000),
      },
    );
    return { token, expiresAt };
  }

  /**
   * Payload of a valid age verification token, null otherwise
   */
  async verifyToken(token?: string | null): Promise<{ method: string; expiresAt: Date } | null> {
    if (!token || typeof token !== 'string' || !this.settings.tokenSecret) return null;
    try {
      const payload: any = await this.jwt.verifyAsync(token, {
        secret: this.settings.tokenSecret,
        algorithms: ['HS256'],
        audience: AGE_VERIFICATION_TOKEN_AUDIENCE,
      });
      if (payload?.av !== true || payload?.typ !== AGE_VERIFICATION_TOKEN_TYPE || typeof payload.exp !== 'number') {
        return null;
      }
      return { method: String(payload.method ?? ''), expiresAt: new Date(payload.exp * 1000) };
    } catch {
      return null;
    }
  }

  private assertTokenSecret() {
    if (!this.settings.tokenSecret) {
      throw new ServiceUnavailableException('AGE_VERIFICATION_UNAVAILABLE');
    }
  }

  /**
   * Verification state of a requester: staff, a logged-in user whose
   * ageVerifiedAt is still valid, or a valid anonymous token.
   */
  async getState(params: { userId?: string | null; role?: string | null; token?: string | null }): Promise<AgeVerificationState> {
    let best: AgeVerificationState = { verified: false, expiresAt: null, source: null, method: null };

    if (params.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: params.userId },
        select: { role: true, ageVerifiedAt: true, ageVerificationMethod: true },
      });
      const role = params.role ?? user?.role;
      if (role && AGE_VERIFICATION_EXEMPT_ROLES.includes(role)) {
        return { verified: true, expiresAt: null, source: 'staff', method: null };
      }
      if (user?.ageVerifiedAt) {
        const expiresAt = new Date(new Date(user.ageVerifiedAt).getTime() + this.settings.userTtlMs);
        if (expiresAt.getTime() > Date.now()) {
          best = {
            verified: true,
            expiresAt: expiresAt.toISOString(),
            source: 'user',
            method: user.ageVerificationMethod ?? null,
          };
        }
      }
    }

    const token = await this.verifyToken(params.token);
    if (token && (!best.expiresAt || token.expiresAt.getTime() > new Date(best.expiresAt).getTime())) {
      best = { verified: true, expiresAt: token.expiresAt.toISOString(), source: 'token', method: token.method };
    }

    return best;
  }

  /**
   * Whether the requester of an HTTP request may see explicit media (memoized per request)
   */
  async isAgeVerified(request: RequestLike): Promise<boolean> {
    if (!request) return false;
    if (typeof request[REQUEST_CACHE_KEY] === 'boolean') {
      return request[REQUEST_CACHE_KEY];
    }
    const state = await this.getState({
      userId: request.user?.id,
      role: request.user?.role,
      token: readAgeVerificationHeader(request),
    });
    request[REQUEST_CACHE_KEY] = state.verified;
    return state.verified;
  }

  /**
   * Same check outside HTTP (sockets): a user id and/or a token
   */
  async isAgeVerifiedFor(params: { userId?: string | null; token?: string | null }): Promise<boolean> {
    return (await this.getState(params)).verified;
  }

  /**
   * Abandoned attempts are not kept. Completed attempts only hold the
   * outcome (no identity data); their retention is to be set with the lawyer.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupPendingAttempts() {
    const result = await this.prisma.ageVerificationAttempt.deleteMany({
      where: {
        status: 'pending',
        createdAt: { lt: new Date(Date.now() - AGE_VERIFICATION_PENDING_RETENTION_MS) },
      },
    });
    return result.count;
  }
}

/**
 * Token from the X-Age-Verification header (absent: null)
 */
export function readAgeVerificationHeader(request: RequestLike): string | null {
  const value = request?.headers?.[AGE_VERIFICATION_HEADER];
  const token = Array.isArray(value) ? value[0] : value;
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}
