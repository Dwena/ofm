import { generateKeyPairSync, KeyObject, sign } from 'crypto';
import { OidcAgeVerificationProvider, OidcAgeVerificationOptions } from './providers/oidc.provider';

const b64url = (value: object | Buffer) =>
  (Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))).toString('base64url');

function signJwt(payload: object, key: KeyObject, header: Record<string, any>) {
  const input = `${b64url(header)}.${b64url(payload)}`;
  const alg = header.alg;
  const signature =
    alg === 'ES256'
      ? sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
      : sign('sha256', Buffer.from(input), key);
  return `${input}.${b64url(signature)}`;
}

describe('OidcAgeVerificationProvider', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

  const jwks = {
    keys: [
      { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'rsa-1', use: 'sig', alg: 'RS256' },
      { ...ec.publicKey.export({ format: 'jwk' }), kid: 'ec-1', use: 'sig', alg: 'ES256' },
    ],
  };

  const options: OidcAgeVerificationOptions = {
    issuer: 'https://verifier.test',
    clientId: 'fanvip',
    clientSecret: 'secret',
    authorizeUrl: 'https://verifier.test/authorize',
    tokenUrl: 'https://verifier.test/token',
    jwksUrl: 'https://verifier.test/jwks',
    claim: 'age_over_18',
    scope: 'openid age',
    tokenAuthMethod: 'client_secret_basic',
    allowedAlgs: [],
  };

  const expected = { state: 'state-1', nonce: 'nonce-1', callbackUrl: 'https://api.test/api/v1/age-verification/callback' };
  const now = () => Math.floor(Date.now() / 1000);
  const claims = (overrides: Record<string, any> = {}) => ({
    iss: options.issuer,
    aud: options.clientId,
    exp: now() + 300,
    iat: now(),
    nonce: 'nonce-1',
    age_over_18: true,
    ...overrides,
  });

  let fetchMock: jest.Mock;
  let idToken: string;

  beforeEach(() => {
    idToken = signJwt(claims(), rsa.privateKey, { alg: 'RS256', kid: 'rsa-1' });
    fetchMock = jest.fn(async (url: string) => {
      if (url === options.tokenUrl) {
        return { ok: true, status: 200, json: async () => ({ id_token: idToken, access_token: 'x' }) };
      }
      if (url === options.jwksUrl) {
        return { ok: true, status: 200, json: async () => jwks };
      }
      throw new Error(`unexpected ${url}`);
    });
    (global as any).fetch = fetchMock;
  });

  const complete = (provider = new OidcAgeVerificationProvider(options), params: Record<string, unknown> = { state: 'state-1', code: 'code-1' }) =>
    provider.completeVerification(params, expected);

  it('builds the authorization request with state and nonce', async () => {
    const { redirectUrl } = await new OidcAgeVerificationProvider(options).startVerification({
      state: 'state-1',
      nonce: 'nonce-1',
      callbackUrl: expected.callbackUrl,
    });
    const url = new URL(redirectUrl);
    expect(url.origin + url.pathname).toBe(options.authorizeUrl);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'fanvip',
      redirect_uri: expected.callbackUrl,
      scope: 'openid age',
      state: 'state-1',
      nonce: 'nonce-1',
    });
  });

  it('verifies an RS256 ID token with the age claim', async () => {
    const result = await complete();
    expect(result).toEqual({ verified: true, method: 'oidc:verifier.test' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('fanvip:secret').toString('base64')}`);
    expect(init.body).toContain('grant_type=authorization_code');
    expect(init.body).toContain('code=code-1');
  });

  it('verifies an ES256 ID token', async () => {
    idToken = signJwt(claims(), ec.privateKey, { alg: 'ES256', kid: 'ec-1' });
    expect((await complete()).verified).toBe(true);
  });

  it.each([
    ['claim false', () => signJwt(claims({ age_over_18: false }), rsa.privateKey, { alg: 'RS256', kid: 'rsa-1' }), 'UNDERAGE'],
    ['claim as string', () => signJwt(claims({ age_over_18: 'true' }), rsa.privateKey, { alg: 'RS256', kid: 'rsa-1' }), 'UNDERAGE'],
    ['wrong issuer', () => signJwt(claims({ iss: 'https://evil.test' }), rsa.privateKey, { alg: 'RS256', kid: 'rsa-1' }), 'INVALID_ISSUER'],
    ['wrong audience', () => signJwt(claims({ aud: 'other' }), rsa.privateKey, { alg: 'RS256', kid: 'rsa-1' }), 'INVALID_AUDIENCE'],
    ['expired', () => signJwt(claims({ exp: now() - 600 }), rsa.privateKey, { alg: 'RS256', kid: 'rsa-1' }), 'TOKEN_EXPIRED'],
    ['wrong nonce', () => signJwt(claims({ nonce: 'other' }), rsa.privateKey, { alg: 'RS256', kid: 'rsa-1' }), 'NONCE_MISMATCH'],
    ['signed by another key', () => signJwt(claims(), other.privateKey, { alg: 'RS256', kid: 'rsa-1' }), 'INVALID_SIGNATURE'],
    ['unknown key', () => signJwt(claims(), other.privateKey, { alg: 'RS256', kid: 'nope' }), 'SIGNING_KEY_NOT_FOUND'],
    ['alg none', () => `${b64url({ alg: 'none' })}.${b64url(claims())}.`, 'UNSUPPORTED_ALGORITHM'],
    ['HS256', () => `${b64url({ alg: 'HS256', kid: 'rsa-1' })}.${b64url(claims())}.c2ln`, 'UNSUPPORTED_ALGORITHM'],
  ])('refuses: %s', async (_label, makeToken, reason) => {
    idToken = makeToken();
    expect(await complete()).toMatchObject({ verified: false, reason });
  });

  it('refuses a state mismatch or a provider error without calling the token endpoint', async () => {
    expect(await complete(undefined, { state: 'other', code: 'c' })).toMatchObject({ verified: false, reason: 'STATE_MISMATCH' });
    expect(await complete(undefined, { state: 'state-1', error: 'access_denied' })).toMatchObject({
      verified: false,
      reason: 'PROVIDER_REFUSED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('handles token endpoint failures', async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 400, json: async () => ({}) }));
    expect(await complete()).toMatchObject({ verified: false, reason: 'PROVIDER_ERROR' });
  });

  it('is not configured without its endpoints', async () => {
    const provider = new OidcAgeVerificationProvider({ ...options, tokenUrl: '' });
    expect(provider.configured).toBe(false);
    await expect(
      provider.startVerification({ state: 's', nonce: 'n', callbackUrl: expected.callbackUrl }),
    ).rejects.toThrow('not configured');
  });
});
