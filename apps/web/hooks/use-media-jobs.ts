'use client'

import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type MediaJobState = 'queued' | 'processing' | 'completed' | 'failed'

export interface MediaJobStatus {
  jobId: string
  type: 'IMAGE' | 'VIDEO'
  status: MediaJobState
  state: string
  progress: number
  attemptsMade: number
  failedReason: string | null
  result: unknown
  createdAt: string | null
  finishedAt: string | null
}

export interface TrackedMediaJob {
  jobId: string
  fileName: string
  title?: string
  type: 'IMAGE' | 'VIDEO'
  addedAt: number
}

const STORAGE_KEY = 'ofm:media-jobs'
const CHANGE_EVENT = 'ofm:media-jobs-changed'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export const isFinalJobState = (status?: MediaJobState) =>
  status === 'completed' || status === 'failed'

/**
 * Poll GET /media/jobs/:jobId/status every 2s until the job completes or fails.
 */
export function useMediaJobStatus(jobId?: string | null) {
  return useQuery({
    queryKey: ['media-job', jobId],
    queryFn: async () => {
      const response = await api.get(`/media/jobs/${encodeURIComponent(jobId!)}/status`)
      return response.data as MediaJobStatus
    },
    enabled: !!jobId,
    retry: false,
    refetchInterval: (query) => {
      if (query.state.error) return false
      return isFinalJobState(query.state.data?.status) ? false : 2000
    },
  })
}

// ---- Per-browser list of jobs still being followed (shown on the creator dashboard) ----
// Stored in localStorage only as a convenience: the job status itself always comes from the API.

function readJobs(): TrackedMediaJob[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const jobs: TrackedMediaJob[] = raw ? JSON.parse(raw) : []
    const now = Date.now()
    return Array.isArray(jobs) ? jobs.filter((job) => job?.jobId && now - job.addedAt < MAX_AGE_MS) : []
  } catch {
    return []
  }
}

function writeJobs(jobs: TrackedMediaJob[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs))
  } catch {
    // Storage unavailable (private mode...): tracking simply won't persist
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function trackMediaJobs(jobs: Omit<TrackedMediaJob, 'addedAt'>[]) {
  if (typeof window === 'undefined' || jobs.length === 0) return
  const existing = readJobs().filter((job) => !jobs.some((j) => j.jobId === job.jobId))
  writeJobs([...jobs.map((job) => ({ ...job, addedAt: Date.now() })), ...existing])
}

export function untrackMediaJob(jobId: string) {
  if (typeof window === 'undefined') return
  writeJobs(readJobs().filter((job) => job.jobId !== jobId))
}

export function useTrackedMediaJobs() {
  const [jobs, setJobs] = useState<TrackedMediaJob[]>([])

  useEffect(() => {
    const sync = () => setJobs(readJobs())
    sync()
    window.addEventListener(CHANGE_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const remove = useCallback((jobId: string) => untrackMediaJob(jobId), [])

  return { jobs, remove }
}
