'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildAgeVerificationUrl } from '@/lib/age-verification'
import { cn } from '@/lib/utils'

/**
 * Placeholder shown instead of explicit media (content, stories, lives, PPV
 * messages) while the visitor's age is not verified: the API returned
 * `ageVerificationRequired` and no media URL. Blurred background, lock icon
 * and a "Vérifier mon âge" button that comes back to the current page.
 */
export function AgeGatedMedia({
  className,
  compact = false,
  label = 'Contenu réservé aux adultes',
}: {
  className?: string
  /** Small variant (thumbnails, message attachments) */
  compact?: boolean
  label?: string
}) {
  const pathname = usePathname() || '/'
  const href = buildAgeVerificationUrl(
    pathname + (typeof window !== 'undefined' ? window.location.search : ''),
  )

  return (
    <div
      data-testid="age-gated-media"
      className={cn(
        'relative flex w-full items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 text-white',
        compact ? 'min-h-[8rem]' : 'min-h-[14rem]',
        className,
      )}
    >
      {/* Abstract blurred shapes: no real media is ever loaded here */}
      <div aria-hidden className="absolute inset-0 opacity-60 blur-2xl">
        <div className="absolute left-1/4 top-1/4 h-1/2 w-1/2 rounded-full bg-pink-500/40" />
        <div className="absolute bottom-0 right-0 h-2/3 w-2/3 rounded-full bg-indigo-500/40" />
      </div>
      <div className={cn('relative z-10 flex flex-col items-center text-center', compact ? 'gap-2 p-3' : 'gap-3 p-6')}>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15">
          <Lock className="h-5 w-5" aria-hidden />
        </span>
        <p className={cn('font-medium', compact ? 'text-xs' : 'text-sm')}>{label}</p>
        {!compact && (
          <p className="max-w-xs text-xs text-white/80">
            Vérifiez votre âge auprès d’un service indépendant pour afficher ce média.
          </p>
        )}
        <Button asChild size="sm" variant="secondary">
          <Link href={href} data-testid="age-gated-media-verify">
            Vérifier mon âge
          </Link>
        </Button>
      </div>
    </div>
  )
}
