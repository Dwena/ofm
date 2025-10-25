'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { mediaApi, contentApi } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Upload, X, Image as ImageIcon, Video, FileText, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface UploadedFile {
  file: File
  preview?: string
  type: 'IMAGE' | 'VIDEO' | 'FILE'
  uploading: boolean
  progress: number
  mediaId?: string
  error?: string
}

export default function UploadPage() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tier, setTier] = useState<'FREE' | 'BASIC' | 'PREMIUM' | 'VIP'>('FREE')
  const [price, setPrice] = useState('')
  const [isPPV, setIsPPV] = useState(false)

  const queryClient = useQueryClient()
  const router = useRouter()

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

      const response = await contentApi.create({
        title,
        description,
        tier,
        mediaIds: uploadedFiles.map(f => f.mediaId!),
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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || [])

    const newFiles: UploadedFile[] = selectedFiles.map(file => {
      const type = file.type.startsWith('image/')
        ? 'IMAGE'
        : file.type.startsWith('video/')
        ? 'VIDEO'
        : 'FILE'

      const preview = type === 'IMAGE' ? URL.createObjectURL(file) : undefined

      return {
        file,
        preview,
        type,
        uploading: false,
        progress: 0,
      }
    })

    setFiles(prev => [...prev, ...newFiles])

    // Upload each file
    for (const uploadFile of newFiles) {
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
            ? { ...f, uploading: false, error: error.message }
            : f
        ))
      }
    }
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

  const canPublish = title.trim() && files.some(f => f.mediaId) && !createContentMutation.isPending

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Nouveau Contenu</h1>
        <p className="text-muted-foreground mt-2">
          Uploadez vos images, vidéos ou fichiers
        </p>
      </div>

      {/* File Upload Zone */}
      <Card>
        <CardHeader>
          <CardTitle>Fichiers</CardTitle>
          <CardDescription>
            Formats acceptés: Images (JPG, PNG, GIF), Vidéos (MP4, MOV), Fichiers (PDF)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary transition-colors cursor-pointer">
            <input
              type="file"
              multiple
              accept="image/*,video/*,.pdf"
              onChange={handleFileSelect}
              className="hidden"
              id="file-upload"
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Cliquez pour sélectionner des fichiers ou glissez-les ici
              </p>
            </label>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="space-y-2">
              {files.map((file, index) => {
                const Icon = file.type === 'IMAGE' ? ImageIcon : file.type === 'VIDEO' ? Video : FileText

                return (
                  <div
                    key={index}
                    className="flex items-center space-x-4 p-3 border rounded-lg"
                  >
                    {file.preview ? (
                      <img
                        src={file.preview}
                        alt="Preview"
                        className="h-12 w-12 object-cover rounded"
                      />
                    ) : (
                      <div className="h-12 w-12 flex items-center justify-center bg-muted rounded">
                        <Icon className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(file.file.size / 1024 / 1024).toFixed(2)} MB
                      </p>

                      {file.uploading && (
                        <div className="mt-1">
                          <div className="h-1 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary transition-all duration-300"
                              style={{ width: `${file.progress}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {file.error && (
                        <p className="text-xs text-red-500 mt-1">{file.error}</p>
                      )}
                    </div>

                    <div className="flex items-center space-x-2">
                      {file.uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                      {file.mediaId && <Badge variant="success">OK</Badge>}
                      {file.error && <Badge variant="destructive">Erreur</Badge>}

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveFile(index)}
                        disabled={file.uploading}
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
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Titre *</label>
            <Input
              placeholder="Titre de votre contenu"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <textarea
              placeholder="Décrivez votre contenu..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full min-h-[100px] px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Niveau d'abonnement</label>
              <Select value={tier} onValueChange={(value: any) => setTier(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FREE">Gratuit</SelectItem>
                  <SelectItem value="BASIC">Basic</SelectItem>
                  <SelectItem value="PREMIUM">Premium</SelectItem>
                  <SelectItem value="VIP">VIP</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <Select value={isPPV ? 'ppv' : 'normal'} onValueChange={(value) => setIsPPV(value === 'ppv')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="ppv">Pay-Per-View</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {isPPV && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Prix PPV (€)</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="5.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end space-x-4">
        <Button
          variant="outline"
          onClick={() => router.back()}
        >
          Annuler
        </Button>
        <Button
          onClick={handlePublish}
          disabled={!canPublish}
        >
          {createContentMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Publication...
            </>
          ) : (
            'Publier'
          )}
        </Button>
      </div>
    </div>
  )
}
