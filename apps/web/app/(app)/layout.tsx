'use client'

import { useAuth } from '@/contexts/auth-context'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Lock, Loader2 } from 'lucide-react'
import { Navigation } from '@/components/navigation'
import { AppBanners } from '@/components/app-banners'
import { SiteFooter } from '@/components/site-footer'
import { useTranslation } from '@/components/i18n-provider'
import { buildLoginUrl, getHomeRoute, getPathAccess } from '@/lib/navigation'

/**
 * Shell of every authenticated page:
 * - no session → /login?redirect=<current url>
 * - /creator/* is reserved to creators, /admin/* to admins (moderators: reports only).
 *   The API enforces the same rules with RolesGuard; this only avoids showing broken pages.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, isLoading: loading } = useAuth()
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname() || '/'

  const access = user ? getPathAccess(user.role, pathname) : 'ok'

  useEffect(() => {
    if (loading) return
    if (!user) {
      // window.location.search: useSearchParams() would force a Suspense boundary on every page
      router.replace(buildLoginUrl(pathname + window.location.search))
      return
    }
    if (access !== 'ok') {
      router.replace(getHomeRoute(user.role))
    }
  }, [user, loading, router, pathname, access])

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="app-loading">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">{t.shell.loading}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <AppBanners />
      <main className="container mx-auto px-4 py-6 md:py-8">
        {access === 'ok' ? (
          children
        ) : (
          <div className="flex min-h-[40vh] flex-col items-center justify-center text-center" data-testid="access-denied">
            <Lock className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="font-medium">
              {access === 'creator-only' ? t.shell.forbiddenCreator : t.shell.forbiddenAdmin}
            </p>
            <p className="text-sm text-muted-foreground">{t.shell.redirecting}</p>
          </div>
        )}
      </main>
      <footer className="border-t">
        <div className="container mx-auto px-4">
          <SiteFooter />
        </div>
      </footer>
    </div>
  )
}
