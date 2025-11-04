import { fr, Translations } from './locales/fr';
import { en } from './locales/en';

export type Locale = 'fr' | 'en';

export const locales: Record<Locale, Translations> = {
  fr,
  en,
};

export const defaultLocale: Locale = 'fr';

export function getTranslations(locale: Locale = defaultLocale): Translations {
  return locales[locale] || locales[defaultLocale];
}

// Helper function to interpolate variables in translations
export function interpolate(text: string, variables: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    return variables[key]?.toString() || match;
  });
}
