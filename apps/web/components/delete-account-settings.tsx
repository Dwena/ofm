'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'

import { authApi } from '@/lib/api'
import { useAuth } from '@/contexts/auth-context'
import { useToast } from '@/hooks/use-toast'
import { getApiErrorMessage } from '@/components/auth-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const CONFIRMATION_WORD = 'SUPPRIMER'

/** "Danger zone": soft-deletes the account (DELETE /auth/account) after a typed confirmation */
export function DeleteAccountSettings() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!user) return null

  const isAdmin = user.role === 'ADMIN'
  const needsTotp = !!user.twoFactorEnabled
  const canSubmit =
    confirmation.trim().toUpperCase() === CONFIRMATION_WORD &&
    password.length > 0 &&
    (!needsTotp || totpCode.length === 6) &&
    !loading

  function close(nextOpen: boolean) {
    if (loading) return
    setOpen(nextOpen)
    if (!nextOpen) {
      setPassword('')
      setTotpCode('')
      setConfirmation('')
      setError('')
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError('')
    setLoading(true)
    try {
      await authApi.deleteAccount({ password, ...(needsTotp && { totpCode }) })
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('user')
      toast({ title: 'Compte supprimé', description: 'Votre compte a été supprimé. À bientôt !' })
      window.location.href = '/'
    } catch (err) {
      setError(getApiErrorMessage(err, 'Impossible de supprimer le compte.'))
      setLoading(false)
    }
  }

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          Zone de danger
        </CardTitle>
        <CardDescription>
          La suppression de votre compte est définitive : vos informations personnelles sont effacées
          {user.role === 'CREATOR' ? ', vos contenus et vos paliers ne sont plus accessibles' : ''} et vos
          abonnements ne sont pas renouvelés.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isAdmin ? (
          <p className="text-sm text-muted-foreground">
            Un compte administrateur ne peut pas être supprimé depuis cette page.
          </p>
        ) : (
          <Button variant="destructive" onClick={() => setOpen(true)}>
            <Trash2 className="h-4 w-4 mr-2" />
            Supprimer mon compte
          </Button>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Supprimer définitivement votre compte ?</DialogTitle>
              <DialogDescription>
                Cette action est irréversible. Les abonnements en cours resteront actifs jusqu’à la fin de la
                période payée, sans renouvellement.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1">
              <Label htmlFor="delete-password">Mot de passe</Label>
              <Input
                id="delete-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>

            {needsTotp && (
              <div className="space-y-1">
                <Label htmlFor="delete-totp">Code 2FA</Label>
                <Input
                  id="delete-totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  disabled={loading}
                  className="max-w-[10rem] tracking-widest text-center"
                />
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="delete-confirmation">
                Pour confirmer, tapez <span className="font-mono font-semibold">{CONFIRMATION_WORD}</span>
              </Label>
              <Input
                id="delete-confirmation"
                autoComplete="off"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                disabled={loading}
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => close(false)} disabled={loading}>
                Annuler
              </Button>
              <Button type="submit" variant="destructive" disabled={!canSubmit}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Supprimer mon compte
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
