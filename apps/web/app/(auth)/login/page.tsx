'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { getSafeRedirect, useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CardContent, CardFooter } from '@/components/ui/card'
import { toast } from '@/hooks/use-toast'
import {
  AuthMessage,
  AuthShell,
  PasswordInput,
  getApiErrorMessage,
  getRawApiErrorMessage,
  useRedirectIfAuthenticated,
} from '@/components/auth-shell'

function LoginForm() {
  const searchParams = useSearchParams()
  const redirectTo = getSafeRedirect(searchParams.get('redirect'))

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [needs2FA, setNeeds2FA] = useState(false)

  const { login } = useAuth()
  const checkingSession = useRedirectIfAuthenticated(redirectTo)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (needs2FA && !/^\d{6}$/.test(totpCode)) {
      setError('Le code 2FA doit contenir 6 chiffres.')
      return
    }

    setLoading(true)
    try {
      const user = await login(email.trim(), password, needs2FA ? totpCode : undefined, redirectTo)
      if (!user.emailVerified) {
        toast({
          title: 'Adresse e-mail non vérifiée',
          description: `Confirmez votre adresse via le lien envoyé à ${user.email}. Vous pouvez demander un nouveau lien depuis vos paramètres.`,
          duration: 8000,
        })
      }
    } catch (err: any) {
      const message = getRawApiErrorMessage(err)
      if (message === '2FA code required') {
        setNeeds2FA(true)
      } else if (message === 'Invalid 2FA code') {
        setTotpCode('')
        setError(getApiErrorMessage(err, 'Code 2FA invalide.'))
      } else {
        setError(getApiErrorMessage(err, 'Erreur de connexion. Veuillez réessayer.'))
      }
    } finally {
      setLoading(false)
    }
  }

  function resetTo2FAStart() {
    setNeeds2FA(false)
    setTotpCode('')
    setPassword('')
    setError('')
  }

  return (
    <AuthShell description="Connectez-vous à votre compte" loading={checkingSession && !loading}>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {error && <AuthMessage type="error" testId="login-error">{error}</AuthMessage>}
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="login-email">Email</label>
            <Input
              id="login-email"
              name="email"
              data-testid="login-email"
              type="email"
              autoComplete="email"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              disabled={loading || needs2FA}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium" htmlFor="login-password">Mot de passe</label>
              <Link href="/forgot-password" className="text-sm text-primary hover:underline">
                Mot de passe oublié ?
              </Link>
            </div>
            <PasswordInput
              id="login-password"
              name="password"
              data-testid="login-password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading || needs2FA}
            />
          </div>
          {needs2FA && (
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="totpCode">Code 2FA</label>
              <p className="text-sm text-muted-foreground">
                Saisissez le code à 6 chiffres affiché par votre application d'authentification.
              </p>
              <Input
                id="totpCode"
                name="totpCode"
                data-testid="login-totp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                placeholder="123456"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                disabled={loading}
                maxLength={6}
                autoFocus
              />
              <button
                type="button"
                className="text-sm text-muted-foreground hover:underline"
                onClick={resetTo2FAStart}
                disabled={loading}
              >
                Utiliser un autre compte
              </button>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <Button
            type="submit"
            data-testid="login-submit"
            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-lg py-6"
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
            {loading ? 'Connexion...' : needs2FA ? 'Vérifier' : 'Se connecter'}
          </Button>
          <p className="text-sm text-center text-muted-foreground">
            Pas encore de compte ?{' '}
            <Link href="/register" className="text-primary hover:underline" data-testid="register-link">
              S'inscrire
            </Link>
          </p>
        </CardFooter>
      </form>
    </AuthShell>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthShell description="Connectez-vous à votre compte" loading>{null}</AuthShell>}>
      <LoginForm />
    </Suspense>
  )
}
