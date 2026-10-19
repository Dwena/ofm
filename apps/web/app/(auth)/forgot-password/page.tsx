'use client'

import { useState } from 'react'
import Link from 'next/link'
import { authApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CardContent, CardFooter } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'
import { AuthMessage, AuthShell, getApiErrorMessage, useRedirectIfAuthenticated } from '@/components/auth-shell'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const checkingSession = useRedirectIfAuthenticated()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await authApi.forgotPassword(email.trim())
      setSent(true)
    } catch (err) {
      setError(getApiErrorMessage(err, "Impossible d'envoyer le lien de réinitialisation."))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell description="Mot de passe oublié" loading={checkingSession}>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {error && <AuthMessage type="error" testId="forgot-password-error">{error}</AuthMessage>}
          {sent ? (
            <AuthMessage type="success">
              Si un compte existe pour <strong>{email}</strong>, vous allez recevoir un e-mail contenant un
              lien pour réinitialiser votre mot de passe. Ce lien est valable 1 heure.
            </AuthMessage>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Saisissez l'adresse e-mail de votre compte : nous vous enverrons un lien pour choisir un nouveau mot de passe.
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="email">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="email@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
            </>
          )}
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          {sent ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setSent(false)
                setEmail('')
              }}
            >
              Utiliser une autre adresse
            </Button>
          ) : (
            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-lg py-6"
              disabled={loading}
            >
              {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
              {loading ? 'Envoi...' : 'Envoyer le lien'}
            </Button>
          )}
          <p className="text-sm text-center text-muted-foreground">
            <Link href="/login" className="text-primary hover:underline">
              Retour à la connexion
            </Link>
          </p>
        </CardFooter>
      </form>
    </AuthShell>
  )
}
