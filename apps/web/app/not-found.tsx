'use client'

import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/auth-context'
import { useTranslation } from '@/components/i18n-provider'
import { getHomeRoute } from '@/lib/navigation'

export default function NotFound() {
  const { user } = useAuth()
  const { t } = useTranslation()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center" data-testid="not-found">
      <SearchX className="mb-4 h-12 w-12 text-muted-foreground" />
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{t.shell.notFoundTitle}</h1>
      <p className="mt-2 max-w-md text-muted-foreground">{t.shell.notFoundDescription}</p>
      <Button asChild className="mt-6">
        <Link href={user ? getHomeRoute(user.role) : '/'}>{t.shell.backHome}</Link>
      </Button>
    </div>
  )
}
