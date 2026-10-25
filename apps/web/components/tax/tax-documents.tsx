'use client'

import type { ReactNode } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatEuros } from '@/lib/utils'
import {
  countryLabel,
  formatDay,
  type AnnualStatement,
  type InvoiceDetail,
  type InvoiceParty,
} from '@/lib/tax'

/**
 * Printable tax documents (self-billing invoice, annual statement).
 * Printing hides the whole app shell and keeps only `.tax-print-area`;
 * "Imprimer / PDF" uses the browser dialog (save as PDF).
 */
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 14mm; }
  html, body { background: #fff !important; }
  body * { visibility: hidden !important; }
  .tax-print-area, .tax-print-area * { visibility: visible !important; }
  .tax-print-area { position: absolute; inset: 0 auto auto 0; width: 100%; box-shadow: none !important; border: 0 !important; padding: 0 !important; }
  .tax-no-print { display: none !important; }
}
`

export function PrintButton({ label = 'Imprimer / PDF' }: { label?: string }) {
  return (
    <Button type="button" onClick={() => window.print()} className="tax-no-print">
      <Printer className="h-4 w-4 mr-2" />
      {label}
    </Button>
  )
}

/** White "paper" sheet, readable in both themes and printed alone */
export function PrintSheet({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{PRINT_CSS}</style>
      <article className="tax-print-area mx-auto w-full max-w-[210mm] rounded-lg border bg-white p-6 text-[13px] leading-relaxed text-neutral-900 shadow-sm sm:p-10 print:text-[11px]">
        {children}
      </article>
    </>
  )
}

function addressLines(address: InvoiceParty['address']): string[] {
  if (!address) return []
  if (Array.isArray(address)) return address.map((line) => (/^[A-Z]{2}$/.test(line) ? countryLabel(line) : line))
  return address.split(/\n|,\s*(?=\d{4,5}\s)/)
}

function Party({ title, party }: { title: string; party: InvoiceParty }) {
  const registration = party.companyRegistrationNumber ?? party.siren
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{title}</p>
      <p className="mt-1 font-semibold break-words">{party.name || '—'}</p>
      {addressLines(party.address).map((line, index) => (
        <p key={index} className="break-words">
          {line}
        </p>
      ))}
      {registration && <p>SIREN / immatriculation : {registration}</p>}
      {party.vatNumber && <p>N° TVA : {party.vatNumber}</p>}
    </div>
  )
}

const amount = (value: number) => <span className="tabular-nums whitespace-nowrap">{formatEuros(value)}</span>

export function InvoiceDocument({ invoice }: { invoice: InvoiceDetail }) {
  const data = invoice.data
  const totals = data.totals
  const creditNote = data.documentType === 'credit_note'

  return (
    <PrintSheet>
      <header className="flex flex-col gap-4 border-b border-neutral-200 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{data.title}</h1>
          <p className="mt-1 inline-block rounded border border-neutral-300 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
            Autofacturation
          </p>
        </div>
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-neutral-500">Numéro</dt>
          <dd className="font-semibold">{data.number}</dd>
          <dt className="text-neutral-500">Date d’émission</dt>
          <dd>{formatDay(data.issuedAt)}</dd>
          <dt className="text-neutral-500">Période</dt>
          <dd className="capitalize">{data.period.label}</dd>
        </dl>
      </header>

      <section className="grid gap-6 py-6 sm:grid-cols-2">
        <Party title="Fournisseur (émise en son nom et pour son compte)" party={data.seller} />
        <Party title="Client" party={data.buyer} />
      </section>

      <p className="text-neutral-700">{data.description}</p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-neutral-300 text-[11px] uppercase tracking-wide text-neutral-500">
              <th className="py-2 pr-3 font-semibold">Désignation</th>
              <th className="py-2 px-3 text-right font-semibold">Nombre</th>
              <th className="py-2 px-3 text-right font-semibold">Ventes HT (fans)</th>
              <th className="py-2 px-3 text-right font-semibold">Commission</th>
              <th className="py-2 pl-3 text-right font-semibold">Montant HT facturé</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line) => (
              <tr key={`${line.kind}-${line.type}`} className="border-b border-neutral-200">
                <td className="py-2 pr-3">
                  {line.label}
                  {line.kind === 'CREDIT' && <span className="ml-1 text-neutral-500">(avoir)</span>}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">{line.count}</td>
                <td className="py-2 px-3 text-right">{amount(line.salesAmount)}</td>
                <td className="py-2 px-3 text-right">{amount(line.platformFee)}</td>
                <td className="py-2 pl-3 text-right font-medium">{amount(line.netAmount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-neutral-600">
              <td className="py-2 pr-3">Total</td>
              <td />
              <td className="py-2 px-3 text-right">{amount(totals.salesAmount)}</td>
              <td className="py-2 px-3 text-right">{amount(totals.platformFee)}</td>
              <td className="py-2 pl-3 text-right font-medium">{amount(totals.netAmount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-6 flex justify-end">
        <dl className="grid w-full max-w-xs grid-cols-[1fr,auto] gap-x-6 gap-y-1">
          <dt>Total HT</dt>
          <dd className="text-right">{amount(totals.netAmount)}</dd>
          <dt>TVA {totals.vatRate > 0 ? `(${totals.vatRate.toLocaleString('fr-FR')} %)` : ''}</dt>
          <dd className="text-right">{amount(totals.vatAmount)}</dd>
          <dt className="border-t border-neutral-300 pt-2 font-bold">{creditNote ? 'Total de l’avoir TTC' : 'Total TTC'}</dt>
          <dd className="border-t border-neutral-300 pt-2 text-right font-bold">{amount(totals.totalAmount)}</dd>
        </dl>
      </div>

      <section className="mt-8 space-y-1 border-t border-neutral-200 pt-4 text-[12px] text-neutral-700">
        {data.mentions.map((mention) => (
          <p key={mention} className={mention === 'Autofacturation' ? 'font-semibold' : undefined}>
            {mention}
          </p>
        ))}
        <p>{data.paymentTerms}</p>
        <p>
          Le fournisseur dispose de 30 jours à compter de la mise à disposition de cette facture pour la contester auprès du
          support.
        </p>
      </section>
    </PrintSheet>
  )
}

export function AnnualStatementDocument({ statement }: { statement: AnnualStatement }) {
  const seller = statement.seller
  const platform = statement.platform
  return (
    <PrintSheet>
      <header className="border-b border-neutral-200 pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{platform.name || 'FanVIP'}</p>
        <h1 className="mt-1 text-2xl font-bold">Récapitulatif annuel des revenus {statement.year}</h1>
        <p className="mt-1 text-sm text-neutral-600">{statement.legalBasis}</p>
        {statement.provisional && (
          <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Document provisoire : l’année {statement.year} n’est pas terminée. Le récapitulatif définitif est disponible
            au plus tard le 31 janvier {statement.year + 1}.
          </p>
        )}
      </header>

      <section className="grid gap-6 py-6 sm:grid-cols-2">
        <div className="min-w-0">
          <Party title="Vendeur" party={seller} />
          {seller.taxIdentificationNumber && (
            <p>
              N° fiscal : {seller.taxIdentificationNumber}
              {seller.tinCountry ? ` (${countryLabel(seller.tinCountry)})` : ''}
            </p>
          )}
        </div>
        <Party
          title="Opérateur de plateforme"
          party={{ name: platform.name, address: platform.address, siren: platform.siren, vatNumber: platform.vatNumber }}
        />
      </section>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-neutral-300 text-[11px] uppercase tracking-wide text-neutral-500">
              <th className="py-2 pr-3 font-semibold">Période</th>
              <th className="py-2 px-3 text-right font-semibold">Transactions</th>
              <th className="py-2 px-3 text-right font-semibold">Montant brut HT</th>
              <th className="py-2 px-3 text-right font-semibold">Commissions</th>
              <th className="py-2 px-3 text-right font-semibold">Montant perçu</th>
              <th className="py-2 pl-3 text-right font-semibold">Remboursements</th>
            </tr>
          </thead>
          <tbody>
            {statement.quarters.map((q) => (
              <tr key={q.quarter} className="border-b border-neutral-200">
                <td className="py-2 pr-3">{q.label}</td>
                <td className="py-2 px-3 text-right tabular-nums">{q.transactions}</td>
                <td className="py-2 px-3 text-right">{amount(q.salesAmount)}</td>
                <td className="py-2 px-3 text-right">{amount(q.platformFee)}</td>
                <td className="py-2 px-3 text-right">{amount(q.consideration)}</td>
                <td className="py-2 pl-3 text-right">{amount(-q.refundedAmount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className="py-2 pr-3">Année {statement.year}</td>
              <td className="py-2 px-3 text-right tabular-nums">{statement.totals.transactions}</td>
              <td className="py-2 px-3 text-right">{amount(statement.totals.salesAmount)}</td>
              <td className="py-2 px-3 text-right">{amount(statement.totals.platformFee)}</td>
              <td className="py-2 px-3 text-right">{amount(statement.totals.consideration)}</td>
              <td className="py-2 pl-3 text-right">{amount(-statement.totals.refundedAmount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-4 text-[12px] text-neutral-600">
        Montant brut HT : prix payés par les fans hors TVA. Montant perçu : votre part après commission de la plateforme
        (montant déclaré à l’administration fiscale). Remboursements : parts reprises lors de remboursements ou de
        contestations bancaires. Montant net de l’année après remboursements :{' '}
        <strong>{formatEuros(statement.totals.netConsideration)}</strong>.
      </p>

      <section className="mt-8 space-y-2 border-t border-neutral-200 pt-4 text-[12px] text-neutral-700">
        <h2 className="text-sm font-semibold text-neutral-900">Vos obligations fiscales et sociales</h2>
        {statement.information.text.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <ul className="list-disc pl-5">
          {statement.information.links.map((link) => (
            <li key={link.url}>
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="underline break-words">
                {link.label}
              </a>
              <span className="hidden print:inline"> ({link.url})</span>
            </li>
          ))}
        </ul>
        <p className="text-neutral-500">Document généré le {formatDay(statement.generatedAt)}.</p>
      </section>
    </PrintSheet>
  )
}
