import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AgeVerificationService } from './age-verification.service';
import { DevAgeVerificationProvider } from './providers/dev.provider';
import { AgeVerificationProvider } from './providers/age-verification-provider.interface';
import { sanitizeReturnTo } from './age-verification.config';
import { createAgeVerificationProvider } from './age-verification.module';
import { OidcAgeVerificationProvider } from './providers/oidc.provider';

const config = (values: Record<string, string | undefined>) =>
  ({ get: (key: string, fallback?: any) => values[key] ?? fallback }) as unknown as ConfigService;

describe('AgeVerificationService', () => {
  const env = {
    NODE_ENV: 'development',
    JWT_SECRET: 'jwt-secret-for-tests',
    WEB_URL: 'http://web.test',
    APP_URL: 'http://api.test',
  };

  let prisma: any;
  let provider: AgeVerificationProvider;
  let service: AgeVerificationService;
  const jwt = new JwtService({});

  const pendingAttempt = (overrides: Record<string, any> = {}) => ({
    id: 'attempt-1',
    state: 'state-1',
    nonce: 'nonce-1',
    provider: 'dev',
    userId: null,
    returnTo: '/creator/alice',
    status: 'pending',
    createdAt: new Date(),
    completedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      ageVerificationAttempt: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    provider = new DevAgeVerificationProvider('http://web.test', false);
    service = new AgeVerificationService(prisma, jwt, config(env), provider);
  });

  describe('start', () => {
    it('creates a pending attempt and returns the provider URL', async () => {
      const result = await service.start({ userId: 'user-1', returnTo: '/feed' });

      expect(result.redirectUrl).toMatch(/^http:\/\/web\.test\/verification-age\/dev\?state=.+&nonce=.+/);
      const data = prisma.ageVerificationAttempt.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ provider: 'dev', userId: 'user-1', returnTo: '/feed' });
      expect(data.state).toHaveLength(43);
      expect(data.nonce).not.toEqual(data.state);
    });

    it('refuses absolute / protocol-relative return paths', async () => {
      await service.start({ returnTo: 'https://evil.example/x' });
      await service.start({ returnTo: '//evil.example/x' });
      const calls = prisma.ageVerificationAttempt.create.mock.calls;
      expect(calls[0][0].data.returnTo).toBe('/');
      expect(calls[1][0].data.returnTo).toBe('/');
    });

    it('builds the callback URL from APP_URL and the API prefix', () => {
      expect(service.callbackUrl()).toBe('http://api.test/api/v1/age-verification/callback');
    });
  });

  describe('complete', () => {
    it('verifies an anonymous visitor and issues a token without identity', async () => {
      prisma.ageVerificationAttempt.findUnique.mockResolvedValue(pendingAttempt());

      const result = await service.complete({ state: 'state-1', nonce: 'nonce-1', result: 'adult' });

      expect(result.verified).toBe(true);
      expect(result.returnTo).toBe('/creator/alice');
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.ageVerificationAttempt.updateMany).toHaveBeenCalledWith({
        where: { id: 'attempt-1', status: 'pending' },
        data: expect.objectContaining({ status: 'verified' }),
      });

      const payload: any = jwt.decode(result.token!);
      expect(payload).toMatchObject({ av: true, method: 'dev-simulator', typ: 'age-verification' });
      expect(payload.sub).toBeUndefined();
      expect(payload.exp - payload.iat).toBe(60 * 60);
    });

    it('stores the outcome on a logged-in user (no identity data)', async () => {
      prisma.ageVerificationAttempt.findUnique.mockResolvedValue(pendingAttempt({ userId: 'user-1' }));

      await service.complete({ state: 'state-1', nonce: 'nonce-1', result: 'adult' });

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { ageVerifiedAt: expect.any(Date), ageVerificationMethod: 'dev-simulator' },
      });
    });

    it('fails for a minor', async () => {
      prisma.ageVerificationAttempt.findUnique.mockResolvedValue(pendingAttempt({ userId: 'user-1' }));

      const result = await service.complete({ state: 'state-1', nonce: 'nonce-1', result: 'minor' });

      expect(result).toMatchObject({ verified: false, reason: 'UNDERAGE' });
      expect(result.token).toBeUndefined();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.ageVerificationAttempt.updateMany.mock.calls[0][0].data.status).toBe('failed');
    });

    it('fails with a wrong nonce', async () => {
      prisma.ageVerificationAttempt.findUnique.mockResolvedValue(pendingAttempt());
      const result = await service.complete({ state: 'state-1', nonce: 'other', result: 'adult' });
      expect(result.verified).toBe(false);
    });

    it('refuses unknown, already completed or expired attempts', async () => {
      prisma.ageVerificationAttempt.findUnique.mockResolvedValueOnce(null);
      expect((await service.complete({ state: 'nope' })).reason).toBe('UNKNOWN_ATTEMPT');

      prisma.ageVerificationAttempt.findUnique.mockResolvedValueOnce(pendingAttempt({ status: 'verified' }));
      expect((await service.complete({ state: 'state-1', nonce: 'nonce-1', result: 'adult' })).verified).toBe(false);

      prisma.ageVerificationAttempt.findUnique.mockResolvedValueOnce(
        pendingAttempt({ createdAt: new Date(Date.now() - 60 * 60 * 1000) }),
      );
      expect((await service.complete({ state: 'state-1', nonce: 'nonce-1', result: 'adult' })).reason).toBe('EXPIRED');
    });

    it('cannot be replayed concurrently (single use state)', async () => {
      prisma.ageVerificationAttempt.findUnique.mockResolvedValue(pendingAttempt());
      prisma.ageVerificationAttempt.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.complete({ state: 'state-1', nonce: 'nonce-1', result: 'adult' });

      expect(result.verified).toBe(false);
      expect(result.token).toBeUndefined();
    });
  });

  describe('getState / isAgeVerified', () => {
    it('accepts a valid token sent in X-Age-Verification', async () => {
      const { token } = await service.issueToken('dev-simulator');
      const request: any = { headers: { 'x-age-verification': token } };

      expect(await service.isAgeVerified(request)).toBe(true);
      const state = await service.getState({ token });
      expect(state).toMatchObject({ verified: true, source: 'token', method: 'dev-simulator' });
    });

    it('refuses forged, expired or non age-verification tokens', async () => {
      const forged = await jwt.signAsync({ av: true, typ: 'age-verification' }, { secret: 'other', audience: 'fanvip:age-verification' });
      const expired = await jwt.signAsync(
        { av: true, typ: 'age-verification', exp: Math.floor(Date.now() / 1000) - 10 },
        { secret: env.JWT_SECRET, audience: 'fanvip:age-verification' },
      );
      const authToken = await jwt.signAsync({ sub: 'user-1' }, { secret: env.JWT_SECRET });

      for (const token of [forged, expired, authToken, 'garbage']) {
        expect(await service.isAgeVerified({ headers: { 'x-age-verification': token } })).toBe(false);
      }
    });

    it('accepts a logged-in user verified within AGE_VERIFICATION_USER_TTL_DAYS', async () => {
      prisma.user.findUnique.mockResolvedValue({
        role: 'SUBSCRIBER',
        ageVerifiedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
        ageVerificationMethod: 'oidc:verifier.test',
      });
      expect(await service.isAgeVerified({ user: { id: 'user-1', role: 'SUBSCRIBER' }, headers: {} })).toBe(true);
    });

    it('refuses a user whose verification is too old', async () => {
      prisma.user.findUnique.mockResolvedValue({
        role: 'SUBSCRIBER',
        ageVerifiedAt: new Date(Date.now() - 31 * 24 * 3600 * 1000),
      });
      expect(await service.isAgeVerified({ user: { id: 'user-1', role: 'SUBSCRIBER' }, headers: {} })).toBe(false);
    });

    it('honours AGE_VERIFICATION_USER_TTL_DAYS and AGE_VERIFICATION_TTL_MINUTES', async () => {
      const custom = new AgeVerificationService(
        prisma,
        jwt,
        config({ ...env, AGE_VERIFICATION_USER_TTL_DAYS: '1', AGE_VERIFICATION_TTL_MINUTES: '5' }),
        provider,
      );
      prisma.user.findUnique.mockResolvedValue({ role: 'SUBSCRIBER', ageVerifiedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) });
      expect(await custom.isAgeVerifiedFor({ userId: 'user-1' })).toBe(false);

      const { token } = await custom.issueToken('dev');
      const payload: any = jwt.decode(token);
      expect(payload.exp - payload.iat).toBe(5 * 60);
    });

    it('never gates admins and moderators', async () => {
      expect(await service.isAgeVerified({ user: { id: 'admin-1', role: 'ADMIN' }, headers: {} })).toBe(true);
      expect(await service.isAgeVerified({ user: { id: 'mod-1', role: 'MODERATOR' }, headers: {} })).toBe(true);
    });

    it('refuses anonymous visitors without token and memoizes per request', async () => {
      expect(await service.isAgeVerified({ headers: {} })).toBe(false);

      const userRequest: any = { user: { id: 'u' }, headers: {} };
      expect(await service.isAgeVerified(userRequest)).toBe(false);
      expect(await service.isAgeVerified(userRequest)).toBe(false);
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  it('deletes abandoned pending attempts', async () => {
    expect(await service.cleanupPendingAttempts()).toBe(2);
    expect(prisma.ageVerificationAttempt.deleteMany).toHaveBeenCalledWith({
      where: { status: 'pending', createdAt: { lt: expect.any(Date) } },
    });
  });
});

describe('DevAgeVerificationProvider', () => {
  it('refuses to run in production', async () => {
    const provider = new DevAgeVerificationProvider('http://web.test', true);
    await expect(provider.startVerification({ state: 's', nonce: 'n', callbackUrl: 'x' })).rejects.toThrow();
    await expect(provider.completeVerification({ state: 's', nonce: 'n', result: 'adult' }, { state: 's', nonce: 'n' })).rejects.toThrow();
  });

  it('a production start with the dev provider is refused with 503', async () => {
    const prisma: any = { ageVerificationAttempt: { create: jest.fn() } };
    const service = new AgeVerificationService(
      prisma,
      new JwtService({}),
      config({ NODE_ENV: 'production', JWT_SECRET: 's' }),
      new DevAgeVerificationProvider('http://web.test', true),
    );
    await expect(service.start({})).rejects.toThrow('AGE_VERIFICATION_UNAVAILABLE');
    expect(prisma.ageVerificationAttempt.create).not.toHaveBeenCalled();
  });
});

describe('createAgeVerificationProvider', () => {
  it('uses the dev simulator by default outside production, oidc in production', () => {
    expect(createAgeVerificationProvider(config({ NODE_ENV: 'development' })).name).toBe('dev');
    expect(createAgeVerificationProvider(config({ NODE_ENV: 'production' }))).toBeInstanceOf(OidcAgeVerificationProvider);
    expect(createAgeVerificationProvider(config({ NODE_ENV: 'development', AGE_VERIFICATION_PROVIDER: 'oidc' })).name).toBe('oidc');
  });
});

describe('sanitizeReturnTo', () => {
  it.each([
    ['/creator/alice?tab=media', '/creator/alice?tab=media'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['/verification-age/retour', '/'],
    [undefined, '/'],
  ])('%s -> %s', (input, expected) => {
    expect(sanitizeReturnTo(input)).toBe(expected);
  });
});
