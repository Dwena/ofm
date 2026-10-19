'use client'

import { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** Categorical series colors, in fixed order (CSS variables defined in globals.css) */
export const VIZ = {
  1: 'var(--viz-1)',
  2: 'var(--viz-2)',
  3: 'var(--viz-3)',
  4: 'var(--viz-4)',
  5: 'var(--viz-5)',
  6: 'var(--viz-6)',
  7: 'var(--viz-7)',
  8: 'var(--viz-8)',
} as const

export const VIZ_ORDER = [VIZ[1], VIZ[2], VIZ[3], VIZ[4], VIZ[5], VIZ[6], VIZ[7], VIZ[8]]

/** Recessive axes & grid shared by admin charts */
export const axisProps = {
  stroke: 'hsl(var(--muted-foreground))',
  tick: { fill: 'hsl(var(--muted-foreground))', fontSize: 12 },
  tickLine: false,
  axisLine: false,
} as const

export const gridProps = {
  stroke: 'hsl(var(--border))',
  strokeDasharray: '3 3',
  vertical: false,
} as const

const euroFormatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
const compactEuroFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export const formatEuro = (value: number) => euroFormatter.format(value || 0)
export const formatEuroCompact = (value: number) => compactEuroFormatter.format(value || 0)
export const formatNumber = (value: number) => (value || 0).toLocaleString('fr-FR')

interface TooltipEntry {
  name?: string
  value?: number | string
  color?: string
  dataKey?: string | number
}

/**
 * Tooltip with text in text colors and a colored swatch carrying the series identity
 */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter = (value: number) => formatNumber(value),
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string | number
  labelFormatter?: (label: string | number) => string
  valueFormatter?: (value: number, entry: TooltipEntry) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
      {label !== undefined && (
        <p className="mb-1 font-medium">{labelFormatter ? labelFormatter(label) : label}</p>
      )}
      <ul className="space-y-0.5">
        {payload.map((entry) => (
          <li key={String(entry.dataKey ?? entry.name)} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: entry.color }} aria-hidden />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto pl-4 font-medium tabular-nums">
              {valueFormatter(Number(entry.value ?? 0), entry)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Legend rendered as HTML so labels stay in text colors */
export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

export function StatTile({
  title,
  value,
  description,
  icon,
  testId,
}: {
  title: string
  value: ReactNode
  description?: ReactNode
  icon?: ReactNode
  testId?: string
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  )
}
