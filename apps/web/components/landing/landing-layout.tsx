import type { ReactNode } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { BRAND_NAME, Logo } from '@/components/brand/logo'
import {
  type Audience,
  LandingFooterCta,
  LandingHeaderActions,
  LandingMaintenanceBanner,
} from '@/components/landing-actions'
import { cn } from '@/lib/utils'

const AUDIENCES: { audience: Audience; href: string; label: string }[] = [
  { audience: 'fans', href: '/', label: 'Fans' },
  { audience: 'creators', href: '/createurs', label: 'Créateurs' },
]

/** "Fans | Créateurs" switch between the two landing pages */
function AudienceSwitch({ audience, className }: { audience: Audience; className?: string }) {
  return (
    <div className={cn('inline-flex rounded-full border p-1 text-sm', className)} data-testid="audience-switch">
      {AUDIENCES.map((item) => (
        <Link
          key={item.audience}
          href={item.href}
          aria-current={item.audience === audience ? 'page' : undefined}
          className={cn(
            'rounded-full px-4 py-1.5 transition-colors',
            item.audience === audience
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}

export interface FaqItem {
  question: string
  answer: ReactNode
}

export function LandingFaq({ title, items }: { title: string; items: FaqItem[] }) {
  return (
    <section className="border-t py-16">
      <div className="mx-auto max-w-3xl">
        <h2 className="mb-8 text-3xl font-bold tracking-tight">{title}</h2>
        <div className="divide-y rounded-xl border">
          {items.map((item) => (
            <details key={item.question} className="group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {item.question}
                <span className="text-xl leading-none text-muted-foreground transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-muted-foreground">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

export function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <li key={item} className="flex gap-3">
          <Check className="mt-1 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

/** Numbered steps, plain text */
export function Steps({ items, inline = false }: { items: { title: string; text: string }[]; inline?: boolean }) {
  return (
    <ol className={cn('grid gap-8', inline && 'md:grid-cols-3')}>
      {items.map((item, index) => (
        <li key={item.title}>
          <span className="mb-3 block text-sm font-semibold text-indigo-600 dark:text-indigo-400">
            Étape {index + 1}
          </span>
          <h3 className="mb-2 text-xl font-semibold">{item.title}</h3>
          <p className="text-muted-foreground">{item.text}</p>
        </li>
      ))}
    </ol>
  )
}

/** Header, final call to action and footer shared by the fans and creators landing pages */
export function LandingLayout({
  audience,
  cta,
  children,
}: {
  audience: Audience
  cta: { title: string; text: string; crossLink: ReactNode }
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4">
        <LandingMaintenanceBanner />
        <nav className="flex items-center justify-between gap-4 py-6">
          <div className="flex items-center gap-6">
            <Link href="/" aria-label={BRAND_NAME}>
              <Logo markClassName="h-10 w-10" />
            </Link>
            <AudienceSwitch audience={audience} className="hidden md:inline-flex" />
          </div>
          <LandingHeaderActions audience={audience} />
        </nav>
        <AudienceSwitch audience={audience} className="mb-4 md:hidden" />

        {children}

        <section className="mb-16 rounded-2xl bg-gray-900 px-6 py-12 text-center text-white sm:px-12 dark:bg-indigo-950 dark:ring-1 dark:ring-indigo-900">
          <h2 className="mb-3 text-3xl font-bold tracking-tight">{cta.title}</h2>
          <p className="mx-auto mb-8 max-w-xl text-gray-300 dark:text-indigo-200">{cta.text}</p>
          <LandingFooterCta audience={audience} />
          <p className="mt-6 text-sm text-gray-400 dark:text-indigo-300">{cta.crossLink}</p>
        </section>
      </div>

      <footer className="border-t">
        <div className="container mx-auto flex flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row">
          <Logo className="text-lg" markClassName="h-7 w-7" />
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            <Link href="/" className="hover:text-foreground">
              Pour les fans
            </Link>
            <Link href="/createurs" className="hover:text-foreground">
              Pour les créateurs
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Connexion
            </Link>
          </div>
          <p>&copy; {new Date().getFullYear()} {BRAND_NAME}</p>
        </div>
      </footer>
    </div>
  )
}
