'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info, Loader2, RefreshCw } from 'lucide-react'

import { notificationsApi } from '@/lib/api'
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPreferences,
} from '@/lib/notifications'
import { useAuth } from '@/contexts/auth-context'
import { useToast } from '@/hooks/use-toast'
import { getApiErrorMessage } from '@/components/auth-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const QUERY_KEY = ['notification-preferences']
type Channel = 'inApp' | 'push'

/** Per-category notification preferences (GET/PUT /notifications/preferences), saved on toggle */
export function NotificationPreferencesSettings() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: preferences, isLoading, isError, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await notificationsApi.getPreferences()).data as NotificationPreferences,
  })

  const mutation = useMutation({
    mutationFn: async (update: { category: NotificationCategory; channel: Channel; value: boolean }) =>
      (
        await notificationsApi.updatePreferences({
          [update.category]: { [update.channel]: update.value },
        })
      ).data as NotificationPreferences,
    // Optimistic toggle, rolled back on error
    onMutate: async ({ category, channel, value }) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY })
      const previous = queryClient.getQueryData<NotificationPreferences>(QUERY_KEY)
      if (previous) {
        queryClient.setQueryData<NotificationPreferences>(QUERY_KEY, {
          ...previous,
          [category]: { ...previous[category], [channel]: value },
        })
      }
      return { previous }
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous)
      toast({
        title: 'Erreur',
        description: getApiErrorMessage(error, "Impossible d'enregistrer vos préférences."),
        variant: 'destructive',
      })
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(QUERY_KEY, saved)
      toast({ title: 'Préférences enregistrées' })
    },
  })

  const categories = NOTIFICATION_CATEGORIES.filter((c) => !c.creatorOnly || user?.role === 'CREATOR')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Préférences de notifications</CardTitle>
        <CardDescription>
          Choisissez, pour chaque type, si vous êtes alerté dans l’application et par notification push.
          Les notifications désactivées « dans l’application » restent consultables dans l’historique.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError || !preferences ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">Impossible de charger vos préférences.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Réessayer
            </Button>
          </div>
        ) : (
          <>
            {categories.length > 0 && (
              <div className="divide-y rounded-lg border">
                <div className="hidden sm:grid grid-cols-[1fr_6rem_6rem] gap-2 px-4 py-2 text-xs font-medium text-muted-foreground">
                  <span>Type</span>
                  <span className="text-center">Application</span>
                  <span className="text-center">Push</span>
                </div>
                {categories.map((category) => (
                  <div
                    key={category.value}
                    className="grid grid-cols-1 sm:grid-cols-[1fr_6rem_6rem] gap-2 px-4 py-3 sm:items-center"
                  >
                    <div>
                      <p className="font-medium text-sm">{category.label}</p>
                      <p className="text-xs text-muted-foreground">{category.description}</p>
                    </div>
                    {(['inApp', 'push'] as Channel[]).map((channel) => {
                      const id = `pref-${category.value}-${channel}`
                      const pending =
                        mutation.isPending &&
                        mutation.variables?.category === category.value &&
                        mutation.variables?.channel === channel
                      return (
                        <label
                          key={channel}
                          htmlFor={id}
                          className="flex items-center gap-2 text-sm sm:justify-center cursor-pointer"
                        >
                          <input
                            id={id}
                            type="checkbox"
                            className="h-4 w-4 accent-primary cursor-pointer"
                            checked={preferences[category.value][channel]}
                            disabled={pending}
                            onChange={(e) =>
                              mutation.mutate({ category: category.value, channel, value: e.target.checked })
                            }
                          />
                          <span className="sm:sr-only">{channel === 'inApp' ? 'Application' : 'Push'}</span>
                          {pending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                        </label>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="h-4 w-4 shrink-0" />
              Les notifications liées à votre compte (paiements, abonnements, modération, sécurité) sont
              toujours envoyées.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
