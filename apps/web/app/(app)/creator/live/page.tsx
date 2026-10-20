'use client'

import { useEffect, useReducer, useRef, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Socket } from 'socket.io-client'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  Radio,
  Users,
  Send,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Square,
  CalendarClock,
  Play,
  Trash2,
  ExternalLink,
  Loader2,
  Eye,
  TrendingUp,
  MessageSquare,
  Clock,
  Gift,
  Lock,
  Target,
  ChevronDown,
} from 'lucide-react'
import { liveApi } from '@/lib/api'
import {
  createLiveSocket,
  closeLiveSocket,
  liveErrorMessage,
  mediaErrorMessage,
  formatStreamDuration,
  CHAT_ERROR_MESSAGES,
  LIVE_ACK_TIMEOUT,
  VISIBILITY_LABELS,
  type LiveAck,
  type LiveChatMessage,
  type StreamVisibility,
} from '@/lib/live'
import { useAuth } from '@/contexts/auth-context'
import { formatEuros } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useConfirm } from '@/hooks/use-confirm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LiveChatMessageItem } from '@/components/live/live-chat-message'
import { BroadcastQualitySettings } from '@/components/live/broadcast-quality-settings'
import { BroadcastHealthPanel } from '@/components/live/broadcast-health-panel'
import { useBroadcastQuality } from '@/hooks/use-broadcast-quality'
import { useMediaDevices } from '@/hooks/use-media-devices'
import { useChatAutoscroll } from '@/hooks/use-chat-autoscroll'
import { useStableCallback } from '@/hooks/use-stable-callback'
import { QUALITY_PRESETS, type QualityPresetId } from '@/lib/webrtc/quality-presets'
import { openBroadcastMedia, switchDevice, switchPreset } from '@/lib/webrtc/media'
import { addBroadcastTracks } from '@/lib/webrtc/sender-params'
import { getLiveIceServers, prefetchLiveIceServers } from '@/lib/webrtc/ice-servers'
import { TipMenuEditor } from '@/components/live/tip-menu-editor'
import { TipGoalsEditor } from '@/components/live/tip-goals-editor'
import { TipActionsQueue } from '@/components/live/tip-actions-queue'
import {
  bindLiveTipEvents,
  initialLiveTipState,
  liveTipsReducer,
  type LiveTipSnapshot,
  type TipGoal,
} from '@/lib/live-tips'
import { formatGoalEuros, goalReachedText } from '@/lib/live-tip-goals'

interface StreamStats {
  tipsCount: number
  tipsTotal: number // euros
  ppvCount: number
  ppvTotal: number // euros
}

interface CreatorStream {
  id: string
  title: string
  description?: string | null
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'
  visibility: string
  isPpv?: boolean
  ppvPrice?: number | null // euros
  scheduledFor?: string | null
  startedAt?: string | null
  endedAt?: string | null
  duration?: number | null // seconds
  viewerCount: number
  peakViewers: number
  totalViews: number
  createdAt: string
  _count?: { viewers?: number; messages?: number }
  stats?: StreamStats
  /** Euros of tips received during the live */
  tipTotal?: number
  /** Donation goal milestones, by amount */
  tipGoals?: TipGoal[]
}

interface ViewerPeer {
  pc: RTCPeerConnection
  sessionId: string
  pendingCandidates: RTCIceCandidateInit[]
  /** Closes the connection if it stays failed (the viewer gets time to restart ICE) */
  failTimer?: ReturnType<typeof setTimeout>
}

// A failed viewer connection is kept this long for an ICE restart
const PEER_FAILED_GRACE_MS = 20_000

interface FormErrors {
  title?: string
  scheduledFor?: string
  ppvPrice?: string
}

const TITLE_MAX = 120
const DESCRIPTION_MAX = 1000
const PPV_MIN = 1
const PPV_MAX = 1000

const newSessionId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

// Value for <input type="datetime-local"> in local time
const toLocalInputValue = (date: Date) => {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const START_ERRORS: Record<string, string> = {
  NOT_CREATOR: 'Seul le créateur peut diffuser ce live.',
  NOT_LIVE: "Ce live n'est pas en cours.",
  NOT_FOUND: 'Live introuvable.',
}

export default function CreatorLivePage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const queryClient = useQueryClient()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<StreamVisibility>('SUBSCRIBERS_ONLY')
  const [scheduledFor, setScheduledFor] = useState('')
  const [isPpv, setIsPpv] = useState(false)
  const [ppvPrice, setPpvPrice] = useState('')
  // Inline errors are shown once the form was submitted
  const [submitted, setSubmitted] = useState(false)

  const [previewOn, setPreviewOn] = useState(false)
  const [startingPreview, setStartingPreview] = useState(false)
  const [cameraOn, setCameraOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [mediaError, setMediaError] = useState<string | null>(null)

  const [activeStream, setActiveStream] = useState<CreatorStream | null>(null)
  const [broadcasting, setBroadcasting] = useState(false)
  const [viewerCount, setViewerCount] = useState(0)
  const [chatMessages, setChatMessages] = useState<LiveChatMessage[]>([])
  const [chatMessage, setChatMessage] = useState('')
  const [chatError, setChatError] = useState<string | null>(null)
  const [sendingChat, setSendingChat] = useState(false)
  const [mutedUserIds, setMutedUserIds] = useState<Set<string>>(new Set())
  // Donation goals and tip menu requests of the live being broadcast
  const [tipState, dispatchTips] = useReducer(liveTipsReducer, initialLiveTipState)
  // Upcoming live whose donation goals editor is open
  const [goalsStreamId, setGoalsStreamId] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const peersRef = useRef(new Map<string, ViewerPeer>())
  const chatErrorTimer = useRef<ReturnType<typeof setTimeout>>()

  // Video quality: preset, capture devices, adaptive bitrate per viewer
  const quality = useBroadcastQuality(peersRef, !!activeStream)
  const mediaDevices = useMediaDevices()
  const [cameraId, setCameraId] = useState<string>()
  const [microphoneId, setMicrophoneId] = useState<string>()
  const [switchingMedia, setSwitchingMedia] = useState(false)
  const [socketReconnecting, setSocketReconnecting] = useState(false)

  const isCreator = user?.role === 'CREATOR'

  const {
    data: streams = [],
    isLoading: streamsLoading,
    isError: streamsError,
    refetch: refetchStreams,
  } = useQuery({
    queryKey: ['creator-streams', user?.id],
    queryFn: async () => {
      const response = await liveApi.getCreatorStreams(user!.id)
      return (Array.isArray(response.data) ? response.data : []) as CreatorStream[]
    },
    enabled: !!user?.id && isCreator,
  })

  const pendingStreams = streams.filter((s) => s.status === 'SCHEDULED' || s.status === 'LIVE')
  const pastStreams = streams.filter((s) => s.status === 'ENDED' || s.status === 'CANCELLED').slice(0, 10)
  const otherLiveStream = pendingStreams.find((s) => s.status === 'LIVE')

  // ---- Form validation ------------------------------------------------------

  const validate = (): FormErrors => {
    const errors: FormErrors = {}
    if (!title.trim()) {
      errors.title = 'Le titre est obligatoire.'
    } else if (title.trim().length > TITLE_MAX) {
      errors.title = `Le titre ne doit pas dépasser ${TITLE_MAX} caractères.`
    }
    if (scheduledFor) {
      const date = new Date(scheduledFor)
      if (Number.isNaN(date.getTime())) {
        errors.scheduledFor = 'Date invalide.'
      } else if (date.getTime() <= Date.now() + 60_000) {
        errors.scheduledFor = 'Choisissez une date dans le futur (au moins dans une minute).'
      }
    }
    if (isPpv) {
      const price = Number(ppvPrice.replace(',', '.'))
      if (!ppvPrice.trim() || !Number.isFinite(price)) {
        errors.ppvPrice = "Indiquez le prix d'accès."
      } else if (price < PPV_MIN || price > PPV_MAX) {
        errors.ppvPrice = `Le prix doit être compris entre ${formatEuros(PPV_MIN)} et ${formatEuros(PPV_MAX)}.`
      } else if (Math.round(price * 100) !== price * 100) {
        errors.ppvPrice = 'Deux décimales maximum.'
      }
    }
    return errors
  }
  const formErrors = submitted ? validate() : {}

  // ---- Media ---------------------------------------------------------------

  const startPreview = async () => {
    if (localStreamRef.current) return localStreamRef.current
    setMediaError(null)
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMediaError(mediaErrorMessage({ name: window.isSecureContext ? 'NotFoundError' : 'InsecureContext' }))
      return null
    }
    setStartingPreview(true)
    try {
      const media = await openBroadcastMedia(QUALITY_PRESETS[quality.presetId], {
        videoDeviceId: cameraId,
        audioDeviceId: microphoneId,
      })
      localStreamRef.current = media
      if (videoRef.current) {
        videoRef.current.srcObject = media
      }
      // Device labels are only available once the permission is granted
      void mediaDevices.refresh()
      setCameraId(media.getVideoTracks()[0]?.getSettings().deviceId)
      setMicrophoneId(media.getAudioTracks()[0]?.getSettings().deviceId)
      setPreviewOn(true)
      setCameraOn(true)
      setMicOn(true)
      return media
    } catch (error) {
      console.error('getUserMedia error:', error)
      setMediaError(mediaErrorMessage(error))
      return null
    } finally {
      setStartingPreview(false)
    }
  }

  const stopPreview = () => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setPreviewOn(false)
  }

  const toggleCamera = () => {
    const next = !cameraOn
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = next
    })
    setCameraOn(next)
  }

  const toggleMic = () => {
    const next = !micOn
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next
    })
    setMicOn(next)
  }

  const setLocalMedia = (media: MediaStream) => {
    localStreamRef.current = media
    if (videoRef.current && videoRef.current.srcObject !== media) {
      videoRef.current.srcObject = media
    }
  }

  const viewerConnections = () => [...peersRef.current.values()].map((entry) => entry.pc)

  // Preset change: new capture size and bitrate ceilings, applied live without renegotiation
  const handlePresetChange = async (presetId: QualityPresetId) => {
    quality.setPresetId(presetId)
    const media = localStreamRef.current
    if (!media) return
    setSwitchingMedia(true)
    try {
      setLocalMedia(await switchPreset(media, QUALITY_PRESETS[presetId], viewerConnections(), cameraId))
    } catch (error) {
      console.error('Preset switch error:', error)
      toast({ title: 'Changement de qualité impossible', description: mediaErrorMessage(error), variant: 'destructive' })
    } finally {
      setSwitchingMedia(false)
    }
  }

  // Camera / microphone change: the new track replaces the old one on every viewer connection
  const handleDeviceChange = async (kind: 'video' | 'audio', deviceId: string) => {
    if (kind === 'video') setCameraId(deviceId)
    else setMicrophoneId(deviceId)
    const media = localStreamRef.current
    if (!media) return
    setSwitchingMedia(true)
    try {
      setLocalMedia(
        await switchDevice(media, kind, deviceId, QUALITY_PRESETS[quality.presetId], viewerConnections()),
      )
    } catch (error) {
      console.error('Device switch error:', error)
      toast({
        title: kind === 'video' ? 'Changement de caméra impossible' : 'Changement de micro impossible',
        description: mediaErrorMessage(error),
        variant: 'destructive',
      })
    } finally {
      setSwitchingMedia(false)
    }
  }

  // ---- WebRTC (one peer connection per viewer, we are the offerer) ----------

  const closePeer = (viewerId: string) => {
    const entry = peersRef.current.get(viewerId)
    if (entry) {
      clearTimeout(entry.failTimer)
      entry.pc.onicecandidate = null
      entry.pc.onconnectionstatechange = null
      entry.pc.close()
      peersRef.current.delete(viewerId)
    }
  }

  const closeAllPeers = () => {
    peersRef.current.forEach((_entry, viewerId) => closePeer(viewerId))
  }

  const sendOfferTo = async (streamId: string, viewerId: string) => {
    const socket = socketRef.current
    if (!socket || !localStreamRef.current) return
    // Fetched once per live session (STUN + TURN credentials)
    const iceServers = await getLiveIceServers()
    const media = localStreamRef.current
    if (socketRef.current !== socket || !media) return

    closePeer(viewerId)
    const sessionId = newSessionId()
    const pc = new RTCPeerConnection({ iceServers })
    const entry: ViewerPeer = { pc, sessionId, pendingCandidates: [] }
    peersRef.current.set(viewerId, entry)

    // Send-only transceivers, capped from the first frame
    addBroadcastTracks(pc, media, quality.manager.initialEncodings(viewerId))

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          streamId,
          viewerId,
          candidate: event.candidate.toJSON(),
          sessionId,
        })
      }
    }

    pc.onconnectionstatechange = () => handlePeerState(viewerId, entry)

    await negotiate(streamId, viewerId, entry, false)
    // One more viewer: every viewer's share of the upload changes
    quality.manager.applyAll()
  }

  const negotiate = async (streamId: string, viewerId: string, entry: ViewerPeer, iceRestart: boolean) => {
    const socket = socketRef.current
    if (!socket) return
    try {
      const offer = await entry.pc.createOffer(iceRestart ? { iceRestart: true } : undefined)
      await entry.pc.setLocalDescription(offer)
      if (peersRef.current.get(viewerId) !== entry) return
      socket.emit('offer', { streamId, viewerId, offer: entry.pc.localDescription, sessionId: entry.sessionId })
    } catch (error) {
      console.error('WebRTC offer error:', error)
      if (iceRestart) {
        void sendOfferTo(streamId, viewerId)
      } else {
        closePeer(viewerId)
      }
    }
  }

  // The viewer lost the connection but kept its peer: restart ICE on the same
  // connection (same session id), or start over when that is not possible
  const restartIce = (streamId: string, viewerId: string) => {
    const entry = peersRef.current.get(viewerId)
    if (!entry || entry.pc.signalingState !== 'stable' || entry.pc.connectionState === 'closed') {
      void sendOfferTo(streamId, viewerId)
      return
    }
    clearTimeout(entry.failTimer)
    entry.failTimer = undefined
    entry.pendingCandidates = []
    void negotiate(streamId, viewerId, entry, true)
  }

  const handlePeerState = (viewerId: string, entry: ViewerPeer) => {
    if (peersRef.current.get(viewerId) !== entry) return
    const state = entry.pc.connectionState
    if (state === 'connected') {
      clearTimeout(entry.failTimer)
      entry.failTimer = undefined
      void quality.manager.applyPeer(viewerId)
    } else if (state === 'failed') {
      // The viewer retries (ICE restart, then a new offer): drop it only if it never comes back
      clearTimeout(entry.failTimer)
      entry.failTimer = setTimeout(() => {
        if (peersRef.current.get(viewerId) === entry && entry.pc.connectionState === 'failed') {
          closePeer(viewerId)
        }
      }, PEER_FAILED_GRACE_MS)
    } else if (state === 'closed') {
      closePeer(viewerId)
    }
  }

  // ---- Socket ---------------------------------------------------------------

  const disconnectSocket = () => {
    closeAllPeers()
    closeLiveSocket(socketRef.current)
    socketRef.current = null
    setBroadcasting(false)
  }

  // Stop broadcasting from this page (camera off, back to the form)
  const leaveBroadcast = () => {
    disconnectSocket()
    stopPreview()
    setActiveStream(null)
    setChatMessages([])
    setChatMessage('')
    setChatError(null)
    setMutedUserIds(new Set())
    setViewerCount(0)
    setSocketReconnecting(false)
    dispatchTips({ type: 'reset' })
  }

  const connectBroadcast = (stream: CreatorStream) => {
    disconnectSocket()
    prefetchLiveIceServers(true)
    const socket = createLiveSocket({
      onAuthError: () => {
        if (socketRef.current !== socket) return
        toast({
          title: 'Diffusion impossible',
          description: 'Connexion au serveur de live refusée. Reconnectez-vous puis reprenez le live.',
          variant: 'destructive',
        })
        disconnectSocket()
      },
    })
    socketRef.current = socket
    bindLiveTipEvents(socket, dispatchTips)
    const streamId = stream.id

    socket.on('connect', () => {
      socket.timeout(LIVE_ACK_TIMEOUT).emit('start-broadcast', { streamId }, (err: Error | null, ack: LiveAck) => {
        if (socketRef.current !== socket) return
        if (err || !ack?.success) {
          toast({
            title: 'Diffusion impossible',
            description: err
              ? 'Le serveur de live ne répond pas. Réessayez.'
              : START_ERRORS[ack?.reason ?? ''] || ack?.error || 'Erreur inconnue',
            variant: 'destructive',
          })
          disconnectSocket()
          return
        }
        setBroadcasting(true)
        setSocketReconnecting(false)
        setViewerCount(ack.viewerCount ?? 0)
        setChatMessages(ack.messages ?? [])
        setMutedUserIds(new Set(ack.mutedUserIds ?? []))
        dispatchTips({ type: 'snapshot', snapshot: ack as LiveTipSnapshot })
      })
    })

    socket.on('disconnect', () => {
      // Keep the viewers' connections: the video flows peer-to-peer, only
      // signaling is interrupted. start-broadcast is sent again on reconnect.
      setBroadcasting(false)
      setSocketReconnecting(true)
    })

    socket.on('viewer-joined', ({ viewerId, iceRestart }: { viewerId: string; iceRestart?: boolean }) => {
      if (iceRestart) {
        restartIce(streamId, viewerId)
      } else {
        void sendOfferTo(streamId, viewerId)
      }
    })

    // A viewer chose "Économie de données" (low) or "Auto"
    socket.on('viewer-quality', ({ viewerId, mode }: { viewerId: string; mode: string }) => {
      if (mode === 'auto' || mode === 'low') quality.manager.setViewerMode(viewerId, mode)
    })

    socket.on(
      'answer',
      async (data: { viewerId: string; answer: RTCSessionDescriptionInit; sessionId?: string }) => {
        const entry = peersRef.current.get(data.viewerId)
        if (!entry || entry.sessionId !== data.sessionId) return
        try {
          await entry.pc.setRemoteDescription(data.answer)
          const queued = entry.pendingCandidates
          entry.pendingCandidates = []
          for (const candidate of queued) {
            await entry.pc.addIceCandidate(candidate).catch(() => undefined)
          }
          void quality.manager.applyPeer(data.viewerId)
        } catch (error) {
          console.error('WebRTC answer error:', error)
          // The viewer asks for a new offer when its connection does not come up
          if (peersRef.current.get(data.viewerId) === entry) closePeer(data.viewerId)
        }
      },
    )

    socket.on(
      'ice-candidate',
      async (data: { viewerId: string; candidate: RTCIceCandidateInit; sessionId?: string }) => {
        const entry = peersRef.current.get(data.viewerId)
        if (!entry || entry.sessionId !== data.sessionId || !data.candidate) return
        try {
          // Queued while an (ICE restart) offer is waiting for its answer
          if (entry.pc.remoteDescription && entry.pc.signalingState === 'stable') {
            await entry.pc.addIceCandidate(data.candidate)
          } else {
            entry.pendingCandidates.push(data.candidate)
          }
        } catch (error) {
          console.error('ICE candidate error:', error)
        }
      },
    )

    socket.on('viewer-left', ({ viewerId }: { viewerId: string }) => {
      closePeer(viewerId)
      quality.manager.forgetViewer(viewerId)
      quality.manager.applyAll()
    })

    socket.on('viewer-count', (count: number) => setViewerCount(count))

    socket.on('chat-message', (message: LiveChatMessage) => {
      setChatMessages((prev) => [...prev.slice(-199), message])
    })

    socket.on('chat-message-deleted', ({ messageId }: { messageId: string }) => {
      setChatMessages((prev) => prev.filter((m) => m.id !== messageId))
    })

    socket.on('viewer-muted', ({ userId, muted }: { userId: string; muted: boolean }) => {
      setMutedUserIds((prev) => {
        const next = new Set(prev)
        if (muted) next.add(userId)
        else next.delete(userId)
        return next
      })
    })

    // A milestone of the donation goals was reached (also announced in the chat)
    socket.on('tip-goal-reached', (data: { goal?: TipGoal }) => {
      if (!data?.goal) return
      toast({ title: goalReachedText(data.goal), description: 'Marquez-le comme fait une fois réalisé.' })
    })

    // Paid tips are also announced in the chat (chat-message of type TIP)
    socket.on('tip', (tip: { amount: number; fromUser?: { username: string } }) => {
      toast({
        title: `Pourboire de ${formatEuros(tip.amount)}`,
        description: tip.fromUser ? `Envoyé par @${tip.fromUser.username}` : undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['creator-streams'] })
    })

    socket.on('broadcast-replaced', () => {
      toast({
        title: 'Diffusion reprise ailleurs',
        description: 'Ce live est maintenant diffusé depuis un autre onglet ou appareil.',
      })
      leaveBroadcast()
    })

    socket.on('stream-ended', () => {
      leaveBroadcast()
      queryClient.invalidateQueries({ queryKey: ['creator-streams'] })
    })
  }

  const goLive = (stream: CreatorStream) => {
    setActiveStream(stream)
    setViewerCount(stream.viewerCount ?? 0)
    setChatMessages([])
    setChatError(null)
    dispatchTips({ type: 'reset' })
    connectBroadcast(stream)
  }

  // ---- Mutations ------------------------------------------------------------

  const resetForm = () => {
    setTitle('')
    setDescription('')
    setScheduledFor('')
    setIsPpv(false)
    setPpvPrice('')
    setSubmitted(false)
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await liveApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        visibility,
        isPpv,
        // Price in euros
        ppvPrice: isPpv ? Math.round(Number(ppvPrice.replace(',', '.')) * 100) / 100 : undefined,
        scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
      })
      return response.data as CreatorStream
    },
    onSuccess: (stream) => {
      queryClient.invalidateQueries({ queryKey: ['creator-streams'] })
      resetForm()
      if (stream.status === 'SCHEDULED') {
        toast({
          title: 'Live programmé',
          description: stream.scheduledFor
            ? `Rendez-vous le ${format(new Date(stream.scheduledFor), "d MMMM yyyy 'à' HH:mm", { locale: fr })}.`
            : 'Votre live a été programmé.',
        })
      } else {
        goLive(stream)
      }
    },
    onError: (error) => {
      toast({
        title: 'Impossible de créer le live',
        description: liveErrorMessage(error, 'Une erreur est survenue. Réessayez.'),
        variant: 'destructive',
      })
    },
  })

  const startMutation = useMutation({
    mutationFn: async (stream: CreatorStream) => {
      const response = await liveApi.start(stream.id)
      return { ...stream, ...(response.data as Partial<CreatorStream>) } as CreatorStream
    },
    onSuccess: (stream) => {
      queryClient.invalidateQueries({ queryKey: ['creator-streams'] })
      goLive(stream)
    },
    onError: (error) => {
      toast({
        title: 'Impossible de démarrer le live',
        description: liveErrorMessage(error, 'Une erreur est survenue. Réessayez.'),
        variant: 'destructive',
      })
    },
  })

  const endMutation = useMutation({
    mutationFn: async (streamId: string) => {
      await liveApi.end(streamId)
      return streamId
    },
    onSuccess: (streamId) => {
      if (activeStream?.id === streamId) {
        leaveBroadcast()
      }
      queryClient.invalidateQueries({ queryKey: ['creator-streams'] })
      toast({ title: 'Live terminé', description: 'Vos spectateurs ont été prévenus.' })
    },
    onError: (error) => {
      toast({
        title: 'Impossible de terminer le live',
        description: liveErrorMessage(error, 'Une erreur est survenue. Réessayez.'),
        variant: 'destructive',
      })
      queryClient.invalidateQueries({ queryKey: ['creator-streams'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (streamId: string) => {
      await liveApi.delete(streamId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creator-streams'] })
      toast({ title: 'Live supprimé' })
    },
    onError: (error) => {
      toast({
        title: 'Suppression impossible',
        description: liveErrorMessage(error, 'Une erreur est survenue. Réessayez.'),
        variant: 'destructive',
      })
    },
  })

  // ---- Actions --------------------------------------------------------------

  const handleSubmit = async () => {
    setSubmitted(true)
    if (Object.keys(validate()).length > 0) return

    // Going live now: the camera must work before the live is created
    if (!scheduledFor) {
      const media = await startPreview()
      if (!media) return
    }
    createMutation.mutate()
  }

  const handleStart = async (stream: CreatorStream) => {
    const media = await startPreview()
    if (!media) return
    startMutation.mutate(stream)
  }

  const handleResume = async (stream: CreatorStream) => {
    const media = await startPreview()
    if (!media) return
    goLive(stream)
  }

  const handleEnd = async (stream: CreatorStream) => {
    const ok = await confirm({
      title: 'Terminer le live ?',
      description: `« ${stream.title} » sera arrêté pour tous les spectateurs. Un live terminé ne peut pas être relancé.`,
      confirmText: 'Terminer le live',
      variant: 'destructive',
    })
    if (ok) endMutation.mutate(stream.id)
  }

  const handleDelete = async (stream: CreatorStream) => {
    const ok = await confirm({
      title: 'Supprimer ce live ?',
      description:
        stream.status === 'SCHEDULED'
          ? `« ${stream.title} » sera annulé et retiré de votre programme. Les achats d'accès éventuels ne sont pas remboursés automatiquement.`
          : `« ${stream.title} », ses statistiques et son chat seront définitivement supprimés.`,
      confirmText: 'Supprimer',
      variant: 'destructive',
    })
    if (ok) deleteMutation.mutate(stream.id)
  }

  const showChatError = (message: string) => {
    setChatError(message)
    clearTimeout(chatErrorTimer.current)
    chatErrorTimer.current = setTimeout(() => setChatError(null), 4000)
  }

  const handleSendMessage = () => {
    const text = chatMessage.trim()
    const socket = socketRef.current
    if (!text || !socket || !activeStream || sendingChat) return

    setSendingChat(true)
    socket
      .timeout(LIVE_ACK_TIMEOUT)
      .emit('send-chat-message', { streamId: activeStream.id, message: text }, (err: Error | null, ack: LiveAck) => {
        setSendingChat(false)
        if (err || !ack?.success) {
          showChatError(
            err ? "Message non envoyé : le serveur ne répond pas." : CHAT_ERROR_MESSAGES[ack?.reason ?? ''] || 'Message non envoyé.',
          )
          return
        }
        setChatMessage('')
        setChatError(null)
      })
  }

  const handleDeleteMessage = (message: LiveChatMessage) => {
    const socket = socketRef.current
    if (!socket || !activeStream) return
    socket
      .timeout(LIVE_ACK_TIMEOUT)
      .emit(
        'delete-chat-message',
        { streamId: activeStream.id, messageId: message.id },
        (err: Error | null, ack: LiveAck) => {
          if (err || !ack?.success) {
            if (ack?.reason === 'NOT_FOUND') {
              setChatMessages((prev) => prev.filter((m) => m.id !== message.id))
              return
            }
            toast({ title: 'Suppression impossible', description: 'Réessayez.', variant: 'destructive' })
          }
        },
      )
  }

  const handleToggleMute = (message: LiveChatMessage) => {
    const socket = socketRef.current
    if (!socket || !activeStream) return
    const muted = !mutedUserIds.has(message.userId)
    socket
      .timeout(LIVE_ACK_TIMEOUT)
      .emit(
        'mute-viewer',
        { streamId: activeStream.id, userId: message.userId, muted },
        (err: Error | null, ack: LiveAck) => {
          if (err || !ack?.success) {
            toast({ title: 'Action impossible', description: 'Réessayez.', variant: 'destructive' })
            return
          }
          toast({
            title: muted ? `@${message.username} est muet` : `@${message.username} peut de nouveau écrire`,
            description: muted ? "Il ne pourra plus écrire dans le chat jusqu'à la fin du live." : undefined,
          })
        },
      )
  }

  // Stable identities so memoized chat lines do not re-render on every message
  const onDeleteMessage = useStableCallback(handleDeleteMessage)
  const onToggleMute = useStableCallback(handleToggleMute)
  const { onScroll: onChatScroll } = useChatAutoscroll(chatContainerRef, chatMessages)

  // ---- Effects --------------------------------------------------------------

  // Re-attach the preview when the video element is (re)mounted
  useEffect(() => {
    if (videoRef.current && localStreamRef.current && videoRef.current.srcObject !== localStreamRef.current) {
      videoRef.current.srcObject = localStreamRef.current
    }
  })

  // Leaving the page stops the camera and signaling (the stream stays LIVE and can be resumed)
  useEffect(() => {
    const peers = peersRef.current
    const errorTimer = chatErrorTimer
    return () => {
      peers.forEach((entry) => {
        clearTimeout(entry.failTimer)
        entry.pc.close()
      })
      peers.clear()
      closeLiveSocket(socketRef.current)
      localStreamRef.current?.getTracks().forEach((track) => track.stop())
      clearTimeout(errorTimer.current)
    }
  }, [])

  // Warn before closing the tab while broadcasting
  useEffect(() => {
    if (!activeStream) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [activeStream])

  if (!user) return null

  if (!isCreator) {
    return (
      <Card className="max-w-md mx-auto">
        <CardContent className="pt-6 text-center">
          <Radio className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Seuls les créateurs peuvent lancer un live.</p>
        </CardContent>
      </Card>
    )
  }

  const creating = createMutation.isPending || (startingPreview && !scheduledFor && !activeStream)
  const minSchedule = toLocalInputValue(new Date(Date.now() + 5 * 60_000))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <Radio className="h-7 w-7 text-red-500" />
            Live
          </h1>
          <p className="text-muted-foreground">Diffusez en direct pour vos abonnés</p>
        </div>
        {activeStream && (
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant={broadcasting ? 'destructive' : 'secondary'} className="flex items-center gap-1">
              {broadcasting ? <Radio className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
              {broadcasting ? 'EN DIRECT' : 'Connexion...'}
            </Badge>
            <div className="flex items-center gap-2 bg-muted px-3 py-1 rounded-full" title="Spectateurs connectés">
              <Users className="h-4 w-4" />
              <span className="font-semibold">{viewerCount.toLocaleString('fr-FR')}</span>
            </div>
            <Link
              href={`/live/${activeStream.id}`}
              target="_blank"
              className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
            >
              <ExternalLink className="h-4 w-4" /> Page spectateur
            </Link>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Preview */}
        <div className={`space-y-4 min-w-0 ${activeStream ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          <Card className="overflow-hidden">
            <div className="relative bg-black aspect-video">
              <video ref={videoRef} className="w-full h-full object-contain" autoPlay playsInline muted />
              {!previewOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 gap-3 p-4 text-center">
                  {startingPreview ? <Loader2 className="h-10 w-10 animate-spin" /> : <Video className="h-10 w-10" />}
                  <p>{startingPreview ? 'Activation de la caméra...' : 'Aperçu de la caméra désactivé'}</p>
                </div>
              )}
              {previewOn && !cameraOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 bg-black gap-2">
                  <VideoOff className="h-10 w-10" />
                  {activeStream && <p className="text-sm">Vos spectateurs voient un écran noir</p>}
                </div>
              )}
              {activeStream && previewOn && !micOn && (
                <div className="absolute top-3 left-3 flex items-center gap-1 rounded-full bg-black/70 px-3 py-1 text-xs text-white">
                  <MicOff className="h-3 w-3" /> Micro coupé
                </div>
              )}
            </div>
            <CardContent className="pt-4 flex flex-wrap items-center gap-2">
              {!previewOn ? (
                <Button variant="outline" onClick={() => void startPreview()} disabled={startingPreview}>
                  {startingPreview ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Video className="h-4 w-4 mr-2" />
                  )}
                  Activer la caméra
                </Button>
              ) : (
                <>
                  <Button
                    variant={cameraOn ? 'outline' : 'secondary'}
                    size="icon"
                    onClick={toggleCamera}
                    title={cameraOn ? 'Couper la caméra' : 'Activer la caméra'}
                    aria-pressed={!cameraOn}
                  >
                    {cameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant={micOn ? 'outline' : 'secondary'}
                    size="icon"
                    onClick={toggleMic}
                    title={micOn ? 'Couper le micro' : 'Activer le micro'}
                    aria-pressed={!micOn}
                  >
                    {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                  </Button>
                  {!activeStream && (
                    <Button variant="ghost" onClick={stopPreview}>
                      Couper l&apos;aperçu
                    </Button>
                  )}
                </>
              )}
              {activeStream && (
                <div className="flex flex-wrap gap-2 sm:ml-auto">
                  <Button variant="outline" onClick={leaveBroadcast} title="Le live reste en cours, vous pourrez le reprendre">
                    Quitter
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => void handleEnd(activeStream)}
                    disabled={endMutation.isPending}
                  >
                    {endMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Square className="h-4 w-4 mr-2" />
                    )}
                    {endMutation.isPending ? 'Arrêt...' : 'Terminer le live'}
                  </Button>
                </div>
              )}
            </CardContent>
            <div className="px-6 pb-4">
              <BroadcastQualitySettings
                presetId={quality.presetId}
                onPresetChange={(id) => void handlePresetChange(id)}
                cameras={mediaDevices.cameras}
                microphones={mediaDevices.microphones}
                cameraId={cameraId}
                microphoneId={microphoneId}
                onCameraChange={(id) => void handleDeviceChange('video', id)}
                onMicrophoneChange={(id) => void handleDeviceChange('audio', id)}
                busy={switchingMedia}
                live={!!activeStream}
              />
            </div>
            {mediaError && (
              <div className="mx-6 mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <p>{mediaError}</p>
                <Button
                  variant="link"
                  className="h-auto p-0 text-destructive underline"
                  onClick={() => void startPreview()}
                  disabled={startingPreview}
                >
                  Réessayer
                </Button>
              </div>
            )}
          </Card>

          {activeStream && (
            <Card>
              <CardContent className="pt-6 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold break-words">{activeStream.title}</p>
                  <Badge variant="outline">{VISIBILITY_LABELS[activeStream.visibility] ?? activeStream.visibility}</Badge>
                  {activeStream.isPpv && <Badge variant="secondary">PPV {formatEuros(activeStream.ppvPrice)}</Badge>}
                </div>
                {activeStream.description && (
                  <p className="text-sm text-muted-foreground break-words">{activeStream.description}</p>
                )}
                <div className="pt-2">
                  <BroadcastHealthPanel health={quality.health} reconnecting={socketReconnecting} />
                </div>
                <p className="text-xs text-muted-foreground pt-2">
                  « Quitter » coupe votre caméra mais laisse le live ouvert : vous pourrez le reprendre depuis cette
                  page. « Terminer le live » le clôture définitivement.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Tip menu requests, donation goals and menu while broadcasting */}
          {activeStream && (
            <>
              <TipActionsQueue
                streamId={activeStream.id}
                socketRef={socketRef}
                actions={tipState.actions}
                connected={broadcasting}
                onActionUpdated={(action) => dispatchTips({ type: 'action', action })}
              />
              <TipGoalsEditor
                streamId={activeStream.id}
                total={tipState.total}
                goals={tipState.goals}
                live
                onSaved={(snapshot) => {
                  dispatchTips({ type: 'goals', total: snapshot.total, goals: snapshot.goals })
                  queryClient.invalidateQueries({ queryKey: ['creator-streams'] })
                }}
                onGoalUpdated={(goal) => dispatchTips({ type: 'goal', goal })}
              />
              <TipMenuEditor defaultOpen={false} />
            </>
          )}

          {!activeStream && (
            <Card>
              <CardHeader>
                <CardTitle>Nouveau live</CardTitle>
                <CardDescription>Lancez un live maintenant ou programmez-le pour plus tard.</CardDescription>
              </CardHeader>
              <CardContent>
                {otherLiveStream && (
                  <p className="mb-4 rounded-md bg-muted p-3 text-sm">
                    Vous avez déjà un live en cours (« {otherLiveStream.title} »). Reprenez-le ou terminez-le avant
                    d&apos;en lancer un autre ; vous pouvez toujours en programmer un.
                  </p>
                )}
                <form
                  className="space-y-4"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault()
                    void handleSubmit()
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="live-title">Titre</Label>
                    <Input
                      id="live-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Mon live du soir"
                      maxLength={TITLE_MAX}
                      aria-invalid={!!formErrors.title}
                      className={formErrors.title ? 'border-destructive' : undefined}
                    />
                    {formErrors.title && <p className="text-sm text-destructive">{formErrors.title}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="live-description">Description (optionnel)</Label>
                    <Textarea
                      id="live-description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="De quoi allez-vous parler ?"
                      maxLength={DESCRIPTION_MAX}
                    />
                    <p className="text-xs text-muted-foreground text-right">
                      {description.length}/{DESCRIPTION_MAX}
                    </p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="live-visibility">Visibilité</Label>
                      <Select value={visibility} onValueChange={(v) => setVisibility(v as StreamVisibility)}>
                        <SelectTrigger id="live-visibility">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PUBLIC">Public (tous les membres)</SelectItem>
                          <SelectItem value="SUBSCRIBERS_ONLY">Abonnés</SelectItem>
                          <SelectItem value="PREMIUM_SUBSCRIBERS">Abonnés premium</SelectItem>
                          <SelectItem value="PRIVATE">Privé (vous seul)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="live-schedule">Programmer (optionnel)</Label>
                      <div className="flex gap-2">
                        <Input
                          id="live-schedule"
                          type="datetime-local"
                          value={scheduledFor}
                          min={minSchedule}
                          onChange={(e) => setScheduledFor(e.target.value)}
                          aria-invalid={!!formErrors.scheduledFor}
                          className={formErrors.scheduledFor ? 'border-destructive' : undefined}
                        />
                        {scheduledFor && (
                          <Button type="button" variant="ghost" onClick={() => setScheduledFor('')}>
                            Effacer
                          </Button>
                        )}
                      </div>
                      {formErrors.scheduledFor && (
                        <p className="text-sm text-destructive">{formErrors.scheduledFor}</p>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isPpv}
                        onChange={(e) => setIsPpv(e.target.checked)}
                        className="h-4 w-4"
                      />
                      Live payant (pay-per-view)
                    </label>
                    {isPpv && (
                      <div className="space-y-1">
                        <Label htmlFor="live-ppv-price">Prix d&apos;accès (€)</Label>
                        <Input
                          id="live-ppv-price"
                          type="number"
                          inputMode="decimal"
                          min={PPV_MIN}
                          max={PPV_MAX}
                          step="0.01"
                          value={ppvPrice}
                          onChange={(e) => setPpvPrice(e.target.value)}
                          placeholder="9.99"
                          className={`max-w-[200px] ${formErrors.ppvPrice ? 'border-destructive' : ''}`}
                          aria-invalid={!!formErrors.ppvPrice}
                        />
                        {formErrors.ppvPrice && <p className="text-sm text-destructive">{formErrors.ppvPrice}</p>}
                        <p className="text-xs text-muted-foreground">
                          Les spectateurs paient ce prix une fois pour regarder le live, en plus des conditions de
                          visibilité. Un compte de paiement Stripe configuré est requis.
                        </p>
                      </div>
                    )}
                  </div>
                  <Button
                    type="submit"
                    disabled={creating || (!scheduledFor && !!otherLiveStream)}
                    className="w-full sm:w-auto"
                  >
                    {creating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : scheduledFor ? (
                      <CalendarClock className="h-4 w-4 mr-2" />
                    ) : (
                      <Radio className="h-4 w-4 mr-2" />
                    )}
                    {scheduledFor ? 'Programmer le live' : 'Lancer le live'}
                  </Button>
                  {!scheduledFor && !otherLiveStream && (
                    <p className="text-xs text-muted-foreground">
                      Votre navigateur vous demandera l&apos;accès à la caméra et au micro.
                    </p>
                  )}
                </form>
              </CardContent>
            </Card>
          )}

          {/* The tip menu is reused from one live to the next */}
          {!activeStream && <TipMenuEditor defaultOpen={false} />}

          {!activeStream && streamsLoading && (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!activeStream && streamsError && (
            <Card>
              <CardContent className="pt-6 text-center space-y-3">
                <p className="text-sm text-muted-foreground">Impossible de charger vos lives.</p>
                <Button variant="outline" size="sm" onClick={() => void refetchStreams()}>
                  Réessayer
                </Button>
              </CardContent>
            </Card>
          )}

          {!activeStream && pendingStreams.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Lives à venir / en cours</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {pendingStreams.map((stream) => {
                  const ending = endMutation.isPending && endMutation.variables === stream.id
                  const deleting = deleteMutation.isPending && deleteMutation.variables === stream.id
                  const starting = startMutation.isPending && startMutation.variables?.id === stream.id
                  const late =
                    stream.status === 'SCHEDULED' &&
                    !!stream.scheduledFor &&
                    new Date(stream.scheduledFor).getTime() < Date.now()
                  const goals = stream.tipGoals ?? []
                  const goalsOpen = goalsStreamId === stream.id
                  return (
                    <div key={stream.id} className="border rounded-lg" data-testid="pending-stream">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3">
                        <div className="min-w-0 space-y-1">
                          <p className="font-medium break-words">{stream.title}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={stream.status === 'LIVE' ? 'destructive' : 'secondary'}>
                              {stream.status === 'LIVE' ? 'En direct' : 'Programmé'}
                            </Badge>
                            <Badge variant="outline">{VISIBILITY_LABELS[stream.visibility] ?? stream.visibility}</Badge>
                            {stream.isPpv && <Badge variant="secondary">PPV {formatEuros(stream.ppvPrice)}</Badge>}
                          </div>
                          {stream.scheduledFor && stream.status === 'SCHEDULED' && (
                            <p className={`text-sm ${late ? 'text-amber-600' : 'text-muted-foreground'}`}>
                              {format(new Date(stream.scheduledFor), "d MMMM yyyy 'à' HH:mm", { locale: fr })}
                              {late && ' (horaire dépassé)'}
                            </p>
                          )}
                          {stream.status === 'LIVE' && (
                            <p className="text-sm text-muted-foreground">
                              Aucune diffusion depuis cette page : reprenez le live pour réactiver votre caméra.
                            </p>
                          )}
                          <button
                            type="button"
                            className="flex max-w-full items-center gap-1 text-sm font-medium text-primary hover:underline"
                            onClick={() => setGoalsStreamId(goalsOpen ? null : stream.id)}
                            aria-expanded={goalsOpen}
                            data-testid="toggle-goals-editor"
                          >
                            <Target className="h-4 w-4 shrink-0" />
                            <span className="truncate">
                              {goals.length > 0
                                ? `Objectifs de dons : ${goals.length} palier${goals.length > 1 ? 's' : ''} (jusqu’à ${formatGoalEuros(goals[goals.length - 1].amount)})`
                                : 'Ajouter des objectifs de dons'}
                            </span>
                            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${goalsOpen ? 'rotate-180' : ''}`} />
                          </button>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          {stream.status === 'LIVE' ? (
                            <>
                              <Button size="sm" onClick={() => void handleResume(stream)} disabled={startingPreview}>
                                <Play className="h-4 w-4 mr-1" /> Reprendre
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void handleEnd(stream)}
                                disabled={ending}
                              >
                                {ending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                                Terminer
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                onClick={() => void handleStart(stream)}
                                disabled={starting || startingPreview || !!otherLiveStream}
                                title={otherLiveStream ? "Terminez d'abord le live en cours" : undefined}
                              >
                                {starting ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                  <Play className="h-4 w-4 mr-1" />
                                )}
                                Démarrer
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-9 w-9"
                                onClick={() => void handleDelete(stream)}
                                disabled={deleting}
                                title="Supprimer"
                                aria-label={`Supprimer ${stream.title}`}
                              >
                                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      {goalsOpen && (
                        <div className="border-t p-2 sm:p-3">
                          <TipGoalsEditor
                            streamId={stream.id}
                            total={stream.tipTotal ?? 0}
                            goals={goals}
                            className="border-0 shadow-none"
                            onSaved={() => queryClient.invalidateQueries({ queryKey: ['creator-streams'] })}
                            onGoalUpdated={() => queryClient.invalidateQueries({ queryKey: ['creator-streams'] })}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )}

          {!activeStream && pastStreams.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Lives passés</CardTitle>
                <CardDescription>Vos 10 derniers lives et leurs statistiques.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {pastStreams.map((stream) => {
                  const deleting = deleteMutation.isPending && deleteMutation.variables === stream.id
                  const duration = formatStreamDuration(stream.duration)
                  const revenue = (stream.stats?.tipsTotal ?? 0) + (stream.stats?.ppvTotal ?? 0)
                  const date = stream.endedAt || stream.scheduledFor || stream.createdAt
                  return (
                    <div key={stream.id} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium break-words">{stream.title}</p>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {stream.status === 'CANCELLED' && <Badge variant="outline">Annulé</Badge>}
                            <span>{format(new Date(date), 'd MMM yyyy', { locale: fr })}</span>
                            <span className="flex items-center gap-1">
                              {stream.visibility === 'PRIVATE' && <Lock className="h-3 w-3" />}
                              {VISIBILITY_LABELS[stream.visibility] ?? stream.visibility}
                            </span>
                          </div>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0"
                          onClick={() => void handleDelete(stream)}
                          disabled={deleting}
                          title="Supprimer"
                          aria-label={`Supprimer ${stream.title}`}
                        >
                          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </div>
                      {stream.status === 'ENDED' && (
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
                          <span className="flex items-center gap-1" title="Spectateurs uniques">
                            <Eye className="h-4 w-4 text-muted-foreground" />
                            {stream.totalViews.toLocaleString('fr-FR')} vues
                          </span>
                          <span className="flex items-center gap-1" title="Pic de spectateurs simultanés">
                            <TrendingUp className="h-4 w-4 text-muted-foreground" />
                            Pic {stream.peakViewers.toLocaleString('fr-FR')}
                          </span>
                          <span className="flex items-center gap-1" title="Messages du chat">
                            <MessageSquare className="h-4 w-4 text-muted-foreground" />
                            {(stream._count?.messages ?? 0).toLocaleString('fr-FR')} messages
                          </span>
                          <span className="flex items-center gap-1" title="Durée">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            {duration ?? '—'}
                          </span>
                          <span
                            className="flex items-center gap-1"
                            title={`Pourboires : ${formatEuros(stream.stats?.tipsTotal ?? 0)} (${stream.stats?.tipsCount ?? 0}) · Accès PPV : ${formatEuros(stream.stats?.ppvTotal ?? 0)} (${stream.stats?.ppvCount ?? 0})`}
                          >
                            <Gift className="h-4 w-4 text-muted-foreground" />
                            {formatEuros(revenue)}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )}

          {!activeStream && !streamsLoading && !streamsError && streams.length === 0 && (
            <p className="text-sm text-muted-foreground text-center">
              Vous n&apos;avez encore fait aucun live. Lancez-vous !
            </p>
          )}
        </div>

        {/* Chat (only while broadcasting) */}
        {activeStream && (
          <Card className="flex flex-col h-[500px] lg:h-[600px] min-w-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <MessageSquare className="h-5 w-5" /> Chat en direct
              </CardTitle>
              {mutedUserIds.size > 0 && (
                <CardDescription>
                  {mutedUserIds.size} spectateur{mutedUserIds.size > 1 ? 's' : ''} rendu
                  {mutedUserIds.size > 1 ? 's' : ''} muet{mutedUserIds.size > 1 ? 's' : ''}
                </CardDescription>
              )}
            </CardHeader>
            <div ref={chatContainerRef} onScroll={onChatScroll} className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatMessages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center">Aucun message pour le moment.</p>
              )}
              {chatMessages.map((msg) => (
                <LiveChatMessageItem
                  key={msg.id}
                  message={msg}
                  creatorLabel="Vous"
                  muted={mutedUserIds.has(msg.userId)}
                  onDelete={broadcasting ? onDeleteMessage : undefined}
                  onToggleMute={broadcasting ? onToggleMute : undefined}
                />
              ))}
            </div>
            <div className="p-4 border-t space-y-2">
              {chatError && <p className="text-xs text-destructive">{chatError}</p>}
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  handleSendMessage()
                }}
              >
                <Input
                  placeholder={broadcasting ? 'Répondre au chat...' : 'Connexion au chat...'}
                  value={chatMessage}
                  maxLength={500}
                  disabled={!broadcasting}
                  onChange={(e) => setChatMessage(e.target.value)}
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!broadcasting || !chatMessage.trim() || sendingChat}
                  aria-label="Envoyer"
                >
                  {sendingChat ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </form>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
