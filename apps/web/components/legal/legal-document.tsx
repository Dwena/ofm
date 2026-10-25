import type { ReactNode } from 'react'
import Link from 'next/link'

import { LEGAL_DRAFT, LEGAL_DRAFT_NOTICE, LEGAL_LAST_UPDATE } from '@/lib/legal'

export interface LegalSection {
  /** Anchor (#id) used by the table of contents */
  id: string
  title: string
  content: ReactNode
}

/** Discreet "draft" notice: removed everywhere by setting LEGAL_DRAFT to false in lib/legal.ts */
export function LegalDraftNotice() {
  if (!LEGAL_DRAFT) return null
  return (
    <p
      role="note"
      data-testid="legal-draft-notice"
      className="mb-6 rounded-md border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
    >
      {LEGAL_DRAFT_NOTICE}
    </p>
  )
}

/**
 * One legal document: title, update date and version, draft notice, table of contents
 * built from the sections, then the numbered sections.
 */
export function LegalDocument({
  title,
  version,
  intro,
  sections,
}: {
  title: string
  version: string
  intro?: ReactNode
  sections: LegalSection[]
}) {
  return (
    <article className="legal-document">
      <LegalDraftNotice />
      <header className="mb-8">
        <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <p className="text-sm text-muted-foreground">
          Dernière mise à jour : {LEGAL_LAST_UPDATE} · Version {version}
        </p>
        {intro && <div className="mt-6 space-y-3 leading-relaxed">{intro}</div>}
      </header>

      <nav aria-label="Sommaire" className="mb-10 rounded-lg border bg-muted/40 p-4 text-sm">
        <p className="mb-2 font-semibold">Sommaire</p>
        <ol className="list-decimal space-y-1 pl-5">
          {sections.map((section) => (
            <li key={section.id}>
              <Link href={`#${section.id}`} className="text-primary hover:underline">
                {section.title}
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-10">
        {sections.map((section, index) => (
          <section key={section.id} id={section.id} className="scroll-mt-24">
            <h2 className="mb-4 text-xl font-semibold tracking-tight sm:text-2xl">
              {index + 1}. {section.title}
            </h2>
            <div className="space-y-3 leading-relaxed [&_a]:text-primary [&_a]:underline [&_h3]:mt-6 [&_h3]:font-semibold [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_strong]:font-semibold [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_td]:border [&_td]:p-2 [&_td]:align-top [&_th]:border [&_th]:bg-muted/50 [&_th]:p-2 [&_th]:text-left [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
              {section.content}
            </div>
          </section>
        ))}
      </div>
    </article>
  )
}

/** Placeholder to be replaced by the company (highlighted so it is not forgotten) */
export function Ph({ children }: { children: ReactNode }) {
  return <mark className="rounded bg-amber-100 px-1 text-inherit dark:bg-amber-900/50">{children}</mark>
}
