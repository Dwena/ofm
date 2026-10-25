/**
 * Current version of each legal document (single source of truth).
 *
 * Bump a version (format AAAA-MM-JJ) when the corresponding text changes in a way
 * that requires users to accept it again: GET /legal/status then lists the document
 * for every user whose last acceptance is older, and the web app asks them to
 * re-accept (POST /legal/accept).
 *
 * Keep in sync with the "Version" shown on the web pages (apps/web/lib/legal.ts).
 */
export const LEGAL_VERSIONS = {
  /** Conditions générales d'utilisation (/legal/cgu) */
  terms: '2026-10-25',
  /** Politique de confidentialité (/legal/confidentialite) */
  privacy: '2026-10-25',
  /** Conditions créateurs, incl. mandat d'autofacturation (/legal/conditions-createurs) */
  creator_terms: '2026-10-25',
  /** Conditions générales de vente (/legal/cgv), accepted at checkout */
  cgv: '2026-10-25',
  /** Déclaration sur l'honneur d'avoir 18 ans ou plus */
  adult_declaration: '2026-10-25',
} as const;

export type LegalDocument = keyof typeof LEGAL_VERSIONS;

export const LEGAL_DOCUMENTS = Object.keys(LEGAL_VERSIONS) as LegalDocument[];

/** Documents every account must have accepted in their current version */
export const REQUIRED_FOR_ALL: LegalDocument[] = ['terms', 'privacy', 'adult_declaration'];

/** Additional documents a creator account must have accepted */
export const REQUIRED_FOR_CREATORS: LegalDocument[] = ['creator_terms'];

/** Documents a given role must have accepted (CGV are accepted at each purchase) */
export function requiredDocumentsForRole(role?: string | null): LegalDocument[] {
  return role === 'CREATOR' ? [...REQUIRED_FOR_ALL, ...REQUIRED_FOR_CREATORS] : [...REQUIRED_FOR_ALL];
}
