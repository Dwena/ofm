/**
 * Legal pages (/legal/*): shared constants.
 *
 * - LEGAL_DRAFT: shows the "Projet — à faire valider par un avocat" notice at the top of every
 *   legal page. Set to false once a lawyer has validated the texts.
 * - LEGAL_VERSIONS: must match apps/api/src/legal/legal-versions.ts (the API stores the accepted
 *   version with each acceptance and asks users to re-accept when it changes).
 * - COMPANY: placeholders to replace with the company's real details before going live.
 */

export const LEGAL_DRAFT = true
export const LEGAL_DRAFT_NOTICE = 'Projet — à faire valider par un avocat avant mise en ligne'

/** Displayed as "Dernière mise à jour" on every legal page */
export const LEGAL_LAST_UPDATE = '[DATE]'

export const LEGAL_VERSIONS = {
  terms: '2026-10-25',
  privacy: '2026-10-25',
  creator_terms: '2026-10-25',
  cgv: '2026-10-25',
  adult_declaration: '2026-10-25',
} as const

export const COMPANY = {
  brand: 'FanVIP',
  name: '[RAISON SOCIALE]',
  legalForm: '[FORME JURIDIQUE ET CAPITAL]',
  address: '[ADRESSE DU SIÈGE]',
  registration: '[RCS / SIREN]',
  vatNumber: '[N° TVA INTRACOMMUNAUTAIRE]',
  publicationDirector: '[DIRECTEUR DE LA PUBLICATION]',
  contactEmail: '[EMAIL DE CONTACT]',
  host: '[HÉBERGEUR : nom, adresse, téléphone]',
  mediator: '[MÉDIATEUR DE LA CONSOMMATION : nom, site]',
  /** DSA single point of contact (art. 11 and 12 of Regulation (EU) 2022/2065) */
  dsaEmail: '[EMAIL POINT DE CONTACT DSA]',
  /** Data protection officer / privacy contact */
  dpoEmail: '[EMAIL DPO / CONTACT DONNÉES PERSONNELLES]',
  website: '[URL DU SITE]',
} as const

export interface LegalPageLink {
  slug: string
  href: string
  /** Full title, used as the page h1 */
  title: string
  /** Short label for the footer and the legal navigation */
  shortTitle: string
}

export const LEGAL_PAGES: LegalPageLink[] = [
  { slug: 'mentions-legales', href: '/legal/mentions-legales', title: 'Mentions légales', shortTitle: 'Mentions légales' },
  { slug: 'cgu', href: '/legal/cgu', title: "Conditions générales d'utilisation", shortTitle: 'CGU' },
  { slug: 'cgv', href: '/legal/cgv', title: 'Conditions générales de vente', shortTitle: 'CGV' },
  {
    slug: 'conditions-createurs',
    href: '/legal/conditions-createurs',
    title: 'Conditions créateurs',
    shortTitle: 'Conditions créateurs',
  },
  { slug: 'regles-contenu', href: '/legal/regles-contenu', title: 'Règles de contenu', shortTitle: 'Règles de contenu' },
  {
    slug: 'confidentialite',
    href: '/legal/confidentialite',
    title: 'Politique de confidentialité',
    shortTitle: 'Confidentialité',
  },
  { slug: 'cookies', href: '/legal/cookies', title: 'Politique cookies et traceurs', shortTitle: 'Cookies' },
  {
    slug: 'signalement',
    href: '/legal/signalement',
    title: 'Signaler un contenu illicite',
    shortTitle: 'Signaler un contenu',
  },
]

export function legalPage(slug: string): LegalPageLink {
  const page = LEGAL_PAGES.find((p) => p.slug === slug)
  if (!page) throw new Error(`Unknown legal page: ${slug}`)
  return page
}

/** Official resources referenced by the legal pages */
export const PHAROS_URL = 'https://www.internet-signalement.gouv.fr'
export const CNIL_URL = 'https://www.cnil.fr'
export const CNIL_COMPLAINT_URL = 'https://www.cnil.fr/fr/adresser-une-plainte'
export const E_ENFANCE_URL = 'https://e-enfance.org'
export const ALLO_119_URL = 'https://www.allo119.gouv.fr'
