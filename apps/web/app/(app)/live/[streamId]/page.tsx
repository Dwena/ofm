'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { liveApi } from '@/lib/api';
import {
  createLiveSocket,
  closeLiveSocket,
  getIceServers,
  ACCESS_DENIED_MESSAGES,
  CHAT_ERROR_MESSAGES,
  LIVE_ACK_TIMEOUT,
  type LiveAck,
  type LiveChatMessage,
} from '@/lib/live';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Radio,
  Users,
  Send,
  Euro,
  Maximize,
  Minimize,
  Volume2,
  VolumeX,
  X,
  Lock,
  Loader2,
  MessageSquare,
  MicOff,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Socket } from 'socket.io-client';
import OneTimeCheckout from '@/components/checkout/one-time-checkout';
import { LiveChatMessageItem } from '@/components/live/live-chat-message';
import { formatEuros } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface LiveStream {
  id: string;
  title: string;
  description?: string | null;
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
  startedAt?: string | null;
  scheduledFor?: string | null;
  viewerCount: number;
  hasAccess?: boolean;
  accessDeniedReason?: string | null;
  isPpv?: boolean;
  ppvPrice?: number | null; // euros
  // Creator's tip settings (euros)
  tips?: { allowed: boolean; minimum: number };
  creator: {
    id: string;
    username: string;
    displayName?: string | null;
    avatar?: string | null;
  };
}

type ConnectionState = 'connecting' | 'waiting' | 'playing' | 'error' | 'offline';

const REACTION_EMOJIS = ['❤️', '🔥', '👏', '😍', '🎉', '💎'];
const TIP_PRESETS = [5, 10, 20, 50, 100, 200];
const TIP_MAX = 10000;
const TIP_MESSAGE_MAX = 200;

export default function LiveStreamPage({ params }: { params: { streamId: string } }) {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const streamId = params.streamId;

  const [isFullscreen, setIsFullscreen] = useState(false);
  // Browsers block autoplay with sound, so playback starts muted
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(80);
  const [chatMessage, setChatMessage] = useState('');
  const [chatMessages, setChatMessages] = useState<LiveChatMessage[]>([]);
  const [reactions, setReactions] = useState<{ id: string; emoji: string; x: number; y: number }[]>([]);
  const [showTipModal, setShowTipModal] = useState(false);
  const [tipAmount, setTipAmount] = useState('5');
  const [tipMessage, setTipMessage] = useState('');
  const [tipError, setTipError] = useState<string | null>(null);
  // Amount chosen: show the payment step of the tip modal
  const [tipCheckout, setTipCheckout] = useState(false);
  const [showPurchase, setShowPurchase] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [joined, setJoined] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [sendingChat, setSendingChat] = useState(false);
  const [mutedInChat, setMutedInChat] = useState(false);
  // Bumped to rebuild the socket connection (retry button)
  const [connectAttempt, setConnectAttempt] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket>();
  const requestOfferRef = useRef<() => void>();
  const chatErrorTimer = useRef<ReturnType<typeof setTimeout>>();

  // Fetch live stream info
  const {
    data: stream,
    isLoading,
    isError,
    error: streamError,
    refetch,
  } = useQuery({
    queryKey: ['live-stream', streamId],
    queryFn: async () => {
      const response = await liveApi.getStream(streamId);
      return response.data as LiveStream;
    },
    // Poll while waiting for a scheduled live to start or for a purchase
    refetchInterval: (query) => {
      const data = query.state.data as LiveStream | undefined;
      return data && (data.status === 'ENDED' || data.status === 'CANCELLED') ? false : 10000;
    },
    retry: (count, error: any) => error?.response?.status !== 404 && error?.response?.status !== 403 && count < 2,
  });

  const tipMinimum = Math.max(1, stream?.tips?.minimum ?? 1);
  const tipValue = Number(tipAmount.replace(',', '.'));

  const closeTipModal = () => {
    setShowTipModal(false);
    setTipCheckout(false);
    setTipAmount(String(Math.max(5, tipMinimum)));
    setTipMessage('');
    setTipError(null);
  };

  const isLive = stream?.status === 'LIVE';
  const canWatch = isLive && stream?.hasAccess !== false;
  const userId = user?.id;

  // WebSocket + WebRTC (the creator is the offerer, this page answers)
  useEffect(() => {
    if (!canWatch || !userId) return;

    setConnectionState('connecting');
    const socket = createLiveSocket({
      onAuthError: () => {
        setJoined(false);
        setConnectionState('offline');
      },
    });
    socketRef.current = socket;
    let peer: RTCPeerConnection | null = null;
    // Negotiation id chosen by the broadcaster for the current offer
    let sessionId: string | undefined;
    let pendingCandidates: RTCIceCandidateInit[] = [];

    const closePeer = () => {
      if (peer) {
        peer.ontrack = null;
        peer.onicecandidate = null;
        peer.onconnectionstatechange = null;
        peer.close();
        peer = null;
      }
      sessionId = undefined;
      pendingCandidates = [];
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };

    const createPeer = (offerSessionId?: string) => {
      closePeer();
      const pc = new RTCPeerConnection({ iceServers: getIceServers() });
      sessionId = offerSessionId;

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          videoRef.current.play().catch(() => undefined);
          setConnectionState('playing');
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('ice-candidate', {
            streamId,
            candidate: event.candidate.toJSON(),
            sessionId: offerSessionId,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          setConnectionState('error');
        }
      };

      peer = pc;
      return pc;
    };

    const requestOffer = () => {
      setConnectionState('connecting');
      socket.timeout(LIVE_ACK_TIMEOUT).emit('request-offer', { streamId }, (err: Error | null, ack: LiveAck) => {
        if (err) {
          setConnectionState('error');
          return;
        }
        if (ack?.reason === 'BROADCASTER_OFFLINE') {
          closePeer();
          setConnectionState('waiting');
        } else if (ack?.error) {
          setConnectionState('error');
        }
      });
    };
    requestOfferRef.current = requestOffer;

    // (Re)join on every connection, including automatic reconnections
    socket.on('connect', () => {
      socket.timeout(LIVE_ACK_TIMEOUT).emit('join-live-stream', { streamId }, (err: Error | null, ack: LiveAck) => {
        if (err) {
          setConnectionState('offline');
          return;
        }
        if (!ack?.success) {
          if (ack?.reason === 'NOT_LIVE') {
            // The live ended or has not started: reload its status
            queryClient.invalidateQueries({ queryKey: ['live-stream', streamId] });
            return;
          }
          setJoinError(ack?.reason || 'UNKNOWN');
          return;
        }
        setJoinError(null);
        setJoined(true);
        setMutedInChat(!!ack.muted);
        setChatMessages(ack.messages ?? []);
        if (typeof ack.viewerCount === 'number') {
          queryClient.setQueryData(['live-stream', streamId], (old: LiveStream | undefined) =>
            old ? { ...old, viewerCount: ack.viewerCount as number } : old,
          );
        }
        if (ack.broadcasterOnline) {
          requestOffer();
        } else {
          setConnectionState('waiting');
        }
      });
    });

    socket.on('disconnect', () => {
      setJoined(false);
      closePeer();
      setConnectionState('offline');
    });

    // Every offer starts a fresh peer connection
    socket.on(
      'offer',
      async (data: { streamId: string; offer: RTCSessionDescriptionInit; sessionId?: string }) => {
        try {
          const pc = createPeer(data.sessionId);
          await pc.setRemoteDescription(data.offer);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (peer !== pc) return; // superseded by a newer offer
          socket.emit('answer', { streamId, answer: pc.localDescription, sessionId: data.sessionId });

          const queued = pendingCandidates;
          pendingCandidates = [];
          for (const candidate of queued) {
            await pc.addIceCandidate(candidate);
          }
        } catch (error) {
          console.error('WebRTC offer error:', error);
          setConnectionState('error');
        }
      },
    );

    socket.on(
      'ice-candidate',
      async (data: { streamId: string; candidate: RTCIceCandidateInit; sessionId?: string }) => {
        const candidate = data.candidate;
        if (!peer || !candidate || data.sessionId !== sessionId) return;
        try {
          if (peer.remoteDescription && peer.signalingState === 'stable') {
            await peer.addIceCandidate(candidate);
          } else {
            pendingCandidates.push(candidate);
          }
        } catch (error) {
          console.error('ICE candidate error:', error);
        }
      },
    );

    socket.on('broadcaster-ready', () => requestOffer());

    socket.on('broadcaster-disconnected', () => {
      closePeer();
      setConnectionState('waiting');
    });

    socket.on('stream-ended', () => {
      closePeer();
      queryClient.setQueryData(['live-stream', streamId], (old: LiveStream | undefined) =>
        old ? { ...old, status: 'ENDED' } : old,
      );
    });

    socket.on('chat-message', (message: LiveChatMessage) => {
      setChatMessages((prev) => [...prev.slice(-199), message]);
    });

    socket.on('chat-message-deleted', ({ messageId }: { messageId: string }) => {
      setChatMessages((prev) => prev.filter((m) => m.id !== messageId));
    });

    socket.on('viewer-muted', (data: { userId: string; muted: boolean }) => {
      if (data.userId !== userId) return;
      setMutedInChat(data.muted);
      toast({
        title: data.muted ? 'Vous avez été rendu muet' : 'Vous pouvez de nouveau écrire',
        description: data.muted ? "Le créateur a désactivé votre chat jusqu'à la fin du live." : undefined,
        variant: data.muted ? 'destructive' : 'default',
      });
    });

    socket.on('reaction', (reaction: { emoji: string; x: number; y: number }) => {
      const id = Math.random().toString();
      setReactions((prev) => [...prev.slice(-30), { id, emoji: reaction.emoji, x: reaction.x, y: reaction.y }]);
      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== id));
      }, 3000);
    });

    socket.on('viewer-count', (count: number) => {
      queryClient.setQueryData(['live-stream', streamId], (old: LiveStream | undefined) =>
        old ? { ...old, viewerCount: count } : old,
      );
    });

    return () => {
      // Leave the room before closing (the server also cleans up on disconnect)
      if (socket.connected) socket.emit('leave-live-stream', { streamId });
      closeLiveSocket(socket);
      socketRef.current = undefined;
      requestOfferRef.current = undefined;
      closePeer();
      setJoined(false);
    };
  }, [canWatch, userId, streamId, queryClient, toast, connectAttempt]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Keep the fullscreen button in sync when the user presses Escape
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const timer = chatErrorTimer;
    return () => clearTimeout(timer.current);
  }, []);

  // Apply the volume to the player
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume / 100;
      videoRef.current.muted = isMuted;
    }
  }, [volume, isMuted, connectionState]);

  const showChatError = (message: string) => {
    setChatError(message);
    clearTimeout(chatErrorTimer.current);
    chatErrorTimer.current = setTimeout(() => setChatError(null), 4000);
  };

  const handleSendMessage = () => {
    const text = chatMessage.trim();
    const socket = socketRef.current;
    if (!text || !socket || !joined || sendingChat) return;
    if (mutedInChat) {
      showChatError(CHAT_ERROR_MESSAGES.MUTED);
      return;
    }

    setSendingChat(true);
    socket
      .timeout(LIVE_ACK_TIMEOUT)
      .emit('send-chat-message', { streamId, message: text }, (err: Error | null, ack: LiveAck) => {
        setSendingChat(false);
        if (err || !ack?.success) {
          if (ack?.reason === 'MUTED') setMutedInChat(true);
          // The text is kept so it can be sent again
          showChatError(
            err
              ? 'Message non envoyé : connexion instable.'
              : CHAT_ERROR_MESSAGES[ack?.reason ?? ''] || 'Message non envoyé.',
          );
          return;
        }
        setChatMessage('');
        setChatError(null);
      });
  };

  const handleReaction = (emoji: string) => {
    if (!socketRef.current || !joined) return;

    const x = Math.random() * 80 + 10; // Random x position (10% to 90%)
    const y = 10; // Start near the bottom

    // Too many reactions are silently dropped by the server
    socketRef.current.emit('send-reaction', { streamId, emoji, x, y });
  };

  const handleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;

    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => undefined);
      return;
    }
    if (container.requestFullscreen) {
      container.requestFullscreen().catch(() => undefined);
      return;
    }
    // iOS Safari only supports fullscreen on the video element itself
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    video?.webkitEnterFullscreen?.();
  };

  const handleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (!next) {
      if (volume === 0) setVolume(50);
      // Unmuting is a user gesture: resume playback if the browser paused it
      videoRef.current?.play().catch(() => undefined);
    }
  };

  const handleVolume = (value: number) => {
    setVolume(value);
    setIsMuted(value === 0);
    if (value > 0) videoRef.current?.play().catch(() => undefined);
  };

  const handleClose = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/live');
    }
  };

  const handleTipContinue = () => {
    if (!Number.isFinite(tipValue) || !tipAmount.trim()) {
      setTipError('Indiquez un montant.');
      return;
    }
    if (tipValue < tipMinimum) {
      setTipError(`Le pourboire minimum est de ${formatEuros(tipMinimum)}.`);
      return;
    }
    if (tipValue > TIP_MAX) {
      setTipError(`Le pourboire maximum est de ${formatEuros(TIP_MAX)}.`);
      return;
    }
    if (Math.round(tipValue * 100) !== tipValue * 100) {
      setTipError('Deux décimales maximum.');
      return;
    }
    setTipError(null);
    setTipCheckout(true);
  };

  if (isError) {
    const status = (streamError as any)?.response?.status;
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <Radio className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">
              {status === 404 ? 'Live introuvable' : 'Chargement impossible'}
            </h2>
            <p className="text-muted-foreground mb-4">
              {status === 404
                ? "Ce live n'existe pas ou a été supprimé."
                : "Le live n'a pas pu être chargé. Vérifiez votre connexion."}
            </p>
            <div className="flex flex-col gap-2">
              {status !== 404 && (
                <Button onClick={() => void refetch()}>
                  <RefreshCw className="h-4 w-4 mr-2" /> Réessayer
                </Button>
              )}
              <Button variant={status === 404 ? 'default' : 'outline'} asChild>
                <Link href="/live">Voir les lives en cours</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !stream) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">Chargement du live...</p>
        </div>
      </div>
    );
  }

  const isOwnStream = user?.id === stream.creator.id;

  if (stream.status === 'ENDED' || stream.status === 'CANCELLED') {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <Radio className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">
              {stream.status === 'CANCELLED' ? 'Live annulé' : 'Live terminé'}
            </h2>
            <p className="text-muted-foreground mb-4">
              {stream.status === 'CANCELLED'
                ? `« ${stream.title} » a été annulé par le créateur.`
                : `« ${stream.title} » est maintenant terminé. Merci d'avoir regardé !`}
            </p>
            <div className="flex flex-col gap-2">
              <Button asChild>
                <Link href={`/${stream.creator.username}`}>Voir le profil du créateur</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/live">Voir les autres lives</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const deniedReason = stream.hasAccess === false ? stream.accessDeniedReason || 'PRIVATE' : joinError;
  // PPV lives (live or scheduled) can be bought from this page
  const canPurchase = deniedReason === 'PPV_PURCHASE_REQUIRED' && Number(stream.ppvPrice) > 0;

  if (canPurchase && showPurchase) {
    return (
      <div className="py-8 space-y-4 px-4">
        <div className="text-center">
          <h2 className="text-2xl font-bold break-words">{stream.title}</h2>
          <p className="text-muted-foreground">Live de @{stream.creator.username}</p>
        </div>
        <OneTimeCheckout
          kind="stream"
          amount={Number(stream.ppvPrice)}
          description={`${stream.title} - @${stream.creator.username}`}
          start={async (paymentMethodId) => (await liveApi.purchase(streamId, paymentMethodId)).data}
          confirm={async (paymentIntentId) => (await liveApi.confirmPurchase(streamId, paymentIntentId)).data}
          successDelay={1200}
          onSuccess={() => {
            setShowPurchase(false);
            setJoinError(null);
            queryClient.invalidateQueries({ queryKey: ['live-stream', streamId] });
          }}
          onCancel={() => setShowPurchase(false)}
        />
      </div>
    );
  }

  if (stream.status === 'SCHEDULED') {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <Radio className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2 break-words">{stream.title}</h2>
            <p className="text-muted-foreground mb-2">
              {stream.scheduledFor
                ? `Ce live est programmé pour le ${format(new Date(stream.scheduledFor), "d MMMM yyyy 'à' HH:mm", { locale: fr })}.`
                : "Ce live n'a pas encore commencé."}
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              Cette page se mettra à jour automatiquement au début du live.
            </p>
            {stream.hasAccess !== false && stream.isPpv && !isOwnStream && (
              <p className="text-sm text-green-600 mb-4">Votre accès à ce live est confirmé.</p>
            )}
            {deniedReason && deniedReason !== 'PPV_PURCHASE_REQUIRED' && (
              <p className="text-sm text-muted-foreground mb-4">{ACCESS_DENIED_MESSAGES[deniedReason]}</p>
            )}
            <div className="flex flex-col gap-2">
              {canPurchase && (
                <Button onClick={() => setShowPurchase(true)}>
                  <Euro className="h-4 w-4 mr-2" />
                  Réserver l&apos;accès pour {formatEuros(stream.ppvPrice)}
                </Button>
              )}
              {isOwnStream && (
                <Button asChild>
                  <Link href="/creator/live">Gérer mes lives</Link>
                </Button>
              )}
              <Button variant={canPurchase || isOwnStream ? 'outline' : 'default'} asChild>
                <Link href={`/${stream.creator.username}`}>Voir le profil du créateur</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (deniedReason) {
    const known = !!ACCESS_DENIED_MESSAGES[deniedReason];
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <Lock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">{known ? 'Accès restreint' : 'Connexion impossible'}</h2>
            <p className="text-muted-foreground mb-4">
              {ACCESS_DENIED_MESSAGES[deniedReason] || 'Impossible de rejoindre ce live pour le moment.'}
            </p>
            <div className="flex flex-col gap-2">
              {canPurchase && (
                <Button onClick={() => setShowPurchase(true)}>
                  <Euro className="h-4 w-4 mr-2" />
                  Acheter l&apos;accès pour {formatEuros(stream.ppvPrice)}
                </Button>
              )}
              {!known && (
                <Button
                  onClick={() => {
                    setJoinError(null);
                    setConnectAttempt((n) => n + 1);
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-2" /> Réessayer
                </Button>
              )}
              {deniedReason === 'SUBSCRIPTION_REQUIRED' || deniedReason === 'PREMIUM_SUBSCRIPTION_REQUIRED' ? (
                <Button asChild>
                  <Link href={`/${stream.creator.username}`}>
                    {deniedReason === 'PREMIUM_SUBSCRIPTION_REQUIRED'
                      ? "Voir les offres d'abonnement"
                      : "S'abonner au créateur"}
                  </Link>
                </Button>
              ) : (
                <Button variant={canPurchase || !known ? 'outline' : 'default'} asChild>
                  <Link href={`/${stream.creator.username}`}>Voir le profil du créateur</Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canTip = !isOwnStream && stream.tips?.allowed !== false;
  const tipPresets = TIP_PRESETS.filter((amount) => amount >= tipMinimum);

  return (
    <div className="lg:h-[calc(100vh-8rem)] lg:min-h-[500px] flex flex-col lg:flex-row bg-background rounded-lg overflow-hidden border">
      <style>{`
        @keyframes live-float-up {
          0% { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-300px) scale(1.4); opacity: 0; }
        }
      `}</style>

      {/* Video Player Section */}
      <div className="flex-1 flex flex-col bg-black min-h-0 min-w-0">
        {/* Creator Info Bar */}
        <div className="bg-black/80 text-white p-3 sm:p-4 flex items-center justify-between gap-2">
          <Link href={`/${stream.creator.username}`} className="flex items-center gap-3 min-w-0">
            <Avatar className="h-10 w-10 border-2 border-red-500 shrink-0">
              <AvatarImage src={stream.creator.avatar || undefined} />
              <AvatarFallback className="text-foreground">
                {stream.creator.username.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-bold truncate">{stream.creator.displayName || stream.creator.username}</h2>
                <Badge variant="destructive" className="flex items-center gap-1 shrink-0">
                  <Radio className="h-3 w-3" />
                  LIVE
                </Badge>
              </div>
              <p className="text-sm text-white/70 truncate">{stream.title}</p>
            </div>
          </Link>

          <div className="flex items-center gap-2 shrink-0">
            <div
              className="flex items-center gap-2 bg-white/20 px-3 py-1 rounded-full"
              title="Spectateurs connectés"
            >
              <Users className="h-4 w-4" />
              <span className="font-semibold">{(stream.viewerCount ?? 0).toLocaleString('fr-FR')}</span>
            </div>
            {isOwnStream && (
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" asChild>
                <Link href="/creator/live" title="Gérer le live" aria-label="Gérer le live">
                  <Settings className="h-5 w-5" />
                </Link>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={handleClose}
              aria-label="Quitter le live"
              title="Quitter le live"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Video Player */}
        <div
          ref={containerRef}
          className="flex-1 relative bg-black overflow-hidden aspect-video lg:aspect-auto min-h-[220px]"
        >
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            autoPlay
            playsInline
            muted={isMuted}
          />

          {connectionState !== 'playing' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 gap-3 p-4 text-center">
              {connectionState === 'error' || connectionState === 'offline' ? (
                <>
                  <p>
                    {connectionState === 'offline'
                      ? 'Connexion au live perdue. Reconnexion...'
                      : 'Connexion à la vidéo impossible.'}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (connectionState === 'error' && joined && requestOfferRef.current) {
                        requestOfferRef.current();
                      } else {
                        setConnectAttempt((n) => n + 1);
                      }
                    }}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" /> Réessayer
                  </Button>
                </>
              ) : (
                <>
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p>
                    {connectionState === 'waiting'
                      ? isOwnStream
                        ? "Vous ne diffusez pas encore : lancez la caméra depuis l'espace Live."
                        : 'En attente du créateur...'
                      : 'Connexion au live...'}
                  </p>
                </>
              )}
            </div>
          )}

          {connectionState === 'playing' && isMuted && (
            <button
              type="button"
              onClick={handleMute}
              className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-sm text-white hover:bg-black/90"
            >
              <VolumeX className="h-4 w-4" /> Activer le son
            </button>
          )}

          {/* Floating reactions */}
          {reactions.map((reaction) => (
            <div
              key={reaction.id}
              className="absolute text-4xl pointer-events-none"
              style={{
                left: `${reaction.x}%`,
                bottom: `${reaction.y}%`,
                animation: 'live-float-up 3s ease-out forwards',
              }}
            >
              {reaction.emoji}
            </div>
          ))}

          {/* Video Controls */}
          <div className="absolute bottom-2 left-2 right-2 sm:bottom-4 sm:left-4 sm:right-4 flex items-end justify-between gap-2">
            <div className="flex gap-1 sm:gap-2 overflow-x-auto min-w-0">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleReaction(emoji)}
                  disabled={!joined}
                  aria-label={`Réagir ${emoji}`}
                  className="text-lg sm:text-2xl hover:scale-125 transition-transform bg-black/50 rounded-full w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center shrink-0 disabled:opacity-50 disabled:hover:scale-100"
                >
                  {emoji}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 shrink-0 bg-black/50 rounded-full px-1">
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20 h-8 w-8 sm:h-10 sm:w-10"
                onClick={handleMute}
                title={isMuted ? 'Activer le son' : 'Couper le son'}
                aria-label={isMuted ? 'Activer le son' : 'Couper le son'}
              >
                {isMuted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </Button>
              <Slider
                className="hidden sm:block w-20"
                min={0}
                max={100}
                value={[isMuted ? 0 : volume]}
                onValueChange={([value]) => handleVolume(value)}
                aria-label="Volume"
              />
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20 h-8 w-8 sm:h-10 sm:w-10"
                onClick={handleFullscreen}
                title={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
                aria-label={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
              >
                {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Section */}
      <div className="lg:w-96 h-[420px] lg:h-auto flex flex-col bg-card border-t lg:border-t-0 lg:border-l">
        {/* Chat Header */}
        <div className="p-4 border-b">
          <h3 className="font-bold flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Chat en direct
          </h3>
        </div>

        {/* Messages */}
        <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {!joined && chatMessages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center">Connexion au chat...</p>
          )}
          {joined && chatMessages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center">
              Aucun message pour le moment. Dites bonjour !
            </p>
          )}
          {chatMessages.map((msg) => (
            <LiveChatMessageItem key={msg.id} message={msg} creatorLabel={msg.userId === user?.id ? 'Vous' : 'Créateur'} />
          ))}
        </div>

        {/* Message Input */}
        <div className="p-4 border-t space-y-2">
          {mutedInChat && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <MicOff className="h-3 w-3" /> {CHAT_ERROR_MESSAGES.MUTED}
            </p>
          )}
          {chatError && !mutedInChat && <p className="text-xs text-destructive">{chatError}</p>}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
          >
            <Input
              placeholder={
                mutedInChat ? 'Chat désactivé' : joined ? 'Envoyer un message...' : 'Connexion au chat...'
              }
              value={chatMessage}
              maxLength={500}
              disabled={!joined || mutedInChat}
              onChange={(e) => setChatMessage(e.target.value)}
              aria-label="Message"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!joined || mutedInChat || !chatMessage.trim() || sendingChat}
              aria-label="Envoyer"
            >
              {sendingChat ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>

          {canTip && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setTipAmount(String(Math.max(5, tipMinimum)));
                setShowTipModal(true);
              }}
            >
              <Euro className="h-4 w-4 mr-2" />
              Envoyer un pourboire
            </Button>
          )}
        </div>
      </div>

      {/* Tip Modal: choose the amount, then pay (saved card or Stripe Elements) */}
      <Dialog open={showTipModal} onOpenChange={(open) => !open && closeTipModal()}>
        <DialogContent
          className={
            tipCheckout
              ? 'max-w-md max-h-[90vh] overflow-y-auto bg-transparent border-0 shadow-none p-0 [&>button]:hidden'
              : 'max-w-md max-h-[90vh] overflow-y-auto'
          }
          // Don't lose a payment in progress with a stray click
          onInteractOutside={(e) => tipCheckout && e.preventDefault()}
        >
          {tipCheckout ? (
            <>
              <DialogTitle className="sr-only">Paiement du pourboire</DialogTitle>
              <OneTimeCheckout
                kind="tip"
                compact
                amount={tipValue}
                description={`Pourboire pour @${stream.creator.username}`}
                start={async (paymentMethodId) =>
                  (
                    await liveApi.sendTip(stream.creator.id, tipValue, {
                      streamId,
                      message: tipMessage.trim() || undefined,
                      paymentMethodId,
                    })
                  ).data
                }
                confirm={async (paymentIntentId) =>
                  (await liveApi.confirmTip(stream.creator.id, paymentIntentId)).data
                }
                successDelay={1500}
                onSuccess={closeTipModal}
                onCancel={() => setTipCheckout(false)}
              />
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Envoyer un pourboire</DialogTitle>
                <DialogDescription>
                  Soutenez @{stream.creator.username}. Votre pourboire sera annoncé dans le chat une fois le
                  paiement validé.
                </DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleTipContinue();
                }}
              >
                {tipPresets.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {tipPresets.map((amount) => (
                      <Button
                        key={amount}
                        type="button"
                        variant={tipValue === amount ? 'default' : 'outline'}
                        onClick={() => {
                          setTipAmount(String(amount));
                          setTipError(null);
                        }}
                      >
                        {formatEuros(amount)}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="space-y-1">
                  <Label htmlFor="tip-amount">Montant (€)</Label>
                  <Input
                    id="tip-amount"
                    type="number"
                    inputMode="decimal"
                    min={tipMinimum}
                    max={TIP_MAX}
                    step="0.01"
                    value={tipAmount}
                    onChange={(e) => {
                      setTipAmount(e.target.value);
                      setTipError(null);
                    }}
                    aria-invalid={!!tipError}
                    className={tipError ? 'border-destructive' : undefined}
                  />
                  {tipError ? (
                    <p className="text-sm text-destructive">{tipError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Minimum {formatEuros(tipMinimum)}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tip-message">Message (optionnel)</Label>
                  <Input
                    id="tip-message"
                    placeholder="Merci pour ce live !"
                    value={tipMessage}
                    maxLength={TIP_MESSAGE_MAX}
                    onChange={(e) => setTipMessage(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" className="flex-1">
                    Envoyer {Number.isFinite(tipValue) && tipValue > 0 ? formatEuros(tipValue) : ''}
                  </Button>
                  <Button type="button" variant="outline" onClick={closeTipModal}>
                    Annuler
                  </Button>
                </div>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
