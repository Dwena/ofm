'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, RotateCcw, Save, Settings } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { useToast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ErrorState, LoadingState, formatDateTime, getErrorMessage } from '@/components/admin/admin-shared'

interface PlatformSettings {
  platformFeePercentage: number
  minimumPayoutAmount: number
  registrationOpen: boolean
  maintenanceMode: boolean
  maintenanceMessage: string
}

type SettingKey = keyof PlatformSettings

interface SettingMeta {
  source: 'database' | 'environment' | 'default'
  fallbackValue: PlatformSettings[SettingKey]
  updatedAt: string | null
  updatedBy: string | null
}

interface SettingsResponse {
  settings: PlatformSettings
  meta: Record<SettingKey, SettingMeta>
}

interface FormState {
  platformFeePercentage: string
  minimumPayoutAmount: string
  registrationOpen: boolean
  maintenanceMode: boolean
  maintenanceMessage: string
}

const SETTING_LABELS: Record<SettingKey, string> = {
  platformFeePercentage: 'Commission de la plateforme',
  minimumPayoutAmount: 'Versement minimum',
  registrationOpen: 'Inscriptions ouvertes',
  maintenanceMode: 'Mode maintenance',
  maintenanceMessage: 'Message de maintenance',
}

const SOURCE_LABELS: Record<SettingMeta['source'], string> = {
  database: 'Personnalisé',
  environment: 'Variable d’environnement',
  default: 'Valeur par défaut',
}

function toForm(settings: PlatformSettings): FormState {
  return {
    platformFeePercentage: String(settings.platformFeePercentage),
    minimumPayoutAmount: String(settings.minimumPayoutAmount),
    registrationOpen: settings.registrationOpen,
    maintenanceMode: settings.maintenanceMode,
    maintenanceMessage: settings.maintenanceMessage,
  }
}

function formatFallback(value: unknown) {
  if (typeof value === 'boolean') return value ? 'activé' : 'désactivé'
  return String(value)
}

function SettingFooter({
  meta,
  settingKey,
  onReset,
  resetting,
}: {
  meta?: SettingMeta
  settingKey: SettingKey
  onReset: (key: SettingKey) => void
  resetting: boolean
}) {
  const fallback = meta ? formatFallback(meta.fallbackValue) : ''
  if (!meta) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Badge variant="outline">{SOURCE_LABELS[meta.source]}</Badge>
      {meta.source === 'database' && (
        <>
          {meta.updatedAt && <span>Modifié le {formatDateTime(meta.updatedAt)}</span>}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            disabled={resetting}
            onClick={() => onReset(settingKey)}
          >
            {!resetting && <RotateCcw className="h-3 w-3 mr-1" />}
            {resetting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            Revenir à {fallback.length > 40 ? `${fallback.slice(0, 40)}…` : fallback}
          </Button>
        </>
      )}
    </div>
  )
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        data-testid={id}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          checked ? 'bg-primary' : 'bg-input'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}

export default function AdminSettingsPage() {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState | null>(null)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: async () => (await adminApi.getSettings()).data as SettingsResponse,
  })

  useEffect(() => {
    if (data && !form) setForm(toForm(data.settings))
  }, [data, form])

  const onSaved = (response: SettingsResponse & { changes?: Record<string, unknown> }, message: string) => {
    queryClient.setQueryData(['admin-settings'], { settings: response.settings, meta: response.meta })
    queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] })
    setForm(toForm(response.settings))
    const count = Object.keys(response.changes ?? {}).length
    toast({ title: message, description: count ? `${count} paramètre(s) modifié(s)` : 'Aucune modification' })
  }

  const saveMutation = useMutation({
    mutationFn: async (payload: Partial<PlatformSettings>) => (await adminApi.updateSettings(payload)).data,
    onSuccess: (response) => onSaved(response, 'Paramètres enregistrés'),
    onError: (error) => toast({ title: 'Erreur', description: getErrorMessage(error), variant: 'destructive' }),
  })

  const resetMutation = useMutation({
    mutationFn: async (key: SettingKey) => (await adminApi.resetSetting(key)).data,
    onSuccess: (response) => onSaved(response, 'Paramètre réinitialisé'),
    onError: (error) => toast({ title: 'Erreur', description: getErrorMessage(error), variant: 'destructive' }),
  })

  const validation = useMemo(() => {
    if (!form) return {}
    const errors: Partial<Record<SettingKey, string>> = {}
    const fee = Number(form.platformFeePercentage)
    if (form.platformFeePercentage === '' || !Number.isFinite(fee) || fee < 0 || fee > 50) {
      errors.platformFeePercentage = 'Entre 0 et 50 %'
    }
    const payout = Number(form.minimumPayoutAmount)
    if (form.minimumPayoutAmount === '' || !Number.isFinite(payout) || payout < 0 || payout > 10000) {
      errors.minimumPayoutAmount = 'Entre 0 et 10 000 €'
    }
    if (!form.maintenanceMessage.trim()) errors.maintenanceMessage = 'Message requis'
    return errors
  }, [form])

  const payload = useMemo<Partial<PlatformSettings>>(() => {
    if (!form || !data) return {}
    const next: PlatformSettings = {
      platformFeePercentage: Number(form.platformFeePercentage),
      minimumPayoutAmount: Number(form.minimumPayoutAmount),
      registrationOpen: form.registrationOpen,
      maintenanceMode: form.maintenanceMode,
      maintenanceMessage: form.maintenanceMessage.trim(),
    }
    const changed: Partial<PlatformSettings> = {}
    ;(Object.keys(next) as SettingKey[]).forEach((key) => {
      if (next[key] !== data.settings[key]) (changed as Record<string, unknown>)[key] = next[key]
    })
    return changed
  }, [form, data])

  const resetSetting = async (key: SettingKey) => {
    if (!data) return
    const ok = await confirm({
      title: `Réinitialiser « ${SETTING_LABELS[key]} » ?`,
      description: `La valeur personnalisée sera supprimée et le paramètre reviendra à « ${formatFallback(
        data.meta[key]?.fallbackValue,
      )} ». ${hasChanges ? 'Vos modifications non enregistrées seront perdues.' : ''}`,
      confirmText: 'Réinitialiser',
      variant: 'destructive',
    })
    if (ok) resetMutation.mutate(key)
  }

  const save = async () => {
    if (hasErrors || !hasChanges) return
    if (payload.maintenanceMode === true) {
      const ok = await confirm({
        title: 'Activer le mode maintenance ?',
        description:
          'Tous les utilisateurs, sauf les administrateurs, recevront une erreur 503 et ne pourront plus utiliser la plateforme.',
        confirmText: 'Activer la maintenance',
        variant: 'destructive',
      })
      if (!ok) return
    }
    if (payload.registrationOpen === false) {
      const ok = await confirm({
        title: 'Fermer les inscriptions ?',
        description: 'Plus aucun nouveau compte ne pourra être créé tant que les inscriptions resteront fermées.',
        confirmText: 'Fermer les inscriptions',
        variant: 'destructive',
      })
      if (!ok) return
    }
    saveMutation.mutate(payload)
  }

  const hasChanges = Object.keys(payload).length > 0
  const hasErrors = Object.keys(validation).length > 0
  const update = (patch: Partial<FormState>) => setForm((current) => (current ? { ...current, ...patch } : current))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Settings className="h-7 w-7" />
          Paramètres de la plateforme
        </h1>
        <p className="text-muted-foreground mt-1">
          Commissions, versements, inscriptions et maintenance. Chaque modification est enregistrée dans le journal
          d&apos;audit.
        </p>
      </div>

      {isLoading || (!form && !isError) ? (
        <LoadingState />
      ) : isError || !form || !data ? (
        <ErrorState error={error} onRetry={() => refetch()} label="Impossible de charger les paramètres" />
      ) : (
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          {form.maintenanceMode && (
            <Alert variant="destructive">
              <AlertDescription>
                Le mode maintenance est activé : seuls les administrateurs peuvent utiliser la plateforme.
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Monétisation</CardTitle>
              <CardDescription>
                Appliqué aux nouveaux paiements (abonnements, pourboires, contenus payants). Les abonnements Stripe
                existants conservent la commission en vigueur à leur création.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="platformFeePercentage">Commission de la plateforme (%)</Label>
                <Input
                  id="platformFeePercentage"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={50}
                  step={0.5}
                  value={form.platformFeePercentage}
                  onChange={(e) => update({ platformFeePercentage: e.target.value })}
                  aria-invalid={!!validation.platformFeePercentage}
                />
                {validation.platformFeePercentage && (
                  <p className="text-sm text-destructive">{validation.platformFeePercentage}</p>
                )}
                <SettingFooter
                  meta={data.meta.platformFeePercentage}
                  settingKey="platformFeePercentage"
                  onReset={resetSetting}
                  resetting={resetMutation.isPending && resetMutation.variables === 'platformFeePercentage'}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="minimumPayoutAmount">Versement minimum (€)</Label>
                <Input
                  id="minimumPayoutAmount"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={10000}
                  step={1}
                  value={form.minimumPayoutAmount}
                  onChange={(e) => update({ minimumPayoutAmount: e.target.value })}
                  aria-invalid={!!validation.minimumPayoutAmount}
                />
                {validation.minimumPayoutAmount && (
                  <p className="text-sm text-destructive">{validation.minimumPayoutAmount}</p>
                )}
                <p className="text-sm text-muted-foreground">
                  Solde disponible requis avant un versement automatique à un créateur.
                </p>
                <SettingFooter
                  meta={data.meta.minimumPayoutAmount}
                  settingKey="minimumPayoutAmount"
                  onReset={resetSetting}
                  resetting={resetMutation.isPending && resetMutation.variables === 'minimumPayoutAmount'}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Accès</CardTitle>
              <CardDescription>Contrôlez qui peut rejoindre et utiliser la plateforme</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <ToggleRow
                  id="registrationOpen"
                  label="Inscriptions ouvertes"
                  description="Lorsque désactivé, la création de nouveaux comptes est refusée."
                  checked={form.registrationOpen}
                  onChange={(registrationOpen) => update({ registrationOpen })}
                />
                <SettingFooter
                  meta={data.meta.registrationOpen}
                  settingKey="registrationOpen"
                  onReset={resetSetting}
                  resetting={resetMutation.isPending && resetMutation.variables === 'registrationOpen'}
                />
              </div>
              <div className="space-y-2">
                <ToggleRow
                  id="maintenanceMode"
                  label="Mode maintenance"
                  description="L'API répond « 503 » à tous les utilisateurs sauf aux administrateurs (connexion et back-office restent accessibles)."
                  checked={form.maintenanceMode}
                  onChange={(maintenanceMode) => update({ maintenanceMode })}
                />
                <SettingFooter
                  meta={data.meta.maintenanceMode}
                  settingKey="maintenanceMode"
                  onReset={resetSetting}
                  resetting={resetMutation.isPending && resetMutation.variables === 'maintenanceMode'}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maintenanceMessage">Message de maintenance</Label>
                <Textarea
                  id="maintenanceMessage"
                  rows={3}
                  maxLength={500}
                  value={form.maintenanceMessage}
                  onChange={(e) => update({ maintenanceMessage: e.target.value })}
                  aria-invalid={!!validation.maintenanceMessage}
                />
                {validation.maintenanceMessage && (
                  <p className="text-sm text-destructive">{validation.maintenanceMessage}</p>
                )}
                <SettingFooter
                  meta={data.meta.maintenanceMessage}
                  settingKey="maintenanceMessage"
                  onReset={resetSetting}
                  resetting={resetMutation.isPending && resetMutation.variables === 'maintenanceMessage'}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!hasChanges || saveMutation.isPending}
              onClick={() => setForm(toForm(data.settings))}
            >
              Annuler les modifications
            </Button>
            <Button type="submit" disabled={!hasChanges || hasErrors || saveMutation.isPending}>
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Enregistrer
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
