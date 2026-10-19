'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, Loader2 } from 'lucide-react'
import { authApi } from '@/lib/api'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { CardContent, CardFooter } from '@/components/ui/card'
import {
  AuthMessage,
  AuthShell,
  PasswordChecklist,
  PasswordInput,
  getApiErrorMessage,
  getPasswordError,
} from '@/components/auth-shell'

function ResetPasswordContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const { clearSession } = useAuth()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!token) return
    const passwordError = getPasswordError(password)
    if (passwordError) {
      setError(passwordError)
      return
    }
    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }

    setLoading(true)
    try {
      await authApi.resetPassword(token, password)
      // All sessions were revoked server-side: drop the local one too
      clearSession()
      setDone(true)
    } catch (err) {
      setError(getApiErrorMessage(err, 'Impossible de réinitialiser le mot de passe.'))
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <>
        <CardContent>
          <AuthMessage type="error">Lien de réinitialisation incomplet : aucun jeton fourni.</AuthMessage>
        </CardContent>
        <CardFooter>
          <Button asChild variant="outline" className="w-full">
            <Link href="/forgot-password">Demander un nouveau lien</Link>
          </Button>
        </CardFooter>
      </>
    )
  }

  if (done) {
    return (
      <>
        <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle className="h-12 w-12 text-green-500" />
          <p className="font-medium">Votre mot de passe a été modifié.</p>
          <p className="text-sm text-muted-foreground">
            Par sécurité, toutes vos sessions ont été déconnectées. Connectez-vous avec votre nouveau mot de passe.
          </p>
        </CardContent>
        <CardFooter>
          <Button asChild className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700">
            <Link href="/login">Se connecter</Link>
          </Button>
        </CardFooter>
      </>
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      <CardContent className="space-y-4">
        {error && (
          <AuthMessage type="error" testId="reset-password-error">
            {error}{' '}
            {error.includes('expiré') && (
              <Link href="/forgot-password" className="underline">
                Demander un nouveau lien
              </Link>
            )}
          </AuthMessage>
        )}
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="password">
            Nouveau mot de passe
          </label>
          <PasswordInput
            id="password"
            data-testid="reset-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            autoComplete="new-password"
            autoFocus
          />
          <PasswordChecklist value={password} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="confirmPassword">
            Confirmer le mot de passe
          </label>
          <PasswordInput
            id="confirmPassword"
            data-testid="reset-password-confirm"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            disabled={loading}
            autoComplete="new-password"
          />
        </div>
      </CardContent>
      <CardFooter className="flex flex-col space-y-4">
        <Button
          type="submit"
          className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-lg py-6"
          disabled={loading}
        >
          {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
          {loading ? 'Enregistrement...' : 'Changer le mot de passe'}
        </Button>
        <p className="text-sm text-center text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            Retour à la connexion
          </Link>
        </p>
      </CardFooter>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <AuthShell description="Choisissez un nouveau mot de passe">
      <Suspense
        fallback={
          <CardContent className="flex justify-center py-6">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </CardContent>
        }
      >
        <ResetPasswordContent />
      </Suspense>
    </AuthShell>
  )
}
