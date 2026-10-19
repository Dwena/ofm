'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2, MailWarning, X } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { authApi } from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import { useTranslation } from '@/components/i18n-provider'
import { interpolate } from '@/lib/i18n'

interface PublicSettings {
  registrationOpen: boolean
  maintenanceMode: boolean
  maintenanceMessage: string | null
}

const DISMISS_KEY = 'ofm-email-banner-dismissed'

/**
 * Global banners shown under the navigation:
 * - platform maintenance (GET /settings/public)
 * - email not verified, with a "resend" action (POST /auth/resend-verification)
 */
export function AppBanners() {
  const { user } = useAuth()
  const { t } = useTranslation()
  const [emailDismissed, setEmailDismissed] = useState(true)

  useEffect(() => {
    try {
      setEmailDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
    } catch {
      setEmailDismissed(false)
    }
  }, [])

  const { data: settings } = useQuery({
    queryKey: ['public-settings'],
    queryFn: async () => (await authApi.getPublicSettings()).data as PublicSettings,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  })

  const resend = useMutation({
    mutationFn: (email: string) => authApi.resendVerification(email),
    onSuccess: (_res, email) => {
      toast({
        title: t.shell.resendSuccessTitle,
        description: interpolate(t.shell.resendSuccessDescription, { email }),
      })
    },
    onError: (error: any) => {
      toast({
        title: t.shell.resendErrorTitle,
        description: error?.response?.data?.message || t.errors.generic,
        variant: 'destructive',
      })
    },
  })

  const dismissEmail = () => {
    setEmailDismissed(true)
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // ignore: the banner simply reappears on next load
    }
  }

  const showMaintenance = !!settings?.maintenanceMode
  const showEmail = !!user && user.emailVerified === false && !emailDismissed

  if (!showMaintenance && !showEmail) return null

  return (
    <div className="space-y-px">
      {showMaintenance && (
        <div
          role="status"
          className="border-b border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          data-testid="maintenance-banner"
        >
          <div className="container mx-auto flex items-start gap-2 px-4 py-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <span className="font-semibold">{t.shell.maintenanceTitle}</span>
              {' — '}
              {settings?.maintenanceMessage || t.shell.maintenanceDefault}
            </p>
          </div>
        </div>
      )}
      {showEmail && user && (
        <div
          role="status"
          className="border-b border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100"
          data-testid="email-verification-banner"
        >
          <div className="container mx-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
            <MailWarning className="h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1">{t.shell.emailNotVerified}</p>
            <button
              type="button"
              className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:no-underline disabled:opacity-60"
              onClick={() => resend.mutate(user.email)}
              disabled={resend.isPending || resend.isSuccess}
              data-testid="resend-verification-button"
            >
              {resend.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              {t.shell.resendVerification}
            </button>
            <button
              type="button"
              className="rounded p-1 hover:bg-blue-100 dark:hover:bg-blue-900"
              onClick={dismissEmail}
              aria-label={t.shell.dismiss}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
