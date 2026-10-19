'use client';

import React, { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun, Monitor } from 'lucide-react';
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

// The ThemeProvider from next-themes is mounted in app/providers.tsx

function ThemeRadioItems() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  // The stored theme is only known on the client: avoid a hydration mismatch
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const options = [
    { value: 'light', label: t.shell.themeLight, icon: Sun },
    { value: 'dark', label: t.shell.themeDark, icon: Moon },
    { value: 'system', label: t.shell.themeSystem, icon: Monitor },
  ];

  return (
    <DropdownMenuRadioGroup value={mounted ? theme : undefined} onValueChange={setTheme}>
      {options.map(({ value, label, icon: Icon }) => (
        <DropdownMenuRadioItem key={value} value={value} data-testid={`theme-${value}`}>
          <Icon className="mr-2 h-4 w-4" />
          {label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/** Stand-alone icon button */
export function ThemeToggle() {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">{t.shell.theme}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ThemeRadioItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Sub-menu for an existing dropdown (avatar menu) */
export function ThemeSubMenu() {
  const { t } = useTranslation();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="theme-submenu">
        <Sun className="mr-2 h-4 w-4 dark:hidden" />
        <Moon className="mr-2 hidden h-4 w-4 dark:block" />
        {t.shell.theme}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <ThemeRadioItems />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
