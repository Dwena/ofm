'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi, mediaApi } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Camera,
  Loader2,
  Save,
  Upload,
  X,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
  Shield,
  Bell,
  CreditCard
} from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { useRouter } from 'next/navigation'

export default function SettingsPage() {
  const { user, refreshUser } = useAuth()
  const queryClient = useQueryClient()
  const router = useRouter()

  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [location, setLocation] = useState('')
  const [website, setWebsite] = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [avatarPreview, setAvatarPreview] = useState('')
  const [coverPreview, setCoverPreview] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)

  // Initialize form with user data
  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '')
      setBio(user.bio || '')
      setLocation(user.location || '')
      setWebsite(user.website || '')
      setAvatarPreview(user.avatar || '')
      setCoverPreview(user.coverImage || '')
    }
  }, [user])

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await usersApi.updateProfile(data)
      return response.data
    },
    onSuccess: () => {
      refreshUser()
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    },
  })

  // Upload image mutation
  const uploadImageMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      const response = await mediaApi.uploadImage(file)
      return response.data
    },
  })

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file
    if (!file.type.startsWith('image/')) {
      alert('Veuillez sélectionner une image')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('L\'image ne doit pas dépasser 10 MB')
      return
    }

    setUploadingAvatar(true)
    try {
      // Create preview
      const preview = URL.createObjectURL(file)
      setAvatarPreview(preview)

      // Upload to server
      const result = await uploadImageMutation.mutateAsync(file)

      // Update profile with new avatar URL
      await updateProfileMutation.mutateAsync({
        avatar: result.url,
      })
    } catch (error: any) {
      alert(error.response?.data?.message || 'Erreur lors de l\'upload')
      setAvatarPreview(user?.avatar || '')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file
    if (!file.type.startsWith('image/')) {
      alert('Veuillez sélectionner une image')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('L\'image ne doit pas dépasser 10 MB')
      return
    }

    setUploadingCover(true)
    try {
      // Create preview
      const preview = URL.createObjectURL(file)
      setCoverPreview(preview)

      // Upload to server
      const result = await uploadImageMutation.mutateAsync(file)

      // Update profile with new cover URL
      await updateProfileMutation.mutateAsync({
        coverImage: result.url,
      })
    } catch (error: any) {
      alert(error.response?.data?.message || 'Erreur lors de l\'upload')
      setCoverPreview(user?.coverImage || '')
    } finally {
      setUploadingCover(false)
    }
  }

  const handleSaveProfile = () => {
    updateProfileMutation.mutate({
      displayName: displayName.trim() || undefined,
      bio: bio.trim() || undefined,
      location: location.trim() || undefined,
      website: website.trim() || undefined,
    })
  }

  const hasChanges =
    displayName !== (user?.displayName || '') ||
    bio !== (user?.bio || '') ||
    location !== (user?.location || '') ||
    website !== (user?.website || '')

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Chargement...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Paramètres</h1>
        <p className="text-muted-foreground mt-2">
          Gérez vos informations de profil et vos préférences
        </p>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList>
          <TabsTrigger value="profile">Profil</TabsTrigger>
          <TabsTrigger value="security">Sécurité</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          {user.role === 'CREATOR' && (
            <TabsTrigger value="payments">Paiements</TabsTrigger>
          )}
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-6">
          {/* Cover Image */}
          <Card>
            <CardHeader>
              <CardTitle>Image de couverture</CardTitle>
              <CardDescription>
                Image affichée en haut de votre profil (recommandé: 1500x500px)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <div className="w-full h-48 rounded-lg overflow-hidden bg-muted relative">
                  {coverPreview ? (
                    <img
                      src={coverPreview}
                      alt="Cover"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      <Camera className="h-12 w-12" />
                    </div>
                  )}

                  {uploadingCover && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 text-white animate-spin" />
                    </div>
                  )}
                </div>

                <div className="absolute bottom-4 right-4 flex gap-2">
                  {coverPreview && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setCoverPreview('')
                        updateProfileMutation.mutate({ coverImage: null })
                      }}
                      disabled={uploadingCover}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => coverInputRef.current?.click()}
                    disabled={uploadingCover}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Changer
                  </Button>
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleCoverUpload}
                    className="hidden"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Avatar & Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle>Photo de profil</CardTitle>
              <CardDescription>
                Votre avatar visible partout sur la plateforme
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-6">
                <div className="relative">
                  <Avatar className="h-24 w-24">
                    <AvatarImage src={avatarPreview} alt={user.username} />
                    <AvatarFallback className="text-2xl">
                      {user.username.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  {uploadingAvatar && (
                    <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                      <Loader2 className="h-6 w-6 text-white animate-spin" />
                    </div>
                  )}

                  <Button
                    size="sm"
                    className="absolute bottom-0 right-0 rounded-full h-8 w-8 p-0"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={uploadingAvatar}
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                </div>

                <div className="flex-1">
                  <p className="font-medium">@{user.username}</p>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                  <Badge variant="outline" className="mt-2">
                    {user.role}
                  </Badge>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Nom d'affichage</label>
                  <Input
                    placeholder="Votre nom complet"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={50}
                  />
                  <p className="text-xs text-muted-foreground">
                    {displayName.length}/50 caractères
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Bio</label>
                  <textarea
                    placeholder="Parlez de vous..."
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={300}
                    className="w-full min-h-[100px] px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    {bio.length}/300 caractères
                  </p>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Localisation</label>
                    <Input
                      placeholder="Paris, France"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      maxLength={100}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Site web</label>
                    <Input
                      type="url"
                      placeholder="https://example.com"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      maxLength={200}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between items-center">
              <div>
                {saveSuccess && (
                  <div className="flex items-center gap-2 text-green-600 text-sm">
                    <CheckCircle className="h-4 w-4" />
                    <span>Profil sauvegardé avec succès</span>
                  </div>
                )}
                {updateProfileMutation.isError && (
                  <div className="flex items-center gap-2 text-red-600 text-sm">
                    <AlertCircle className="h-4 w-4" />
                    <span>Erreur lors de la sauvegarde</span>
                  </div>
                )}
              </div>

              <Button
                onClick={handleSaveProfile}
                disabled={!hasChanges || updateProfileMutation.isPending}
              >
                {updateProfileMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sauvegarde...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Sauvegarder
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>

          {/* Preview */}
          <Card>
            <CardHeader>
              <CardTitle>Aperçu du profil</CardTitle>
              <CardDescription>
                Voici comment les autres voient votre profil
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                onClick={() => router.push(`/${user.username}`)}
              >
                <Eye className="h-4 w-4 mr-2" />
                Voir le profil public
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Sécurité du compte</CardTitle>
              <CardDescription>
                Gérez votre mot de passe et l'authentification à deux facteurs
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Mot de passe</p>
                    <p className="text-sm text-muted-foreground">
                      Dernière modification il y a 30 jours
                    </p>
                  </div>
                </div>
                <Button variant="outline">Changer</Button>
              </div>

              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Authentification à deux facteurs</p>
                    <p className="text-sm text-muted-foreground">
                      {user.twoFactorEnabled ? 'Activée' : 'Désactivée'}
                    </p>
                  </div>
                </div>
                <Button variant="outline">
                  {user.twoFactorEnabled ? 'Désactiver' : 'Activer'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Préférences de notifications</CardTitle>
              <CardDescription>
                Choisissez comment vous souhaitez être notifié
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bell className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Nouveaux abonnés</p>
                    <p className="text-sm text-muted-foreground">
                      Recevoir une notification pour chaque nouvel abonné
                    </p>
                  </div>
                </div>
                <input type="checkbox" defaultChecked className="h-5 w-5" />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bell className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Nouveaux commentaires</p>
                    <p className="text-sm text-muted-foreground">
                      Recevoir une notification pour chaque commentaire
                    </p>
                  </div>
                </div>
                <input type="checkbox" defaultChecked className="h-5 w-5" />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bell className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Nouveaux messages</p>
                    <p className="text-sm text-muted-foreground">
                      Recevoir une notification pour chaque nouveau message
                    </p>
                  </div>
                </div>
                <input type="checkbox" defaultChecked className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payments Tab (Creator only) */}
        {user.role === 'CREATOR' && (
          <TabsContent value="payments" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Informations de paiement</CardTitle>
                <CardDescription>
                  Gérez vos méthodes de paiement et de retrait
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <CreditCard className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Compte Stripe</p>
                      <p className="text-sm text-muted-foreground">
                        Connectez votre compte pour recevoir des paiements
                      </p>
                    </div>
                  </div>
                  <Button variant="outline">Configurer</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
