'use client'

import { useState } from 'react'
import { Check, Copy, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'
import type { useLiveIngress } from '@/hooks/use-live-ingress'
import {
  INPUT_TYPE_OPTIONS,
  ingressErrorMessage,
  maskSecret,
  obsSetupSteps,
  type IngressInputType,
  type LiveIngress,
} from '@/lib/live-ingress'
import { cn } from '@/lib/utils'

type IngressControls = ReturnType<typeof useLiveIngress>

async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function CopyField({
  id,
  label,
  value,
  secret = false,
  hint,
}: {
  id: string
  label: string
  value: string
  secret?: boolean
  hint?: string
}) {
  const { toast } = useToast()
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (await copyText(value)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      toast({ title: `${label} copiée`, description: secret ? 'Ne la partagez avec personne.' : undefined })
    } else {
      toast({
        title: 'Copie impossible',
        description: secret ? 'Affichez la clé puis sélectionnez-la pour la copier.' : 'Sélectionnez le texte pour le copier.',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-1.5 min-w-0">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2 min-w-0">
        <code
          id={id}
          data-testid={`${id}-value`}
          className="flex-1 min-w-0 truncate rounded-md border bg-muted px-3 py-2 text-sm font-mono select-all"
          title={secret && !shown ? undefined : value}
        >
          {secret && !shown ? maskSecret(value) : value}
        </code>
        {secret && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? 'Masquer la clé' : 'Afficher la clé'}
            title={shown ? 'Masquer la clé' : 'Afficher la clé'}
            data-testid={`${id}-toggle`}
          >
            {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => void handleCopy()}
          aria-label={`Copier : ${label}`}
          title="Copier"
          data-testid={`${id}-copy`}
        >
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

interface ObsIngressSettingsProps {
  controls: IngressControls
  /** Hide the step-by-step guide (e.g. while live, shown on demand) */
  showGuide?: boolean
  /** A live is in progress in OBS mode: changing protocol / key disconnects OBS */
  live?: boolean
}

/**
 * OBS settings of the creator: protocol (WHIP / RTMP), server URL, stream key
 * (masked, show / copy / regenerate) and the OBS setup guide
 */
export function ObsIngressSettings({ controls, showGuide = true, live = false }: ObsIngressSettingsProps) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const { ingress, setInputType, resetKey } = controls
  if (!ingress) return null

  const busy = setInputType.isPending || resetKey.isPending

  const handleInputType = async (inputType: IngressInputType) => {
    if (inputType === ingress.inputType || busy) return
    const ok = await confirm({
      title: inputType === 'WHIP' ? 'Passer en WHIP ?' : 'Passer en RTMP ?',
      description: `Une nouvelle URL de serveur et une nouvelle clé seront générées : mettez à jour les réglages d’OBS.${
        live ? ' OBS sera déconnecté du live en cours.' : ''
      }`,
      confirmText: 'Changer de protocole',
    })
    if (!ok) return
    setInputType.mutate(inputType, {
      onSuccess: () => toast({ title: `Protocole ${inputType} activé`, description: 'Copiez la nouvelle clé dans OBS.' }),
      onError: (error) =>
        toast({
          title: 'Changement impossible',
          description: ingressErrorMessage(error) ?? 'Une erreur est survenue. Réessayez.',
          variant: 'destructive',
        }),
    })
  }

  const handleReset = async () => {
    const ok = await confirm({
      title: 'Régénérer la clé de stream ?',
      description: `L’ancienne clé cessera immédiatement de fonctionner : vous devrez coller la nouvelle dans OBS.${
        live ? ' OBS sera déconnecté du live en cours jusqu’à ce que vous mettiez la clé à jour.' : ''
      }`,
      confirmText: 'Régénérer la clé',
      variant: 'destructive',
    })
    if (!ok) return
    resetKey.mutate(undefined, {
      onSuccess: () => toast({ title: 'Nouvelle clé générée', description: 'Collez-la dans OBS avant de diffuser.' }),
      onError: (error) =>
        toast({
          title: 'Régénération impossible',
          description: ingressErrorMessage(error) ?? 'Une erreur est survenue. Réessayez.',
          variant: 'destructive',
        }),
    })
  }

  return (
    <div className="space-y-5 min-w-0" data-testid="obs-settings">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium mb-2">Protocole</legend>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Protocole">
          {INPUT_TYPE_OPTIONS.map((option) => {
            const selected = option.value === ingress.inputType
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={busy}
                onClick={() => void handleInputType(option.value)}
                data-testid={`obs-input-${option.value}`}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors disabled:opacity-60',
                  selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted',
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  {option.label}
                  {option.badge && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal">{option.badge}</span>
                  )}
                  {selected && setInputType.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{option.description}</span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <CopyField id="obs-server-url" label="URL du serveur" value={ingress.serverUrl} />
      <CopyField
        id="obs-stream-key"
        label={ingress.inputType === 'WHIP' ? 'Clé de stream (Bearer Token)' : 'Clé de stream'}
        value={ingress.streamKey}
        secret
        hint="Gardez cette clé secrète : toute personne qui la possède peut diffuser sur vos lives."
      />

      <Button type="button" variant="outline" onClick={() => void handleReset()} disabled={busy} data-testid="obs-reset-key">
        {resetKey.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
        Régénérer la clé
      </Button>

      {showGuide && <ObsSetupGuide ingress={ingress} />}
    </div>
  )
}

/** Step-by-step OBS configuration (French), for the protocol in use */
export function ObsSetupGuide({ ingress }: { ingress: LiveIngress }) {
  const steps = obsSetupSteps(ingress.inputType)
  return (
    <div className="rounded-lg border p-4 space-y-3" data-testid="obs-guide">
      <p className="font-medium">Configurer OBS ({ingress.inputType})</p>
      <ol className="space-y-3 text-sm">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3 min-w-0">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="font-medium break-words">{step.title}</p>
              <p className="text-muted-foreground break-words">
                {step.detail}
                {step.copy === 'serverUrl' && (
                  <>
                    {' '}
                    <code className="break-all rounded bg-muted px-1 text-xs">{ingress.serverUrl}</code>
                  </>
                )}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        {ingress.inputType === 'WHIP'
          ? 'WHIP transmet votre vidéo telle quelle : réglez la qualité dans OBS, vos spectateurs recevront exactement ce flux.'
          : 'En RTMP, votre vidéo est convertie en plusieurs qualités pour s’adapter à la connexion de chaque spectateur.'}
      </p>
    </div>
  )
}
