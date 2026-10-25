import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Encryption of sensitive values at rest (IBAN of creators...), AES-256-GCM.
 *
 * The key comes from DATA_ENCRYPTION_KEY (any long random string, e.g.
 * `openssl rand -base64 32`), hashed to 32 bytes. Losing or changing it makes
 * the stored values unreadable: keep it in the secret manager with backups.
 *
 * Format: v1:<iv base64>:<auth tag base64>:<ciphertext base64>
 */

const VERSION = 'v1';

function getKey(): Buffer {
  const secret = process.env.DATA_ENCRYPTION_KEY;
  if (!secret || secret.length < 16) {
    throw new Error('DATA_ENCRYPTION_KEY is not configured (at least 16 characters)');
  }
  return createHash('sha256').update(secret).digest();
}

export function encryptValue(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptValue(payload: string): string {
  const [version, iv, tag, data] = payload.split(':');
  if (version !== VERSION || !iv || !tag || !data) {
    throw new Error('Unsupported encrypted value');
  }
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
