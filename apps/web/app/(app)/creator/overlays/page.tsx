'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Bell, Loader2, MessageSquare, MonitorPlay, RefreshCw, Sparkles, Target } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/hooks/use-confirm'
import { useToast } from '@/hooks/use-toast'
import { OverlayPreview, OverlayUrlField } from '@/components/overlays/overlay-preview'
import { WidgetSettingsForm } from '@/components/overlays/widget-settings-form'
import {
  OVERLAY_TEST_LABELS,
  OVERLAY_WIDGET_LABELS,
  overlayErrorMessage,
  overlaysApi,
  type OverlaySettingsMap,
  type OverlayTestEvent,
  type OverlayWidget,
  type OwnOverlays,
  type OwnOverlayWidget,
} from '@/lib/overlays'

const QUERY_KEY = ['creator-overlays']

/** "Tester" buttons shown in each widget card */
const WIDGET_TESTS: Record<OverlayWidget, OverlayTestEvent[]> = {
  ALERTS: ['alert', 'menu-request', 'goal-reached'],
  GOALS: [],
  TIP_MENU: [],
  CHAT: ['chat'],
  REQUESTS: ['menu-request'],
}

const TEST_ICONS: Record<OverlayTestEvent, typeof Bell> = {
  alert: Bell,
  'menu-request': Sparkles,
  'goal-reached': Target,
  chat: MessageSquare,
}

function TestButtons({ events, onTest, pending }: { events: OverlayTestEvent[]; onTest: (event: OverlayTestEvent) => void; pending: OverlayTestEvent | null }) {
  if (events.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {events.map((event) => {
        const Icon = TEST_ICONS[event]
        return (
          <Button
            key={event}
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onTest(event)}
            disabled={pending === event}
            data-testid={`overlay-test-${event}`}
          >
            {pending === event ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Icon className="mr-2 h-4 w-4" />}
            {OVERLAY_TEST_LABELS[event]}
          </Button>
        )
      })}
    </div>
  )
}

export default function CreatorOverlaysPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [testing, setTesting] = useState<OverlayTestEvent | null>(null)
  const [savingWidget, setSavingWidget] = useState<OverlayWidget | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await overlaysApi.getMine()).data,
  })

  const saveMutation = useMutation({
    mutationFn: async ({ widget, settings }: { widget: OverlayWidget; settings: OverlaySettingsMap[OverlayWidget] }) =>
      (await overlaysApi.updateWidget(widget, settings)).data,
    onMutate: ({ widget }) => setSavingWidget(widget),
    onSuccess: ({ widget, settings }) => {
      queryClient.setQueryData<OwnOverlays>(QUERY_KEY, (current) =>
        current
          ? { ...current, widgets: current.widgets.map((item) => (item.widget === widget ? { ...item, settings } : item)) }
          : current,
      )
      toast({ title: 'Réglages enregistrés', description: 'Vos widgets ouverts dans OBS sont mis à jour.' })
    },
    onError: (error) =>
      toast({ title: 'Enregistrement impossible', description: overlayErrorMessage(error, 'Vérifiez les valeurs saisies.'), variant: 'destructive' }),
    onSettled: () => setSavingWidget(null),
  })

  const rotateMutation = useMutation({
    mutationFn: async () => (await overlaysApi.rotateToken()).data,
    onSuccess: (overlays) => {
      queryClient.setQueryData(QUERY_KEY, overlays)
      toast({ title: 'Nouveaux liens générés', description: 'Mettez à jour l’URL de chaque source Navigateur dans OBS.' })
    },
    onError: () => toast({ title: 'Régénération impossible', description: 'Réessayez dans un instant.', variant: 'destructive' }),
  })

  const sendTest = async (event: OverlayTestEvent) => {
    setTesting(event)
    try {
      const { data: result } = await overlaysApi.sendTest(event)
      toast({
        title: 'Test envoyé',
        description: result.overlaysConnected
          ? 'Visible uniquement dans vos widgets (aperçus et OBS), jamais par vos fans.'
          : 'Aucun widget ouvert pour le moment : ouvrez un aperçu ou OBS.',
      })
    } catch (error) {
      toast({ title: 'Test impossible', description: overlayErrorMessage(error, 'Réessayez dans un instant.'), variant: 'destructive' })
    } finally {
      setTesting(null)
    }
  }

  const rotate = async () => {
    const ok = await confirm({
      title: 'Régénérer les liens des widgets ?',
      description:
        'Les URL actuelles cesseront immédiatement de fonctionner : les widgets déjà ajoutés dans OBS afficheront une erreur. Vous devrez coller les nouvelles URL dans chaque source Navigateur.',
      confirmText: 'Régénérer les liens',
      cancelText: 'Annuler',
      variant: 'destructive',
    })
    if (ok) rotateMutation.mutate()
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/creator/live" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
            <ArrowLeft className="h-4 w-4" /> Live
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
            <MonitorPlay className="h-7 w-7 text-primary" />
            Widgets OBS
          </h1>
          <p className="text-muted-foreground">
            Alertes, objectifs, menu, chat et demandes de vos lives, à ajouter comme sources dans OBS Studio.
          </p>
        </div>
        <Button variant="outline" onClick={rotate} disabled={!data || rotateMutation.isPending} data-testid="overlay-rotate">
          {rotateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Régénérer les liens
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ajouter un widget dans OBS</CardTitle>
          <CardDescription>Une source par widget, à placer où vous voulez sur votre scène.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-2">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>Dans OBS, sous <strong>Sources</strong>, cliquez sur <strong>+</strong> puis <strong>Navigateur</strong>.</li>
            <li>Copiez l’URL du widget ci-dessous et collez-la dans le champ <strong>URL</strong>.</li>
            <li>Indiquez la <strong>largeur</strong> et la <strong>hauteur</strong> recommandées du widget.</li>
            <li>
              Pour les alertes, cochez <strong>« Contrôler l’audio via OBS »</strong> pour entendre les sons dans votre
              mixage.
            </li>
            <li>Validez : le fond est transparent, seul le widget apparaît sur votre live.</li>
          </ol>
          <div className="space-y-2 rounded-lg bg-muted p-3 text-muted-foreground">
            <p>
              Les réglages enregistrés s’appliquent immédiatement dans OBS, sans recharger la source. Les boutons
              « Tester » n’affichent rien à vos fans : uniquement dans vos widgets.
            </p>
            <p>
              Ces URL sont secrètes : quiconque les connaît peut voir vos widgets. En cas de fuite, utilisez
              « Régénérer les liens ».
            </p>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p>Impossible de charger vos widgets.</p>
            <Button variant="outline" onClick={() => refetch()}>
              Réessayer
            </Button>
          </CardContent>
        </Card>
      )}

      {data?.widgets.map((item: OwnOverlayWidget) => {
        const labels = OVERLAY_WIDGET_LABELS[item.widget]
        return (
          <Card key={item.widget} data-testid={`overlay-card-${item.slug}`} className="min-w-0">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="text-lg">{labels.title}</CardTitle>
                  <CardDescription>{labels.description}</CardDescription>
                </div>
                <Badge variant="secondary" className="shrink-0" title="Taille recommandée de la source Navigateur">
                  {item.width} × {item.height} px
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid min-w-0 gap-6 lg:grid-cols-2">
              <div className="min-w-0 space-y-3">
                <OverlayPreview url={item.url} width={item.width} height={item.height} title={labels.title} />
                <OverlayUrlField url={item.url} widget={item.slug} />
                <p className="text-xs text-muted-foreground">
                  Source Navigateur : largeur {item.width}, hauteur {item.height}
                  {item.widget === 'ALERTS' && ' · cochez « Contrôler l’audio via OBS »'}.
                </p>
                <TestButtons events={WIDGET_TESTS[item.widget]} onTest={sendTest} pending={testing} />
              </div>
              <div className="min-w-0">
                <WidgetSettingsForm
                  widget={item.widget}
                  settings={item.settings}
                  saving={savingWidget === item.widget}
                  onSave={(settings) => saveMutation.mutate({ widget: item.widget, settings })}
                />
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
