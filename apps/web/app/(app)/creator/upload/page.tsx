'use client'

import { useState, useRef, useEffect, DragEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { mediaApi, contentApi } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  Upload,
  X,
  Image as ImageIcon,
  Video,
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle,
  RotateCcw,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { MediaJobProgress } from '@/components/media/media-job-progress'
import { MediaJobState, isFinalJobState, trackMediaJobs } from '@/hooks/use-media-jobs'
import { toast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'
import {
  ContentVisibility,
  PPV_MAX_PRICE,
  PPV_MIN_PRICE,
  VISIBILITY_OPTIONS,
  contentErrorMessage,
  parsePrice,
  toDateTimeLocal,
  validatePpvPrice,
  validateScheduleDate,
} from '@/lib/creator-content'

interface UploadedFile {
  key: string
  file: File
  preview?: string
  type: 'IMAGE' | 'VIDEO' | 'FILE'
  uploading: boolean
  progress: number
  mediaId?: string
  // Server-side processing job (encoding, thumbnail, watermark) returned by /media/upload
  jobId?: string
  processing?: MediaJobState
  error?: string
  validationError?: string
}

type PublishMode = 'now' | 'schedule'
type SubmitIntent = 'publish' | 'draft'

const MAX_IMAGE_SIZE = 50 * 1024 * 1024 // 50MB
const MAX_VIDEO_SIZE = 500 * 1024 * 1024 // 500MB
const MAX_PDF_SIZE = 25 * 1024 * 1024 // 25MB
const MAX_FILES = 20

const ACCEPTED_TYPES = {
  image: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  video: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'],
  file: ['application/pdf'],
}

let fileKeySeq = 0

export default function UploadPage() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<ContentVisibility>('SUBSCRIBERS_ONLY')
  const [price, setPrice] = useState('')
  const [publishMode, setPublishMode] = useState<PublishMode>('now')
  const [scheduledFor, setScheduledFor] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [touched, setTouched] = useState({ title: false, price: false, scheduledFor: false })
  const [submitIntent, setSubmitIntent] = useState<SubmitIntent | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<UploadedFile[]>([])
  const queryClient = useQueryClient()
  const router = useRouter()
  const { confirm } = useConfirm()

  filesRef.current = files

  // Release object URLs when leaving the page
  useEffect(
    () => () => {
      filesRef.current.forEach((f) => f.preview?.startsWith('blob:') && URL.revokeObjectURL(f.preview))
    },
    [],
  )

  const isPPV = visibility === 'PPV'

  // Validate file
  const validateFile = (file: File): string | null => {
    const isImage = file.type.startsWith('image/')
    const isVideo = file.type.startsWith('video/')
    const isPDF = file.type === 'application/pdf'

    // Check file type
    if (!isImage && !isVideo && !isPDF) {
      return 'Type de fichier non supporté. Utilisez des images, vidéos ou PDF.'
    }

    // Check specific types
    if (isImage && !ACCEPTED_TYPES.image.includes(file.type)) {
      return `Format d'image non supporté. Utilisez JPG, PNG, GIF ou WEBP.`
    }
    if (isVideo && !ACCEPTED_TYPES.video.includes(file.type)) {
      return 'Format de vidéo non supporté. Utilisez MP4, MOV, AVI ou WEBM.'
    }

    // Check file size
    if (isImage && file.size > MAX_IMAGE_SIZE) {
      return `Image trop volumineuse. Taille max: ${MAX_IMAGE_SIZE / 1024 / 1024}MB`
    }
    if (isVideo && file.size > MAX_VIDEO_SIZE) {
      return `Vidéo trop volumineuse. Taille max: ${MAX_VIDEO_SIZE / 1024 / 1024}MB`
    }
    if (isPDF && file.size > MAX_PDF_SIZE) {
      return `PDF trop volumineux. Taille max: ${MAX_PDF_SIZE / 1024 / 1024}MB`
    }

    return null
  }

  const updateFile = (key: string, patch: Partial<UploadedFile>) => {
    setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)))
  }

  const uploadFile = async (uploadFile: UploadedFile) => {
    updateFile(uploadFile.key, { uploading: true, progress: 0, error: undefined })

    try {
      const formData = new FormData()
      formData.append('file', uploadFile.file)

      const response = await mediaApi.upload(formData, {
        onUploadProgress: (progressEvent: { loaded: number; total?: number }) => {
          const progress = progressEvent.total
            ? Math.round((progressEvent.loaded * 100) / progressEvent.total)
            : 0
          updateFile(uploadFile.key, { progress })
        },
      })
      const result = response.data

      updateFile(uploadFile.key, {
        uploading: false,
        mediaId: result.id,
        progress: 100,
        jobId: result.jobId ?? undefined,
        processing: result.jobId ? 'queued' : undefined,
      })
    } catch (error: any) {
      updateFile(uploadFile.key, {
        uploading: false,
        error: contentErrorMessage(error, "Échec de l'upload"),
      })
    }
  }

  const contentType = (uploaded: UploadedFile[]) => {
    if (uploaded.length === 0) return 'TEXT' as const
    if (uploaded.length > 1) return 'ALBUM' as const
    if (uploaded[0].type === 'VIDEO') return 'VIDEO' as const
    if (uploaded[0].type === 'IMAGE') return 'PHOTO' as const
    return 'TEXT' as const
  }

  // Create content mutation
  const createContentMutation = useMutation({
    mutationFn: async (intent: SubmitIntent) => {
      const uploadedFiles = files.filter((f) => f.mediaId)
      const schedule = intent === 'publish' && publishMode === 'schedule'

      const response = await contentApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        visibility,
        fileIds: uploadedFiles.map((f) => f.mediaId!),
        type: contentType(uploadedFiles),
        isPpv: isPPV,
        ppvPrice: isPPV ? parsePrice(price) : undefined,
        scheduledFor: schedule ? new Date(scheduledFor).toISOString() : undefined,
        publish: intent === 'publish' && !schedule,
      })

      return { content: response.data, intent, schedule }
    },
    onSuccess: ({ intent, schedule }) => {
      // Keep following unfinished processing jobs from the creator dashboard
      trackMediaJobs(
        files
          .filter((f) => f.mediaId && f.jobId && !isFinalJobState(f.processing) && f.type !== 'FILE')
          .map((f) => ({
            jobId: f.jobId!,
            fileName: f.file.name,
            title,
            type: f.type as 'IMAGE' | 'VIDEO',
          })),
      )
      queryClient.invalidateQueries({ queryKey: ['creator-content'] })
      queryClient.invalidateQueries({ queryKey: ['my-content'] })
      queryClient.invalidateQueries({ queryKey: ['creator-profile'] })

      if (intent === 'draft') {
        toast({ title: 'Brouillon enregistré', description: 'Vous pourrez le publier depuis « Mes contenus ».' })
        router.push('/creator/content?status=draft')
      } else if (schedule) {
        toast({
          title: 'Publication programmée',
          description: `Votre contenu sera publié le ${new Date(scheduledFor).toLocaleString('fr-FR', {
            dateStyle: 'long',
            timeStyle: 'short',
          })}.`,
        })
        router.push('/creator/content?status=scheduled')
      } else {
        toast({ title: 'Contenu publié', description: 'Vos fans peuvent dès maintenant le découvrir.' })
        router.push('/creator/dashboard')
      }
    },
    onError: (error) => {
      toast({
        title: 'La publication a échoué',
        description: contentErrorMessage(error),
        variant: 'destructive',
      })
    },
    onSettled: () => setSubmitIntent(null),
  })

  const processFiles = (selectedFiles: File[]) => {
    if (selectedFiles.length === 0) return

    const room = MAX_FILES - files.length
    if (room <= 0) {
      toast({
        title: 'Trop de fichiers',
        description: `Un contenu peut contenir au maximum ${MAX_FILES} fichiers.`,
        variant: 'destructive',
      })
      return
    }
    if (selectedFiles.length > room) {
      toast({
        title: 'Trop de fichiers',
        description: `Seuls les ${room} premiers fichiers ont été ajoutés (maximum ${MAX_FILES}).`,
        variant: 'destructive',
      })
      selectedFiles = selectedFiles.slice(0, room)
    }

    const newFiles: UploadedFile[] = selectedFiles.map((file) => {
      const validationError = validateFile(file)

      const type = file.type.startsWith('image/')
        ? 'IMAGE'
        : file.type.startsWith('video/')
          ? 'VIDEO'
          : 'FILE'

      const key = `file-${++fileKeySeq}`

      // Create preview for images
      const preview = type === 'IMAGE' && !validationError ? URL.createObjectURL(file) : undefined

      // Create video thumbnail
      if (type === 'VIDEO' && !validationError) {
        createVideoThumbnail(file).then((thumbnail) => {
          if (thumbnail) updateFile(key, { preview: thumbnail })
        })
      }

      return {
        key,
        file,
        preview,
        type,
        uploading: false,
        progress: 0,
        validationError: validationError ?? undefined,
      }
    })

    setFiles((prev) => [...prev, ...newFiles])

    const rejected = newFiles.filter((f) => f.validationError)
    if (rejected.length > 0) {
      toast({
        title: rejected.length > 1 ? `${rejected.length} fichiers refusés` : 'Fichier refusé',
        description:
          rejected.length > 1 ? 'Consultez le détail dans la liste des fichiers.' : `${rejected[0].file.name} : ${rejected[0].validationError}`,
        variant: 'destructive',
      })
    }

    // Upload valid files
    newFiles.filter((f) => !f.validationError).forEach((f) => uploadFile(f))
  }

  const createVideoThumbnail = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.muted = true
      video.playsInline = true

      video.onloadeddata = () => {
        video.currentTime = Math.min(1, video.duration || 0) // Capture at 1 second
      }

      video.onseeked = () => {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height)

        const thumbnail = canvas.toDataURL('image/jpeg')
        URL.revokeObjectURL(video.src)
        resolve(thumbnail)
      }

      video.onerror = () => {
        URL.revokeObjectURL(video.src)
        resolve('') // Return empty string on error
      }

      video.src = URL.createObjectURL(file)
    })
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || [])
    processFiles(selectedFiles)

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const droppedFiles = Array.from(e.dataTransfer.files)
    processFiles(droppedFiles)
  }

  const handleRemoveFile = (key: string) => {
    setFiles((prev) => {
      const removed = prev.find((f) => f.key === key)
      if (removed?.preview?.startsWith('blob:')) {
        URL.revokeObjectURL(removed.preview)
      }
      return prev.filter((f) => f.key !== key)
    })
  }

  const totalSize = files.reduce((sum, f) => sum + f.file.size, 0)
  const uploadedCount = files.filter((f) => f.mediaId).length
  const errorCount = files.filter((f) => f.error || f.validationError).length
  const uploadingCount = files.filter((f) => f.uploading).length
  const processingCount = files.filter((f) => f.mediaId && f.jobId && !isFinalJobState(f.processing)).length

  // Inline validation
  const errors = {
    title: !title.trim() ? 'Ajoutez un titre' : null,
    content:
      uploadedCount === 0 && !description.trim()
        ? 'Ajoutez au moins un fichier ou une description'
        : null,
    price: isPPV ? validatePpvPrice(price) : null,
    scheduledFor: publishMode === 'schedule' ? validateScheduleDate(scheduledFor) : null,
  }

  const busy = uploadingCount > 0 || createContentMutation.isPending

  const blockers = [
    errors.title,
    uploadingCount > 0 ? `${uploadingCount} fichier(s) en cours d'upload` : null,
    uploadingCount === 0 ? errors.content : null,
    isPPV && errors.price ? 'Indiquez un prix PPV valide' : null,
    publishMode === 'schedule' && errors.scheduledFor ? 'Choisissez une date de publication future' : null,
  ].filter(Boolean) as string[]

  const canPublish = blockers.length === 0 && !createContentMutation.isPending
  // A draft only needs a title and finished uploads
  const canSaveDraft =
    !errors.title && uploadingCount === 0 && !(isPPV && errors.price) && !createContentMutation.isPending

  const submit = (intent: SubmitIntent) => {
    setTouched({ title: true, price: true, scheduledFor: intent === 'publish' })
    if (intent === 'publish' ? !canPublish : !canSaveDraft) return
    setSubmitIntent(intent)
    createContentMutation.mutate(intent)
  }

  const handleCancel = async () => {
    const hasWork = files.length > 0 || title.trim() || description.trim()
    if (hasWork) {
      const ok = await confirm({
        title: 'Abandonner ce contenu ?',
        description: 'Les informations saisies et les fichiers ajoutés ne seront pas enregistrés.',
        confirmText: 'Abandonner',
        cancelText: 'Continuer l’édition',
        variant: 'destructive',
      })
      if (!ok) return
    }
    router.back()
  }

  const setProcessingState = (key: string, processing: MediaJobState) => {
    updateFile(key, { processing })
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Nouveau Contenu</h1>
        <p className="text-muted-foreground mt-2">
          Uploadez vos images, vidéos ou fichiers et partagez-les avec vos abonnés
        </p>
      </div>

      {/* File Upload Zone */}
      <Card>
        <CardHeader>
          <CardTitle>Fichiers</CardTitle>
          <CardDescription>
            Formats acceptés: Images (JPG, PNG, GIF, WEBP - max 50MB), Vidéos (MP4, MOV, AVI, WEBM - max 500MB), PDF (max 25MB)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="button"
            tabIndex={0}
            aria-label="Sélectionner des fichiers"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center
              transition-all duration-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
              ${isDragging
                ? 'border-primary bg-primary/5 scale-[1.02]'
                : 'border-muted-foreground/25 hover:border-primary hover:bg-accent'
              }
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              data-testid="upload-file-input"
              multiple
              accept="image/*,video/*,.pdf"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Upload className={`h-12 w-12 mx-auto mb-4 transition-colors ${
              isDragging ? 'text-primary' : 'text-muted-foreground'
            }`} />
            <p className="text-sm font-medium mb-1">
              {isDragging ? 'Déposez vos fichiers ici' : 'Cliquez pour sélectionner ou glissez-déposez'}
            </p>
            <p className="text-xs text-muted-foreground">
              Plusieurs fichiers supportés (album) • Sans fichier, le contenu est publié comme un post texte
            </p>
          </div>

          {/* Upload Summary */}
          {files.length > 0 && (
            <div className="flex flex-col gap-2 p-3 bg-muted rounded-lg text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center space-x-4">
                <span>
                  <strong>{files.length}</strong> fichier{files.length > 1 ? 's' : ''}
                </span>
                <span className="text-muted-foreground">
                  {(totalSize / 1024 / 1024).toFixed(2)} MB
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {uploadingCount > 0 && (
                  <Badge variant="default">
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    {uploadingCount} en cours
                  </Badge>
                )}
                {processingCount > 0 && (
                  <Badge variant="secondary">
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    {processingCount} en traitement
                  </Badge>
                )}
                {uploadedCount > 0 && (
                  <Badge variant="default" className="bg-green-600">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    {uploadedCount} terminé{uploadedCount > 1 ? 's' : ''}
                  </Badge>
                )}
                {errorCount > 0 && (
                  <Badge variant="destructive">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    {errorCount} erreur{errorCount > 1 ? 's' : ''}
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* File List */}
          {files.length > 0 && (
            <div className="space-y-2">
              {files.map((file) => {
                const Icon = file.type === 'IMAGE' ? ImageIcon : file.type === 'VIDEO' ? Video : FileText
                const hasError = file.error || file.validationError

                return (
                  <div
                    key={file.key}
                    data-testid="upload-file-item"
                    className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${
                      hasError ? 'border-red-300 bg-red-50 dark:bg-red-950/20' : 'border-border'
                    }`}
                  >
                    {/* Preview */}
                    {file.preview ? (
                      <div className="relative h-16 w-16 flex-shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={file.preview}
                          alt="Preview"
                          className="h-full w-full object-cover rounded"
                        />
                        {file.type === 'VIDEO' && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded">
                            <Video className="h-6 w-6 text-white" />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="h-16 w-16 flex-shrink-0 flex items-center justify-center bg-muted rounded">
                        <Icon className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}

                    {/* File Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(file.file.size / 1024 / 1024).toFixed(2)} MB • {file.type === 'FILE' ? 'PDF' : file.type === 'IMAGE' ? 'Image' : 'Vidéo'}
                      </p>

                      {/* Progress Bar */}
                      {file.uploading && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-muted-foreground">Upload en cours...</span>
                            <span className="font-medium">{file.progress}%</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary transition-all duration-300 ease-out"
                              style={{ width: `${file.progress}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Server-side processing (encoding / optimisation) */}
                      {!file.uploading && file.mediaId && file.jobId && file.type !== 'FILE' && (
                        <MediaJobProgress
                          jobId={file.jobId}
                          type={file.type}
                          onStatusChange={(status) => setProcessingState(file.key, status.status)}
                        />
                      )}

                      {/* Errors */}
                      {file.validationError && (
                        <div className="flex items-center mt-2 text-xs text-red-600 dark:text-red-400" data-testid="upload-file-error">
                          <AlertCircle className="h-3 w-3 mr-1 flex-shrink-0" />
                          <span>{file.validationError}</span>
                        </div>
                      )}
                      {file.error && !file.validationError && (
                        <div className="flex items-center mt-2 text-xs text-red-600 dark:text-red-400" data-testid="upload-file-error">
                          <AlertCircle className="h-3 w-3 mr-1 flex-shrink-0" />
                          <span>{file.error}</span>
                        </div>
                      )}
                    </div>

                    {/* Status & Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {file.uploading && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                      {file.mediaId && file.jobId && !isFinalJobState(file.processing) && (
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      )}
                      {file.mediaId && (!file.jobId || file.processing === 'completed') && (
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      )}
                      {file.processing === 'failed' && <AlertCircle className="h-5 w-5 text-red-600" />}
                      {file.error && !file.validationError && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => uploadFile(file)}
                          aria-label="Réessayer l'upload"
                          className="h-8 w-8 p-0"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                      {file.validationError && <AlertCircle className="h-5 w-5 text-red-600" />}

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveFile(file.key)}
                        disabled={file.uploading || createContentMutation.isPending}
                        aria-label="Retirer le fichier"
                        data-testid="upload-file-remove"
                        className="h-8 w-8 p-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Content Details */}
      <Card>
        <CardHeader>
          <CardTitle>Détails du Contenu</CardTitle>
          <CardDescription>
            Ajoutez un titre et une description pour votre contenu
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="content-title" className="text-sm font-medium">
              Titre <span className="text-red-500">*</span>
            </label>
            <Input
              id="content-title"
              name="title"
              data-testid="content-title"
              aria-label="Titre"
              placeholder="Donnez un titre accrocheur à votre contenu"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, title: true }))}
              aria-invalid={touched.title && !!errors.title}
              maxLength={100}
            />
            <div className="flex justify-between text-xs">
              <span className="text-red-600" data-testid="content-title-error">
                {touched.title && errors.title}
              </span>
              <span className="text-muted-foreground">{title.length}/100 caractères</span>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="content-description" className="text-sm font-medium">Description</label>
            <textarea
              id="content-description"
              name="description"
              data-testid="content-description"
              aria-label="Description"
              placeholder="Décrivez votre contenu, ajoutez des hashtags, etc."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              className="w-full min-h-[120px] px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            <p className="text-xs text-muted-foreground">
              {description.length}/1000 caractères
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Visibilité</label>
              <Select value={visibility} onValueChange={(value) => setVisibility(value as ContentVisibility)}>
                <SelectTrigger data-testid="content-visibility" aria-label="Visibilité">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIBILITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {VISIBILITY_OPTIONS.find((option) => option.value === visibility)?.description}
              </p>
            </div>

            {isPPV && (
              <div className="space-y-2">
                <label htmlFor="content-ppv-price" className="text-sm font-medium">
                  Prix PPV (€) <span className="text-red-500">*</span>
                </label>
                <Input
                  id="content-ppv-price"
                  type="number"
                  inputMode="decimal"
                  name="ppvPrice"
                  data-testid="content-ppv-price"
                  aria-label="Prix PPV (€)"
                  step="0.01"
                  min={PPV_MIN_PRICE}
                  max={PPV_MAX_PRICE}
                  placeholder="5.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, price: true }))}
                  aria-invalid={touched.price && !!errors.price}
                />
                {touched.price && errors.price ? (
                  <p className="text-xs text-red-600">{errors.price}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Prix minimum: 0,50 € • Les fans paieront ce montant pour débloquer le contenu
                  </p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Publication */}
      <Card>
        <CardHeader>
          <CardTitle>Publication</CardTitle>
          <CardDescription>Publiez maintenant, programmez une date ou gardez-le en brouillon</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Moment de publication">
            {([
              { value: 'now', label: 'Publier maintenant', hint: 'Visible dès la validation' },
              { value: 'schedule', label: 'Programmer', hint: 'Publié automatiquement à la date choisie' },
            ] as const).map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  publishMode === option.value ? 'border-primary bg-primary/5' : 'hover:bg-accent'
                }`}
              >
                <input
                  type="radio"
                  name="publishMode"
                  value={option.value}
                  checked={publishMode === option.value}
                  onChange={() => setPublishMode(option.value)}
                  className="mt-1"
                  data-testid={`publish-mode-${option.value}`}
                />
                <span>
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>

          {publishMode === 'schedule' && (
            <div className="space-y-2">
              <label htmlFor="content-scheduled-for" className="text-sm font-medium">
                Date et heure de publication <span className="text-red-500">*</span>
              </label>
              <Input
                id="content-scheduled-for"
                type="datetime-local"
                data-testid="content-scheduled-for"
                value={scheduledFor}
                min={toDateTimeLocal(new Date())}
                onChange={(e) => setScheduledFor(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, scheduledFor: true }))}
                aria-invalid={touched.scheduledFor && !!errors.scheduledFor}
                className="sm:w-72"
              />
              {touched.scheduledFor && errors.scheduledFor && (
                <p className="text-xs text-red-600">{errors.scheduledFor}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="space-y-3">
        {blockers.length > 0 && (files.length > 0 || title || touched.title) && (
          <p className="text-sm text-muted-foreground" data-testid="publish-blockers">
            {blockers.join(' • ')}
          </p>
        )}
        {blockers.length === 0 && processingCount > 0 && (
          <p className="text-sm text-muted-foreground">
            {processingCount} fichier(s) encore en traitement : vous pouvez publier, le suivi continue sur votre dashboard
          </p>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={createContentMutation.isPending}
          >
            Annuler
          </Button>

          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <Button
              variant="secondary"
              onClick={() => submit('draft')}
              disabled={!canSaveDraft || busy}
              data-testid="save-draft"
            >
              {submitIntent === 'draft' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Enregistrer en brouillon
            </Button>
            <Button
              onClick={() => submit('publish')}
              disabled={!canPublish || busy}
              data-testid="publish-content"
              size="lg"
            >
              {submitIntent === 'publish' ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {publishMode === 'schedule' ? 'Programmation...' : 'Publication...'}
                </>
              ) : publishMode === 'schedule' ? (
                'Programmer la publication'
              ) : (
                'Publier le contenu'
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
