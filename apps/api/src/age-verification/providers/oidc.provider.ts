import { Logger } from '@nestjs/common';
import {
  AgeVerificationProvider,
  CompleteVerificationResult,
  StartVerificationParams,
} from './age-verification-provider.interface';
import { Jwk, JwtVerificationError, verifyJwtSignature } from './jwks-jwt';

export interface OidcAgeVerificationOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  /** Boolean claim of the ID token stating the visitor is 18 or older */
  claim: string;
  scope: string;
  /** How the client authenticates on the token endpoint */
  tokenAuthMethod: 'client_secret_basic' | 'client_secret_post';
  /** Accepted signature algorithms (empty: every asymmetric one) */
  allowedAlgs: string[];
}

const CLOCK_SKEW_SECONDS = 60;
const JWKS_CACHE_MS = 10 * 60 * 1000;
const HTTP_TIMEOUT_MS = 10_000;

/**
 * Generic OpenID Connect-like age verification provider: authorization code
 * flow with state + nonce, code exchanged server-side, ID token signature
 * checked against the provider's JWKS, then iss / aud / exp / nonce and the
 * age claim (AGE_VERIFICATION_CLAIM, `age_over_18` by default) === true.
 *
 * LEGAL / INTEGRATION: the provider must be a third party complying with the
 * Arcom référentiel (certified / audited solution, double anonymity: it must
 * not send any identity data, only the age outcome). Its exact protocol
 * (endpoints, claim name, token endpoint authentication, PKCE, signed
 * request objects...) must be checked against its documentation when signing
 * the contract; adapt this class or add a dedicated provider if it differs.
 * Nothing but the boolean outcome is kept from its answer: never log or
 * store the tokens or other claims.
 */
export class OidcAgeVerificationProvider implements AgeVerificationProvider {
  readonly name = 'oidc';
  private readonly logger = new Logger(OidcAgeVerificationProvider.name);
  private jwksCache?: { keys: Jwk[]; fetchedAt: number };

  constructor(private readonly options: OidcAgeVerificationOptions) {}

  /** Every endpoint and credential is configured */
  get configured(): boolean {
    const { issuer, clientId, clientSecret, authorizeUrl, tokenUrl, jwksUrl } = this.options;
    return [issuer, clientId, clientSecret, authorizeUrl, tokenUrl, jwksUrl].every(
      (value) => typeof value === 'string' && value.length > 0,
    );
  }

  get method(): string {
    try {
      return `oidc:${new URL(this.options.issuer).host}`;
    } catch {
      return 'oidc';
    }
  }

  private assertConfigured() {
    if (!this.configured) {
      throw new Error(
        'OIDC age verification is not configured (AGE_VERIFICATION_ISSUER, _CLIENT_ID, _CLIENT_SECRET, _AUTHORIZE_URL, _TOKEN_URL, _JWKS_URL)',
      );
    }
  }

  async startVerification({ state, nonce, callbackUrl }: StartVerificationParams) {
    this.assertConfigured();
    const url = new URL(this.options.authorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('scope', this.options.scope);
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    return { redirectUrl: url.toString() };
  }

  async completeVerification(
    params: Record<string, unknown>,
    expected: { state: string; nonce: string; callbackUrl: string },
  ): Promise<CompleteVerificationResult> {
    this.assertConfigured();
    const method = this.method;

    if (params.state !== expected.state) {
      return { verified: false, method, reason: 'STATE_MISMATCH' };
    }
    if (typeof params.error === 'string' && params.error) {
      // The visitor cancelled or the provider refused (e.g. under 18)
      return { verified: false, method, reason: 'PROVIDER_REFUSED' };
    }
    if (typeof params.code !== 'string' || !params.code) {
      return { verified: false, method, reason: 'MISSING_CODE' };
    }

    try {
      const idToken = await this.exchangeCode(params.code, expected.callbackUrl);
      const claims = await this.verifyIdToken(idToken, expected.nonce);
      if (claims[this.options.claim] !== true) {
        return { verified: false, method, reason: 'UNDERAGE' };
      }
      return { verified: true, method };
    } catch (error) {
      const reason = error instanceof JwtVerificationError ? error.code : 'PROVIDER_ERROR';
      // Only the error code: never the token or its claims
      this.logger.warn(`Age verification failed: ${reason}${error instanceof JwtVerificationError ? '' : ` (${(error as Error)?.message})`}`);
      return { verified: false, method, reason };
    }
  }

  private async exchangeCode(code: string, redirectUri: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };

    if (this.options.tokenAuthMethod === 'client_secret_post') {
      body.set('client_id', this.options.clientId);
      body.set('client_secret', this.options.clientSecret);
    } else {
      const credentials = `${encodeURIComponent(this.options.clientId)}:${encodeURIComponent(this.options.clientSecret)}`;
      headers.Authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
    }

    const response = await fetch(this.options.tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`token endpoint answered ${response.status}`);
    }
    const json: any = await response.json();
    if (typeof json?.id_token !== 'string') {
      throw new JwtVerificationError('MISSING_ID_TOKEN');
    }
    return json.id_token;
  }

  private async getKeys(forceRefresh = false): Promise<Jwk[]> {
    if (!forceRefresh && this.jwksCache && Date.now() - this.jwksCache.fetchedAt < JWKS_CACHE_MS) {
      return this.jwksCache.keys;
    }
    const response = await fetch(this.options.jwksUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`JWKS endpoint answered ${response.status}`);
    }
    const json: any = await response.json();
    const keys: Jwk[] = Array.isArray(json?.keys) ? json.keys : [];
    this.jwksCache = { keys, fetchedAt: Date.now() };
    return keys;
  }

  /**
   * Signature (JWKS, refreshed once on an unknown key: key rotation) and claims
   */
  async verifyIdToken(idToken: string, expectedNonce: string): Promise<Record<string, any>> {
    let claims: Record<string, any>;
    try {
      claims = verifyJwtSignature(idToken, await this.getKeys(), this.options.allowedAlgs);
    } catch (error) {
      if (error instanceof JwtVerificationError && error.code === 'SIGNING_KEY_NOT_FOUND') {
        claims = verifyJwtSignature(idToken, await this.getKeys(true), this.options.allowedAlgs);
      } else {
        throw error;
      }
    }

    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== this.options.issuer) {
      throw new JwtVerificationError('INVALID_ISSUER');
    }
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(this.options.clientId)) {
      throw new JwtVerificationError('INVALID_AUDIENCE');
    }
    if (audiences.length > 1 && claims.azp !== undefined && claims.azp !== this.options.clientId) {
      throw new JwtVerificationError('INVALID_AUDIENCE');
    }
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < now) {
      throw new JwtVerificationError('TOKEN_EXPIRED');
    }
    if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > now) {
      throw new JwtVerificationError('TOKEN_NOT_YET_VALID');
    }
    if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > now) {
      throw new JwtVerificationError('TOKEN_NOT_YET_VALID');
    }
    if (claims.nonce !== expectedNonce) {
      throw new JwtVerificationError('NONCE_MISMATCH');
    }
    return claims;
  }
}

export function readOidcOptions(get: (key: string) => string | undefined): OidcAgeVerificationOptions {
  const env = (key: string) => (get(key) || '').trim();
  return {
    issuer: env('AGE_VERIFICATION_ISSUER'),
    clientId: env('AGE_VERIFICATION_CLIENT_ID'),
    clientSecret: env('AGE_VERIFICATION_CLIENT_SECRET'),
    authorizeUrl: env('AGE_VERIFICATION_AUTHORIZE_URL'),
    tokenUrl: env('AGE_VERIFICATION_TOKEN_URL'),
    jwksUrl: env('AGE_VERIFICATION_JWKS_URL'),
    claim: env('AGE_VERIFICATION_CLAIM') || 'age_over_18',
    scope: env('AGE_VERIFICATION_SCOPE') || 'openid',
    tokenAuthMethod:
      env('AGE_VERIFICATION_TOKEN_AUTH_METHOD') === 'client_secret_post' ? 'client_secret_post' : 'client_secret_basic',
    allowedAlgs: env('AGE_VERIFICATION_ALLOWED_ALGS')
      .split(',')
      .map((alg) => alg.trim())
      .filter(Boolean),
  };
}
