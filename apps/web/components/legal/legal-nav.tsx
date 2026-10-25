'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { LEGAL_PAGES } from '@/lib/legal'
import { cn } from '@/lib/utils'

/** List of all legal documents, current one highlighted */
export function LegalNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Documents légaux" className="text-sm">
      <p className="mb-3 font-semibold">Informations légales</p>
      <ul className="space-y-1">
        {LEGAL_PAGES.map((page) => {
          const active = pathname === page.href
          return (
            <li key={page.slug}>
              <Link
                href={page.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-1.5 transition-colors',
                  active
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {page.title}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
