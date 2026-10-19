'use client';

import React from 'react';
import { Languages } from 'lucide-react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { useTranslation } from './i18n-provider';
import type { Locale } from '@/lib/i18n';

const languages: { code: Locale; name: string }[] = [
  { code: 'fr', name: 'Français' },
  { code: 'en', name: 'English' },
];

function LanguageRadioItems() {
  const { locale, setLocale } = useTranslation();
  return (
    <DropdownMenuRadioGroup value={locale} onValueChange={(value) => setLocale(value as Locale)}>
      {languages.map((lang) => (
        <DropdownMenuRadioItem key={lang.code} value={lang.code} lang={lang.code} data-testid={`locale-${lang.code}`}>
          {lang.name}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/**
 * Stand-alone icon button. The locale translates the app shell
 * (navigation, account menu, banners, error pages); page content stays in French.
 */
export function LanguageSelector() {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <Languages className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">{t.shell.language}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <LanguageRadioItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Sub-menu for an existing dropdown (avatar menu) */
export function LanguageSubMenu() {
  const { t } = useTranslation();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="language-submenu">
        <Languages className="mr-2 h-4 w-4" />
        {t.shell.language}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <LanguageRadioItems />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
