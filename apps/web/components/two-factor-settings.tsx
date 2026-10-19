'use client'

import { useState } from 'react'
import { Loader2, Shield, ShieldCheck } from 'lucide-react'
import { authApi } from '@/lib/api'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { AuthMessage, getApiErrorMessage } from '@/components/auth-shell'

type Mode = 'idle' | 'setup' | 'disable'

export function TwoFactorSettings() {
  const { user, refreshUser } = useAuth()
  const [mode, setMode] = useState<Mode>('idle')
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const enabled = !!user?.twoFactorEnabled

  function reset(nextMode: Mode = 'idle') {
    setMode(nextMode)
    setCode('')
    setError('')
    setQrCode('')
    setSecret('')
  }

  async function startSetup() {
    setError('')
    setSuccess('')
    setLoading(true)
    try {
      const response = await authApi.enable2FA()
      setQrCode(response.data.qrCode)
      setSecret(response.data.secret)
      setMode('setup')
    } catch (err) {
      setError(getApiErrorMessage(err, "Impossible de démarrer l'activation de la 2FA."))
    } finally {
      setLoading(false)
    }
  }

  async function confirmSetup(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await authApi.verify2FA(code)
      await refreshUser()
      reset()
      setSuccess("L'authentification à deux facteurs est activée.")
    } catch (err) {
      setCode('')
      setError(getApiErrorMessage(err, 'Code invalide.'))
    } finally {
      setLoading(false)
    }
  }

  async function confirmDisable(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await authApi.disable2FA(code)
      await refreshUser()
      reset()
      setSuccess("L'authentification à deux facteurs est désactivée.")
    } catch (err) {
      setCode('')
      setError(getApiErrorMessage(err, 'Code invalide.'))
    } finally {
      setLoading(false)
    }
  }

  const codeInput = (
    <Input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      placeholder="123456"
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
      maxLength={6}
      required
      disabled={loading}
      className="max-w-[10rem] tracking-widest text-center"
      aria-label="Code à 6 chiffres"
    />
  )

  return (
    <div className="p-4 border rounded-lg space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {enabled ? (
            <ShieldCheck className="h-5 w-5 text-green-600" />
          ) : (
            <Shield className="h-5 w-5 text-muted-foreground" />
          )}
          <div>
            <p className="font-medium flex items-center gap-2">
              Authentification à deux facteurs
              <Badge variant={enabled ? 'default' : 'secondary'}>{enabled ? 'Activée' : 'Désactivée'}</Badge>
            </p>
            <p className="text-sm text-muted-foreground">
              Protégez votre compte avec un code généré par une application (Google Authenticator, Authy...).
            </p>
          </div>
        </div>
        {mode === 'idle' &&
          (enabled ? (
            <Button variant="outline" onClick={() => reset('disable')}>
              Désactiver
            </Button>
          ) : (
            <Button variant="outline" onClick={startSetup} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Activer
            </Button>
          ))}
      </div>

      {success && mode === 'idle' && <AuthMessage type="success">{success}</AuthMessage>}
      {error && <AuthMessage type="error">{error}</AuthMessage>}

      {mode === 'setup' && (
        <form onSubmit={confirmSetup} className="space-y-4 border-t pt-4">
          <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
            <li>Scannez ce QR code avec votre application d'authentification.</li>
            <li>Saisissez le code à 6 chiffres affiché pour confirmer.</li>
          </ol>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            {qrCode && (
              <img
                src={qrCode}
                alt="QR code d'activation de la 2FA"
                className="h-44 w-44 rounded-md border bg-white p-2"
              />
            )}
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">Impossible de scanner ? Saisissez cette clé manuellement :</p>
              <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-xs">{secret}</code>
              <p className="text-xs text-muted-foreground">Ce QR code expire dans 10 minutes.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {codeInput}
            <Button type="submit" disabled={loading || code.length !== 6}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmer
            </Button>
            <Button type="button" variant="ghost" onClick={() => reset()} disabled={loading}>
              Annuler
            </Button>
          </div>
        </form>
      )}

      {mode === 'disable' && (
        <form onSubmit={confirmDisable} className="space-y-3 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Pour désactiver la 2FA, saisissez le code actuel de votre application d'authentification.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {codeInput}
            <Button type="submit" variant="destructive" disabled={loading || code.length !== 6}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Désactiver la 2FA
            </Button>
            <Button type="button" variant="ghost" onClick={() => reset()} disabled={loading}>
              Annuler
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
