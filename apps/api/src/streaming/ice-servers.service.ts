import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceServersResponse {
  iceServers: IceServer[];
  /** Lifetime of the TURN credentials in seconds (absent without TURN) */
  ttl?: number;
}

export const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];
/** TURN credentials stay valid this long (coturn checks the expiry in the username) */
export const TURN_CREDENTIAL_TTL_SECONDS = 6 * 60 * 60;

const splitUrls = (value: string | undefined, schemes: string[]) =>
  (value ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0 && schemes.some((scheme) => url.startsWith(`${scheme}:`)));

/**
 * ICE servers handed to the live streaming clients.
 *
 * With TURN_URLS and TURN_SECRET set, short-lived TURN credentials are
 * generated with the coturn "REST API" scheme (`use-auth-secret` +
 * `static-auth-secret` in turnserver.conf): username = `<expiry unix>:<userId>`,
 * credential = base64(HMAC-SHA1(secret, username)). The secret never leaves
 * the server. STUN servers come from STUN_URLS (comma separated) or default to
 * Google's public STUN.
 */
@Injectable()
export class IceServersService {
  getIceServers(userId: string, now: Date = new Date()): IceServersResponse {
    const stunUrls = splitUrls(process.env.STUN_URLS, ['stun', 'stuns']);
    const iceServers: IceServer[] = [{ urls: stunUrls.length > 0 ? stunUrls : DEFAULT_STUN_URLS }];

    const turnUrls = splitUrls(process.env.TURN_URLS, ['turn', 'turns']);
    const secret = process.env.TURN_SECRET;
    if (turnUrls.length === 0 || !secret) {
      return { iceServers };
    }

    const ttl = TURN_CREDENTIAL_TTL_SECONDS;
    const expiry = Math.floor(now.getTime() / 1000) + ttl;
    const username = `${expiry}:${userId}`;
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    iceServers.push({ urls: turnUrls, username, credential });

    return { iceServers, ttl };
  }
}
