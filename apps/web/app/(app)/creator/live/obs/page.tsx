'use client'

import Link from 'next/link'
import { ArrowLeft, Loader2, MonitorPlay } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { useLiveIngress } from '@/hooks/use-live-ingress'
import { ingressErrorMessage } from '@/lib/live-ingress'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ObsIngressSettings } from '@/components/live/obs/obs-ingress-settings'
import { ObsStatusBadge } from '@/components/live/obs/obs-status-badge'

/** Live polling of the OBS status on this page (test the OBS settings before going live) */
const STATUS_POLL_MS = 4000

/**
 * "Diffuser avec OBS": server URL, stream key and tutorial, to configure OBS
 * before going live (the same settings are reused for every live)
 */
export default function CreatorObsSettingsPage() {
  const { user } = useAuth()
  const isCreator = user?.role === 'CREATOR'
  const controls = useLiveIngress({ enabled: isCreator, refetchInterval: STATUS_POLL_MS })
  const { ingress, isLoading, error, unavailable } = controls

  if (!user) return null

  if (!isCreator) {
    return (
      <Card className="max-w-md mx-auto">
        <CardContent className="pt-6 text-center">
          <MonitorPlay className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Seuls les créateurs peuvent diffuser avec OBS.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-2">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/creator/live">
            <ArrowLeft className="h-4 w-4 mr-1" /> Retour au live
          </Link>
        </Button>
        <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
          <MonitorPlay className="h-7 w-7 text-primary" />
          Diffuser avec OBS
        </h1>
        <p className="text-muted-foreground">
          Utilisez OBS Studio (scènes, overlays, plusieurs caméras, carte de capture…) au lieu de la caméra du
          navigateur. Ces réglages restent les mêmes d&apos;un live à l&apos;autre.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : unavailable ? (
        <Card>
          <CardContent className="pt-6 space-y-2" data-testid="obs-unavailable">
            <p className="font-medium">Diffusion avec OBS indisponible</p>
            <p className="text-sm text-muted-foreground">
              Elle nécessite le serveur vidéo LiveKit, qui n&apos;est pas configuré sur cette plateforme. Vous pouvez
              toujours diffuser avec la caméra de votre navigateur.
            </p>
          </CardContent>
        </Card>
      ) : error || !ingress ? (
        <Card>
          <CardContent className="pt-6 space-y-3 text-center">
            <p className="text-sm text-muted-foreground">
              {ingressErrorMessage(error) ?? 'Impossible de charger vos réglages OBS.'}
            </p>
            <Button variant="outline" size="sm" onClick={() => void controls.refetch()}>
              Réessayer
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-1 min-w-0">
              <CardTitle>Vos réglages OBS</CardTitle>
              <CardDescription>
                {ingress.streamId
                  ? 'Un live en mode OBS est en cours : votre vidéo y est diffusée.'
                  : 'Aucun live en cours : un signal envoyé maintenant ne sert qu’à tester vos réglages, personne ne le voit.'}
              </CardDescription>
            </div>
            <ObsStatusBadge status={ingress.status} boundToLive={!!ingress.streamId} />
          </CardHeader>
          <CardContent>
            <ObsIngressSettings controls={controls} live={!!ingress.streamId} />
          </CardContent>
        </Card>
      )}

      {!unavailable && (
        <p className="text-sm text-muted-foreground">
          Prêt ? Créez votre live en choisissant la source « OBS » depuis{' '}
          <Link href="/creator/live" className="underline">
            l&apos;espace Live
          </Link>
          , puis cliquez sur « Démarrer le streaming » dans OBS.
        </p>
      )}
    </div>
  )
}
