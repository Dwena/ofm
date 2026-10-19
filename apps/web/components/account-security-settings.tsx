'use client'

import { useState } from 'react'
import { KeyRound, Loader2, Mail } from 'lucide-react'
import { authApi } from '@/lib/api'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AuthMessage, getApiErrorMessage } from '@/components/auth-shell'

/** Email verification status + password change (via reset link) rows of the security settings. */
export function AccountSecuritySettings() {
  const { user } = useAuth()
  const [loading, setLoading] = useState<'verify' | 'password' | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  if (!user) return null

  async function resendVerification() {
    if (!user) return
    setLoading('verify')
    setMessage(null)
    try {
      await authApi.resendVerification(user.email)
      setMessage({ type: 'success', text: `Un e-mail de vérification a été envoyé à ${user.email}.` })
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, "Impossible d'envoyer l'e-mail de vérification.") })
    } finally {
      setLoading(null)
    }
  }

  async function sendPasswordReset() {
    if (!user) return
    setLoading('password')
    setMessage(null)
    try {
      await authApi.forgotPassword(user.email)
      setMessage({
        type: 'success',
        text: `Un lien pour changer votre mot de passe a été envoyé à ${user.email}.`,
      })
    } catch (err) {
      setMessage({ type: 'error', text: getApiErrorMessage(err, "Impossible d'envoyer le lien.") })
    } finally {
      setLoading(null)
    }
  }

  return (
    <>
      {message && <AuthMessage type={message.type}>{message.text}</AuthMessage>}

      <div className="flex items-center justify-between gap-4 p-4 border rounded-lg">
        <div className="flex items-center gap-3">
          <Mail className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="font-medium flex items-center gap-2">
              Adresse e-mail
              <Badge variant={user.emailVerified ? 'success' : 'secondary'}>
                {user.emailVerified ? 'Vérifiée' : 'Non vérifiée'}
              </Badge>
            </p>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>
        {!user.emailVerified && (
          <Button variant="outline" onClick={resendVerification} disabled={loading !== null}>
            {loading === 'verify' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Renvoyer le lien
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 p-4 border rounded-lg">
        <div className="flex items-center gap-3">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="font-medium">Mot de passe</p>
            <p className="text-sm text-muted-foreground">
              Recevez un lien sécurisé par e-mail pour choisir un nouveau mot de passe.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={sendPasswordReset} disabled={loading !== null}>
          {loading === 'password' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Changer
        </Button>
      </div>
    </>
  )
}
