import { BadRequestException } from '@nestjs/common';

/**
 * Text rules of the platform (titles, descriptions, captions, story texts,
 * live titles, usernames).
 *
 * FanVIP hosts sexual content between consenting adults: adult vocabulary
 * ("porno", "xxx", "sexe explicite"...) is allowed. What is blocked is what
 * the law and the card networks (Mastercard specialty merchant rules, Visa
 * integrity rules) prohibit, even as role play or fantasy:
 * - anything suggesting minors;
 * - non-consent (rape, drugged / unconscious people, coercion);
 * - incest; bestiality;
 * - prostitution / escorting / in-person meetings (the platform must not be
 *   used to arrange paid sex);
 * - other illegal content (violence, terrorism, hate, drugs): flagged for review.
 *
 * Severity:
 * - BLOCK: unambiguous terms, the text is refused (or the content rejected);
 * - REVIEW: ambiguous terms (e.g. "adolescence" in a bio, "endormie" in a
 *   morning caption): the content goes to a moderator with the matches.
 *
 * Matching is done on a normalized text (lowercase, accents removed, common
 * leetspeak like t33n / m1neure undone) with letter boundaries, so that
 * legitimate words containing a term are not hit ("canteen", "violon",
 * "adorable", "Escorial"...).
 */

export type RuleCategory =
  | 'MINORS'
  | 'NON_CONSENT'
  | 'INCEST'
  | 'BESTIALITY'
  | 'PROSTITUTION'
  | 'VIOLENCE'
  | 'HATE'
  | 'DRUGS';

export type RuleSeverity = 'BLOCK' | 'REVIEW';

interface Rule {
  category: RuleCategory;
  severity: RuleSeverity;
  /** Regex source fragments, written for the normalized text (no accents) */
  terms: string[];
}

export const CATEGORY_LABELS: Record<RuleCategory, string> = {
  MINORS: 'mineurs',
  NON_CONSENT: 'absence de consentement',
  INCEST: 'inceste',
  BESTIALITY: 'zoophilie',
  PROSTITUTION: 'prostitution / rencontres',
  VIOLENCE: 'violence',
  HATE: 'haine',
  DRUGS: 'drogues',
};

export const CONTENT_RULES: Rule[] = [
  // ---- Minors ----
  {
    category: 'MINORS',
    severity: 'BLOCK',
    terms: [
      'mineures?',
      'underage',
      'under ?age',
      'jail ?bait',
      'loli',
      'lolita',
      'lolicon',
      'shota(con)?',
      'pedo',
      'pedos',
      'pedophil(e|es|ie)',
      'pedoporn\\w*',
      'child ?porn',
      'preteens?',
      'pre teens?',
      'pre ?ados?',
      'teens?',
      'teenagers?',
      'ados?',
      'adolescent(e|s|es)?',
      'lyceen(ne|s|nes)?',
      'collegien(ne|s|nes)?',
      'ecolier(e|s|es)?',
      'school ?girls?',
      'school ?boys?',
      'barely legal',
      'tout juste majeure?',
      'a peine majeure?',
    ],
  },
  {
    category: 'MINORS',
    severity: 'REVIEW',
    terms: [
      'mineurs?',
      'adolescence',
      'enfants?',
      'gamine?s?',
      'jeune fille',
      'petite fille',
      'petit garcon',
      'uniforme scolaire',
      'school uniform',
      'lycee',
      'college',
      'barely',
      'youngs?',
    ],
  },
  // ---- Non-consent ----
  {
    category: 'NON_CONSENT',
    severity: 'BLOCK',
    terms: [
      'non ?consenti(e|s|es)?',
      'sans (son |leur )?consentement',
      'viol',
      'viols',
      'violee?s?',
      'violer',
      'rapes?',
      'raped',
      'raping',
      'forced',
      'forcees?',
      'chloroforme?',
    ],
  },
  {
    category: 'NON_CONSENT',
    severity: 'REVIEW',
    terms: [
      'droguee?s?',
      'endormie?s?',
      'sleeping',
      'asleep',
      'inconsciente?s?',
      'unconscious',
      'ivre morte?',
      'passed out',
      'abus sexuels?',
    ],
  },
  // ---- Incest ----
  {
    category: 'INCEST',
    severity: 'BLOCK',
    terms: ['incestes?', 'incest', 'incestueu(x|se|ses)'],
  },
  {
    category: 'INCEST',
    severity: 'REVIEW',
    terms: [
      'step ?(sis|sister|bro|brother|mom|mother|dad|father|daughter|son)s?',
      'demi (soeur|frere)s?',
    ],
  },
  // ---- Bestiality ----
  {
    category: 'BESTIALITY',
    severity: 'BLOCK',
    terms: ['zoophil(e|es|ie)', 'bestiality', 'bestialite', 'zoo ?sex'],
  },
  // ---- Prostitution / escorting / in-person meetings ----
  {
    category: 'PROSTITUTION',
    severity: 'BLOCK',
    terms: [
      'escort(e|es|s|ing)?',
      'rencontres? reelles?',
      'rencontres? irl',
      'rencontres? en vrai',
      'plans? culs?',
      'tarifs? (de (la )?)?nuit',
      'incall',
      'outcall',
      'massages? (avec|et) finition',
      'happy ending',
      'prestations? sexuelles?',
      'sex ?work(er)?s? irl',
    ],
  },
  {
    category: 'PROSTITUTION',
    severity: 'REVIEW',
    terms: [
      'rdv',
      'rendez vous',
      'je me deplace',
      'a domicile',
      'tarifs? horaires?',
      'sugar ?dadd(y|ies)',
      'gfe',
      'girlfriend experience',
    ],
  },
  // ---- Other illegal content (kept from the previous rules: review) ----
  {
    category: 'VIOLENCE',
    severity: 'REVIEW',
    terms: ['tuer', 'meurtres?', 'terroris(me|te|tes)', 'bombes?', 'armes?', 'violence'],
  },
  {
    category: 'HATE',
    severity: 'REVIEW',
    terms: ['racistes?', 'nazis?', 'discrimination', 'haine'],
  },
  {
    category: 'DRUGS',
    severity: 'REVIEW',
    terms: ['drogues?', 'stupefiants?', 'trafic'],
  },
];

export interface RuleMatch {
  term: string;
  category: RuleCategory;
  severity: RuleSeverity;
}

export interface TextRuleResult {
  blocked: boolean;
  needsReview: boolean;
  matches: RuleMatch[];
}

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

/** Lowercase, no accents, separators collapsed to a single space */
export function normalizeText(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[\s_\-.'’]+/g, ' ')
    .trim();
}

/** Undo leetspeak inside words (t33n, m1neure, 3sc0rt) */
function unLeet(normalized: string): string {
  return normalized.replace(/[a-z0-9@$]+/g, (word) =>
    /[a-z]/.test(word) ? word.replace(/[013457@$]/g, (char) => LEET[char] ?? char) : word,
  );
}

const compiled = CONTENT_RULES.flatMap((rule) =>
  rule.terms.map((term) => ({
    term,
    category: rule.category,
    severity: rule.severity,
    // Letter boundaries: digits are allowed around a term (#teen18)
    regex: new RegExp(`(?<![a-z])(?:${term})(?![a-z])`, 'i'),
  })),
);

// Declared age under 18 ("j'ai 17 ans", "16yo", "15 years old"): review, as
// "il y a 15 ans" is legitimate
const UNDERAGE_AGE = /(?<![0-9])(1[0-7]|[1-9])\s?(ans|yo|y o|years? old)(?![a-z])/i;

/**
 * Check one or several texts against the rules.
 */
export function checkText(...texts: (string | null | undefined)[]): TextRuleResult {
  const normalized = normalizeText(texts.filter(Boolean).join(' \n '));
  const variants = [normalized, unLeet(normalized)];

  const matches: RuleMatch[] = [];
  const seen = new Set<string>();
  for (const rule of compiled) {
    for (const variant of variants) {
      const found = rule.regex.exec(variant);
      if (!found) continue;
      // Reported as found in the (normalized) text, e.g. "escorte", "t33n" -> "teen"
      const term = found[0];
      const key = `${rule.severity}:${term}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push({ term, category: rule.category, severity: rule.severity });
      }
      break;
    }
  }

  if (UNDERAGE_AGE.test(normalized)) {
    matches.push({ term: 'âge < 18 ans', category: 'MINORS', severity: 'REVIEW' });
  }

  const blocked = matches.some((match) => match.severity === 'BLOCK');
  return {
    blocked,
    needsReview: !blocked && matches.length > 0,
    matches,
  };
}

/**
 * Refuse a text with BLOCK terms (400 with a French message listing them).
 * Returns the analysis so the caller can flag REVIEW matches for moderators.
 */
export function assertTextAllowed(...texts: (string | null | undefined)[]): TextRuleResult {
  const result = checkText(...texts);
  if (result.blocked) {
    const blocked = result.matches.filter((match) => match.severity === 'BLOCK');
    const categories = [...new Set(blocked.map((match) => CATEGORY_LABELS[match.category]))].join(', ');
    const terms = [...new Set(blocked.map((match) => `« ${match.term} »`))].join(', ');
    throw new BadRequestException({
      message: `Ce texte contient des termes interdits sur FanVIP (${categories}) : ${terms}. Modifiez-le pour publier.`,
      code: 'FORBIDDEN_TERMS',
      terms: blocked.map((match) => match.term),
    });
  }
  return result;
}

/** Moderation note listing the REVIEW matches (null when there are none) */
export function reviewNote(result: TextRuleResult): string | null {
  const review = result.matches.filter((match) => match.severity === 'REVIEW');
  if (review.length === 0) return null;
  return `Termes à vérifier : ${review.map((match) => `${match.term} (${CATEGORY_LABELS[match.category]})`).join(', ')}`;
}
