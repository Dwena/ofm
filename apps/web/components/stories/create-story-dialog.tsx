'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Image as ImageIcon, Loader2, Lock, Globe, Type, Upload, X } from 'lucide-react'
import { storiesApi } from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import { cn, formatFileSize } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DEFAULT_STORY_BACKGROUND, STORY_BACKGROUNDS, storyErrorMessage } from './story-utils'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const MAX_IMAGE_SIZE = 10 * 1024 * 1024
const MAX_VIDEO_SIZE = 500 * 1024 * 1024
const MAX_TEXT = 500
const MAX_CAPTION = 300

type Mode = 'media' | 'text'
type Visibility = 'PUBLIC' | 'SUBSCRIBERS_ONLY'

interface MediaInfo {
  width?: number
  height?: number
  duration?: number
}

interface CreateStoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

export function CreateStoryDialog({ open, onOpenChange, onCreated }: CreateStoryDialogProps) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<Mode>('media')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [mediaInfo, setMediaInfo] = useState<MediaInfo>({})
  const [text, setText] = useState('')
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_STORY_BACKGROUND)
  const [caption, setCaption] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('SUBSCRIBERS_ONLY')
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [errors, setErrors] = useState<{ file?: string; text?: string }>({})

  const isVideo = !!file?.type.startsWith('video/')

  // Release the preview object URL
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const reset = () => {
    setMode('media')
    setFile(null)
    setPreviewUrl(null)
    setMediaInfo({})
    setText('')
    setBackgroundColor(DEFAULT_STORY_BACKGROUND)
    setCaption('')
    setVisibility('SUBSCRIBERS_ONLY')
    setUploadProgress(null)
    setErrors({})
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (mode === 'text') {
        const response = await storiesApi.create({
          type: 'TEXT',
          text: text.trim(),
          backgroundColor,
          caption: caption.trim() || undefined,
          visibility,
        })
        return response.data
      }

      if (!file) throw new Error('missing file')
      setUploadProgress(0)
      const upload = await storiesApi.uploadMedia(file, setUploadProgress)
      const key: string | undefined = upload.data?.key
      if (!key) throw new Error('upload failed')

      const response = await storiesApi.create({
        type: isVideo ? 'VIDEO' : 'PHOTO',
        mediaUrl: key,
        caption: caption.trim() || undefined,
        visibility,
        width: mediaInfo.width,
        height: mediaInfo.height,
        duration: mediaInfo.duration,
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-stories'] })
      queryClient.invalidateQueries({ queryKey: ['stories-feed'] })
      queryClient.invalidateQueries({ queryKey: ['story-group'] })
      toast({ title: 'Story publiée', description: 'Elle restera visible pendant 24 heures.' })
      reset()
      onOpenChange(false)
      onCreated?.()
    },
    onError: (error: any) => {
      setUploadProgress(null)
      toast({
        title: 'Publication impossible',
        description: storyErrorMessage(error, "La story n'a pas pu être publiée. Réessayez."),
        variant: 'destructive',
      })
    },
  })

  const handleFile = (selected: File | undefined) => {
    if (!selected) return
    const video = selected.type.startsWith('video/')
    if (![...IMAGE_TYPES, ...VIDEO_TYPES].includes(selected.type)) {
      setErrors({ file: 'Format non pris en charge (JPEG, PNG, GIF, WebP, MP4, MOV ou WebM).' })
      return
    }
    if (selected.size > (video ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE)) {
      setErrors({
        file: `Fichier trop volumineux (max ${video ? '500 Mo' : '10 Mo'}).`,
      })
      return
    }
    setErrors({})
    setFile(selected)
    setMediaInfo({})
    setPreviewUrl(URL.createObjectURL(selected))
  }

  const handleSubmit = () => {
    if (mode === 'media' && !file) {
      setErrors({ file: 'Choisissez une photo ou une vidéo.' })
      return
    }
    if (mode === 'text' && !text.trim()) {
      setErrors({ text: 'Écrivez le texte de votre story.' })
      return
    }
    setErrors({})
    publishMutation.mutate()
  }

  const isPublishing = publishMutation.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isPublishing) return
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouvelle story</DialogTitle>
          <DialogDescription>
            Partagez une photo, une vidéo ou un texte. Votre story disparaît au bout de 24 heures.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Story type */}
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Type de story">
            {([
              { value: 'media', label: 'Photo / vidéo', icon: ImageIcon },
              { value: 'text', label: 'Texte', icon: Type },
            ] as const).map(({ value, label, icon: Icon }) => (
              <Button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                variant={mode === value ? 'default' : 'outline'}
                onClick={() => {
                  setMode(value)
                  setErrors({})
                }}
                disabled={isPublishing}
              >
                <Icon className="mr-2 h-4 w-4" />
                {label}
              </Button>
            ))}
          </div>

          {mode === 'media' ? (
            <div className="space-y-2">
              <Label>Média</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept={[...IMAGE_TYPES, ...VIDEO_TYPES].join(',')}
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              {file && previewUrl ? (
                <div className="space-y-2">
                  <div className="relative mx-auto aspect-[9/16] max-h-80 overflow-hidden rounded-lg bg-black">
                    {isVideo ? (
                      <video
                        src={previewUrl}
                        className="h-full w-full object-contain"
                        controls
                        muted
                        playsInline
                        onLoadedMetadata={(e) => {
                          const v = e.currentTarget
                          setMediaInfo({
                            width: v.videoWidth || undefined,
                            height: v.videoHeight || undefined,
                            duration: Number.isFinite(v.duration) ? Math.max(1, Math.round(v.duration)) : undefined,
                          })
                        }}
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={previewUrl}
                        alt="Aperçu"
                        className="h-full w-full object-contain"
                        onLoad={(e) =>
                          setMediaInfo({
                            width: e.currentTarget.naturalWidth || undefined,
                            height: e.currentTarget.naturalHeight || undefined,
                          })
                        }
                      />
                    )}
                    {!isPublishing && (
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        className="absolute right-2 top-2 h-8 w-8"
                        onClick={() => {
                          setFile(null)
                          setPreviewUrl(null)
                          if (fileInputRef.current) fileInputRef.current.value = ''
                        }}
                        aria-label="Retirer le média"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <p className="truncate text-center text-xs text-muted-foreground">
                    {file.name} · {formatFileSize(file.size)}
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    handleFile(e.dataTransfer.files?.[0])
                  }}
                  className={cn(
                    'flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-sm text-muted-foreground transition-colors hover:bg-muted/50',
                    errors.file && 'border-destructive',
                  )}
                >
                  <Upload className="h-8 w-8" />
                  <span className="font-medium text-foreground">Choisir une photo ou une vidéo</span>
                  <span>Format vertical recommandé (9:16) · photo 10 Mo, vidéo 500 Mo max</span>
                </button>
              )}
              {errors.file && <p className="text-sm text-destructive">{errors.file}</p>}
            </div>
          ) : (
            <div className="space-y-3">
              <div
                className="flex aspect-[9/16] max-h-64 w-full items-center justify-center overflow-hidden rounded-lg p-6 sm:mx-auto sm:w-auto"
                style={{ backgroundColor }}
              >
                <p className="whitespace-pre-wrap break-words text-center text-xl font-semibold text-white">
                  {text.trim() || 'Votre texte ici'}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="story-text">Texte</Label>
                <Textarea
                  id="story-text"
                  value={text}
                  maxLength={MAX_TEXT}
                  rows={3}
                  placeholder="Qu'avez-vous envie de partager ?"
                  onChange={(e) => {
                    setText(e.target.value)
                    if (errors.text) setErrors({})
                  }}
                  disabled={isPublishing}
                  className={cn(errors.text && 'border-destructive')}
                />
                <div className="flex justify-between text-xs">
                  <span className="text-destructive">{errors.text}</span>
                  <span className="text-muted-foreground">
                    {text.length}/{MAX_TEXT}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Couleur de fond</Label>
                <div className="flex flex-wrap gap-2">
                  {STORY_BACKGROUNDS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setBackgroundColor(color)}
                      className={cn(
                        'h-8 w-8 rounded-full border-2 transition-transform',
                        backgroundColor === color ? 'scale-110 border-foreground' : 'border-transparent',
                      )}
                      style={{ backgroundColor: color }}
                      aria-label={`Couleur ${color}`}
                      aria-pressed={backgroundColor === color}
                      disabled={isPublishing}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="story-caption">Légende (optionnel)</Label>
            <Input
              id="story-caption"
              value={caption}
              maxLength={MAX_CAPTION}
              placeholder="Ajouter une légende…"
              onChange={(e) => setCaption(e.target.value)}
              disabled={isPublishing}
            />
          </div>

          <div className="space-y-2">
            <Label>Visibilité</Label>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Visibilité">
              {([
                { value: 'SUBSCRIBERS_ONLY', label: 'Abonnés', hint: 'Réservée à vos abonnés', icon: Lock },
                { value: 'PUBLIC', label: 'Public', hint: 'Visible par vos abonnés et followers', icon: Globe },
              ] as const).map(({ value, label, hint, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={visibility === value}
                  onClick={() => setVisibility(value)}
                  disabled={isPublishing}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                    visibility === value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {isPublishing && uploadProgress !== null && mode === 'media' && (
            <div className="space-y-1">
              <Progress value={uploadProgress} />
              <p className="text-xs text-muted-foreground">
                {uploadProgress < 100 ? `Envoi du média… ${uploadProgress}%` : 'Publication…'}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              reset()
              onOpenChange(false)
            }}
            disabled={isPublishing}
          >
            Annuler
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isPublishing}>
            {isPublishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Publier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
