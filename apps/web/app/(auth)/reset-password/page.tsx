'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, Eye, EyeOff, Loader2 } from 'lucide-react'
import { authApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CardContent, CardFooter } from '@/components/ui/card'
import { AuthMessage, AuthShell, getApiErrorMessage } from '@/components/auth-shell'

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/

function ResetPasswordContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!token) return
    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }
    if (!PASSWORD_REGEX.test(password)) {
      setError(
        'Le mot de passe doit contenir au moins 8 caractères, dont une majuscule, une minuscule, un chiffre et un caractère spécial (@$!%*?&).'
      )
      return
    }

    setLoading(true)
    try {
      await authApi.resetPassword(token, password)
      // All sessions were revoked server-side
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('user')
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
          <AuthMessage type="error">
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
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              autoComplete="new-password"
              className="pr-10"
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            8 caractères minimum, avec une majuscule, une minuscule, un chiffre et un caractère spécial.
          </p>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="confirmPassword">
            Confirmer le mot de passe
          </label>
          <Input
            id="confirmPassword"
            type={showPassword ? 'text' : 'password'}
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
