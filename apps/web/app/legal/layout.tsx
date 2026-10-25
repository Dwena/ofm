import type { Metadata } from 'next'
import Link from 'next/link'

import { BRAND_NAME, Logo } from '@/components/brand/logo'
import { LegalNav } from '@/components/legal/legal-nav'
import { SiteFooter } from '@/components/site-footer'

export const metadata: Metadata = {
  title: { default: 'Informations légales', template: `%s | ${BRAND_NAME}` },
}

/** Public layout of the legal pages (/legal/*): no login required */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between gap-4 px-4 py-4">
          <Link href="/" aria-label={`Retour à l'accueil ${BRAND_NAME}`}>
            <Logo className="text-xl" markClassName="h-8 w-8" />
          </Link>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            Retour à l&apos;accueil
          </Link>
        </div>
      </header>

      <div className="container mx-auto flex-1 px-4 py-8 lg:py-12">
        <div className="grid gap-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <LegalNav />
          </aside>
          <main className="min-w-0 max-w-3xl">{children}</main>
        </div>
      </div>

      <footer className="border-t">
        <div className="container mx-auto px-4">
          <SiteFooter />
        </div>
      </footer>
    </div>
  )
}
