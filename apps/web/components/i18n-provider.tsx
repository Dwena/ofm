'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Locale, defaultLocale, getTranslations, interpolate } from '@/lib/i18n';
import { Translations } from '@/lib/i18n/locales/fr';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations;
  translate: (key: string, variables?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

interface I18nProviderProps {
  children: React.ReactNode;
  initialLocale?: Locale;
}

export function I18nProvider({ children, initialLocale = defaultLocale }: I18nProviderProps) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [translations, setTranslations] = useState<Translations>(getTranslations(initialLocale));

  useEffect(() => {
    // Load locale from localStorage
    const storedLocale = localStorage.getItem('ofm-locale') as Locale;
    if (storedLocale && (storedLocale === 'fr' || storedLocale === 'en')) {
      setLocale(storedLocale);
      setTranslations(getTranslations(storedLocale));
    }
  }, []);

  const handleSetLocale = (newLocale: Locale) => {
    localStorage.setItem('ofm-locale', newLocale);
    setLocale(newLocale);
    setTranslations(getTranslations(newLocale));

    // Update HTML lang attribute
    document.documentElement.lang = newLocale;
  };

  // Helper function to get nested translation
  const translate = (key: string, variables?: Record<string, string | number>): string => {
    const keys = key.split('.');
    let result: any = translations;

    for (const k of keys) {
      result = result?.[k];
      if (result === undefined) {
        console.warn(`Translation key not found: ${key}`);
        return key;
      }
    }

    if (typeof result !== 'string') {
      console.warn(`Translation key is not a string: ${key}`);
      return key;
    }

    return variables ? interpolate(result, variables) : result;
  };

  const value: I18nContextValue = {
    locale,
    setLocale: handleSetLocale,
    t: translations,
    translate,
  };

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
