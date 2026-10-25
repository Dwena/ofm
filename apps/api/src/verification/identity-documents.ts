import { BadRequestException } from '@nestjs/common';

/**
 * Identity documents (KYC of creators, co-performers' IDs and releases).
 *
 * Storage: private prefix `kyc/` of the media bucket, server-side encrypted
 * (SSE AES256, see StorageService), no public ACL, `Cache-Control: private,
 * no-store`. Files are only ever read by moderators through short-lived
 * signed URLs, and every access is written to the AuditLog.
 *
 * RETENTION (to be validated by the lawyer): card-network rules require the
 * platform to keep the age / identity records and signed releases of every
 * person appearing in content (creators and co-performers). Proposal: keep
 * them for the whole life of the account + 5 years after its closure (or
 * after the last publication showing the co-performer), then delete them
 * (files and IdentityDocument rows). They must NOT be deleted when an account
 * or a co-performer is deleted (soft deletes only) nor when a KYC is
 * resubmitted: older submissions stay on file. No automatic deletion job
 * exists yet. See docs/COMPLIANCE_CONTENT.md.
 */

export const KYC_STORAGE_PREFIX = 'kyc';

/** Signed URLs given to moderators: 5 minutes */
export const IDENTITY_DOCUMENT_URL_TTL_SECONDS = 300;

/** Max size of each identity file */
export const IDENTITY_FILE_MAX_SIZE = 10 * 1024 * 1024;

export const IDENTITY_DOCUMENT_TYPES = ['ID_CARD', 'PASSPORT', 'DRIVING_LICENSE', 'RESIDENCE_PERMIT'] as const;
export type IdentityDocumentKind = (typeof IDENTITY_DOCUMENT_TYPES)[number];

/** Documents with information on both sides: the back is required */
export const TWO_SIDED_DOCUMENTS: IdentityDocumentKind[] = ['ID_CARD', 'RESIDENCE_PERMIT'];

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const PDF_TYPES = ['application/pdf'];

export const ACCEPTED_DOCUMENT_TYPES = [...IMAGE_TYPES, ...PDF_TYPES];
export const ACCEPTED_SELFIE_TYPES = IMAGE_TYPES;

export const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
};

/**
 * Real type of a file from its first bytes (the client-declared mimetype is
 * not trusted). Returns null for anything that is not an accepted format.
 */
export function detectFileType(buffer: Buffer | undefined | null): string | null {
  if (!buffer || buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buffer.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1', 'heif'].includes(brand)) return 'image/heif';
  }
  return null;
}

/**
 * Check an uploaded identity file (format from its content, size) and return
 * its real mime type.
 */
export function validateIdentityFile(
  file: Express.Multer.File | undefined,
  label: string,
  accepted: string[] = ACCEPTED_DOCUMENT_TYPES,
): string {
  if (!file || !file.buffer || file.size === 0) {
    throw new BadRequestException(`${label} : fichier manquant`);
  }

  if (file.size > IDENTITY_FILE_MAX_SIZE) {
    throw new BadRequestException(`${label} : fichier trop volumineux (10 Mo maximum)`);
  }

  const detected = detectFileType(file.buffer);
  if (!detected || !accepted.includes(detected)) {
    const formats = accepted.includes('application/pdf') ? 'JPG, PNG, WEBP, HEIC ou PDF' : 'JPG, PNG, WEBP ou HEIC';
    throw new BadRequestException(`${label} : format non accepté (${formats})`);
  }

  return detected;
}

/**
 * Parse a date of birth sent as YYYY-MM-DD (or ISO). Throws on invalid dates.
 */
export function parseDateOfBirth(value: string | Date | undefined | null): Date {
  if (!value) {
    throw new BadRequestException('La date de naissance est requise');
  }

  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) {
    throw new BadRequestException('Date de naissance invalide');
  }

  if (date.getUTCFullYear() < 1900 || date.getTime() > Date.now()) {
    throw new BadRequestException('Date de naissance invalide');
  }

  return date;
}

/**
 * At least 18 years old on `today`. Someone born on February 29 becomes adult
 * on March 1 of non-leap years (the conservative reading).
 */
export function isAdult(dateOfBirth: Date, today: Date = new Date()): boolean {
  const eighteenth = new Date(
    Date.UTC(dateOfBirth.getUTCFullYear() + 18, dateOfBirth.getUTCMonth(), dateOfBirth.getUTCDate()),
  );
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return eighteenth.getTime() <= todayUtc.getTime();
}

export function assertAdult(dateOfBirth: Date, message: string, today: Date = new Date()) {
  if (!isAdult(dateOfBirth, today)) {
    throw new BadRequestException(message);
  }
}

/** Side / role of a stored identity file, from its storage path */
export function documentSide(storagePath: string): 'front' | 'back' | 'selfie' | 'release' | null {
  const match = /\/(front|back|selfie|release)\/[^/]+$/.exec(storagePath);
  return (match?.[1] as any) ?? null;
}
