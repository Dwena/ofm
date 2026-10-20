'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CardContent, CardFooter } from '@/components/ui/card'
import { toast } from '@/hooks/use-toast'
import {
  AuthMessage,
  AuthShell,
  FieldError,
  PasswordChecklist,
  PasswordInput,
  getApiErrorMessage,
  getPasswordError,
  getRawApiErrorMessage,
  translateApiMessage,
  usePublicSettings,
  useRedirectIfAuthenticated,
} from '@/components/auth-shell'

type Role = 'SUBSCRIBER' | 'CREATOR'
type Field = 'email' | 'username' | 'password' | 'confirmPassword'
type FieldErrors = Partial<Record<Field, string>>

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/

/** Same rules as the API's RegisterDto */
function validate(values: { email: string; username: string; password: string; confirmPassword: string }) {
  const errors: FieldErrors = {}
  if (!values.email) errors.email = "L'adresse e-mail est requise."
  else if (!EMAIL_REGEX.test(values.email)) errors.email = 'Adresse e-mail invalide.'

  if (!values.username) errors.username = "Le nom d'utilisateur est requis."
  else if (values.username.length < 3) errors.username = "Le nom d'utilisateur doit contenir au moins 3 caractères."
  else if (values.username.length > 30) errors.username = "Le nom d'utilisateur doit contenir au plus 30 caractères."
  else if (!USERNAME_REGEX.test(values.username))
    errors.username = "Le nom d'utilisateur ne peut contenir que des lettres, chiffres, tirets et underscores."

  const passwordError = getPasswordError(values.password)
  if (passwordError) errors.password = passwordError

  if (!values.confirmPassword) errors.confirmPassword = 'Confirmez votre mot de passe.'
  else if (values.password !== values.confirmPassword) errors.confirmPassword = 'Les mots de passe ne correspondent pas'
  return errors
}

/** Map an API validation message to the field it concerns */
function fieldOfApiMessage(message: string): Field | null {
  if (/^Email|email/.test(message)) return 'email'
  if (/^Username/.test(message)) return 'username'
  if (/^Password/.test(message)) return 'password'
  return null
}

function RegisterForm() {
  const searchParams = useSearchParams()
  const initialRole: Role = searchParams.get('role')?.toUpperCase() === 'CREATOR' ? 'CREATOR' : 'SUBSCRIBER'

  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState<Role>(initialRole)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  const { register } = useAuth()
  const checkingSession = useRedirectIfAuthenticated()
  const { data: settings, isLoading: settingsLoading } = usePublicSettings()
  const registrationClosed = settings?.registrationOpen === false

  const values = { email: email.trim(), username: username.trim(), password, confirmPassword }

  function updateField(field: Field, value: string, setter: (v: string) => void) {
    setter(value)
    // Re-validate live once the user tried to submit
    if (submitted) {
      const next = validate({ ...values, [field]: field === 'email' || field === 'username' ? value.trim() : value })
      setFieldErrors(next)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitted(true)

    const errors = validate(values)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      const first = (['email', 'username', 'password', 'confirmPassword'] as Field[]).find((f) => errors[f])
      if (first) document.getElementById(`register-${first === 'confirmPassword' ? 'password-confirm' : first}`)?.focus()
      return
    }

    setLoading(true)
    try {
      await register(values.email, values.username, values.password, role)
      toast({
        title: 'Bienvenue sur FanVIP !',
        description: `Votre compte a été créé. Un e-mail de vérification a été envoyé à ${values.email}.`,
        duration: 8000,
      })
    } catch (err: any) {
      if (err?.registeredButLoginFailed) {
        toast({
          title: 'Compte créé',
          description: 'Votre compte a bien été créé. Connectez-vous pour continuer.',
        })
        return
      }
      const raw = err?.response?.data?.message
      const messages: string[] = Array.isArray(raw) ? raw : raw ? [raw] : []
      const apiFieldErrors: FieldErrors = {}
      for (const message of messages) {
        const field = fieldOfApiMessage(message)
        if (field && !apiFieldErrors[field]) apiFieldErrors[field] = translateApiMessage(message)
      }
      if (Object.keys(apiFieldErrors).length > 0) {
        setFieldErrors(apiFieldErrors)
      } else if (err?.response?.status === 403) {
        setError(getRawApiErrorMessage(err) || 'Les inscriptions sont actuellement fermées.')
      } else {
        setError(getApiErrorMessage(err, "Erreur lors de l'inscription. Veuillez réessayer."))
      }
    } finally {
      setLoading(false)
    }
  }

  const describedBy = (field: Field) => (fieldErrors[field] ? `register-${field}-error` : undefined)

  if (registrationClosed) {
    return (
      <AuthShell description="Créez votre compte et commencez à monétiser votre contenu">
        <CardContent>
          <AuthMessage type="info" testId="registration-closed">
            Les inscriptions sont actuellement fermées. Revenez un peu plus tard !
          </AuthMessage>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <Button asChild className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700">
            <Link href="/login">J'ai déjà un compte</Link>
          </Button>
          <Link href="/" className="text-sm text-primary hover:underline">
            Retour à l'accueil
          </Link>
        </CardFooter>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      description="Créez votre compte et commencez à monétiser votre contenu"
      loading={(checkingSession && !loading) || settingsLoading}
    >
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          {error && <AuthMessage type="error" testId="register-error">{error}</AuthMessage>}

          <div className="space-y-2">
            <span className="text-sm font-medium" id="register-role-label">Type de compte</span>
            <div className="grid grid-cols-2 gap-3" role="group" aria-labelledby="register-role-label">
              <button
                type="button"
                data-testid="register-role-subscriber"
                aria-pressed={role === 'SUBSCRIBER'}
                disabled={loading}
                className={`p-4 rounded-lg border-2 transition-all ${
                  role === 'SUBSCRIBER'
                    ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950'
                    : 'border-gray-200 hover:border-gray-300 dark:border-gray-700'
                }`}
                onClick={() => setRole('SUBSCRIBER')}
              >
                <div className="text-lg font-semibold">Abonné</div>
                <div className="text-xs text-muted-foreground mt-1">Découvrir du contenu</div>
              </button>
              <button
                type="button"
                data-testid="register-role-creator"
                aria-pressed={role === 'CREATOR'}
                disabled={loading}
                className={`p-4 rounded-lg border-2 transition-all ${
                  role === 'CREATOR'
                    ? 'border-purple-600 bg-purple-50 dark:bg-purple-950'
                    : 'border-gray-200 hover:border-gray-300 dark:border-gray-700'
                }`}
                onClick={() => setRole('CREATOR')}
              >
                <div className="text-lg font-semibold">Créateur</div>
                <div className="text-xs text-muted-foreground mt-1">Partager et gagner</div>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="register-email">Email</label>
            <Input
              id="register-email"
              name="email"
              data-testid="register-email"
              type="email"
              autoComplete="email"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => updateField('email', e.target.value, setEmail)}
              required
              disabled={loading}
              aria-invalid={!!fieldErrors.email}
              aria-describedby={describedBy('email')}
            />
            <FieldError id="register-email-error" testId="register-email-error">{fieldErrors.email}</FieldError>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="register-username">Nom d'utilisateur</label>
            <Input
              id="register-username"
              name="username"
              data-testid="register-username"
              type="text"
              autoComplete="username"
              placeholder="username"
              value={username}
              onChange={(e) => updateField('username', e.target.value, setUsername)}
              required
              disabled={loading}
              minLength={3}
              maxLength={30}
              aria-invalid={!!fieldErrors.username}
              aria-describedby={describedBy('username') ?? 'register-username-hint'}
            />
            {fieldErrors.username ? (
              <FieldError id="register-username-error" testId="register-username-error">{fieldErrors.username}</FieldError>
            ) : (
              <p id="register-username-hint" className="text-xs text-muted-foreground">
                3 à 30 caractères : lettres, chiffres, tirets (-) et underscores (_).
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="register-password">Mot de passe</label>
            <PasswordInput
              id="register-password"
              name="password"
              data-testid="register-password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => updateField('password', e.target.value, setPassword)}
              required
              disabled={loading}
              minLength={8}
              aria-invalid={!!fieldErrors.password}
              aria-describedby={describedBy('password')}
            />
            <FieldError id="register-password-error" testId="register-password-error">{fieldErrors.password}</FieldError>
            <PasswordChecklist value={password} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="register-password-confirm">Confirmer le mot de passe</label>
            <PasswordInput
              id="register-password-confirm"
              name="confirmPassword"
              data-testid="register-password-confirm"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => updateField('confirmPassword', e.target.value, setConfirmPassword)}
              required
              disabled={loading}
              aria-invalid={!!fieldErrors.confirmPassword}
              aria-describedby={describedBy('confirmPassword')}
            />
            <FieldError id="register-confirmPassword-error" testId="register-password-confirm-error">
              {fieldErrors.confirmPassword}
            </FieldError>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <Button
            type="submit"
            data-testid="register-submit"
            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-lg py-6"
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
            {loading ? 'Inscription...' : "S'inscrire"}
          </Button>
          <p className="text-sm text-center text-muted-foreground">
            Déjà un compte ?{' '}
            <Link href="/login" className="text-primary hover:underline">
              Se connecter
            </Link>
          </p>
        </CardFooter>
      </form>
    </AuthShell>
  )
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <AuthShell description="Créez votre compte et commencez à monétiser votre contenu" loading>
          {null}
        </AuthShell>
      }
    >
      <RegisterForm />
    </Suspense>
  )
}
