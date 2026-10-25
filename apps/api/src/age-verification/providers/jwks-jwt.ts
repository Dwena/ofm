import { constants, createPublicKey, JsonWebKey, KeyObject, verify as cryptoVerify } from 'crypto';

/**
 * Minimal verification of an asymmetrically signed JWT (OpenID Connect ID
 * token) against a JWKS, with Node's crypto only. Symmetric algorithms and
 * "none" are refused: the token must be signed by the provider's private key.
 */

type SupportedAlg = 'RS256' | 'RS384' | 'RS512' | 'PS256' | 'PS384' | 'PS512' | 'ES256' | 'ES384' | 'ES512' | 'EdDSA';

const ALGORITHMS: Record<SupportedAlg, { hash: string | null; kty: string; pssSaltLength?: number; ec?: boolean }> = {
  RS256: { hash: 'sha256', kty: 'RSA' },
  RS384: { hash: 'sha384', kty: 'RSA' },
  RS512: { hash: 'sha512', kty: 'RSA' },
  PS256: { hash: 'sha256', kty: 'RSA', pssSaltLength: 32 },
  PS384: { hash: 'sha384', kty: 'RSA', pssSaltLength: 48 },
  PS512: { hash: 'sha512', kty: 'RSA', pssSaltLength: 64 },
  ES256: { hash: 'sha256', kty: 'EC', ec: true },
  ES384: { hash: 'sha384', kty: 'EC', ec: true },
  ES512: { hash: 'sha512', kty: 'EC', ec: true },
  EdDSA: { hash: null, kty: 'OKP' },
};

export interface Jwk extends JsonWebKey {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
}

export class JwtVerificationError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

function base64UrlDecode(segment: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(segment)) {
    throw new JwtVerificationError('MALFORMED_TOKEN');
  }
  return Buffer.from(segment, 'base64url');
}

function parseJson(segment: string): Record<string, any> {
  try {
    const value = JSON.parse(base64UrlDecode(segment).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch (error) {
    if (error instanceof JwtVerificationError) throw error;
    throw new JwtVerificationError('MALFORMED_TOKEN');
  }
}

/**
 * Decode without verifying (header + payload)
 */
export function decodeJwt(token: string) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) {
    throw new JwtVerificationError('MALFORMED_TOKEN');
  }
  return {
    header: parseJson(parts[0]),
    payload: parseJson(parts[1]),
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: base64UrlDecode(parts[2]),
  };
}

function selectKey(keys: Jwk[], header: Record<string, any>, kty: string): Jwk {
  const candidates = keys.filter(
    (key) =>
      key.kty === kty &&
      (!key.use || key.use === 'sig') &&
      (!key.alg || key.alg === header.alg) &&
      (header.kid ? key.kid === header.kid : true),
  );
  if (candidates.length === 0 || (!header.kid && candidates.length > 1)) {
    throw new JwtVerificationError('SIGNING_KEY_NOT_FOUND');
  }
  return candidates[0];
}

/**
 * Verify the signature of `token` with the matching key of `keys` and return
 * its payload. Claims (iss, aud, exp, nonce...) are checked by the caller.
 */
export function verifyJwtSignature(token: string, keys: Jwk[], allowedAlgs?: string[]): Record<string, any> {
  const { header, payload, signingInput, signature } = decodeJwt(token);

  const alg = header.alg as SupportedAlg;
  const spec = ALGORITHMS[alg];
  if (!spec || (allowedAlgs && allowedAlgs.length > 0 && !allowedAlgs.includes(alg))) {
    throw new JwtVerificationError('UNSUPPORTED_ALGORITHM');
  }

  const jwk = selectKey(keys, header, spec.kty);
  let keyObject: KeyObject;
  try {
    keyObject = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
  } catch {
    throw new JwtVerificationError('INVALID_SIGNING_KEY');
  }

  const data = Buffer.from(signingInput);
  let valid = false;
  try {
    if (spec.pssSaltLength) {
      valid = cryptoVerify(
        spec.hash,
        data,
        { key: keyObject, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: spec.pssSaltLength },
        signature,
      );
    } else if (spec.ec) {
      valid = cryptoVerify(spec.hash, data, { key: keyObject, dsaEncoding: 'ieee-p1363' }, signature);
    } else {
      valid = cryptoVerify(spec.hash, data, keyObject, signature);
    }
  } catch {
    valid = false;
  }

  if (!valid) {
    throw new JwtVerificationError('INVALID_SIGNATURE');
  }
  return payload;
}
