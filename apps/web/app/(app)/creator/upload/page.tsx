'use client'

import { useState, useRef, DragEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { mediaApi, contentApi } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Upload, X, Image as ImageIcon, Video, FileText, Loader2, AlertCircle, CheckCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface UploadedFile {
  file: File
  preview?: string
  type: 'IMAGE' | 'VIDEO' | 'FILE'
  uploading: boolean
  progress: number
  mediaId?: string
  error?: string
  validationError?: string
}

const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB
const MAX_IMAGE_SIZE = 50 * 1024 * 1024 // 50MB
const MAX_VIDEO_SIZE = 500 * 1024 * 1024 // 500MB
const MAX_PDF_SIZE = 25 * 1024 * 1024 // 25MB

const ACCEPTED_TYPES = {
  image: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  video: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'],
  file: ['application/pdf'],
}

export default function UploadPage() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tier, setTier] = useState<'FREE' | 'BASIC' | 'PREMIUM' | 'VIP'>('FREE')
  const [price, setPrice] = useState('')
  const [isPPV, setIsPPV] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const router = useRouter()

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

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)

      const response = await mediaApi.upload(formData, {
        onUploadProgress: (progressEvent) => {
          const progress = progressEvent.total
            ? Math.round((progressEvent.loaded * 100) / progressEvent.total)
            : 0

          setFiles(prev => prev.map(f =>
            f.file === file ? { ...f, progress } : f
          ))
        },
      })

      return response.data
    },
  })

  // Create content mutation
  const createContentMutation = useMutation({
    mutationFn: async () => {
      const uploadedFiles = files.filter(f => f.mediaId)

      if (uploadedFiles.length === 0) {
        throw new Error('Aucun fichier uploadé')
      }

      // Determine content type based on files
      const hasVideo = uploadedFiles.some(f => f.type === 'VIDEO')
      const hasImage = uploadedFiles.some(f => f.type === 'IMAGE')
      const contentType = hasVideo ? 'VIDEO' : hasImage ? 'IMAGE' : 'POST'

      const response = await contentApi.create({
        title,
        description,
        tier,
        fileIds: uploadedFiles.map(f => f.mediaId!),
        type: contentType,
        isPPV,
        ppvPrice: isPPV ? Math.round(parseFloat(price) * 100) : undefined,
      })

      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creator-content'] })
      router.push('/creator/dashboard')
    },
  })

  const processFiles = (selectedFiles: File[]) => {
    const newFiles: UploadedFile[] = selectedFiles
      .map(file => {
        // Validate file
        const validationError = validateFile(file)

        const type = file.type.startsWith('image/')
          ? 'IMAGE'
          : file.type.startsWith('video/')
          ? 'VIDEO'
          : 'FILE'

        // Create preview for images
        const preview = type === 'IMAGE' ? URL.createObjectURL(file) : undefined

        // Create video thumbnail
        if (type === 'VIDEO') {
          createVideoThumbnail(file).then(thumbnail => {
            setFiles(prev => prev.map(f =>
              f.file === file ? { ...f, preview: thumbnail } : f
            ))
          })
        }

        return {
          file,
          preview,
          type,
          uploading: false,
          progress: 0,
          validationError,
        }
      })

    setFiles(prev => [...prev, ...newFiles])

    // Upload valid files
    newFiles.forEach(async (uploadFile) => {
      if (uploadFile.validationError) return

      try {
        setFiles(prev => prev.map(f =>
          f.file === uploadFile.file ? { ...f, uploading: true } : f
        ))

        const result = await uploadMutation.mutateAsync(uploadFile.file)

        setFiles(prev => prev.map(f =>
          f.file === uploadFile.file
            ? { ...f, uploading: false, mediaId: result.id, progress: 100 }
            : f
        ))
      } catch (error: any) {
        setFiles(prev => prev.map(f =>
          f.file === uploadFile.file
            ? { ...f, uploading: false, error: error.response?.data?.message || error.message }
            : f
        ))
      }
    })
  }

  const createVideoThumbnail = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.muted = true
      video.playsInline = true

      video.onloadeddata = () => {
        video.currentTime = 1 // Capture at 1 second
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

  const handleRemoveFile = (index: number) => {
    setFiles(prev => {
      const newFiles = [...prev]
      if (newFiles[index].preview) {
        URL.revokeObjectURL(newFiles[index].preview!)
      }
      newFiles.splice(index, 1)
      return newFiles
    })
  }

  const handlePublish = () => {
    createContentMutation.mutate()
  }

  const canPublish = title.trim() &&
    files.some(f => f.mediaId) &&
    !files.some(f => f.uploading) &&
    !createContentMutation.isPending

  const totalSize = files.reduce((sum, f) => sum + f.file.size, 0)
  const uploadedCount = files.filter(f => f.mediaId).length
  const errorCount = files.filter(f => f.error || f.validationError).length
  const uploadingCount = files.filter(f => f.uploading).length

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
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center
              transition-all duration-200 cursor-pointer
              ${isDragging
                ? 'border-primary bg-primary/5 scale-[1.02]'
                : 'border-muted-foreground/25 hover:border-primary hover:bg-accent'
              }
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
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
              Plusieurs fichiers supportés
            </p>
          </div>

          {/* Upload Summary */}
          {files.length > 0 && (
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg text-sm">
              <div className="flex items-center space-x-4">
                <span>
                  <strong>{files.length}</strong> fichier{files.length > 1 ? 's' : ''}
                </span>
                <span className="text-muted-foreground">
                  {(totalSize / 1024 / 1024).toFixed(2)} MB
                </span>
              </div>
              <div className="flex items-center space-x-3">
                {uploadingCount > 0 && (
                  <Badge variant="default">
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    {uploadingCount} en cours
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
              {files.map((file, index) => {
                const Icon = file.type === 'IMAGE' ? ImageIcon : file.type === 'VIDEO' ? Video : FileText
                const hasError = file.error || file.validationError

                return (
                  <div
                    key={index}
                    className={`flex items-center space-x-4 p-3 border rounded-lg transition-colors ${
                      hasError ? 'border-red-300 bg-red-50 dark:bg-red-950/20' : 'border-border'
                    }`}
                  >
                    {/* Preview */}
                    {file.preview ? (
                      <div className="relative h-16 w-16 flex-shrink-0">
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
                        {(file.file.size / 1024 / 1024).toFixed(2)} MB • {file.type}
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

                      {/* Errors */}
                      {file.validationError && (
                        <div className="flex items-center mt-2 text-xs text-red-600 dark:text-red-400">
                          <AlertCircle className="h-3 w-3 mr-1 flex-shrink-0" />
                          <span>{file.validationError}</span>
                        </div>
                      )}
                      {file.error && !file.validationError && (
                        <div className="flex items-center mt-2 text-xs text-red-600 dark:text-red-400">
                          <AlertCircle className="h-3 w-3 mr-1 flex-shrink-0" />
                          <span>{file.error}</span>
                        </div>
                      )}
                    </div>

                    {/* Status & Actions */}
                    <div className="flex items-center space-x-2 flex-shrink-0">
                      {file.uploading && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                      {file.mediaId && <CheckCircle className="h-5 w-5 text-green-600" />}
                      {hasError && <AlertCircle className="h-5 w-5 text-red-600" />}

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveFile(index)}
                        disabled={file.uploading}
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
            <label className="text-sm font-medium">
              Titre <span className="text-red-500">*</span>
            </label>
            <Input
              placeholder="Donnez un titre accrocheur à votre contenu"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground">
              {title.length}/100 caractères
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <textarea
              placeholder="Décrivez votre contenu, ajoutez des hashtags, etc."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              className="w-full min-h-[120px] px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
            <p className="text-xs text-muted-foreground">
              {description.length}/1000 caractères
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Niveau d'abonnement minimum</label>
              <Select value={tier} onValueChange={(value: any) => setTier(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FREE">Gratuit (Public)</SelectItem>
                  <SelectItem value="BASIC">Basic</SelectItem>
                  <SelectItem value="PREMIUM">Premium</SelectItem>
                  <SelectItem value="VIP">VIP</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Type de contenu</label>
              <Select value={isPPV ? 'ppv' : 'normal'} onValueChange={(value) => setIsPPV(value === 'ppv')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal (Abonnés)</SelectItem>
                  <SelectItem value="ppv">Pay-Per-View</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {isPPV && (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Prix PPV (€) <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                step="0.01"
                min="0.50"
                max="999.99"
                placeholder="5.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Prix minimum: 0.50€ • Les utilisateurs paieront ce montant pour débloquer le contenu
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-between items-center">
        <Button
          variant="outline"
          onClick={() => router.back()}
          disabled={uploadingCount > 0 || createContentMutation.isPending}
        >
          Annuler
        </Button>

        <div className="flex items-center space-x-3">
          {!canPublish && files.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {!title.trim() && 'Ajoutez un titre • '}
              {uploadingCount > 0 && `${uploadingCount} fichier(s) en cours d'upload • `}
              {!files.some(f => f.mediaId) && 'Attendez la fin des uploads'}
            </p>
          )}

          <Button
            onClick={handlePublish}
            disabled={!canPublish}
            size="lg"
          >
            {createContentMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Publication...
              </>
            ) : (
              'Publier le contenu'
            )}
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {createContentMutation.isError && (
        <Card className="border-red-300 bg-red-50 dark:bg-red-950/20">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2 text-red-600 dark:text-red-400">
              <AlertCircle className="h-5 w-5" />
              <p className="text-sm font-medium">
                Erreur: {(createContentMutation.error as any)?.response?.data?.message || 'Une erreur est survenue'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
