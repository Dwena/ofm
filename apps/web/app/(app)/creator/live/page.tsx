'use client'

import { useEffect, useRef, useState } from 'react'
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
  Gift,
} from 'lucide-react'
import { liveApi } from '@/lib/api'
import {
  createLiveSocket,
  getIceServers,
  VISIBILITY_LABELS,
  type LiveAck,
  type LiveChatMessage,
  type StreamVisibility,
} from '@/lib/live'
import { useAuth } from '@/contexts/auth-context'
import { formatEuros } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

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
  viewerCount: number
  peakViewers: number
  totalViews: number
  createdAt: string
}

interface ViewerPeer {
  pc: RTCPeerConnection
  sessionId: string
  pendingCandidates: RTCIceCandidateInit[]
}

const newSessionId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

const START_ERRORS: Record<string, string> = {
  NOT_CREATOR: 'Seul le créateur peut diffuser ce live.',
  NOT_LIVE: "Ce live n'est pas en cours.",
  NOT_FOUND: 'Live introuvable.',
}

export default function CreatorLivePage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<StreamVisibility>('SUBSCRIBERS_ONLY')
  const [scheduledFor, setScheduledFor] = useState('')
  const [isPpv, setIsPpv] = useState(false)
  const [ppvPrice, setPpvPrice] = useState('')

  const [previewOn, setPreviewOn] = useState(false)
  const [cameraOn, setCameraOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [mediaError, setMediaError] = useState<string | null>(null)

  const [activeStream, setActiveStream] = useState<CreatorStream | null>(null)
  const [broadcasting, setBroadcasting] = useState(false)
  const [viewerCount, setViewerCount] = useState(0)
  const [chatMessages, setChatMessages] = useState<LiveChatMessage[]>([])
  const [chatMessage, setChatMessage] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const peersRef = useRef(new Map<string, ViewerPeer>())

  const isCreator = user?.role === 'CREATOR'
  const ppvPriceValid = !isPpv || parseFloat(ppvPrice) >= 1

  const { data: streams = [] } = useQuery({
    queryKey: ['creator-streams', user?.id],
    queryFn: async () => {
      const response = await liveApi.getCreatorStreams(user!.id)
      return (Array.isArray(response.data) ? response.data : []) as CreatorStream[]
    },
    enabled: !!user?.id && isCreator,
  })

  const pendingStreams = streams.filter((s) => s.status === 'SCHEDULED' || s.status === 'LIVE')
  const pastStreams = streams.filter((s) => s.status === 'ENDED').slice(0, 10)

  // ---- Media ---------------------------------------------------------------

  const startPreview = async () => {
    if (localStreamRef.current) return localStreamRef.current
    try {
      setMediaError(null)
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      })
      localStreamRef.current = media
      if (videoRef.current) {
        videoRef.current.srcObject = media
      }
      setPreviewOn(true)
      setCameraOn(true)
      setMicOn(true)
      return media
    } catch (error) {
      console.error('getUserMedia error:', error)
      setMediaError("Impossible d'accéder à la caméra ou au micro. Vérifiez les autorisations du navigateur.")
      return null
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

  // ---- WebRTC (one peer connection per viewer, we are the offerer) ----------

  const closePeer = (viewerId: string) => {
    const entry = peersRef.current.get(viewerId)
    if (entry) {
      entry.pc.onicecandidate = null
      entry.pc.close()
      peersRef.current.delete(viewerId)
    }
  }

  const closeAllPeers = () => {
    peersRef.current.forEach((_entry, viewerId) => closePeer(viewerId))
  }

  const sendOfferTo = async (streamId: string, viewerId: string) => {
    const socket = socketRef.current
    const media = localStreamRef.current
    if (!socket || !media) return

    closePeer(viewerId)
    const sessionId = newSessionId()
    const pc = new RTCPeerConnection({ iceServers: getIceServers() })
    const entry: ViewerPeer = { pc, sessionId, pendingCandidates: [] }
    peersRef.current.set(viewerId, entry)

    media.getTracks().forEach((track) => pc.addTrack(track, media))

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

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && peersRef.current.get(viewerId)?.pc === pc) {
        closePeer(viewerId)
      }
    }

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      socket.emit('offer', { streamId, viewerId, offer: pc.localDescription, sessionId })
    } catch (error) {
      console.error('WebRTC offer error:', error)
      closePeer(viewerId)
    }
  }

  // ---- Socket ---------------------------------------------------------------

  const disconnectSocket = () => {
    closeAllPeers()
    socketRef.current?.disconnect()
    socketRef.current = null
    setBroadcasting(false)
  }

  const connectBroadcast = (stream: CreatorStream) => {
    disconnectSocket()
    const socket = createLiveSocket()
    socketRef.current = socket
    const streamId = stream.id

    socket.on('connect', () => {
      socket.emit('start-broadcast', { streamId }, (ack: LiveAck) => {
        if (!ack?.success) {
          toast({
            title: 'Diffusion impossible',
            description: START_ERRORS[ack?.reason ?? ''] || ack?.error || 'Erreur inconnue',
            variant: 'destructive',
          })
          disconnectSocket()
          return
        }
        setBroadcasting(true)
        setViewerCount(ack.viewerCount ?? 0)
        setChatMessages(ack.messages ?? [])
      })
    })

    socket.on('disconnect', () => {
      // Viewers' connections are renegotiated after reconnecting
      closeAllPeers()
      setBroadcasting(false)
    })

    socket.on('viewer-joined', ({ viewerId }: { viewerId: string }) => {
      void sendOfferTo(streamId, viewerId)
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
            await entry.pc.addIceCandidate(candidate)
          }
        } catch (error) {
          console.error('WebRTC answer error:', error)
        }
      },
    )

    socket.on(
      'ice-candidate',
      async (data: { viewerId: string; candidate: RTCIceCandidateInit; sessionId?: string }) => {
        const entry = peersRef.current.get(data.viewerId)
        if (!entry || entry.sessionId !== data.sessionId || !data.candidate) return
        try {
          if (entry.pc.remoteDescription) {
            await entry.pc.addIceCandidate(data.candidate)
          } else {
            entry.pendingCandidates.push(data.candidate)
          }
        } catch (error) {
          console.error('ICE candidate error:', error)
        }
      },
    )

    socket.on('viewer-left', ({ viewerId }: { viewerId: string }) => closePeer(viewerId))

    socket.on('viewer-count', (count: number) => setViewerCount(count))

    socket.on('chat-message', (message: LiveChatMessage) => {
      setChatMessages((prev) => [...prev.slice(-199), message])
    })

    // Paid tips are also announced in the chat (chat-message of type TIP)
    socket.on('tip', (tip: { amount: number; fromUser?: { username: string } }) => {
      toast({
        title: `Pourboire de ${formatEuros(tip.amount)}`,
        description: tip.fromUser ? `Envoyé par @${tip.fromUser.username}` : undefined,
      })
    })

    socket.on('broadcast-replaced', () => {
      toast({
        title: 'Diffusion reprise ailleurs',
        description: 'Ce live est maintenant diffusé depuis un autre onglet ou appareil.',
      })
      disconnectSocket()
    })

    socket.on('stream-ended', () => {
      disconnectSocket()
      setActiveStream(null)
      queryClient.invalidateQueries({ queryKey: ['creator-streams'] })
    })
  }

  const goLive = async (stream: CreatorStream) => {
    const media = await startPreview()
    if (!media) return
    setActiveStream(stream)
    setViewerCount(stream.viewerCount ?? 0)
    connectBroadcast(stream)
  }

  // ---- Mutations ------------------------------------------------------------

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await liveApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        visibility,
        // Price in euros
        isPpv,
        ppvPrice: isPpv ? Math.round(parseFloat(ppvPrice) * 100) / 100 : undefined,
        scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
      })
      return response.data as CreatorStream
    },
    onSuccess: async (stream) => {
      queryClient.invalidateQueries({ queryKey: ['creator-streams'] })
      setTitle('')
      setDescription('')
      setScheduledFor('')
      setIsPpv(false)
      setPpvPrice('')
      if (stream.status === 'SCHEDULED') {
        toast({ title: 'Live programmé', description: 'Votre live a été programmé.' })
      } else {
        await goLive(stream)
      }
    },
    onError: (error: any) => {
      toast({
        title: 'Erreur',
        description: error?.response?.data?.message || 'Impossible de créer le live.',
        variant: 'destructive',
      })
    },
  })

  const startMutation = useMutation({
    mutationFn: async (stream: CreatorStream) => {
      const response = await liveApi.start(stream.id)
      return { ...stream, ...(response.data as Partial<CreatorStream>) } as CreatorStream
    },
    onSuccess: async (stream) => {
      queryClient.invalidateQueries({ queryKey: ['creator-streams'] })
      await goLive(stream)
    },
    onError: (error: any) => {
      toast({
        title: 'Erreur',
        description: error?.response?.data?.message || 'Impossible de démarrer le live.',
        variant: 'destructive',
      })
    },
  })

  const endMutation = useMutation({
    mutationFn: async (streamId: string) => {
      await liveApi.end(streamId)
    },
    onSuccess: () => {
      disconnectSocket()
      stopPreview()
      setActiveStream(null)
      setChatMessages([])
      setViewerCount(0)
      queryClient.invalidateQueries({ queryKey: ['creator-streams'] })
      toast({ title: 'Live terminé', description: 'Votre live est terminé.' })
    },
    onError: (error: any) => {
      toast({
        title: 'Erreur',
        description: error?.response?.data?.message || 'Impossible de terminer le live.',
        variant: 'destructive',
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (streamId: string) => {
      await liveApi.delete(streamId)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['creator-streams'] }),
  })

  // ---- Effects --------------------------------------------------------------

  // Re-attach the preview when the video element is (re)mounted
  useEffect(() => {
    if (videoRef.current && localStreamRef.current && videoRef.current.srcObject !== localStreamRef.current) {
      videoRef.current.srcObject = localStreamRef.current
    }
  })

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
    }
  }, [chatMessages])

  // Leaving the page stops the camera and signaling (the stream stays LIVE and can be resumed)
  useEffect(() => {
    const peers = peersRef.current
    return () => {
      peers.forEach((entry) => entry.pc.close())
      peers.clear()
      socketRef.current?.disconnect()
      localStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const handleSendMessage = () => {
    const text = chatMessage.trim()
    if (!text || !socketRef.current || !activeStream) return
    socketRef.current.emit('send-chat-message', { streamId: activeStream.id, message: text })
    setChatMessage('')
  }

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Radio className="h-7 w-7 text-red-500" />
            Live
          </h1>
          <p className="text-muted-foreground">Diffusez en direct pour vos abonnés</p>
        </div>
        {activeStream && (
          <div className="flex items-center gap-3">
            <Badge variant={broadcasting ? 'destructive' : 'secondary'} className="flex items-center gap-1">
              <Radio className="h-3 w-3" />
              {broadcasting ? 'EN DIRECT' : 'Connexion...'}
            </Badge>
            <div className="flex items-center gap-2 bg-muted px-3 py-1 rounded-full">
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
        <div className="lg:col-span-2 space-y-4">
          <Card className="overflow-hidden">
            <div className="relative bg-black aspect-video">
              <video
                ref={videoRef}
                className="w-full h-full object-contain"
                autoPlay
                playsInline
                muted
              />
              {!previewOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 gap-3">
                  <Video className="h-10 w-10" />
                  <p>Aperçu de la caméra désactivé</p>
                </div>
              )}
              {previewOn && !cameraOn && (
                <div className="absolute inset-0 flex items-center justify-center text-white/80 bg-black">
                  <VideoOff className="h-10 w-10" />
                </div>
              )}
            </div>
            <CardContent className="pt-4 flex flex-wrap items-center gap-2">
              {!previewOn ? (
                <Button variant="outline" onClick={() => void startPreview()}>
                  <Video className="h-4 w-4 mr-2" /> Activer la caméra
                </Button>
              ) : (
                <>
                  <Button variant="outline" size="icon" onClick={toggleCamera} title="Caméra">
                    {cameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                  </Button>
                  <Button variant="outline" size="icon" onClick={toggleMic} title="Micro">
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
                <Button
                  variant="destructive"
                  className="ml-auto"
                  onClick={() => endMutation.mutate(activeStream.id)}
                  disabled={endMutation.isPending}
                >
                  <Square className="h-4 w-4 mr-2" />
                  {endMutation.isPending ? 'Arrêt...' : 'Terminer le live'}
                </Button>
              )}
            </CardContent>
            {mediaError && <p className="px-6 pb-4 text-sm text-destructive">{mediaError}</p>}
          </Card>

          {!activeStream && (
            <Card>
              <CardHeader>
                <CardTitle>Nouveau live</CardTitle>
                <CardDescription>
                  Lancez un live maintenant ou programmez-le pour plus tard.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!title.trim() || !ppvPriceValid) return
                    createMutation.mutate()
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="live-title">Titre</Label>
                    <Input
                      id="live-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Mon live du soir"
                      maxLength={120}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="live-description">Description</Label>
                    <Textarea
                      id="live-description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="De quoi allez-vous parler ?"
                      maxLength={1000}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Visibilité</Label>
                      <Select value={visibility} onValueChange={(v) => setVisibility(v as StreamVisibility)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PUBLIC">Public</SelectItem>
                          <SelectItem value="SUBSCRIBERS_ONLY">Abonnés</SelectItem>
                          <SelectItem value="PREMIUM_SUBSCRIBERS">Abonnés premium</SelectItem>
                          <SelectItem value="PRIVATE">Privé</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="live-schedule">Programmer (optionnel)</Label>
                      <Input
                        id="live-schedule"
                        type="datetime-local"
                        value={scheduledFor}
                        onChange={(e) => setScheduledFor(e.target.value)}
                      />
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
                          min="1"
                          step="0.01"
                          value={ppvPrice}
                          onChange={(e) => setPpvPrice(e.target.value)}
                          placeholder="9.99"
                          required
                        />
                        <p className="text-xs text-muted-foreground">
                          Les spectateurs paient ce prix une fois pour regarder le live, en plus des
                          conditions de visibilité. Un compte Stripe configuré est requis.
                        </p>
                      </div>
                    )}
                  </div>
                  <Button
                    type="submit"
                    disabled={!title.trim() || !ppvPriceValid || createMutation.isPending}
                  >
                    {scheduledFor ? (
                      <>
                        <CalendarClock className="h-4 w-4 mr-2" /> Programmer le live
                      </>
                    ) : (
                      <>
                        <Radio className="h-4 w-4 mr-2" /> Lancer le live
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          {!activeStream && pendingStreams.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Lives à venir / en cours</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {pendingStreams.map((stream) => (
                  <div key={stream.id} className="flex items-center justify-between gap-4 border rounded-lg p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{stream.title}</p>
                        <Badge variant={stream.status === 'LIVE' ? 'destructive' : 'secondary'}>
                          {stream.status === 'LIVE' ? 'En direct' : 'Programmé'}
                        </Badge>
                        <Badge variant="outline">{VISIBILITY_LABELS[stream.visibility] ?? stream.visibility}</Badge>
                        {stream.isPpv && (
                          <Badge variant="secondary">PPV {formatEuros(stream.ppvPrice)}</Badge>
                        )}
                      </div>
                      {stream.scheduledFor && stream.status === 'SCHEDULED' && (
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(stream.scheduledFor), "d MMMM yyyy 'à' HH:mm", { locale: fr })}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {stream.status === 'LIVE' ? (
                        <>
                          <Button size="sm" onClick={() => void goLive(stream)}>
                            <Play className="h-4 w-4 mr-1" /> Reprendre
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => endMutation.mutate(stream.id)}
                            disabled={endMutation.isPending}
                          >
                            Terminer
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            onClick={() => startMutation.mutate(stream)}
                            disabled={startMutation.isPending}
                          >
                            <Play className="h-4 w-4 mr-1" /> Démarrer
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteMutation.mutate(stream.id)}
                            disabled={deleteMutation.isPending}
                            title="Supprimer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {!activeStream && pastStreams.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Lives passés</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {pastStreams.map((stream) => (
                  <div key={stream.id} className="flex items-center justify-between text-sm border-b last:border-0 py-2">
                    <span className="truncate">{stream.title}</span>
                    <span className="text-muted-foreground shrink-0 ml-4">
                      {stream.totalViews} vues · pic {stream.peakViewers}
                      {stream.endedAt &&
                        ` · ${format(new Date(stream.endedAt), 'd MMM yyyy', { locale: fr })}`}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Chat */}
        <Card className="flex flex-col h-[600px]">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5" /> Chat en direct
            </CardTitle>
          </CardHeader>
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {!activeStream && (
              <p className="text-sm text-muted-foreground text-center">
                Le chat apparaîtra ici pendant votre live.
              </p>
            )}
            {activeStream && chatMessages.length === 0 && (
              <p className="text-sm text-muted-foreground text-center">Aucun message pour le moment.</p>
            )}
            {chatMessages.map((msg) => (
              <div key={msg.id} className="flex gap-2">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={msg.avatar || undefined} />
                  <AvatarFallback>{msg.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">@{msg.username}</span>
                    {msg.isCreator && (
                      <Badge variant="destructive" className="text-xs">Vous</Badge>
                    )}
                    {msg.type === 'TIP' && (
                      <Badge variant="secondary" className="text-xs">
                        <Gift className="h-3 w-3 mr-1" />
                        {formatEuros(msg.tipAmount)}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm break-words">{msg.message}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 border-t flex gap-2">
            <Input
              placeholder="Répondre au chat..."
              value={chatMessage}
              maxLength={500}
              disabled={!broadcasting}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            />
            <Button size="icon" onClick={handleSendMessage} disabled={!broadcasting}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
