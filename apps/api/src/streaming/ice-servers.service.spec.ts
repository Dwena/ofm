import { createHmac } from 'crypto';
import { DEFAULT_STUN_URLS, IceServersService, TURN_CREDENTIAL_TTL_SECONDS } from './ice-servers.service';

describe('IceServersService', () => {
  const service = new IceServersService();
  const env = { ...process.env };
  const now = new Date('2026-10-20T10:00:00Z');

  beforeEach(() => {
    delete process.env.TURN_URLS;
    delete process.env.TURN_SECRET;
    delete process.env.STUN_URLS;
  });

  afterAll(() => {
    process.env = env;
  });

  it('returns the default STUN servers without configuration', () => {
    expect(service.getIceServers('user-1', now)).toEqual({ iceServers: [{ urls: DEFAULT_STUN_URLS }] });
  });

  it('uses STUN_URLS when set and ignores invalid entries', () => {
    process.env.STUN_URLS = 'stun:stun.example.com:3478, ,https://nope, stuns:stun.example.com:5349';
    expect(service.getIceServers('user-1', now).iceServers).toEqual([
      { urls: ['stun:stun.example.com:3478', 'stuns:stun.example.com:5349'] },
    ]);
  });

  it('does not expose TURN without a secret', () => {
    process.env.TURN_URLS = 'turn:turn.example.com:3478';
    const result = service.getIceServers('user-1', now);
    expect(result.iceServers).toHaveLength(1);
    expect(result.ttl).toBeUndefined();
  });

  it('generates coturn REST API credentials', () => {
    process.env.TURN_URLS = 'turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349';
    process.env.TURN_SECRET = 'top-secret';

    const result = service.getIceServers('user-1', now);
    const expiry = Math.floor(now.getTime() / 1000) + TURN_CREDENTIAL_TTL_SECONDS;
    const username = `${expiry}:user-1`;

    expect(result.ttl).toBe(TURN_CREDENTIAL_TTL_SECONDS);
    expect(result.iceServers[0]).toEqual({ urls: DEFAULT_STUN_URLS });
    expect(result.iceServers[1]).toEqual({
      urls: ['turn:turn.example.com:3478?transport=udp', 'turns:turn.example.com:5349'],
      username,
      credential: createHmac('sha1', 'top-secret').update(username).digest('base64'),
    });
    expect(JSON.stringify(result)).not.toContain('top-secret');
  });
});
