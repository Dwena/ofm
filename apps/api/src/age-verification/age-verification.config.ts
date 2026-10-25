import { ConfigService } from '@nestjs/config';
import { AgeVerificationProviderName } from './age-verification.constants';

/**
 * Validity of a verification.
 *
 * LEGAL: the defaults below (60 minutes for an anonymous visitor's token,
 * 30 days for a logged-in account) are placeholders to be confirmed. The
 * lawyer must re-check the Arcom référentiel for the exact re-verification
 * frequency required (it may require a new verification per session or a
 * shorter validity) and these env values must be set accordingly.
 */
export const DEFAULT_AGE_VERIFICATION_TTL_MINUTES = 60;
export const DEFAULT_AGE_VERIFICATION_USER_TTL_DAYS = 30;

export interface AgeVerificationSettings {
  provider: AgeVerificationProviderName;
  isProduction: boolean;
  /** Validity of the anonymous token, in milliseconds */
  tokenTtlMs: number;
  /** Validity of User.ageVerifiedAt, in milliseconds */
  userTtlMs: number;
  tokenSecret: string;
  /** Web app base URL (redirect after the callback) */
  webUrl: string;
  /** Explicit callback URL (otherwise APP_URL + API_PREFIX + /age-verification/callback) */
  callbackUrl?: string;
  appUrl?: string;
  apiPrefix: string;
}

const positiveNumber = (value: unknown, fallback: number) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
};

export function readAgeVerificationSettings(config: ConfigService): AgeVerificationSettings {
  const isProduction = config.get<string>('NODE_ENV') === 'production';
  const configured = (config.get<string>('AGE_VERIFICATION_PROVIDER') || '').trim().toLowerCase();
  // dev simulator by default outside production; production needs a real provider
  const provider = (configured || (isProduction ? 'oidc' : 'dev')) as AgeVerificationProviderName;

  return {
    provider,
    isProduction,
    tokenTtlMs:
      positiveNumber(config.get('AGE_VERIFICATION_TTL_MINUTES'), DEFAULT_AGE_VERIFICATION_TTL_MINUTES) * 60 * 1000,
    userTtlMs:
      positiveNumber(config.get('AGE_VERIFICATION_USER_TTL_DAYS'), DEFAULT_AGE_VERIFICATION_USER_TTL_DAYS) *
      24 * 60 * 60 * 1000,
    tokenSecret:
      config.get<string>('AGE_VERIFICATION_TOKEN_SECRET') || config.get<string>('JWT_SECRET') || '',
    webUrl: (config.get<string>('WEB_URL') || config.get<string>('FRONTEND_URL') || 'http://localhost:3000').replace(
      /\/$/,
      '',
    ),
    callbackUrl: config.get<string>('AGE_VERIFICATION_CALLBACK_URL') || undefined,
    appUrl: config.get<string>('APP_URL') || undefined,
    apiPrefix: config.get<string>('API_PREFIX', 'api/v1'),
  };
}

/**
 * A relative path of the web app (open redirects are refused): "/x/y?z=1"
 */
export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  const trimmed = value.trim();
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    trimmed.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    return '/';
  }
  // Never loop back to the verification pages themselves
  if (/^\/verification-age(\/|\?|#|$)/.test(trimmed)) return '/';
  return trimmed;
}
