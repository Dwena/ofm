'use client'

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { InfiniteData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { messagesApi, mediaApi } from '@/lib/api'
import { useSocket, SocketMessage } from '@/hooks/use-socket'
import { useConfirm } from '@/hooks/use-confirm'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Lightbox } from '@/components/ui/lightbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import OneTimeCheckout from '@/components/checkout/one-time-checkout'
import { AgeGatedMedia } from '@/components/age-verification/age-gated-media'
import { getStoredAgeToken } from '@/lib/age-verification'
import {
  ArrowLeft,
  Check,
  CheckCheck,
  FileVideo,
  Image as ImageIcon,
  Loader2,
  Lock,
  MessageSquare,
  PenSquare,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useAuth } from '@/contexts/auth-context'
import { toast } from '@/hooks/use-toast'
import { formatFanPrice } from '@/lib/vat'
import { formatEuros } from '@/lib/utils'

interface Participant {
  id: string
  username: string
  displayName?: string | null
  avatar?: string | null
}

interface Conversation {
  id: string
  participant: Participant
  lastMessage?: {
    id: string
    content: string
    createdAt: string
    senderId: string
    status?: string
    hasAttachment?: boolean
    isPpv?: boolean
    locked?: boolean
  } | null
  unreadCount: number
  updatedAt: string
  // false when the partner is a creator who does not accept messages
  canMessage?: boolean
}

interface Message extends SocketMessage {
  sender?: Participant
  /** Attachment withheld until the viewer's age is verified */
  ageVerificationRequired?: boolean
}

interface MessagesPage {
  items: Message[]
  total: number
  hasMore: boolean
}

interface Contact extends Participant {
  role: string
  canMessage: boolean
}

const PAGE_SIZE = 30
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/x-matroska']
const MAX_IMAGE_SIZE = 10 * 1024 * 1024
const MAX_VIDEO_SIZE = 100 * 1024 * 1024
const PPV_MIN = 1
const PPV_MAX = 500
const VIDEO_URL = /\.(mp4|mov|webm|avi|mkv|m4v)(\?|#|$)/i

const nameOf = (p: Participant) => p.displayName || p.username
const initialsOf = (p: Participant) => nameOf(p).substring(0, 2).toUpperCase()
const errorMessage = (error: any, fallback = 'Une erreur est survenue.') => {
  const message = error?.response?.data?.message
  return (Array.isArray(message) ? message[0] : message) || error?.message || fallback
}

export default function MessagesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <MessagesView />
    </Suspense>
  )
}

function MessagesView() {
  const { user } = useAuth()
  const { confirm } = useConfirm()
  const searchParams = useSearchParams()
  const targetUser = searchParams.get('user')
  const queryClient = useQueryClient()

  // Conversation opened from ?user= or the "new message" dialog, before it shows up in the list
  const [openedConversation, setOpenedConversation] = useState<Conversation | null>(null)
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null)
  const [conversationSearch, setConversationSearch] = useState('')
  const [newConversationOpen, setNewConversationOpen] = useState(false)
  const [openingTarget, setOpeningTarget] = useState(false)
  const openedTargetRef = useRef<string | null>(null)

  // Composer
  const [messageInput, setMessageInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [attachment, setAttachment] = useState<{ url: string; previewUrl: string; type: 'image' | 'video'; name: string } | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [ppvEnabled, setPpvEnabled] = useState(false)
  const [ppvPrice, setPpvPrice] = useState('')
  const [ppvError, setPpvError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  // Thread
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set())
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const typingSentRef = useRef(false)
  const typingStopTimer = useRef<ReturnType<typeof setTimeout>>()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [unlockTarget, setUnlockTarget] = useState<Message | null>(null)
  const [lightboxItem, setLightboxItem] = useState<{ url: string; type: 'image' | 'video' } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const scrollRestore = useRef<{ height: number; top: number } | null>(null)

  const isCreator = user?.role === 'CREATOR'

  const {
    connected,
    onlineUsers,
    setTyping,
    queryPresence,
    onNewMessage,
    onMessageSent,
    onTyping,
    onMessageRead,
    onMessageDeleted,
  } = useSocket()

  // ---------- Conversations ----------
  const {
    data: conversations,
    isLoading: conversationsLoading,
    isError: conversationsError,
    refetch: refetchConversations,
  } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const response = await messagesApi.getConversations()
      return response.data as Conversation[]
    },
  })

  const sortedConversations = useMemo(() => {
    const list = [...(conversations ?? [])]
    if (openedConversation && !list.some((c) => c.participant.id === openedConversation.participant.id)) {
      list.unshift(openedConversation)
    }
    const time = (c: Conversation) => new Date(c.lastMessage?.createdAt ?? c.updatedAt).getTime()
    return list.sort((a, b) => time(b) - time(a))
  }, [conversations, openedConversation])

  const filteredConversations = useMemo(() => {
    const q = conversationSearch.trim().toLowerCase()
    if (!q) return sortedConversations
    return sortedConversations.filter(
      (c) =>
        c.participant.username.toLowerCase().includes(q) ||
        (c.participant.displayName ?? '').toLowerCase().includes(q)
    )
  }, [sortedConversations, conversationSearch])

  const selectedConversation = useMemo(
    () => sortedConversations.find((c) => c.participant.id === selectedPartnerId) ?? null,
    [sortedConversations, selectedPartnerId]
  )
  const partnerId = selectedConversation?.participant.id ?? null
  const composerBlocked = selectedConversation?.canMessage === false

  const updateConversation = useCallback(
    (id: string, patch: (c: Conversation) => Conversation) => {
      queryClient.setQueryData<Conversation[]>(['conversations'], (current) =>
        current?.map((c) => (c.participant.id === id ? patch(c) : c))
      )
    },
    [queryClient]
  )

  // Presence of the conversation partners (the socket only pushes changes)
  const participantIds = useMemo(
    () => sortedConversations.map((c) => c.participant.id).join(','),
    [sortedConversations]
  )
  useEffect(() => {
    if (connected && participantIds) queryPresence(participantIds.split(','))
  }, [connected, participantIds, queryPresence])

  const openConversation = useCallback(
    (conversation: Conversation) => {
      queryClient.setQueryData<Conversation[]>(['conversations'], (current) => {
        if (!current) return current
        return current.some((c) => c.id === conversation.id) ? current : [conversation, ...current]
      })
      setOpenedConversation(conversation)
      setSelectedPartnerId(conversation.participant.id)
    },
    [queryClient]
  )

  // /messages?user=<username or id>: open (or create) the conversation and focus the composer
  useEffect(() => {
    if (!targetUser || openedTargetRef.current === targetUser) return
    openedTargetRef.current = targetUser

    setOpeningTarget(true)
    messagesApi
      .startConversation(targetUser)
      .then((response) => {
        openConversation(response.data as Conversation)
        queryClient.invalidateQueries({ queryKey: ['conversations'] })
      })
      .catch((error: any) => {
        const status = error?.response?.status
        toast({
          title: "Impossible d'ouvrir la conversation",
          description:
            status === 403
              ? "Ce créateur n'accepte pas les messages privés."
              : status === 404
                ? 'Utilisateur introuvable.'
                : errorMessage(error),
          variant: 'destructive',
        })
      })
      .finally(() => setOpeningTarget(false))
  }, [targetUser, queryClient, openConversation])

  // ---------- Messages of the open conversation ----------
  const messagesQuery = useInfiniteQuery({
    queryKey: ['messages', partnerId],
    queryFn: async ({ pageParam }) => {
      const response = await messagesApi.getMessages(partnerId!, {
        limit: PAGE_SIZE,
        ...(pageParam ? { before: pageParam as string } : {}),
      })
      return response.data as MessagesPage
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: MessagesPage) =>
      lastPage.hasMore && lastPage.items.length > 0 ? lastPage.items[0].createdAt : undefined,
    enabled: !!partnerId,
  })

  const messages = useMemo(() => {
    const pages = messagesQuery.data?.pages ?? []
    const seen = new Set<string>()
    // pages[0] holds the newest messages: older pages come first on screen
    return [...pages]
      .reverse()
      .flatMap((p) => p.items)
      .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
  }, [messagesQuery.data])

  const setMessagesCache = useCallback(
    (otherId: string, update: (items: Message[], pageIndex: number) => Message[]) => {
      queryClient.setQueryData<InfiniteData<MessagesPage>>(['messages', otherId], (current) =>
        current
          ? { ...current, pages: current.pages.map((p, i) => ({ ...p, items: update(p.items, i) })) }
          : current
      )
    },
    [queryClient]
  )

  const appendMessage = useCallback(
    (otherId: string, message: Message) => {
      setMessagesCache(otherId, (items, index) =>
        index === 0 && !items.some((m) => m.id === message.id) ? [...items, message] : items
      )
    },
    [setMessagesCache]
  )

  // Mark as read when the conversation is opened, and when messages arrive while it is open
  const unreadIncomingIds = messages
    .filter((m) => m.senderId === partnerId && m.status !== 'READ')
    .map((m) => m.id)
    .join(',')
  const markingRead = useRef(false)
  const [readRetry, setReadRetry] = useState(0)
  useEffect(() => {
    if (!partnerId || !unreadIncomingIds || markingRead.current) return
    markingRead.current = true
    const pending = new Set(unreadIncomingIds.split(','))
    let succeeded = false
    messagesApi
      .markAsRead(partnerId)
      .then((response) => {
        succeeded = true
        const marked = new Set<string>([...pending, ...((response.data?.messageIds as string[]) ?? [])])
        setMessagesCache(partnerId, (items) =>
          items.map((m) => (marked.has(m.id) ? { ...m, status: 'READ' } : m))
        )
        updateConversation(partnerId, (c) => ({ ...c, unreadCount: 0 }))
      })
      .catch(() => {
        // Not blocking: the conversation stays marked as unread
      })
      .finally(() => {
        markingRead.current = false
        // Messages received during the request are marked on the next pass
        if (succeeded) setReadRetry((n) => n + 1)
      })
  }, [partnerId, unreadIncomingIds, readRetry, setMessagesCache, updateConversation])

  // Scroll: stick to the bottom for new messages, keep the position when older ones load
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (scrollRestore.current) {
      el.scrollTop = el.scrollHeight - scrollRestore.current.height + scrollRestore.current.top
      scrollRestore.current = null
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, typingUsers])

  useEffect(() => {
    stickToBottom.current = true
    setMessageInput('')
    setAttachment(null)
    setAttachmentError(null)
    setPpvEnabled(false)
    setPpvPrice('')
    setPpvError(null)
    typingSentRef.current = false
  }, [partnerId])

  const loadOlder = useCallback(() => {
    const el = scrollRef.current
    if (!messagesQuery.hasNextPage || messagesQuery.isFetchingNextPage) return
    if (el) scrollRestore.current = { height: el.scrollHeight, top: el.scrollTop }
    messagesQuery.fetchNextPage()
  }, [messagesQuery])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (el.scrollTop < 60) loadOlder()
  }

  // Focus the composer when a conversation is opened
  useEffect(() => {
    if (!partnerId || composerBlocked) return
    const timer = setTimeout(() => composerRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [partnerId, composerBlocked])

  // ---------- Realtime ----------
  const partnerRef = useRef<string | null>(null)
  partnerRef.current = partnerId

  useEffect(() => {
    if (!connected) return

    const touchConversation = (otherId: string, message: Message, incoming: boolean) => {
      const known = queryClient
        .getQueryData<Conversation[]>(['conversations'])
        ?.some((c) => c.participant.id === otherId)
      if (!known) {
        queryClient.invalidateQueries({ queryKey: ['conversations'] })
        return
      }
      updateConversation(otherId, (c) => ({
        ...c,
        lastMessage: {
          id: message.id,
          content: message.content,
          createdAt: message.createdAt,
          senderId: message.senderId,
          status: message.status,
          hasAttachment: message.hasAttachment,
          isPpv: message.isPpv,
          locked: message.locked,
        },
        updatedAt: message.createdAt,
        unreadCount: incoming && partnerRef.current !== otherId ? c.unreadCount + 1 : c.unreadCount,
      }))
    }

    const offNew = onNewMessage((message: Message) => {
      touchConversation(message.senderId, message, true)
      appendMessage(message.senderId, message)
      // Real-time pushes only know the account's verification: reload with this browser's age token
      if (message.ageVerificationRequired && getStoredAgeToken()) {
        queryClient.invalidateQueries({ queryKey: ['messages', message.senderId] })
      }
      // Received while typing: the indicator is over
      setTypingUsers((prev) => {
        if (!prev.has(message.senderId)) return prev
        const next = new Set(prev)
        next.delete(message.senderId)
        return next
      })
    })

    const offSent = onMessageSent((message) => {
      touchConversation(message.receiverId, message, false)
      appendMessage(message.receiverId, message)
    })

    const offTyping = onTyping(({ userId, isTyping }) => {
      const timers = typingTimers.current
      clearTimeout(timers.get(userId))
      setTypingUsers((prev) => {
        const next = new Set(prev)
        if (isTyping) next.add(userId)
        else next.delete(userId)
        return next
      })
      if (isTyping) {
        // Safety net if the "stopped typing" event is lost
        timers.set(
          userId,
          setTimeout(() => {
            setTypingUsers((prev) => {
              const next = new Set(prev)
              next.delete(userId)
              return next
            })
          }, 5000)
        )
      }
    })

    const offRead = onMessageRead(({ messageIds, readBy }) => {
      const ids = new Set(messageIds)
      setMessagesCache(readBy, (items) => items.map((m) => (ids.has(m.id) ? { ...m, status: 'READ' } : m)))
      updateConversation(readBy, (c) =>
        c.lastMessage && ids.has(c.lastMessage.id) ? { ...c, lastMessage: { ...c.lastMessage, status: 'READ' } } : c
      )
    })

    const offDeleted = onMessageDeleted(({ messageId, senderId, receiverId }) => {
      const otherId = senderId === user?.id ? receiverId : senderId
      setMessagesCache(otherId, (items) => items.filter((m) => m.id !== messageId))
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    })

    const timers = typingTimers.current
    return () => {
      offNew()
      offSent()
      offTyping()
      offRead()
      offDeleted()
      timers.forEach((timer) => clearTimeout(timer))
    }
  }, [
    connected,
    user?.id,
    queryClient,
    onNewMessage,
    onMessageSent,
    onTyping,
    onMessageRead,
    onMessageDeleted,
    appendMessage,
    setMessagesCache,
    updateConversation,
  ])

  // ---------- Composer ----------
  const stopTyping = useCallback(() => {
    clearTimeout(typingStopTimer.current)
    if (typingSentRef.current && partnerRef.current) {
      setTyping(partnerRef.current, false)
    }
    typingSentRef.current = false
  }, [setTyping])

  // Leaving a conversation: tell that partner we stopped typing
  useEffect(() => {
    const id = partnerId
    return () => {
      clearTimeout(typingStopTimer.current)
      if (typingSentRef.current && id) setTyping(id, false)
      typingSentRef.current = false
    }
  }, [partnerId, setTyping])

  const handleInputChange = (value: string) => {
    setMessageInput(value)
    if (!partnerId) return

    if (value.length > 0 && !typingSentRef.current) {
      setTyping(partnerId, true)
      typingSentRef.current = true
    }
    clearTimeout(typingStopTimer.current)
    typingStopTimer.current = setTimeout(stopTyping, value.length > 0 ? 2000 : 0)
  }

  const clearAttachment = () => {
    if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    setAttachment(null)
    setAttachmentError(null)
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file) return

    const isImage = IMAGE_TYPES.includes(file.type)
    const isVideo = VIDEO_TYPES.includes(file.type)
    if (!isImage && !isVideo) {
      setAttachmentError('Format non pris en charge : images JPG, PNG, GIF, WebP ou vidéos MP4, MOV, WebM.')
      return
    }
    if (isImage && file.size > MAX_IMAGE_SIZE) {
      setAttachmentError('Image trop volumineuse (10 Mo maximum).')
      return
    }
    if (isVideo && file.size > MAX_VIDEO_SIZE) {
      setAttachmentError('Vidéo trop volumineuse (100 Mo maximum).')
      return
    }

    setAttachmentError(null)
    setUploadProgress(0)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await mediaApi.upload(formData, {
        onUploadProgress: (event: { loaded: number; total?: number }) => {
          if (event.total) setUploadProgress(Math.round((event.loaded * 100) / event.total))
        },
      })
      if (!response.data?.url) throw new Error('Réponse du serveur invalide')
      if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
      setAttachment({
        url: response.data.url,
        previewUrl: URL.createObjectURL(file),
        type: isImage ? 'image' : 'video',
        name: file.name,
      })
    } catch (error: any) {
      toast({
        title: 'Échec de l’envoi du fichier',
        description: errorMessage(error),
        variant: 'destructive',
      })
    } finally {
      setUploadProgress(null)
    }
  }

  const validatePpv = (): number | undefined | null => {
    if (!ppvEnabled) return undefined
    const raw = ppvPrice.trim()
    if (!raw) {
      setPpvError('Indiquez un prix.')
      return null
    }
    if (!/^\d+([.,]\d{1,2})?$/.test(raw)) {
      setPpvError('Prix invalide (exemple : 9,99).')
      return null
    }
    const price = Number(raw.replace(',', '.'))
    if (price < PPV_MIN || price > PPV_MAX) {
      setPpvError(`Le prix doit être compris entre ${PPV_MIN} € et ${PPV_MAX} €.`)
      return null
    }
    setPpvError(null)
    return price
  }

  const handleSendMessage = async () => {
    const content = messageInput.trim()
    if ((!content && !attachment) || !selectedConversation || sending || composerBlocked) return

    const price = validatePpv()
    if (price === null) return

    const recipientId = selectedConversation.participant.id
    setSending(true)
    try {
      const response = await messagesApi.sendMessage({
        recipientId,
        content: content || undefined,
        attachmentUrl: attachment?.url,
        ppvPrice: price,
      })
      const message = response.data as Message
      stickToBottom.current = true
      appendMessage(recipientId, message)
      if (queryClient.getQueryData<Conversation[]>(['conversations'])?.some((c) => c.participant.id === recipientId)) {
        updateConversation(recipientId, (c) => ({
          ...c,
          lastMessage: { ...message },
          updatedAt: message.createdAt,
        }))
      } else {
        queryClient.invalidateQueries({ queryKey: ['conversations'] })
      }
      setMessageInput('')
      clearAttachment()
      setPpvEnabled(false)
      setPpvPrice('')
      stopTyping()
      composerRef.current?.focus()
    } catch (error: any) {
      const status = error?.response?.status
      if (status === 403) {
        updateConversation(recipientId, (c) => ({ ...c, canMessage: false }))
      }
      toast({
        title: 'Message non envoyé',
        description: errorMessage(error),
        variant: 'destructive',
      })
    } finally {
      setSending(false)
    }
  }

  const handleDeleteMessage = async (message: Message) => {
    if (!partnerId) return
    const ok = await confirm({
      title: 'Supprimer ce message ?',
      description: message.isPpv
        ? 'Le message payant sera retiré de la conversation et ne pourra plus être acheté.'
        : 'Le message sera retiré de la conversation pour vous et votre interlocuteur.',
      confirmText: 'Supprimer',
      variant: 'destructive',
    })
    if (!ok) return

    setDeletingId(message.id)
    try {
      await messagesApi.deleteMessage(message.id)
      setMessagesCache(partnerId, (items) => items.filter((m) => m.id !== message.id))
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      toast({ title: 'Message supprimé' })
    } catch (error: any) {
      toast({
        title: 'Suppression impossible',
        description: errorMessage(error),
        variant: 'destructive',
      })
    } finally {
      setDeletingId(null)
    }
  }

  const handleUnlocked = () => {
    setUnlockTarget(null)
    if (partnerId) {
      queryClient.invalidateQueries({ queryKey: ['messages', partnerId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }
    toast({ title: 'Message débloqué', description: 'Le contenu est maintenant accessible.' })
  }

  const canSend =
    !sending && !composerBlocked && uploadProgress === null && (messageInput.trim().length > 0 || !!attachment)

  // ---------- Render ----------
  return (
    <div className="grid md:grid-cols-[320px_1fr] lg:grid-cols-[360px_1fr] gap-4 h-[calc(100dvh-9rem)] min-h-[480px]">
      {/* Conversations List */}
      <Card className={`flex-col min-h-0 overflow-hidden ${selectedConversation ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-4 space-y-3 border-b">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-bold">Messages</h2>
            <div className="flex items-center gap-2">
              {connected ? (
                <Badge variant="success">En ligne</Badge>
              ) : (
                <Badge variant="secondary" title="Les nouveaux messages s'afficheront à la reconnexion">
                  Hors ligne
                </Badge>
              )}
              <Button
                size="icon"
                variant="outline"
                onClick={() => setNewConversationOpen(true)}
                aria-label="Nouveau message"
                title="Nouveau message"
              >
                <PenSquare className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={conversationSearch}
              onChange={(e) => setConversationSearch(e.target.value)}
              placeholder="Rechercher une conversation"
              className="pl-9"
              aria-label="Rechercher une conversation"
            />
          </div>
          {openingTarget && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Ouverture de la conversation...
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {conversationsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : conversationsError ? (
            <div className="text-center py-8 px-4 text-muted-foreground space-y-3">
              <p>Impossible de charger vos conversations.</p>
              <Button variant="outline" size="sm" onClick={() => refetchConversations()}>
                Réessayer
              </Button>
            </div>
          ) : filteredConversations.length > 0 ? (
            <div className="space-y-1">
              {filteredConversations.map((conv) => (
                <ConversationRow
                  key={conv.id}
                  conversation={conv}
                  active={conv.participant.id === selectedPartnerId}
                  online={onlineUsers.has(conv.participant.id)}
                  typing={typingUsers.has(conv.participant.id)}
                  ownId={user?.id}
                  onSelect={() => setSelectedPartnerId(conv.participant.id)}
                />
              ))}
            </div>
          ) : sortedConversations.length > 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Aucune conversation ne correspond à « {conversationSearch.trim()} ».
            </div>
          ) : (
            <div className="text-center py-10 px-4 text-muted-foreground space-y-3">
              <MessageSquare className="h-10 w-10 mx-auto opacity-50" />
              <p>Aucune conversation</p>
              <p className="text-sm">
                {isCreator
                  ? 'Écrivez à vos abonnés pour lancer la discussion.'
                  : 'Écrivez à un créateur depuis son profil ou avec le bouton ci-dessous.'}
              </p>
              <Button size="sm" onClick={() => setNewConversationOpen(true)}>
                <PenSquare className="h-4 w-4 mr-2" />
                Nouveau message
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Thread */}
      <Card className={`flex-col min-h-0 overflow-hidden ${selectedConversation ? 'flex' : 'hidden md:flex'}`}>
        {selectedConversation ? (
          <>
            {/* Header */}
            <div className="p-3 md:p-4 border-b flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden -ml-1"
                onClick={() => setSelectedPartnerId(null)}
                aria-label="Retour aux conversations"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <Link href={`/${selectedConversation.participant.username}`} className="flex items-center gap-3 min-w-0 hover:opacity-80">
                <div className="relative shrink-0">
                  <Avatar>
                    <AvatarImage src={selectedConversation.participant.avatar ?? undefined} />
                    <AvatarFallback>{initialsOf(selectedConversation.participant)}</AvatarFallback>
                  </Avatar>
                  {onlineUsers.has(selectedConversation.participant.id) && (
                    <div className="absolute bottom-0 right-0 h-3 w-3 bg-green-500 border-2 border-background rounded-full" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{nameOf(selectedConversation.participant)}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {typingUsers.has(selectedConversation.participant.id)
                      ? 'En train d’écrire…'
                      : onlineUsers.has(selectedConversation.participant.id)
                        ? 'En ligne'
                        : `@${selectedConversation.participant.username}`}
                  </p>
                </div>
              </Link>
            </div>

            {/* Messages */}
            <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-3 md:p-4 space-y-3">
              {messagesQuery.isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : messagesQuery.isError ? (
                <div className="text-center py-8 text-muted-foreground space-y-3">
                  <p>Impossible de charger les messages.</p>
                  <Button variant="outline" size="sm" onClick={() => messagesQuery.refetch()}>
                    Réessayer
                  </Button>
                </div>
              ) : messages.length > 0 ? (
                <>
                  {messagesQuery.hasNextPage && (
                    <div className="flex justify-center">
                      <Button variant="ghost" size="sm" onClick={loadOlder} disabled={messagesQuery.isFetchingNextPage}>
                        {messagesQuery.isFetchingNextPage && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Messages précédents
                      </Button>
                    </div>
                  )}
                  {messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      isOwn={message.senderId === user?.id}
                      deleting={deletingId === message.id}
                      onDelete={() => handleDeleteMessage(message)}
                      onUnlock={() => setUnlockTarget(message)}
                      onOpenMedia={(url, type) => setLightboxItem({ url, type })}
                    />
                  ))}
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p>Aucun message</p>
                  {!composerBlocked && <p className="text-sm mt-2">Commencez la conversation</p>}
                </div>
              )}
              {typingUsers.has(selectedConversation.participant.id) && (
                <div className="flex justify-start" aria-label="En train d’écrire">
                  <div className="bg-muted rounded-lg p-3">
                    <div className="flex space-x-1">
                      <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" />
                      <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:150ms]" />
                      <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Composer */}
            {composerBlocked ? (
              <div className="p-4 border-t bg-muted/40 text-sm text-muted-foreground flex items-start gap-2">
                <Lock className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                  {nameOf(selectedConversation.participant)} n&apos;accepte pas les messages privés pour le moment.
                  Vous pourrez répondre dès qu&apos;il ou elle vous écrira.
                </p>
              </div>
            ) : (
              <div className="p-3 md:p-4 border-t space-y-2">
                {uploadProgress !== null && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Envoi du fichier… {uploadProgress}%</p>
                    <Progress value={uploadProgress} className="h-1.5" />
                  </div>
                )}
                {attachmentError && <p className="text-sm text-destructive">{attachmentError}</p>}

                {attachment && (
                  <div className="relative inline-block">
                    {attachment.type === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={attachment.previewUrl} alt="Aperçu" className="max-h-32 rounded border" />
                    ) : (
                      <div className="flex items-center gap-2 p-3 bg-muted rounded border max-w-[240px]">
                        <FileVideo className="h-6 w-6 shrink-0" />
                        <span className="text-sm truncate">{attachment.name}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={clearAttachment}
                      aria-label="Retirer la pièce jointe"
                      className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 hover:bg-destructive/90"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}

                {isCreator && ppvEnabled && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Lock className="h-4 w-4 text-primary shrink-0" />
                      <label htmlFor="ppv-price" className="text-sm whitespace-nowrap">
                        Prix de déblocage
                      </label>
                      <div className="relative w-28">
                        <Input
                          id="ppv-price"
                          inputMode="decimal"
                          value={ppvPrice}
                          onChange={(e) => {
                            setPpvPrice(e.target.value)
                            setPpvError(null)
                          }}
                          placeholder="9,99"
                          className="pr-7"
                          aria-invalid={!!ppvError}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">€</span>
                      </div>
                    </div>
                    {ppvError ? (
                      <p className="text-sm text-destructive">{ppvError}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Le texte et la pièce jointe resteront masqués jusqu&apos;au paiement ({PPV_MIN} € à {PPV_MAX} €).
                      </p>
                    )}
                  </div>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleSendMessage()
                  }}
                  className="flex items-end gap-2"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={[...IMAGE_TYPES, ...VIDEO_TYPES].join(',')}
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadProgress !== null || sending}
                    aria-label="Joindre une image ou une vidéo"
                    title="Joindre une image ou une vidéo"
                  >
                    {uploadProgress !== null ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ImageIcon className="h-4 w-4" />
                    )}
                  </Button>
                  {isCreator && (
                    <Button
                      type="button"
                      variant={ppvEnabled ? 'default' : 'outline'}
                      size="icon"
                      onClick={() => {
                        setPpvEnabled((v) => !v)
                        setPpvError(null)
                      }}
                      disabled={sending}
                      aria-pressed={ppvEnabled}
                      aria-label="Message payant"
                      title="Message payant (PPV)"
                    >
                      <Lock className="h-4 w-4" />
                    </Button>
                  )}
                  <Textarea
                    ref={composerRef}
                    rows={1}
                    placeholder="Tapez votre message..."
                    value={messageInput}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault()
                        handleSendMessage()
                      }
                    }}
                    disabled={sending}
                    maxLength={5000}
                    className="flex-1 min-h-[40px] max-h-32 resize-none py-2"
                  />
                  <Button type="submit" disabled={!canSend} aria-label="Envoyer">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </form>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground p-6 text-center">
            <MessageSquare className="h-10 w-10 opacity-50" />
            <p>Sélectionnez une conversation</p>
            <Button variant="outline" size="sm" onClick={() => setNewConversationOpen(true)}>
              <PenSquare className="h-4 w-4 mr-2" />
              Nouveau message
            </Button>
          </div>
        )}
      </Card>

      <NewConversationDialog
        open={newConversationOpen}
        onOpenChange={setNewConversationOpen}
        isCreator={isCreator}
        onOpened={(conversation) => {
          openConversation(conversation)
          setNewConversationOpen(false)
          queryClient.invalidateQueries({ queryKey: ['conversations'] })
        }}
      />

      <Dialog open={!!unlockTarget} onOpenChange={(open) => !open && setUnlockTarget(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Débloquer ce message</DialogTitle>
            <DialogDescription>
              Paiement unique de {formatEuros(unlockTarget?.ppvPrice ?? 0)} HT à{' '}
              {selectedConversation ? nameOf(selectedConversation.participant) : 'ce créateur'}.
            </DialogDescription>
          </DialogHeader>
          {unlockTarget && (
            <OneTimeCheckout
              kind="message"
              compact
              amount={Number(unlockTarget.ppvPrice ?? 0)}
              description={`Message privé de @${selectedConversation?.participant.username ?? ''}`}
              start={async (options) => (await messagesApi.unlockMessage(unlockTarget.id, options)).data}
              confirm={async (transactionId) =>
                (await messagesApi.confirmUnlockMessage(unlockTarget.id, transactionId)).data
              }
              successDelay={1500}
              onSuccess={handleUnlocked}
              onCancel={() => setUnlockTarget(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Lightbox
        items={lightboxItem ? [lightboxItem] : []}
        isOpen={!!lightboxItem}
        onClose={() => setLightboxItem(null)}
      />
    </div>
  )
}

function ConversationRow({
  conversation,
  active,
  online,
  typing,
  ownId,
  onSelect,
}: {
  conversation: Conversation
  active: boolean
  online: boolean
  typing: boolean
  ownId?: string
  onSelect: () => void
}) {
  const { participant, lastMessage, unreadCount } = conversation
  const fromMe = lastMessage?.senderId === ownId

  let preview: string
  if (typing) preview = 'En train d’écrire…'
  else if (!lastMessage) preview = 'Nouvelle conversation'
  else if (lastMessage.locked) preview = '🔒 Message payant'
  else if (lastMessage.content) preview = lastMessage.content
  else if (lastMessage.hasAttachment) preview = '📎 Pièce jointe'
  else preview = 'Message'

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-lg cursor-pointer transition-colors ${
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <Avatar>
            <AvatarImage src={participant.avatar ?? undefined} />
            <AvatarFallback className="text-foreground">{initialsOf(participant)}</AvatarFallback>
          </Avatar>
          {online && (
            <div className="absolute bottom-0 right-0 h-3 w-3 bg-green-500 border-2 border-background rounded-full" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className={`truncate ${unreadCount > 0 ? 'font-semibold' : 'font-medium'}`}>{nameOf(participant)}</p>
            {lastMessage && (
              <span className={`text-xs shrink-0 ${active ? 'opacity-80' : 'text-muted-foreground'}`}>
                {formatDistanceToNow(new Date(lastMessage.createdAt), { locale: fr })}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className={`text-sm truncate ${active ? 'opacity-80' : 'text-muted-foreground'} ${typing ? 'italic' : ''}`}>
              {fromMe && !typing && lastMessage ? 'Vous : ' : ''}
              {preview}
            </p>
            {unreadCount > 0 && (
              <Badge variant="destructive" className="shrink-0" aria-label={`${unreadCount} non lu(s)`}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

function MessageBubble({
  message,
  isOwn,
  deleting,
  onDelete,
  onUnlock,
  onOpenMedia,
}: {
  message: Message
  isOwn: boolean
  deleting: boolean
  onDelete: () => void
  onUnlock: () => void
  onOpenMedia: (url: string, type: 'image' | 'video') => void
}) {
  const time = formatDistanceToNow(new Date(message.createdAt), { addSuffix: true, locale: fr })
  const canDelete = isOwn && !(message.isPpv && message.isPurchased)
  const attachmentUrl = message.attachmentUrl
  const isVideo = !!attachmentUrl && VIDEO_URL.test(attachmentUrl)

  return (
    <div className={`group flex items-end gap-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
      {canDelete && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100"
          onClick={onDelete}
          disabled={deleting}
          aria-label="Supprimer le message"
          title="Supprimer"
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      )}
      <div
        className={`max-w-[80%] md:max-w-[70%] rounded-lg overflow-hidden ${
          isOwn ? 'bg-primary text-primary-foreground' : 'bg-muted'
        }`}
      >
        {message.locked ? (
          <div className="p-4 space-y-3 min-w-[220px]">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-full bg-background/60 flex items-center justify-center">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium text-sm">Message payant</p>
                <p className="text-xs opacity-70">
                  {message.hasAttachment ? 'Texte et média masqués' : 'Contenu masqué'}
                </p>
              </div>
            </div>
            <Button size="sm" className="w-full" onClick={onUnlock}>
              Débloquer pour {formatFanPrice(message.ppvPrice ?? 0)}
            </Button>
          </div>
        ) : (
          <>
            {message.ageVerificationRequired ? (
              <div className="p-2">
                <AgeGatedMedia compact className="min-w-[220px]" label="Média réservé aux adultes" />
              </div>
            ) : message.hasAttachment && attachmentUrl && (
              isVideo ? (
                <video src={attachmentUrl} controls className="max-w-full max-h-80 bg-black" />
              ) : (
                <button type="button" onClick={() => onOpenMedia(attachmentUrl, 'image')} className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={attachmentUrl} alt="Pièce jointe" className="max-w-full max-h-80 object-cover" />
                </button>
              )
            )}
          </>
        )}
        {!message.locked && (
          <div className="px-3 py-2">
            {message.isPpv && (
              <p className="text-xs font-medium mb-1 flex items-center gap-1 opacity-90">
                <Lock className="h-3 w-3" />
                {isOwn
                  ? `Message payant · ${formatEuros(message.ppvPrice ?? 0)} · ${message.isPurchased ? 'Acheté' : 'Non acheté'}`
                  : `Débloqué · ${formatEuros(message.ppvPrice ?? 0)}`}
              </p>
            )}
            {message.content && <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>}
            <p className="text-xs opacity-70 mt-1 flex items-center gap-1 justify-end">
              {time}
              {isOwn &&
                (message.status === 'READ' ? (
                  <CheckCheck className="h-3.5 w-3.5" aria-label="Lu" />
                ) : (
                  <Check className="h-3.5 w-3.5" aria-label="Envoyé" />
                ))}
            </p>
          </div>
        )}
        {message.locked && <p className="text-xs opacity-70 px-4 pb-3 -mt-1">{time}</p>}
      </div>
    </div>
  )
}

function NewConversationDialog({
  open,
  onOpenChange,
  isCreator,
  onOpened,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  isCreator: boolean
  onOpened: (conversation: Conversation) => void
}) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [startingId, setStartingId] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setDebounced('')
    }
  }, [open])

  const tooShort = debounced.length === 1
  const { data: contacts, isLoading, isError, refetch } = useQuery({
    queryKey: ['message-contacts', debounced],
    queryFn: async () => (await messagesApi.searchContacts(debounced || undefined)).data as Contact[],
    enabled: open && !tooShort,
  })

  const start = async (contact: Contact) => {
    setStartingId(contact.id)
    try {
      const response = await messagesApi.startConversation(contact.id)
      onOpened(response.data as Conversation)
    } catch (error: any) {
      toast({
        title: "Impossible d'ouvrir la conversation",
        description:
          error?.response?.status === 403 ? "Ce créateur n'accepte pas les messages privés." : errorMessage(error),
        variant: 'destructive',
      })
    } finally {
      setStartingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nouveau message</DialogTitle>
          <DialogDescription>
            {isCreator
              ? 'Recherchez un abonné, un follower ou un créateur.'
              : 'Recherchez un créateur à qui écrire.'}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom ou @pseudo"
            className="pl-9"
            aria-label="Rechercher un utilisateur"
          />
        </div>
        <div className="max-h-80 overflow-y-auto -mx-2">
          {tooShort ? (
            <p className="text-sm text-muted-foreground text-center py-6">Saisissez au moins 2 caractères.</p>
          ) : isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : isError ? (
            <div className="text-center py-6 space-y-2">
              <p className="text-sm text-muted-foreground">La recherche a échoué.</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                Réessayer
              </Button>
            </div>
          ) : contacts && contacts.length > 0 ? (
            <>
              {!debounced && (
                <p className="text-xs font-medium text-muted-foreground px-2 pb-1">
                  {isCreator ? 'Vos abonnés et créateurs suivis' : 'Vos créateurs'}
                </p>
              )}
              {contacts.map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  disabled={!contact.canMessage || !!startingId}
                  onClick={() => start(contact)}
                  className="w-full flex items-center gap-3 p-2 rounded-lg text-left hover:bg-accent disabled:opacity-60 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                >
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={contact.avatar ?? undefined} />
                    <AvatarFallback>{initialsOf(contact)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{nameOf(contact)}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      @{contact.username}
                      {contact.role === 'CREATOR' ? ' · Créateur' : ''}
                      {!contact.canMessage ? ' · Messages désactivés' : ''}
                    </p>
                  </div>
                  {startingId === contact.id && <Loader2 className="h-4 w-4 animate-spin" />}
                </button>
              ))}
            </>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">
              {debounced
                ? 'Aucun utilisateur trouvé.'
                : isCreator
                  ? 'Aucun abonné pour le moment. Recherchez un nom ci-dessus.'
                  : 'Abonnez-vous ou suivez un créateur, ou recherchez-le ci-dessus.'}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
