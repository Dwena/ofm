'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, Loader2, XCircle } from 'lucide-react'
import { authApi } from '@/lib/api'
import { getHomePath, useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CardContent, CardFooter } from '@/components/ui/card'
import { AuthMessage, AuthShell, getApiErrorMessage } from '@/components/auth-shell'

type Status = 'verifying' | 'success' | 'error' | 'missing'

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const { user, refreshUser } = useAuth()

  const [status, setStatus] = useState<Status>(token ? 'verifying' : 'missing')
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [resendLoading, setResendLoading] = useState(false)
  const [resendMessage, setResendMessage] = useState('')
  const [resendError, setResendError] = useState('')
  const requested = useRef<string | null>(null)

  // Logged-in users get their own address pre-filled in the resend form
  useEffect(() => {
    if (user?.email) setEmail((current) => current || user.email)
  }, [user?.email])

  useEffect(() => {
    if (!token) {
      setStatus('missing')
      return
    }
    // Avoid double submission (React strict mode runs effects twice in dev)
    if (requested.current === token) return
    requested.current = token

    setStatus('verifying')
    authApi
      .verifyEmail(token)
      .then(() => {
        setStatus('success')
        if (localStorage.getItem('accessToken')) {
          refreshUser().catch(() => undefined)
        }
      })
      .catch((err) => {
        setError(getApiErrorMessage(err, 'Impossible de vérifier votre adresse e-mail.'))
        setStatus('error')
      })
  }, [token, refreshUser])

  async function handleResend(e: React.FormEvent) {
    e.preventDefault()
    setResendError('')
    setResendMessage('')
    setResendLoading(true)
    try {
      await authApi.resendVerification(email.trim())
      setResendMessage(
        'Si un compte non vérifié existe pour cette adresse, un nouvel e-mail de vérification vient de vous être envoyé.'
      )
    } catch (err) {
      setResendError(getApiErrorMessage(err, "Impossible d'envoyer l'e-mail de vérification."))
    } finally {
      setResendLoading(false)
    }
  }

  return (
    <>
      <CardContent className="space-y-4">
        {status === 'verifying' && (
          <div className="flex flex-col items-center gap-3 py-6 text-muted-foreground">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p>Vérification de votre adresse e-mail...</p>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle className="h-12 w-12 text-green-500" />
            <p className="font-medium">Votre adresse e-mail a bien été confirmée !</p>
            <p className="text-sm text-muted-foreground">Vous pouvez maintenant profiter de toutes les fonctionnalités de FanVIP.</p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <XCircle className="h-12 w-12 text-red-500" />
            <p className="font-medium">{error}</p>
          </div>
        )}

        {status === 'missing' && (
          <AuthMessage type="error">Lien de vérification incomplet : aucun jeton fourni.</AuthMessage>
        )}

        {(status === 'error' || status === 'missing') && (
          <form onSubmit={handleResend} className="space-y-3 pt-2 border-t">
            <p className="text-sm text-muted-foreground pt-4">
              Recevoir un nouveau lien de vérification :
            </p>
            {resendMessage && <AuthMessage type="success">{resendMessage}</AuthMessage>}
            {resendError && <AuthMessage type="error">{resendError}</AuthMessage>}
            <Input
              type="email"
              autoComplete="email"
              aria-label="Adresse e-mail"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={resendLoading}
            />
            <Button type="submit" variant="outline" className="w-full" disabled={resendLoading}>
              {resendLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {resendLoading ? 'Envoi...' : 'Renvoyer le lien'}
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter className="flex flex-col space-y-4">
        {status === 'success' ? (
          <Button asChild className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700">
            <Link href={user ? getHomePath(user.role) : '/login'}>{user ? 'Continuer' : 'Se connecter'}</Link>
          </Button>
        ) : (
          <p className="text-sm text-center text-muted-foreground">
            <Link href="/login" className="text-primary hover:underline">
              Retour à la connexion
            </Link>
          </p>
        )}
      </CardFooter>
    </>
  )
}

export default function VerifyEmailPage() {
  return (
    <AuthShell description="Vérification de l'adresse e-mail">
      <Suspense
        fallback={
          <CardContent className="flex justify-center py-6">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </CardContent>
        }
      >
        <VerifyEmailContent />
      </Suspense>
    </AuthShell>
  )
}
