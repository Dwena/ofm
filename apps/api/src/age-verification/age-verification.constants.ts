/**
 * Age verification of visitors before any pornographic media is shown
 * (French law n° 2024-449 of 21 May 2024 "SREN", Arcom "référentiel
 * technique" on age verification).
 */

/** Error code (403 message / socket ack reason) when media needs a verified age */
export const AGE_VERIFICATION_REQUIRED = 'AGE_VERIFICATION_REQUIRED';

/** Request header carrying the anonymous age verification token */
export const AGE_VERIFICATION_HEADER = 'x-age-verification';

/** `typ` claim of the age verification tokens (never accepted as an auth token) */
export const AGE_VERIFICATION_TOKEN_TYPE = 'age-verification';

/** Audience of the age verification tokens */
export const AGE_VERIFICATION_TOKEN_AUDIENCE = 'fanvip:age-verification';

/** A pending attempt must be completed within this delay */
export const AGE_VERIFICATION_ATTEMPT_TTL_MS = 15 * 60 * 1000;

/** Abandoned (still pending) attempts are deleted after this delay */
export const AGE_VERIFICATION_PENDING_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Roles that never need the age verification (staff) */
export const AGE_VERIFICATION_EXEMPT_ROLES = ['ADMIN', 'MODERATOR'];

export type AgeVerificationProviderName = 'dev' | 'oidc';

export type AgeVerificationStatus = 'pending' | 'verified' | 'failed';
