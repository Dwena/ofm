'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/auth-context'
import { useTranslation } from '@/components/i18n-provider'
import { getHomeRoute } from '@/lib/navigation'

/**
 * Error boundary of every authenticated page: the navigation stays usable
 * and the user can retry rendering the page.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { user } = useAuth()
  const { t } = useTranslation()

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center" data-testid="page-error">
      <AlertTriangle className="mb-4 h-12 w-12 text-destructive" />
      <h1 className="text-2xl font-bold">{t.shell.errorTitle}</h1>
      <p className="mt-2 max-w-md text-muted-foreground">{t.shell.errorDescription}</p>
      {error.digest && <p className="mt-1 text-xs text-muted-foreground">Réf. {error.digest}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button onClick={() => reset()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t.shell.retry}
        </Button>
        <Button variant="outline" asChild>
          <Link href={getHomeRoute(user?.role)}>{t.shell.backHome}</Link>
        </Button>
      </div>
    </div>
  )
}
