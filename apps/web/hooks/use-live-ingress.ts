'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { liveApi } from '@/lib/api'
import { isIngressUnavailable, type LiveIngress } from '@/lib/live-ingress'

export const LIVE_INGRESS_QUERY_KEY = ['live-ingress'] as const

interface Options {
  enabled?: boolean
  /** Poll the OBS status (ms) while OBS mode is in use, false to stop */
  refetchInterval?: number | false
}

/**
 * The creator's OBS settings (GET /streaming/me/ingress, created on first
 * read). `unavailable` is true when the platform runs without LiveKit (OBS
 * mode impossible): the UI then hides / disables the OBS mode.
 */
export function useLiveIngress({ enabled = true, refetchInterval = false }: Options = {}) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: LIVE_INGRESS_QUERY_KEY,
    queryFn: async () => (await liveApi.getIngress()).data as LiveIngress,
    enabled,
    refetchInterval,
    // 400 INGRESS_UNAVAILABLE is final, other errors (503) may be retried
    retry: (count, error) => !isIngressUnavailable(error) && count < 2,
    staleTime: 5_000,
  })

  const store = (ingress: LiveIngress) => queryClient.setQueryData(LIVE_INGRESS_QUERY_KEY, ingress)

  const resetKey = useMutation({
    mutationFn: async () => (await liveApi.resetIngressKey()).data as LiveIngress,
    onSuccess: store,
  })

  return {
    ingress: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    unavailable: isIngressUnavailable(query.error),
    refetch: query.refetch,
    /** Update the status pushed by the socket (`obs-status`) without waiting for the next poll */
    setStatus: (status: LiveIngress['status'], streamId: string | null) =>
      queryClient.setQueryData<LiveIngress>(LIVE_INGRESS_QUERY_KEY, (old) => (old ? { ...old, status, streamId } : old)),
    resetKey,
  }
}
