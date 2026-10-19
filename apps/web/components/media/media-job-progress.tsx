'use client'

import { useEffect, useRef } from 'react'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertCircle, CheckCircle, Loader2, Video, Image as ImageIcon, X } from 'lucide-react'
import {
  MediaJobStatus,
  TrackedMediaJob,
  useMediaJobStatus,
  useTrackedMediaJobs,
} from '@/hooks/use-media-jobs'

function labels(type: 'IMAGE' | 'VIDEO') {
  return type === 'VIDEO'
    ? { processing: 'Traitement de la vidéo', queued: 'Vidéo en file d\'attente', ready: 'Vidéo prête', failed: 'Échec du traitement de la vidéo' }
    : { processing: 'Optimisation de l\'image', queued: 'Image en file d\'attente', ready: 'Image prête', failed: 'Échec du traitement de l\'image' }
}

/**
 * Inline server-side processing progress for one uploaded file (encoding, thumbnail, watermark).
 */
export function MediaJobProgress({
  jobId,
  type,
  onStatusChange,
}: {
  jobId: string
  type: 'IMAGE' | 'VIDEO'
  onStatusChange?: (status: MediaJobStatus) => void
}) {
  const { data, isError } = useMediaJobStatus(jobId)
  const text = labels(type)
  const lastStatus = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (data && data.status !== lastStatus.current) {
      lastStatus.current = data.status
      onStatusChange?.(data)
    }
  }, [data, onStatusChange])

  if (isError) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Statut du traitement indisponible
      </p>
    )
  }

  if (!data) {
    return (
      <div className="mt-2 flex items-center text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        {text.queued}...
      </div>
    )
  }

  if (data.status === 'completed') {
    return (
      <div className="mt-2 flex items-center text-xs text-green-600">
        <CheckCircle className="h-3 w-3 mr-1" />
        {text.ready}
      </div>
    )
  }

  if (data.status === 'failed') {
    return (
      <div className="mt-2 flex items-center text-xs text-red-600 dark:text-red-400">
        <AlertCircle className="h-3 w-3 mr-1 flex-shrink-0" />
        <span>
          {text.failed}
          {data.failedReason ? ` : ${data.failedReason}` : ''}
        </span>
      </div>
    )
  }

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="flex items-center text-muted-foreground">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          {data.status === 'queued' ? text.queued : text.processing}...
        </span>
        <span className="font-medium">{data.progress}%</span>
      </div>
      <Progress value={data.progress} />
    </div>
  )
}

function TrackedJobRow({ job, onDismiss }: { job: TrackedMediaJob; onDismiss: () => void }) {
  const Icon = job.type === 'VIDEO' ? Video : ImageIcon
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <Icon className="h-5 w-5 mt-0.5 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{job.title || job.fileName}</p>
        {job.title && <p className="text-xs text-muted-foreground truncate">{job.fileName}</p>}
        <MediaJobProgress jobId={job.jobId} type={job.type} />
      </div>
      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onDismiss} aria-label="Masquer">
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}

/**
 * Creator dashboard card listing media still being processed after an upload.
 * Renders nothing when no job is being followed.
 */
export function ProcessingJobsCard() {
  const { jobs, remove } = useTrackedMediaJobs()

  if (jobs.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Traitements en cours</CardTitle>
        <CardDescription>
          Encodage et optimisation de vos derniers fichiers uploadés
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {jobs.map((job) => (
          <TrackedJobRow key={job.jobId} job={job} onDismiss={() => remove(job.jobId)} />
        ))}
      </CardContent>
    </Card>
  )
}
