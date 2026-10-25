import Link from 'next/link'

import { COMPANY, LEGAL_PAGES } from '@/lib/legal'
import { cn } from '@/lib/utils'

/**
 * Legal links + copyright + 18+ notice, shown on the landing pages, the auth pages,
 * the logged-in app and the legal pages. Server-compatible (no hooks).
 */
export function SiteFooter({ className, compact = false }: { className?: string; compact?: boolean }) {
  const year = new Date().getFullYear()
  return (
    <div
      data-testid="site-footer"
      className={cn(
        'flex flex-col items-center gap-3 text-xs text-muted-foreground',
        compact ? 'py-2' : 'py-6',
        className,
      )}
    >
      <nav aria-label="Informations légales">
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1">
          {LEGAL_PAGES.map((page) => (
            <li key={page.slug}>
              <Link href={page.href} className="hover:text-foreground hover:underline">
                {page.shortTitle}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <p className="flex flex-wrap items-center justify-center gap-2 text-center">
        <span
          className="inline-flex items-center rounded border border-current px-1.5 py-0.5 font-semibold leading-none"
          title="Site réservé aux personnes majeures"
        >
          18+
        </span>
        <span>Réservé aux personnes majeures.</span>
        <span>
          &copy; {year} {COMPANY.name}
        </span>
      </p>
    </div>
  )
}
