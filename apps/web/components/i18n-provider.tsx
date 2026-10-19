'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Locale, defaultLocale, getTranslations, interpolate } from '@/lib/i18n';
import { Translations } from '@/lib/i18n/locales/fr';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations;
  translate: (key: string, variables?: Record<string, string | number>) => string;
}

const STORAGE_KEY = 'ofm-locale';

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

interface I18nProviderProps {
  children: React.ReactNode;
  initialLocale?: Locale;
}

function readStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'fr' || stored === 'en' ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Mounted in app/layout.tsx. The selected locale is remembered in localStorage
 * and reflected on <html lang>.
 */
export function I18nProvider({ children, initialLocale = defaultLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    const stored = readStoredLocale();
    if (stored) setLocaleState(stored);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, newLocale);
    } catch {
      // Private mode / blocked storage: the choice only lasts for this page view
    }
    setLocaleState(newLocale);
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const translations = getTranslations(locale);

    // Resolve a dotted key such as "shell.logout"; falls back to the key itself
    const translate = (key: string, variables?: Record<string, string | number>): string => {
      let result: any = translations;
      for (const k of key.split('.')) {
        result = result?.[k];
        if (result === undefined) return key;
      }
      if (typeof result !== 'string') return key;
      return variables ? interpolate(result, variables) : result;
    };

    return { locale, setLocale, t: translations, translate };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error('useTranslation must be used within an I18nProvider');
  }
  return context;
}

// Shorthand hook
export function useT() {
  const { t } = useTranslation();
  return t;
}
