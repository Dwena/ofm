'use client'

import { forwardRef, ReactNode, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Eye, EyeOff, Loader2 } from 'lucide-react'
import { authApi } from '@/lib/api'
import { getHomePath, useAuth } from '@/contexts/auth-context'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, InputProps } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { BRAND_NAME, Logo } from '@/components/brand/logo'

export interface PublicSettings {
  registrationOpen: boolean
  maintenanceMode: boolean
  maintenanceMessage: string | null
}

/** GET /settings/public: registration status and maintenance mode (no auth needed) */
export function usePublicSettings() {
  return useQuery<PublicSettings>({
    queryKey: ['settings', 'public'],
    queryFn: async () => (await authApi.getPublicSettings()).data,
    staleTime: 60 * 1000,
    retry: 1,
  })
}

/** Banner shown while the platform is in maintenance mode */
export function MaintenanceBanner({ className }: { className?: string }) {
  const { data } = usePublicSettings()
  if (!data?.maintenanceMode) return null
  return (
    <div
      role="status"
      data-testid="maintenance-banner"
      className={cn(
        'flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200',
        className
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">Maintenance en cours</p>
        <p>
          {data.maintenanceMessage ||
            'La plateforme est temporairement indisponible. Merci de réessayer un peu plus tard.'}
        </p>
      </div>
    </div>
  )
}

/**
 * For guest-only pages (login, register, forgot password): sends an already
 * logged-in user to their home page. Returns true while the page must not render.
 */
export function useRedirectIfAuthenticated(redirectTo?: string | null) {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [redirecting, setRedirecting] = useState(false)

  useEffect(() => {
    if (!isLoading && user && !redirecting) {
      setRedirecting(true)
      router.replace(redirectTo || getHomePath(user.role))
    }
  }, [isLoading, user, redirecting, redirectTo, router])

  return isLoading || !!user
}

export function AuthShell({
  description,
  children,
  loading = false,
}: {
  description: string
  children: ReactNode
  /** Shows a spinner instead of the content (session check, redirect...) */
  loading?: boolean
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md shadow-2xl border-2">
        <CardHeader className="space-y-1 pb-6">
          <div className="flex items-center justify-center mb-2">
            <CardTitle>
              <Link href="/" aria-label={`Retour à l'accueil ${BRAND_NAME}`}>
                <Logo className="text-4xl" markClassName="h-12 w-12" />
              </Link>
            </CardTitle>
          </div>
          <CardDescription className="text-center text-base">{description}</CardDescription>
          <MaintenanceBanner className="mt-4" />
        </CardHeader>
        {loading ? (
          <CardContent className="flex justify-center py-6">
            <Loader2 className="h-10 w-10 animate-spin text-primary" aria-label="Chargement" />
          </CardContent>
        ) : (
          children
        )}
      </Card>
    </div>
  )
}

export function AuthMessage({
  type,
  children,
  testId,
}: {
  type: 'error' | 'success' | 'info'
  children: ReactNode
  testId?: string
}) {
  const styles =
    type === 'error'
      ? 'text-red-500 bg-red-50 dark:bg-red-900/20'
      : type === 'success'
        ? 'text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-900/20'
        : 'text-indigo-700 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-900/20'
  return (
    <div role={type === 'error' ? 'alert' : 'status'} data-testid={testId} className={`p-3 text-sm rounded-md ${styles}`}>
      {children}
    </div>
  )
}

/** Inline validation message under a form field */
export function FieldError({ id, children, testId }: { id: string; children?: ReactNode; testId?: string }) {
  if (!children) return null
  return (
    <p id={id} data-testid={testId} className="text-xs text-red-500">
      {children}
    </p>
  )
}

/** Password input with a show / hide toggle */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type'>>(
  ({ className, disabled, ...props }, ref) => {
    const [visible, setVisible] = useState(false)
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('pr-10', className)}
          disabled={disabled}
          {...props}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground disabled:opacity-50"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          aria-pressed={visible}
          disabled={disabled}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    )
  }
)
PasswordInput.displayName = 'PasswordInput'

/** Same rules as the API's RegisterDto / ResetPasswordDto */
export const PASSWORD_SPECIAL_CHARS = '@$!%*?&'
export const PASSWORD_RULES: { label: string; test: (value: string) => boolean }[] = [
  { label: '8 caractères minimum', test: (v) => v.length >= 8 },
  { label: 'Une majuscule', test: (v) => /[A-Z]/.test(v) },
  { label: 'Une minuscule', test: (v) => /[a-z]/.test(v) },
  { label: 'Un chiffre', test: (v) => /\d/.test(v) },
  { label: `Un caractère spécial (${PASSWORD_SPECIAL_CHARS})`, test: (v) => /[@$!%*?&]/.test(v) },
]

// The API also requires the first character to be a letter, a digit or one of @$!%*?&
const PASSWORD_FIRST_CHAR = /^[A-Za-z\d@$!%*?&]/

export const PASSWORD_RULES_MESSAGE =
  'Le mot de passe doit contenir au moins 8 caractères, dont une majuscule, une minuscule, un chiffre et un caractère spécial (@$!%*?&).'

/** French error for a password the API would refuse, or null if it is valid */
export function getPasswordError(value: string): string | null {
  if (!value) return 'Le mot de passe est requis.'
  if (value.length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.'
  if (!PASSWORD_RULES.every((rule) => rule.test(value))) return PASSWORD_RULES_MESSAGE
  if (!PASSWORD_FIRST_CHAR.test(value)) {
    return 'Le mot de passe doit commencer par une lettre non accentuée, un chiffre ou l’un des caractères @$!%*?&.'
  }
  return null
}

export function isPasswordValid(value: string) {
  return getPasswordError(value) === null
}

/** Live checklist of the password rules */
export function PasswordChecklist({ value }: { value: string }) {
  return (
    <ul className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2" aria-label="Règles du mot de passe">
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(value)
        return (
          <li key={rule.label} className={ok ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}>
            {ok ? '✓' : '•'} {rule.label}
          </li>
        )
      })}
    </ul>
  )
}

const ERROR_TRANSLATIONS: Record<string, string> = {
  'Invalid credentials': 'Email ou mot de passe incorrect.',
  'Account suspended': 'Votre compte est suspendu. Contactez le support pour plus d’informations.',
  'Account banned': 'Votre compte a été banni.',
  'Account has been suspended': 'Votre compte est suspendu ou banni.',
  'Token has been revoked': 'Votre session a expiré. Veuillez vous reconnecter.',
  'Invalid refresh token': 'Votre session a expiré. Veuillez vous reconnecter.',
  'Email already exists': 'Un compte existe déjà avec cette adresse e-mail.',
  'Username already exists': "Ce nom d'utilisateur est déjà pris.",
  'Username must be at least 3 characters': "Le nom d'utilisateur doit contenir au moins 3 caractères.",
  'Username must be at most 30 characters': "Le nom d'utilisateur doit contenir au plus 30 caractères.",
  'Username can only contain letters, numbers, underscores and hyphens':
    "Le nom d'utilisateur ne peut contenir que des lettres, chiffres, tirets et underscores.",
  'Invalid role': 'Type de compte invalide.',
  'email must be an email': 'Adresse e-mail invalide.',
  'Invalid or expired verification token': 'Ce lien de vérification est invalide ou a expiré.',
  'Invalid or expired reset token': 'Ce lien de réinitialisation est invalide ou a expiré.',
  'Invalid token': 'Lien invalide.',
  'Invalid email address': 'Adresse e-mail invalide.',
  'Password must be at least 8 characters': 'Le mot de passe doit contenir au moins 8 caractères.',
  'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character':
    'Le mot de passe doit contenir une majuscule, une minuscule, un chiffre et un caractère spécial (@$!%*?&).',
  'Invalid 2FA code': 'Code 2FA invalide. Réessayez avec un nouveau code.',
  '2FA code must be 6 digits': 'Le code 2FA doit contenir 6 chiffres.',
  '2FA setup expired. Please try again.': 'La configuration 2FA a expiré. Veuillez recommencer.',
  'Too Many Requests': 'Trop de tentatives. Veuillez réessayer dans une minute.',
  'ThrottlerException: Too Many Requests': 'Trop de tentatives. Veuillez réessayer dans une minute.',
}

/** Raw (untranslated) API error message, first one if the API sent a list */
export function getRawApiErrorMessage(err: any): string {
  const raw = err?.response?.data?.message
  const message = Array.isArray(raw) ? raw[0] : raw
  return typeof message === 'string' ? message : ''
}

/** Translates one API message to French (unknown messages are returned as-is) */
export function translateApiMessage(message: string): string {
  return ERROR_TRANSLATIONS[message] ?? message
}

/** Extract a user-facing (French) message from an axios error. */
export function getApiErrorMessage(err: any, fallback: string): string {
  if (err && err.isAxiosError && !err.response) {
    return 'Impossible de contacter le serveur. Vérifiez votre connexion et réessayez.'
  }
  const message = getRawApiErrorMessage(err)
  if (!message) {
    return fallback
  }
  return translateApiMessage(message)
}
