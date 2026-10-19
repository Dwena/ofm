'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi, subscriptionsApi, contentApi, socialApi } from '@/lib/api'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  MapPin,
  Globe,
  Calendar,
  Users,
  Image as ImageIcon,
  Video,
  Heart,
  MessageCircle,
  Lock,
  CheckCircle,
  ExternalLink,
  UserPlus,
  UserCheck,
  Gift,
  Flag,
  Link2,
  MoreHorizontal,
  Loader2,
  Radio,
  FileText,
  Music,
  GalleryHorizontal,
  Pencil,
  Layers,
  Upload,
  AlertCircle,
  CreditCard,
} from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { formatEuros, formatRelativeTime } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'
import ChangeTierDialog, {
  getPendingChangeLabel,
  getTierChangeLabel,
} from '@/components/subscriptions/change-tier-dialog'
import PpvUnlockDialog from '@/components/checkout/ppv-unlock-dialog'
import TipDialog from '@/components/profile/tip-dialog'
import ReportDialog from '@/components/social/report-dialog'

interface PublicProfile {
  id: string
  username: string
  displayName: string | null
  bio: string | null
  avatar: string | null
  coverImage: string | null
  location: string | null
  website: string | null
  role: 'SUBSCRIBER' | 'CREATOR' | 'MODERATOR' | 'ADMIN'
  createdAt: string
  isVerified: boolean
  creatorProfile: {
    totalSubscribers: number
    totalContent: number
    averageRating: number
    allowMessages: boolean
    allowTips: boolean
    minimumTip: number
  } | null
  followersCount: number
  liveStream: { id: string; title: string } | null
  hasActiveStories: boolean
  hasUnseenStories: boolean
  canMessage: boolean
}

const getErrorMessage = (error: any) => {
  const message = error?.response?.data?.message
  return (Array.isArray(message) ? message.join(', ') : message) || 'Une erreur est survenue'
}

const getInitials = (name: string) =>
  name
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?'

const formatDay = (date: string) => new Date(date).toLocaleDateString('fr-FR')

// Only http(s) links are rendered as the creator's website
const safeWebsite = (website: string | null) => {
  if (!website) return null
  const url = /^https?:\/\//i.test(website) ? website : `https://${website}`
  try {
    return new URL(url).toString()
  } catch {
    return null
  }
}

const scrollToTiers = () =>
  document.getElementById('tiers-section')?.scrollIntoView({ behavior: 'smooth' })

export default function CreatorProfilePage() {
  const params = useParams()
  const router = useRouter()
  const { user: currentUser } = useAuth()
  const { confirm } = useConfirm()
  const username = decodeURIComponent(params.username as string)
  const queryClient = useQueryClient()

  // Tier picked for an upgrade / downgrade (confirmation dialog)
  const [changeTarget, setChangeTarget] = useState<any | null>(null)
  const [tipOpen, setTipOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [coverError, setCoverError] = useState(false)

  // Fetch creator profile
  const {
    data: creator,
    isLoading: loadingCreator,
    error: creatorError,
    refetch: refetchCreator,
  } = useQuery({
    queryKey: ['creator-profile', username],
    queryFn: async () => {
      const response = await usersApi.getByUsername(username)
      return response.data as PublicProfile
    },
    retry: (failureCount, error: any) => error?.response?.status !== 404 && failureCount < 2,
  })

  const isOwnProfile = !!creator && currentUser?.id === creator.id
  const isCreator = creator?.role === 'CREATOR' && !!creator.creatorProfile

  // Free follow (independent from paid subscriptions)
  const canFollow = !!creator?.id && isCreator && !isOwnProfile
  const { data: followStatus } = useQuery({
    queryKey: ['follow-status', creator?.id],
    queryFn: async () => {
      const response = await socialApi.getFollowStatus(creator!.id)
      return response.data as { isFollowing: boolean; followersCount: number }
    },
    enabled: canFollow,
  })

  const followMutation = useMutation({
    mutationFn: async (follow: boolean) => {
      const response = follow
        ? await socialApi.followCreator(creator!.id)
        : await socialApi.unfollowCreator(creator!.id)
      return response.data as { isFollowing: boolean; followersCount: number }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['follow-status', creator?.id], data)
      queryClient.invalidateQueries({ queryKey: ['following'] })
      queryClient.invalidateQueries({ queryKey: ['creator-profile', username] })
      toast({
        title: data.isFollowing ? 'Vous suivez ce créateur' : 'Vous ne suivez plus ce créateur',
      })
    },
    onError: (error: any) => {
      toast({ title: 'Erreur', description: getErrorMessage(error), variant: 'destructive' })
    },
  })

  const isFollowing = followStatus?.isFollowing ?? false
  const followersCount = followStatus?.followersCount ?? creator?.followersCount ?? 0

  // Fetch creator's subscription tiers (active ones only)
  const { data: tiers, isLoading: loadingTiers } = useQuery({
    queryKey: ['creator-tiers', creator?.id],
    queryFn: async () => {
      const response = await subscriptionsApi.getCreatorTiers(creator!.id)
      return (Array.isArray(response.data) ? response.data : []) as any[]
    },
    enabled: !!creator?.id && isCreator,
  })

  // Fetch my subscription to this creator
  const { data: subscriptionStatus } = useQuery({
    queryKey: ['subscription-status', creator?.id],
    queryFn: async () => {
      const response = await subscriptionsApi.getStatusForCreator(creator!.id)
      return response.data as { isSubscribed: boolean; subscription: any | null }
    },
    enabled: !!creator?.id && isCreator && !isOwnProfile,
  })

  const refreshSubscription = () => {
    queryClient.invalidateQueries({ queryKey: ['subscription-status', creator?.id] })
    queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] })
    queryClient.invalidateQueries({ queryKey: ['creator-profile', username] })
    queryClient.invalidateQueries({ queryKey: ['creator-content', creator?.id] })
  }

  const onSubscriptionError = (error: any) => {
    toast({ title: 'Erreur', description: getErrorMessage(error), variant: 'destructive' })
  }

  // Free tiers are activated directly; paid tiers go through checkout
  const subscribeMutation = useMutation({
    mutationFn: (tierId: string) => subscriptionsApi.subscribe({ tierId }),
    onSuccess: () => {
      refreshSubscription()
      toast({ title: 'Abonnement activé' })
    },
    onError: onSubscriptionError,
  })

  const cancelMutation = useMutation({
    mutationFn: (subscriptionId: string) => subscriptionsApi.cancel(subscriptionId),
    onSuccess: (response: any) => {
      refreshSubscription()
      const subscription = response?.data
      toast({
        title: 'Abonnement annulé',
        description:
          subscription?.status === 'ACTIVE' && subscription?.currentPeriodEnd
            ? `Vous gardez l'accès jusqu'au ${formatDay(subscription.currentPeriodEnd)}.`
            : undefined,
      })
    },
    onError: onSubscriptionError,
  })

  const resumeMutation = useMutation({
    mutationFn: (subscriptionId: string) => subscriptionsApi.resume(subscriptionId),
    onSuccess: () => {
      refreshSubscription()
      toast({ title: 'Abonnement repris' })
    },
    onError: onSubscriptionError,
  })

  const currentSubscription =
    subscriptionStatus?.subscription &&
    ['ACTIVE', 'PAST_DUE'].includes(subscriptionStatus.subscription.status)
      ? subscriptionStatus.subscription
      : null

  const handleSubscribe = (tier: any) => {
    const price = Number(tier.price)
    if (price <= 0) {
      subscribeMutation.mutate(tier.id)
      return
    }

    const params = new URLSearchParams({
      type: 'subscription',
      itemId: tier.id,
      amount: String(price), // euros
      description: `${tier.name} - @${username}`,
      returnUrl: `/${username}`,
    })
    router.push(`/checkout?${params.toString()}`)
  }

  const handleCancel = async (subscription: any) => {
    const isPaid = !!subscription.stripeSubscriptionId
    let description: string
    if (subscription.status === 'PAST_DUE') {
      description = 'Votre abonnement impayé sera résilié immédiatement.'
    } else if (isPaid) {
      description =
        `Votre abonnement ${subscription.tier?.name ?? ''} restera actif jusqu'au ` +
        `${formatDay(subscription.currentPeriodEnd)}, puis ne sera pas renouvelé.` +
        (subscription.pendingTier ? ` Le passage à ${subscription.pendingTier.name} prévu sera annulé.` : '')
    } else {
      description = 'Vous perdrez immédiatement l\'accès aux contenus réservés aux abonnés.'
    }

    const confirmed = await confirm({
      title: 'Se désabonner ?',
      description,
      confirmText: 'Se désabonner',
      cancelText: 'Garder mon abonnement',
      variant: 'destructive',
    })
    if (confirmed) {
      cancelMutation.mutate(subscription.id)
    }
  }

  // PPV content is paid in a dialog; access is granted once the payment is confirmed
  const [unlocking, setUnlocking] = useState<any | null>(null)
  const handleUnlock = (item: any) => {
    setUnlocking({ ...item, creator: { username } })
  }

  // Fetch creator's content
  const { data: content, isLoading: loadingContent } = useQuery({
    queryKey: ['creator-content', creator?.id],
    queryFn: async () => {
      const response = await contentApi.getCreatorContent(creator!.id)
      return (Array.isArray(response.data) ? response.data : []) as any[]
    },
    enabled: !!creator?.id && isCreator,
  })

  // Links like /{username}#tiers-section ("S'abonner" from the feed / content
  // pages): the section only exists once the profile and tiers are loaded
  const tiersReady = !!creator && isCreator && !isOwnProfile && !loadingTiers
  const scrolledToHash = useRef(false)
  useEffect(() => {
    if (!tiersReady || scrolledToHash.current) return
    if (window.location.hash !== '#tiers-section') return
    scrolledToHash.current = true
    // Let the tiers grid render before scrolling
    const timer = setTimeout(scrollToTiers, 50)
    return () => clearTimeout(timer)
  }, [tiersReady])

  const copyProfileLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/${username}`)
      toast({ title: 'Lien du profil copié' })
    } catch {
      toast({ title: 'Impossible de copier le lien', variant: 'destructive' })
    }
  }

  if (loadingCreator) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Chargement du profil...</p>
        </div>
      </div>
    )
  }

  if (creatorError || !creator) {
    const notFound = (creatorError as any)?.response?.status === 404 || !creatorError
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            {notFound ? (
              <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            ) : (
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive opacity-70" />
            )}
            <h2 className="text-xl font-semibold mb-2">
              {notFound ? 'Profil introuvable' : 'Impossible de charger le profil'}
            </h2>
            <p className="text-muted-foreground mb-4 break-words">
              {notFound
                ? `Le profil @${username} n'existe pas ou n'est plus disponible.`
                : getErrorMessage(creatorError)}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {!notFound && (
                <Button variant="outline" onClick={() => refetchCreator()}>
                  Réessayer
                </Button>
              )}
              <Button asChild>
                <Link href="/discover">Découvrir des créateurs</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const displayName = creator.displayName || creator.username
  const website = safeWebsite(creator.website)
  const profileSettings = creator.creatorProfile
  const hasTiers = !!tiers && tiers.length > 0
  const canTip = isCreator && !isOwnProfile && !!profileSettings?.allowTips
  const messagesDisabled = isCreator && !isOwnProfile && !creator.canMessage
  const photos = content?.filter((c: any) => c.type === 'PHOTO' || c.type === 'ALBUM')
  const videos = content?.filter((c: any) => c.type === 'VIDEO')

  const avatar = (
    <Avatar className="h-28 w-28 md:h-32 md:w-32 border-4 border-background bg-background">
      <AvatarImage src={creator.avatar || undefined} alt={displayName} className="object-cover" />
      <AvatarFallback className="text-3xl">{getInitials(displayName)}</AvatarFallback>
    </Avatar>
  )

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        {/* Cover Image (gradient when missing or broken) */}
        <div className="w-full h-36 sm:h-48 md:h-64 rounded-lg overflow-hidden bg-gradient-to-br from-primary/30 via-primary/10 to-muted">
          {creator.coverImage && !coverError && (
            <img
              src={creator.coverImage}
              alt=""
              className="w-full h-full object-cover"
              onError={() => setCoverError(true)}
            />
          )}
        </div>

        {/* Profile Header */}
        <div className="flex flex-col md:flex-row gap-4 md:gap-6 items-center md:items-start -mt-14 md:-mt-16 px-2 md:px-6">
          {/* Avatar: story ring + live badge */}
          <div className="relative shrink-0">
            {creator.hasActiveStories ? (
              <Link
                href={`/stories/${creator.id}`}
                aria-label={`Voir les stories de ${displayName}`}
                className={`block rounded-full p-1 ${
                  creator.hasUnseenStories || isOwnProfile
                    ? 'bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600'
                    : 'bg-muted-foreground/30'
                }`}
              >
                {avatar}
              </Link>
            ) : (
              avatar
            )}
            {creator.liveStream && (
              <Link
                href={`/live/${creator.liveStream.id}`}
                className="absolute -bottom-2 left-1/2 -translate-x-1/2"
                aria-label="Regarder le live"
              >
                <Badge className="bg-red-600 hover:bg-red-700 text-white border-2 border-background uppercase tracking-wide whitespace-nowrap">
                  En direct
                </Badge>
              </Link>
            )}
          </div>

          {/* Info Section */}
          <div className="flex-1 space-y-4 w-full md:pt-[4.5rem] text-center md:text-left">
            <div>
              <div className="flex items-center justify-center md:justify-start gap-2 md:gap-3 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-bold break-words">{displayName}</h1>
                {isCreator &&
                  (creator.isVerified ? (
                    <Badge variant="default" className="bg-blue-600">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Créateur vérifié
                    </Badge>
                  ) : (
                    <Badge variant="outline">Créateur</Badge>
                  ))}
              </div>
              <p className="text-muted-foreground text-lg mt-1">@{creator.username}</p>
            </div>

            {creator.bio && (
              <p className="text-base leading-relaxed max-w-2xl whitespace-pre-line break-words mx-auto md:mx-0">
                {creator.bio}
              </p>
            )}

            {/* Meta Info */}
            <div className="flex flex-wrap justify-center md:justify-start gap-x-4 gap-y-2 text-sm text-muted-foreground">
              {creator.location && (
                <div className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  <span>{creator.location}</span>
                </div>
              )}
              {website && (
                <a
                  href={website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-primary transition-colors"
                >
                  <Globe className="h-4 w-4" />
                  <span>Site web</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                <span>
                  Membre depuis{' '}
                  {new Date(creator.createdAt).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                </span>
              </div>
            </div>

            {/* Stats */}
            {profileSettings && (
              <div className="flex flex-wrap justify-center md:justify-start gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="font-bold text-lg">{profileSettings.totalSubscribers}</span>
                  <span className="text-muted-foreground ml-1">
                    {profileSettings.totalSubscribers > 1 ? 'Abonnés' : 'Abonné'}
                  </span>
                </div>
                <div>
                  <span className="font-bold text-lg">{followersCount}</span>
                  <span className="text-muted-foreground ml-1">
                    {followersCount > 1 ? 'Followers' : 'Follower'}
                  </span>
                </div>
                <div>
                  <span className="font-bold text-lg">{profileSettings.totalContent}</span>
                  <span className="text-muted-foreground ml-1">
                    {profileSettings.totalContent > 1 ? 'Publications' : 'Publication'}
                  </span>
                </div>
                {profileSettings.averageRating > 0 && (
                  <div>
                    <span className="font-bold text-lg">{profileSettings.averageRating.toFixed(1)}</span>
                    <span className="text-muted-foreground ml-1">/ 5.0</span>
                  </div>
                )}
              </div>
            )}

            {/* Live banner */}
            {creator.liveStream && (
              <Link
                href={`/live/${creator.liveStream.id}`}
                className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-left hover:bg-red-500/10 transition-colors max-w-xl mx-auto md:mx-0"
              >
                <Radio className="h-5 w-5 text-red-600 shrink-0 animate-pulse" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-red-600">En direct maintenant</p>
                  <p className="text-sm truncate">{creator.liveStream.title}</p>
                </div>
                <span className="ml-auto text-sm font-medium shrink-0">Regarder</span>
              </Link>
            )}

            {/* Actions */}
            <div className="flex flex-wrap justify-center md:justify-start gap-2 md:gap-3">
              {isOwnProfile ? (
                <>
                  <Button asChild>
                    <Link href={isCreator ? '/creator/profile' : '/settings'}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Modifier le profil
                    </Link>
                  </Button>
                  {isCreator && (
                    <>
                      <Button variant="outline" asChild>
                        <Link href="/creator/tiers">
                          <Layers className="h-4 w-4 mr-2" />
                          Gérer mes offres
                        </Link>
                      </Button>
                      <Button variant="outline" asChild>
                        <Link href="/creator/upload">
                          <Upload className="h-4 w-4 mr-2" />
                          Publier
                        </Link>
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <>
                  {isCreator && hasTiers && (
                    <Button variant={currentSubscription ? 'outline' : 'default'} onClick={scrollToTiers}>
                      {currentSubscription ? (
                        <>
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Abonné · {currentSubscription.tier?.name}
                        </>
                      ) : (
                        'S\'abonner'
                      )}
                    </Button>
                  )}
                  {canFollow && (
                    <Button
                      variant={isFollowing ? 'secondary' : 'outline'}
                      onClick={() => followMutation.mutate(!isFollowing)}
                      disabled={followMutation.isPending || !followStatus}
                    >
                      {followMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : isFollowing ? (
                        <UserCheck className="h-4 w-4 mr-2" />
                      ) : (
                        <UserPlus className="h-4 w-4 mr-2" />
                      )}
                      {isFollowing ? 'Ne plus suivre' : 'Suivre'}
                    </Button>
                  )}
                  {creator.canMessage ? (
                    <Button variant="outline" asChild>
                      <Link href={`/messages?user=${encodeURIComponent(creator.username)}`}>
                        <MessageCircle className="h-4 w-4 mr-2" />
                        Message
                      </Link>
                    </Button>
                  ) : (
                    messagesDisabled && (
                      <Button
                        variant="outline"
                        disabled
                        title="Ce créateur a désactivé les messages privés"
                      >
                        <MessageCircle className="h-4 w-4 mr-2" />
                        Messages désactivés
                      </Button>
                    )
                  )}
                  {canTip && (
                    <Button variant="outline" onClick={() => setTipOpen(true)}>
                      <Gift className="h-4 w-4 mr-2" />
                      Pourboire
                    </Button>
                  )}
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Plus d'actions">
                        <MoreHorizontal className="h-5 w-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={copyProfileLink}>
                        <Link2 className="h-4 w-4 mr-2" />
                        Copier le lien du profil
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => setReportOpen(true)}
                      >
                        <Flag className="h-4 w-4 mr-2" />
                        Signaler
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Subscription Tiers Section */}
      {isCreator && !isOwnProfile && (
        <div id="tiers-section" className="scroll-mt-6">
          <h2 className="text-2xl font-bold mb-4">Offres d&apos;abonnement</h2>

          {currentSubscription?.status === 'PAST_DUE' && (
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
              <p className="text-sm flex-1">
                Le dernier paiement de votre abonnement {currentSubscription.tier?.name} a échoué.
                Mettez à jour votre moyen de paiement pour conserver l&apos;accès.
              </p>
              <Button size="sm" variant="outline" asChild>
                <Link href="/settings/payment-methods">
                  <CreditCard className="h-4 w-4 mr-2" />
                  Moyens de paiement
                </Link>
              </Button>
            </div>
          )}

          {loadingTiers ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-64 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : !hasTiers ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Ce créateur ne propose pas encore d&apos;offre d&apos;abonnement.
              </CardContent>
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {tiers!.map((tier: any) => {
                const isCurrent = currentSubscription?.tierId === tier.id
                const isPendingTarget = currentSubscription?.pendingTierId === tier.id
                const isFree = Number(tier.price) <= 0
                const subscribingThis = subscribeMutation.isPending && subscribeMutation.variables === tier.id

                return (
                  <Card
                    key={tier.id}
                    className={`relative flex flex-col overflow-hidden ${isCurrent ? 'ring-2 ring-primary' : ''}`}
                  >
                    <div className={`absolute top-0 left-0 right-0 h-1 ${isCurrent ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="break-words">{tier.name}</CardTitle>
                        {isCurrent && (
                          <Badge className="bg-green-600 shrink-0">Votre offre</Badge>
                        )}
                        {isPendingTarget && (
                          <Badge variant="outline" className="shrink-0">Programmée</Badge>
                        )}
                      </div>
                      {tier.description && <CardDescription>{tier.description}</CardDescription>}
                    </CardHeader>
                    <CardContent className="space-y-4 flex-1">
                      <div>
                        <p className="text-3xl font-bold">{isFree ? 'Gratuit' : formatEuros(tier.price)}</p>
                        {!isFree && (
                          <p className="text-sm text-muted-foreground">
                            par {tier.interval === 'year' ? 'an' : 'mois'}
                          </p>
                        )}
                      </div>

                      {tier.benefits && tier.benefits.length > 0 && (
                        <ul className="text-sm space-y-1">
                          {tier.benefits.map((benefit: string, index: number) => (
                            <li key={index} className="flex items-start">
                              <CheckCircle className="h-4 w-4 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
                              <span>{benefit}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                    <CardFooter className="flex-col gap-2">
                      {isCurrent ? (
                        <>
                          <p className="text-xs text-muted-foreground text-center">
                            {currentSubscription.status === 'PAST_DUE'
                              ? 'Paiement en échec'
                              : getPendingChangeLabel(currentSubscription) ||
                                (currentSubscription.cancelAtPeriodEnd
                                  ? `Se termine le ${formatDay(currentSubscription.currentPeriodEnd)}`
                                  : currentSubscription.stripeSubscriptionId
                                    ? `Renouvellement le ${formatDay(currentSubscription.currentPeriodEnd)}`
                                    : 'Vous êtes abonné')}
                          </p>
                          {currentSubscription.pendingTierId && (
                            <Button className="w-full" onClick={() => setChangeTarget(tier)}>
                              Conserver cette offre
                            </Button>
                          )}
                          {currentSubscription.cancelAtPeriodEnd && !currentSubscription.pendingTierId ? (
                            <Button
                              className="w-full"
                              disabled={resumeMutation.isPending}
                              onClick={() => resumeMutation.mutate(currentSubscription.id)}
                            >
                              {resumeMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                              Reprendre l&apos;abonnement
                            </Button>
                          ) : (
                            <Button
                              className="w-full"
                              variant={currentSubscription.pendingTierId ? 'ghost' : 'outline'}
                              disabled={cancelMutation.isPending}
                              onClick={() => handleCancel(currentSubscription)}
                            >
                              {cancelMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                              Se désabonner
                            </Button>
                          )}
                        </>
                      ) : currentSubscription?.status === 'ACTIVE' ? (
                        <>
                          {isPendingTarget && (
                            <p className="text-xs text-muted-foreground text-center">
                              Prévue à partir du {formatDay(currentSubscription.currentPeriodEnd)}
                            </p>
                          )}
                          <Button
                            className="w-full"
                            variant="outline"
                            disabled={isPendingTarget}
                            onClick={() => setChangeTarget(tier)}
                          >
                            {getTierChangeLabel(currentSubscription, tier)}
                          </Button>
                        </>
                      ) : (
                        <Button
                          className="w-full"
                          disabled={!!currentSubscription || subscribeMutation.isPending}
                          onClick={() => handleSubscribe(tier)}
                        >
                          {subscribingThis && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          {currentSubscription
                            ? 'Abonné à une autre offre'
                            : isFree ? 'S\'abonner gratuitement' : 'S\'abonner'}
                        </Button>
                      )}
                    </CardFooter>
                  </Card>
                )
              })}
            </div>
          )}
          <ChangeTierDialog
            subscription={currentSubscription}
            tier={changeTarget}
            creatorUsername={username}
            returnUrl={`/${username}`}
            onOpenChange={(open) => !open && setChangeTarget(null)}
            onChanged={refreshSubscription}
          />
        </div>
      )}

      <PpvUnlockDialog
        content={unlocking}
        onClose={() => setUnlocking(null)}
        onUnlocked={() => queryClient.invalidateQueries({ queryKey: ['creator-content', creator.id] })}
      />

      {canTip && (
        <TipDialog
          open={tipOpen}
          onOpenChange={setTipOpen}
          creator={creator}
          minimumTip={profileSettings?.minimumTip ?? 1}
          returnUrl={`/${username}`}
        />
      )}

      {!isOwnProfile && (
        <ReportDialog
          target={reportOpen ? { type: 'USER', id: creator.id } : null}
          onClose={() => setReportOpen(false)}
        />
      )}

      {/* Content Gallery */}
      {isCreator && (
        <Tabs defaultValue="all" className="w-full">
          <TabsList>
            <TabsTrigger value="all">Tout{content ? ` (${content.length})` : ''}</TabsTrigger>
            <TabsTrigger value="images">Photos{photos ? ` (${photos.length})` : ''}</TabsTrigger>
            <TabsTrigger value="videos">Vidéos{videos ? ` (${videos.length})` : ''}</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-6">
            <ContentGallery
              content={content}
              isLoading={loadingContent}
              isOwnProfile={isOwnProfile}
              canSubscribe={hasTiers && !isOwnProfile}
              onUnlock={handleUnlock}
              emptyLabel="Aucune publication pour le moment"
            />
          </TabsContent>

          <TabsContent value="images" className="mt-6">
            <ContentGallery
              content={photos}
              isLoading={loadingContent}
              isOwnProfile={isOwnProfile}
              canSubscribe={hasTiers && !isOwnProfile}
              onUnlock={handleUnlock}
              emptyLabel="Aucune photo pour le moment"
            />
          </TabsContent>

          <TabsContent value="videos" className="mt-6">
            <ContentGallery
              content={videos}
              isLoading={loadingContent}
              isOwnProfile={isOwnProfile}
              canSubscribe={hasTiers && !isOwnProfile}
              onUnlock={handleUnlock}
              emptyLabel="Aucune vidéo pour le moment"
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

const typeIcons: Record<string, typeof ImageIcon> = {
  PHOTO: ImageIcon,
  ALBUM: GalleryHorizontal,
  VIDEO: Video,
  AUDIO: Music,
  TEXT: FileText,
}

function ContentThumbnail({ item }: { item: any }) {
  const [failed, setFailed] = useState(false)
  const file = item.files?.[0]
  const src = file && (file.type === 'IMAGE' || file.type === 'VIDEO') ? file.thumbnailUrl || (file.type === 'IMAGE' ? file.url : null) : null
  const TypeIcon = typeIcons[item.type] || ImageIcon

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={item.title || 'Contenu'}
        loading="lazy"
        className="w-full h-full object-cover"
        onError={() => setFailed(true)}
      />
    )
  }

  // Text, audio, locked or broken media: type icon (and excerpt for text posts)
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-4 text-muted-foreground">
      <TypeIcon className="h-10 w-10 opacity-60" />
      {item.type === 'TEXT' && !item.isLocked && (item.description || item.caption) && (
        <p className="text-xs text-center line-clamp-4">{item.description || item.caption}</p>
      )}
    </div>
  )
}

function ContentGallery({
  content,
  isLoading,
  isOwnProfile,
  canSubscribe,
  onUnlock,
  emptyLabel,
}: {
  content: any[] | undefined
  isLoading: boolean
  isOwnProfile: boolean
  canSubscribe: boolean
  onUnlock: (item: any) => void
  emptyLabel: string
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="aspect-square bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    )
  }

  if (!content || content.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <ImageIcon className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <p className="text-muted-foreground">
            {isOwnProfile ? 'Vous n\'avez pas encore publié de contenu ici' : emptyLabel}
          </p>
          {isOwnProfile && (
            <Button className="mt-4" asChild>
              <Link href="/creator/upload">Créer du contenu</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
      {content.map((item: any) => (
        <Card key={item.id} className="group overflow-hidden hover:shadow-lg transition-all">
          <div className="relative aspect-square bg-muted">
            <Link href={`/content/${item.id}`} className="absolute inset-0" aria-label={item.title || 'Voir le contenu'}>
              <ContentThumbnail item={item} />

              {item.files?.[0]?.type === 'VIDEO' && !item.isLocked && (
                <div className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5">
                  <Video className="h-4 w-4 text-white" />
                </div>
              )}

              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-200 flex items-end p-3 opacity-0 group-hover:opacity-100">
                <div className="flex gap-4 text-white text-sm">
                  <div className="flex items-center gap-1">
                    <Heart className="h-4 w-4" />
                    <span>{item._count?.likes ?? item.likeCount ?? 0}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <MessageCircle className="h-4 w-4" />
                    <span>{item._count?.comments ?? item.commentCount ?? 0}</span>
                  </div>
                </div>
              </div>
            </Link>

            {/* Visibility badges (own profile, purchased PPV) */}
            <div className="absolute top-2 left-2 flex flex-wrap gap-1 pointer-events-none">
              {isOwnProfile && item.visibility === 'PRIVATE' && <Badge variant="secondary">Privé</Badge>}
              {item.isPpv && !item.isLocked && (
                <Badge variant="secondary">
                  {isOwnProfile ? `PPV ${formatEuros(item.ppvPrice)}` : item.hasUnlocked ? 'Acheté' : 'PPV'}
                </Badge>
              )}
            </div>

            {/* Lock overlay (PPV not unlocked, or subscribers only) */}
            {item.isLocked && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center pointer-events-none">
                <div className="text-center text-white px-2">
                  <Lock className="h-8 w-8 mx-auto mb-2" />
                  <p className="text-sm font-medium">
                    {item.isPpv
                      ? formatEuros(item.ppvPrice)
                      : item.visibility === 'PREMIUM_SUBSCRIBERS'
                        ? 'Abonnés premium'
                        : 'Abonnés'}
                  </p>
                  {item.isPpv && !isOwnProfile ? (
                    <Button size="sm" className="mt-2 pointer-events-auto" onClick={() => onUnlock(item)}>
                      Débloquer
                    </Button>
                  ) : (
                    canSubscribe && (
                      <Button size="sm" variant="secondary" className="mt-2 pointer-events-auto" onClick={scrollToTiers}>
                        {item.visibility === 'PREMIUM_SUBSCRIBERS' ? 'Voir les offres' : 'S\'abonner'}
                      </Button>
                    )
                  )}
                </div>
              </div>
            )}
          </div>

          <Link href={`/content/${item.id}`} className="block">
            <CardContent className="p-3">
              <p className="text-sm font-medium line-clamp-2">{item.title || 'Sans titre'}</p>
              {item.publishedAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  {formatRelativeTime(new Date(item.publishedAt))}
                </p>
              )}
            </CardContent>
          </Link>
        </Card>
      ))}
    </div>
  )
}
