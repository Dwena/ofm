'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import {
  Camera,
  ChevronRight,
  CreditCard,
  Eye,
  History,
  Loader2,
  MessageCircle,
  Monitor,
  Moon,
  Save,
  Sun,
  Upload,
  Wallet,
  X,
  DollarSign,
} from 'lucide-react'

import { usersApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuth } from '@/contexts/auth-context'
import { useToast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'
import { getApiErrorMessage } from '@/components/auth-shell'
import { AccountSecuritySettings } from '@/components/account-security-settings'
import { TwoFactorSettings } from '@/components/two-factor-settings'
import { NotificationsManager } from '@/components/notifications-manager'
import { NotificationPreferencesSettings } from '@/components/notification-preferences-settings'
import { DeleteAccountSettings } from '@/components/delete-account-settings'

const TABS = ['profile', 'security', 'notifications', 'privacy', 'appearance', 'payments'] as const
type Tab = (typeof TABS)[number]

const MAX_IMAGE_SIZE = 10 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const LIMITS = { displayName: 50, bio: 500, location: 100, website: 200 }

const ROLE_LABELS: Record<string, string> = {
  CREATOR: 'Créateur',
  SUBSCRIBER: 'Abonné',
  ADMIN: 'Administrateur',
  MODERATOR: 'Modérateur',
}

type ProfileErrors = Partial<Record<'displayName' | 'bio' | 'location' | 'website', string>>

function validateImage(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return 'Format non pris en charge : utilisez une image JPG, PNG, GIF ou WebP.'
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return "L'image ne doit pas dépasser 10 Mo."
  }
  return null
}

function isValidWebsite(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.')
  } catch {
    return false
  }
}

export default function SettingsPage() {
  const { user, refreshUser } = useAuth()
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const { theme, setTheme } = useTheme()

  const [tab, setTab] = useState<Tab>('profile')
  const [mounted, setMounted] = useState(false)

  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [location, setLocation] = useState('')
  const [website, setWebsite] = useState('')
  const [profileErrors, setProfileErrors] = useState<ProfileErrors>({})

  const [uploading, setUploading] = useState<'avatar' | 'cover' | null>(null)
  const [avatarPreview, setAvatarPreview] = useState('')
  const [coverPreview, setCoverPreview] = useState('')
  const [avatarError, setAvatarError] = useState('')
  const [coverError, setCoverError] = useState('')

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)

  // Open the tab given in the URL (?tab=notifications)
  useEffect(() => {
    setMounted(true)
    const requested = new URLSearchParams(window.location.search).get('tab')
    if (requested && (TABS as readonly string[]).includes(requested)) {
      setTab(requested as Tab)
    }
  }, [])

  const changeTab = (value: string) => {
    setTab(value as Tab)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', value)
    window.history.replaceState(null, '', url.toString())
  }

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

  // PUT /users/profile (empty strings clear a field)
  const updateProfileMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => (await usersApi.updateProfile(data)).data,
    onSuccess: () => refreshUser(),
  })

  const handleImageUpload = async (kind: 'avatar' | 'cover', e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const file = input.files?.[0]
    // Allow picking the same file again later
    input.value = ''
    if (!file) return

    const setError = kind === 'avatar' ? setAvatarError : setCoverError
    const setPreview = kind === 'avatar' ? setAvatarPreview : setCoverPreview
    const previous = (kind === 'avatar' ? user?.avatar : user?.coverImage) || ''

    const validationError = validateImage(file)
    if (validationError) {
      setError(validationError)
      return
    }
    setError('')

    setUploading(kind)
    const preview = URL.createObjectURL(file)
    setPreview(preview)
    try {
      // Dedicated profile image endpoints store the file and return the updated user
      const updated = (await (kind === 'avatar' ? usersApi.uploadAvatar(file) : usersApi.uploadCover(file)))
        .data as { avatar?: string | null; coverImage?: string | null }
      const url = kind === 'avatar' ? updated?.avatar : updated?.coverImage
      if (!url) {
        throw new Error('missing url')
      }
      await refreshUser()
      setPreview(url)
      toast({ title: kind === 'avatar' ? 'Photo de profil mise à jour' : 'Image de couverture mise à jour' })
    } catch (error) {
      const message = getApiErrorMessage(error, "Erreur lors de l'envoi de l'image.")
      setError(message)
      setPreview(previous)
      toast({ title: "Échec de l'envoi", description: message, variant: 'destructive' })
    } finally {
      URL.revokeObjectURL(preview)
      setUploading(null)
    }
  }

  const handleRemoveCover = async () => {
    const ok = await confirm({
      title: "Retirer l'image de couverture ?",
      description: 'Votre profil affichera la couverture par défaut.',
      confirmText: 'Retirer',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await updateProfileMutation.mutateAsync({ coverImage: null })
      setCoverPreview('')
      setCoverError('')
      toast({ title: 'Image de couverture retirée' })
    } catch (error) {
      toast({
        title: 'Erreur',
        description: getApiErrorMessage(error, "Impossible de retirer l'image de couverture."),
        variant: 'destructive',
      })
    }
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    const errors: ProfileErrors = {}
    const trimmedWebsite = website.trim()
    if (displayName.trim().length > LIMITS.displayName) {
      errors.displayName = `${LIMITS.displayName} caractères maximum.`
    }
    if (bio.length > LIMITS.bio) errors.bio = `${LIMITS.bio} caractères maximum.`
    if (location.trim().length > LIMITS.location) errors.location = `${LIMITS.location} caractères maximum.`
    if (trimmedWebsite && !isValidWebsite(trimmedWebsite)) {
      errors.website = 'Adresse invalide : elle doit commencer par https:// (ex. https://exemple.com).'
    }
    setProfileErrors(errors)
    if (Object.keys(errors).length > 0) return

    try {
      await updateProfileMutation.mutateAsync({
        displayName: displayName.trim(),
        bio: bio.trim(),
        location: location.trim(),
        website: trimmedWebsite,
      })
      toast({ title: 'Profil sauvegardé', description: 'Vos informations ont été mises à jour.' })
    } catch (error) {
      toast({
        title: 'Erreur lors de la sauvegarde',
        description: getApiErrorMessage(error, 'Impossible de sauvegarder le profil.'),
        variant: 'destructive',
      })
    }
  }

  // Creator privacy settings (CreatorProfile)
  const creatorSettingMutation = useMutation({
    mutationFn: async (data: { allowMessages?: boolean; allowTips?: boolean }) =>
      (await usersApi.updateProfile(data)).data,
    onSuccess: async () => {
      await refreshUser()
      toast({ title: 'Paramètre enregistré' })
    },
    onError: (error) =>
      toast({
        title: 'Erreur',
        description: getApiErrorMessage(error, "Impossible d'enregistrer ce paramètre."),
        variant: 'destructive',
      }),
  })

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

  const isCreator = user.role === 'CREATOR'
  const savingProfile = updateProfileMutation.isPending && uploading === null

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Paramètres</h1>
        <p className="text-muted-foreground mt-2">Gérez vos informations de profil et vos préférences</p>
      </div>

      <Tabs value={tab} onValueChange={changeTab} className="w-full">
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList className="w-max">
            <TabsTrigger value="profile">Profil</TabsTrigger>
            <TabsTrigger value="security">Sécurité</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="privacy">Confidentialité</TabsTrigger>
            <TabsTrigger value="appearance">Apparence</TabsTrigger>
            <TabsTrigger value="payments">Paiements</TabsTrigger>
          </TabsList>
        </div>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-6">
          {/* Cover Image */}
          <Card>
            <CardHeader>
              <CardTitle>Image de couverture</CardTitle>
              <CardDescription>Image affichée en haut de votre profil (recommandé : 1500x500 px)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="relative">
                <div className="w-full h-36 sm:h-48 rounded-lg overflow-hidden bg-muted relative">
                  {coverPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={coverPreview} alt="Couverture" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      <Camera className="h-12 w-12" />
                    </div>
                  )}

                  {uploading === 'cover' && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 text-white animate-spin" />
                    </div>
                  )}
                </div>

                <div className="absolute bottom-3 right-3 flex gap-2">
                  {coverPreview && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleRemoveCover}
                      disabled={uploading !== null || updateProfileMutation.isPending}
                      aria-label="Retirer l'image de couverture"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => coverInputRef.current?.click()}
                    disabled={uploading !== null}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Changer
                  </Button>
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept={ALLOWED_IMAGE_TYPES.join(',')}
                    onChange={(e) => handleImageUpload('cover', e)}
                    className="hidden"
                  />
                </div>
              </div>
              {coverError && <p className="text-sm text-red-600">{coverError}</p>}
            </CardContent>
          </Card>

          {/* Avatar & Basic Info */}
          <Card>
            <form onSubmit={handleSaveProfile} noValidate>
              <CardHeader>
                <CardTitle>Photo et informations</CardTitle>
                <CardDescription>Votre avatar et vos informations visibles sur la plateforme</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center gap-4 sm:gap-6">
                  <div className="relative shrink-0">
                    <Avatar className="h-20 w-20 sm:h-24 sm:w-24">
                      <AvatarImage src={avatarPreview} alt={user.username} />
                      <AvatarFallback className="text-2xl">{user.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>

                    {uploading === 'avatar' && (
                      <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                        <Loader2 className="h-6 w-6 text-white animate-spin" />
                      </div>
                    )}

                    <Button
                      type="button"
                      size="sm"
                      className="absolute bottom-0 right-0 rounded-full h-8 w-8 p-0"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={uploading !== null}
                      aria-label="Changer la photo de profil"
                    >
                      <Camera className="h-4 w-4" />
                    </Button>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept={ALLOWED_IMAGE_TYPES.join(',')}
                      onChange={(e) => handleImageUpload('avatar', e)}
                      className="hidden"
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">@{user.username}</p>
                    <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                    <Badge variant="outline" className="mt-2">
                      {ROLE_LABELS[user.role] ?? user.role}
                    </Badge>
                  </div>
                </div>
                {avatarError && <p className="text-sm text-red-600 -mt-3">{avatarError}</p>}

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="displayName">Nom d&apos;affichage</Label>
                    <Input
                      id="displayName"
                      placeholder="Votre nom complet"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      maxLength={LIMITS.displayName}
                      aria-invalid={!!profileErrors.displayName}
                    />
                    <p className={cn('text-xs', profileErrors.displayName ? 'text-red-600' : 'text-muted-foreground')}>
                      {profileErrors.displayName ?? `${displayName.length}/${LIMITS.displayName} caractères`}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="bio">Bio</Label>
                    <Textarea
                      id="bio"
                      placeholder="Parlez de vous..."
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      maxLength={LIMITS.bio}
                      className="min-h-[100px] resize-none"
                      aria-invalid={!!profileErrors.bio}
                    />
                    <p className={cn('text-xs', profileErrors.bio ? 'text-red-600' : 'text-muted-foreground')}>
                      {profileErrors.bio ?? `${bio.length}/${LIMITS.bio} caractères`}
                    </p>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="location">Localisation</Label>
                      <Input
                        id="location"
                        placeholder="Paris, France"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        maxLength={LIMITS.location}
                        aria-invalid={!!profileErrors.location}
                      />
                      {profileErrors.location && <p className="text-xs text-red-600">{profileErrors.location}</p>}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="website">Site web</Label>
                      <Input
                        id="website"
                        type="url"
                        inputMode="url"
                        placeholder="https://exemple.com"
                        value={website}
                        onChange={(e) => {
                          setWebsite(e.target.value)
                          if (profileErrors.website) setProfileErrors((p) => ({ ...p, website: undefined }))
                        }}
                        maxLength={LIMITS.website}
                        aria-invalid={!!profileErrors.website}
                      />
                      {profileErrors.website && <p className="text-xs text-red-600">{profileErrors.website}</p>}
                    </div>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between sm:items-center">
                <Button variant="outline" asChild>
                  <Link href={`/${user.username}`}>
                    <Eye className="h-4 w-4 mr-2" />
                    Voir le profil public
                  </Link>
                </Button>
                <Button type="submit" disabled={!hasChanges || savingProfile}>
                  {savingProfile ? (
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
            </form>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Sécurité du compte</CardTitle>
              <CardDescription>
                Gérez votre adresse e-mail, votre mot de passe, vos sessions et l&apos;authentification à deux
                facteurs
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <AccountSecuritySettings />
              <TwoFactorSettings />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-6">
          <NotificationPreferencesSettings />
          <NotificationsManager />
        </TabsContent>

        {/* Privacy Tab */}
        <TabsContent value="privacy" className="space-y-6">
          {isCreator && (
            <Card>
              <CardHeader>
                <CardTitle>Interactions avec vos fans</CardTitle>
                <CardDescription>Choisissez comment vos fans peuvent interagir avec vous</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  {
                    key: 'allowMessages' as const,
                    icon: MessageCircle,
                    label: 'Messages privés',
                    description: 'Autoriser les fans à vous envoyer des messages et à répondre à vos stories',
                  },
                  {
                    key: 'allowTips' as const,
                    icon: DollarSign,
                    label: 'Pourboires',
                    description: 'Autoriser les fans à vous envoyer des pourboires',
                  },
                ].map(({ key, icon: Icon, label, description }) => {
                  const checked = user.creatorProfile?.[key] ?? true
                  const pending = creatorSettingMutation.isPending && creatorSettingMutation.variables?.[key] !== undefined
                  return (
                    <label
                      key={key}
                      htmlFor={`privacy-${key}`}
                      className="flex items-center justify-between gap-4 p-4 border rounded-lg cursor-pointer"
                    >
                      <span className="flex items-center gap-3">
                        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                        <span>
                          <span className="block font-medium">{label}</span>
                          <span className="block text-sm text-muted-foreground">{description}</span>
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                        <input
                          id={`privacy-${key}`}
                          type="checkbox"
                          className="h-5 w-5 accent-primary cursor-pointer"
                          checked={checked}
                          disabled={creatorSettingMutation.isPending}
                          onChange={(e) => creatorSettingMutation.mutate({ [key]: e.target.checked })}
                        />
                      </span>
                    </label>
                  )
                })}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Profil public</CardTitle>
              <CardDescription>
                Votre nom d&apos;affichage, votre photo, votre bio et votre site web sont visibles par tous les
                utilisateurs. Votre adresse e-mail n&apos;est jamais affichée.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => changeTab('profile')}>
                Modifier mes informations publiques
              </Button>
            </CardContent>
          </Card>

          <DeleteAccountSettings />
        </TabsContent>

        {/* Appearance Tab */}
        <TabsContent value="appearance" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Thème</CardTitle>
              <CardDescription>Choisissez l&apos;apparence de l&apos;application sur cet appareil</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Thème">
                {[
                  { value: 'light', label: 'Clair', icon: Sun },
                  { value: 'dark', label: 'Sombre', icon: Moon },
                  { value: 'system', label: 'Système', icon: Monitor },
                ].map(({ value, label, icon: Icon }) => {
                  const selected = mounted && theme === value
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setTheme(value)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50',
                        selected && 'border-primary ring-2 ring-primary/30'
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="font-medium">{label}</span>
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payments Tab */}
        <TabsContent value="payments" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Paiements</CardTitle>
              <CardDescription>
                {isCreator
                  ? 'Gérez vos moyens de paiement, vos revenus et vos virements'
                  : 'Gérez vos moyens de paiement et consultez vos achats'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                {
                  href: '/settings/payment-methods',
                  icon: CreditCard,
                  label: 'Moyens de paiement',
                  description: 'Ajoutez ou retirez vos cartes bancaires',
                },
                {
                  href: '/transactions',
                  icon: History,
                  label: 'Historique des transactions',
                  description: 'Abonnements, achats et pourboires',
                },
                ...(isCreator
                  ? [
                      {
                        href: '/creator/earnings',
                        icon: Wallet,
                        label: 'Revenus et virements',
                        description: 'Solde, virements, profil fiscal et documents',
                      },
                    ]
                  : []),
              ].map(({ href, icon: Icon, label, description }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center justify-between gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <span>
                      <span className="block font-medium">{label}</span>
                      <span className="block text-sm text-muted-foreground">{description}</span>
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
