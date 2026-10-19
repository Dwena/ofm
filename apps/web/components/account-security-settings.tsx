'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Eye, EyeOff, KeyRound, Loader2, LogOut, Mail } from 'lucide-react'
import { authApi } from '@/lib/api'
import { useAuth } from '@/contexts/auth-context'
import { useConfirm } from '@/hooks/use-confirm'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthMessage, getApiErrorMessage } from '@/components/auth-shell'

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/

type FieldErrors = Partial<Record<'currentPassword' | 'newPassword' | 'confirmPassword', string>>

/** Email verification status, password change and "sign out everywhere" rows of the security settings. */
export function AccountSecuritySettings() {
  const { user } = useAuth()
  const { confirm } = useConfirm()
  const { toast } = useToast()
  const [loading, setLoading] = useState<'verify' | 'password' | 'logoutAll' | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [passwordOpen, setPasswordOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [passwordError, setPasswordError] = useState('')

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

  function resetPasswordForm() {
    setPasswordOpen(false)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setShowPasswords(false)
    setFieldErrors({})
    setPasswordError('')
  }

  async function submitPasswordChange(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError('')
    const errors: FieldErrors = {}
    if (!currentPassword) errors.currentPassword = 'Saisissez votre mot de passe actuel.'
    if (!PASSWORD_REGEX.test(newPassword)) {
      errors.newPassword =
        'Au moins 8 caractères, avec une majuscule, une minuscule, un chiffre et un caractère spécial (@$!%*?&).'
    } else if (newPassword === currentPassword) {
      errors.newPassword = "Le nouveau mot de passe doit être différent de l'actuel."
    }
    if (confirmPassword !== newPassword) errors.confirmPassword = 'Les mots de passe ne correspondent pas.'
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setLoading('password')
    try {
      const response = await authApi.changePassword(currentPassword, newPassword)
      // The other sessions are revoked: keep this one alive with the fresh tokens
      const { accessToken, refreshToken } = response.data ?? {}
      if (accessToken) localStorage.setItem('accessToken', accessToken)
      if (refreshToken) localStorage.setItem('refreshToken', refreshToken)
      resetPasswordForm()
      toast({
        title: 'Mot de passe modifié',
        description: 'Vos autres appareils ont été déconnectés.',
      })
    } catch (err) {
      setPasswordError(getApiErrorMessage(err, 'Impossible de modifier le mot de passe.'))
    } finally {
      setLoading(null)
    }
  }

  async function logoutEverywhere() {
    const ok = await confirm({
      title: 'Se déconnecter de tous les appareils ?',
      description:
        'Toutes vos sessions, y compris celle-ci, seront fermées. Vous devrez vous reconnecter.',
      confirmText: 'Tout déconnecter',
      variant: 'destructive',
    })
    if (!ok) return
    setLoading('logoutAll')
    try {
      await authApi.logoutAll()
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('user')
      window.location.href = '/login'
    } catch (err) {
      toast({
        title: 'Erreur',
        description: getApiErrorMessage(err, 'Impossible de fermer les sessions.'),
        variant: 'destructive',
      })
      setLoading(null)
    }
  }

  const passwordType = showPasswords ? 'text' : 'password'

  return (
    <>
      {message && <AuthMessage type={message.type}>{message.text}</AuthMessage>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4 border rounded-lg">
        <div className="flex items-center gap-3 min-w-0">
          <Mail className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="font-medium flex flex-wrap items-center gap-2">
              Adresse e-mail
              <Badge variant={user.emailVerified ? 'success' : 'secondary'}>
                {user.emailVerified ? 'Vérifiée' : 'Non vérifiée'}
              </Badge>
            </p>
            <p className="text-sm text-muted-foreground break-all">{user.email}</p>
          </div>
        </div>
        {!user.emailVerified && (
          <Button variant="outline" onClick={resendVerification} disabled={loading !== null}>
            {loading === 'verify' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Renvoyer le lien
          </Button>
        )}
      </div>

      <div className="p-4 border rounded-lg space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <KeyRound className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">Mot de passe</p>
              <p className="text-sm text-muted-foreground">
                Modifiez votre mot de passe. Vos autres appareils seront déconnectés.
              </p>
            </div>
          </div>
          {!passwordOpen && (
            <Button variant="outline" onClick={() => setPasswordOpen(true)} disabled={loading !== null}>
              Changer
            </Button>
          )}
        </div>

        {passwordOpen && (
          <form onSubmit={submitPasswordChange} className="space-y-3 border-t pt-4" noValidate>
            <div className="space-y-1">
              <Label htmlFor="current-password">Mot de passe actuel</Label>
              <Input
                id="current-password"
                type={passwordType}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={loading === 'password'}
                aria-invalid={!!fieldErrors.currentPassword}
              />
              {fieldErrors.currentPassword && <p className="text-xs text-red-600">{fieldErrors.currentPassword}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-password">Nouveau mot de passe</Label>
              <Input
                id="new-password"
                type={passwordType}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loading === 'password'}
                aria-invalid={!!fieldErrors.newPassword}
              />
              {fieldErrors.newPassword ? (
                <p className="text-xs text-red-600">{fieldErrors.newPassword}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  8 caractères minimum, avec majuscule, minuscule, chiffre et caractère spécial (@$!%*?&).
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirm-password">Confirmer le nouveau mot de passe</Label>
              <Input
                id="confirm-password"
                type={passwordType}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading === 'password'}
                aria-invalid={!!fieldErrors.confirmPassword}
              />
              {fieldErrors.confirmPassword && <p className="text-xs text-red-600">{fieldErrors.confirmPassword}</p>}
            </div>

            {passwordError && <AuthMessage type="error">{passwordError}</AuthMessage>}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={loading === 'password'}>
                {loading === 'password' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Enregistrer
              </Button>
              <Button type="button" variant="ghost" onClick={resetPasswordForm} disabled={loading === 'password'}>
                Annuler
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowPasswords((v) => !v)}
                aria-label={showPasswords ? 'Masquer les mots de passe' : 'Afficher les mots de passe'}
              >
                {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Link href="/forgot-password" className="text-sm text-primary hover:underline sm:ml-auto">
                Mot de passe oublié ?
              </Link>
            </div>
          </form>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4 border rounded-lg">
        <div className="flex items-center gap-3">
          <LogOut className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">Sessions actives</p>
            <p className="text-sm text-muted-foreground">
              Un appareil perdu ou partagé ? Fermez toutes les sessions ouvertes sur votre compte.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={logoutEverywhere} disabled={loading !== null}>
          {loading === 'logoutAll' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Tout déconnecter
        </Button>
      </div>
    </>
  )
}
