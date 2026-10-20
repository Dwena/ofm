import { useId } from 'react'

import { cn } from '@/lib/utils'

export const BRAND_NAME = 'FanVIP'

/** Crown on an indigo → purple tile: same drawing as public/icon.svg */
export function LogoMark({ className }: { className?: string }) {
  const gradientId = `logo-gradient-${useId().replace(/:/g, '')}`
  return (
    <svg viewBox="0 0 64 64" className={cn('h-9 w-9 shrink-0', className)} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f46e5" />
          <stop offset="1" stopColor="#9333ea" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gradientId})`} />
      <path d="M15 43V24l10 9 7-13 7 13 10-9v19z" fill="#fff" strokeLinejoin="round" />
      <rect x="15" y="46" width="34" height="5" rx="2.5" fill="#fff" />
      <circle cx="15" cy="21" r="3.5" fill="#fff" />
      <circle cx="32" cy="16.5" r="3.5" fill="#fff" />
      <circle cx="49" cy="21" r="3.5" fill="#fff" />
    </svg>
  )
}

/** "Fan" + gradient "VIP" wordmark, optionally preceded by the mark */
export function Logo({
  className,
  markClassName,
  showMark = true,
}: {
  className?: string
  markClassName?: string
  showMark?: boolean
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-2xl font-extrabold tracking-tight', className)}>
      {showMark && <LogoMark className={markClassName} />}
      <span>
        Fan
        <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">VIP</span>
      </span>
    </span>
  )
}
