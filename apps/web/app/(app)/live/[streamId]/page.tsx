'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { liveApi } from '@/lib/api';
import {
  createLiveSocket,
  getIceServers,
  ACCESS_DENIED_MESSAGES,
  type LiveAck,
  type LiveChatMessage,
} from '@/lib/live';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Radio,
  Users,
  Send,
  DollarSign,
  Maximize,
  Minimize,
  Volume2,
  VolumeX,
  X,
  Gift,
  Lock,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Socket } from 'socket.io-client';
import OneTimeCheckout from '@/components/checkout/one-time-checkout';
import { formatEuros } from '@/lib/utils';

interface LiveStream {
  id: string;
  title: string;
  description?: string;
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
  startedAt?: string | null;
  scheduledFor?: string | null;
  viewerCount: number;
  hasAccess?: boolean;
  accessDeniedReason?: string | null;
  isPpv?: boolean;
  ppvPrice?: number | null; // euros
  creator: {
    id: string;
    username: string;
    displayName?: string;
    avatar?: string;
  };
}

type ConnectionState = 'connecting' | 'waiting' | 'playing' | 'error';

const REACTION_EMOJIS = ['❤️', '🔥', '👏', '😍', '🎉', '💎'];

export default function LiveStreamPage({ params }: { params: { streamId: string } }) {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const streamId = params.streamId;

  const [isFullscreen, setIsFullscreen] = useState(false);
  // Browsers block autoplay with sound, so playback starts muted
  const [isMuted, setIsMuted] = useState(true);
  const [chatMessage, setChatMessage] = useState('');
  const [chatMessages, setChatMessages] = useState<LiveChatMessage[]>([]);
  const [reactions, setReactions] = useState<{ id: string; emoji: string; x: number; y: number }[]>([]);
  const [showTipModal, setShowTipModal] = useState(false);
  const [tipAmount, setTipAmount] = useState(5);
  const [tipMessage, setTipMessage] = useState('');
  // Amount chosen: show the payment step of the tip modal
  const [tipCheckout, setTipCheckout] = useState(false);
  const [showPurchase, setShowPurchase] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket>();

  // Fetch live stream info
  const { data: stream, isLoading } = useQuery({
    queryKey: ['live-stream', streamId],
    queryFn: async () => {
      const response = await liveApi.getStream(streamId);
      return response.data as LiveStream;
    },
    refetchInterval: 10000,
  });

  const closeTipModal = () => {
    setShowTipModal(false);
    setTipCheckout(false);
    setTipAmount(5);
    setTipMessage('');
  };

  const isLive = stream?.status === 'LIVE';
  const canWatch = isLive && stream?.hasAccess !== false;
  const userId = user?.id;

  // WebSocket + WebRTC (the creator is the offerer, this page answers)
  useEffect(() => {
    if (!canWatch || !userId) return;

    const socket = createLiveSocket();
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
      socket.emit('request-offer', { streamId }, (ack: LiveAck) => {
        if (ack?.reason === 'BROADCASTER_OFFLINE') {
          closePeer();
          setConnectionState('waiting');
        }
      });
    };

    // (Re)join on every connection, including automatic reconnections
    socket.on('connect', () => {
      socket.emit('join-live-stream', { streamId }, (ack: LiveAck) => {
        if (!ack?.success) {
          setJoinError(ack?.reason || ack?.error || 'UNKNOWN');
          return;
        }
        setJoinError(null);
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

    socket.on('reaction', (reaction: { emoji: string; x: number; y: number }) => {
      const id = Math.random().toString();
      setReactions((prev) => [...prev, { id, emoji: reaction.emoji, x: reaction.x, y: reaction.y }]);
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
      socket.emit('leave-live-stream', { streamId });
      socket.disconnect();
      socketRef.current = undefined;
      closePeer();
    };
  }, [canWatch, userId, streamId, queryClient]);

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

  const handleSendMessage = () => {
    const text = chatMessage.trim();
    if (!text || !socketRef.current) return;

    socketRef.current.emit('send-chat-message', { streamId, message: text }, (ack: LiveAck) => {
      if (ack?.error) {
        setChatError(ack.reason === 'RATE_LIMITED' ? 'Doucement ! Attendez un peu.' : "Message non envoyé.");
        setTimeout(() => setChatError(null), 3000);
      }
    });

    setChatMessage('');
  };

  const handleReaction = (emoji: string) => {
    if (!socketRef.current) return;

    const x = Math.random() * 80 + 10; // Random x position (10% to 90%)
    const y = 10; // Start near the bottom

    socketRef.current.emit('send-reaction', { streamId, emoji, x, y });
  };

  const handleFullscreen = () => {
    const container = document.getElementById('video-container');
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  const handleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  if (isLoading || !stream) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Chargement du stream...</p>
        </div>
      </div>
    );
  }

  if (stream.status === 'ENDED' || stream.status === 'CANCELLED') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <Radio className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Stream terminé</h2>
            <p className="text-muted-foreground mb-4">
              Ce live stream est maintenant terminé.
            </p>
            <Button onClick={() => router.push(`/${stream.creator.username}`)}>
              Voir le profil du créateur
            </Button>
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
      <div className="py-8 space-y-4">
        <div className="text-center">
          <h2 className="text-2xl font-bold">{stream.title}</h2>
          <p className="text-muted-foreground">
            Live de @{stream.creator.username}
          </p>
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
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <Radio className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">{stream.title}</h2>
            <p className="text-muted-foreground mb-4">
              {stream.scheduledFor
                ? `Ce live est programmé pour le ${format(new Date(stream.scheduledFor), "d MMMM yyyy 'à' HH:mm", { locale: fr })}.`
                : "Ce live n'a pas encore commencé."}
            </p>
            <div className="flex flex-col gap-2">
              {canPurchase && (
                <Button onClick={() => setShowPurchase(true)}>
                  <DollarSign className="h-4 w-4 mr-2" />
                  Réserver l&apos;accès pour {formatEuros(stream.ppvPrice)}
                </Button>
              )}
              <Button
                variant={canPurchase ? 'outline' : 'default'}
                onClick={() => router.push(`/${stream.creator.username}`)}
              >
                Voir le profil du créateur
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (deniedReason) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <Lock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Accès restreint</h2>
            <p className="text-muted-foreground mb-4">
              {ACCESS_DENIED_MESSAGES[deniedReason] || 'Impossible de rejoindre ce live.'}
            </p>
            <div className="flex flex-col gap-2">
              {canPurchase && (
                <Button onClick={() => setShowPurchase(true)}>
                  <DollarSign className="h-4 w-4 mr-2" />
                  Acheter l&apos;accès pour {formatEuros(stream.ppvPrice)}
                </Button>
              )}
              <Button
                variant={canPurchase ? 'outline' : 'default'}
                onClick={() => router.push(`/${stream.creator.username}`)}
              >
                Voir le profil du créateur
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)] min-h-[500px] flex flex-col lg:flex-row bg-background rounded-lg overflow-hidden border">
      <style>{`
        @keyframes live-float-up {
          0% { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-300px) scale(1.4); opacity: 0; }
        }
      `}</style>

      {/* Video Player Section */}
      <div className="flex-1 flex flex-col bg-black min-h-0">
        {/* Creator Info Bar */}
        <div className="bg-black/80 text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10 border-2 border-red-500">
              <AvatarImage src={stream.creator.avatar} />
              <AvatarFallback>
                {stream.creator.username.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold">{stream.creator.displayName || stream.creator.username}</h2>
                <Badge variant="destructive" className="flex items-center gap-1">
                  <Radio className="h-3 w-3" />
                  LIVE
                </Badge>
              </div>
              <p className="text-sm text-white/70">{stream.title}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-white/20 px-3 py-1 rounded-full">
              <Users className="h-4 w-4" />
              <span className="font-semibold">{(stream.viewerCount ?? 0).toLocaleString('fr-FR')}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={() => router.back()}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Video Player */}
        <div id="video-container" className="flex-1 relative bg-black overflow-hidden min-h-[240px]">
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            autoPlay
            playsInline
            muted={isMuted}
          />

          {connectionState !== 'playing' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 gap-3">
              {connectionState === 'error' ? (
                <p>Connexion au live impossible. Rechargez la page pour réessayer.</p>
              ) : (
                <>
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p>
                    {connectionState === 'waiting'
                      ? 'En attente du créateur...'
                      : 'Connexion au live...'}
                  </p>
                </>
              )}
            </div>
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
          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
            <div className="flex gap-2">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleReaction(emoji)}
                  className="text-2xl hover:scale-125 transition-transform bg-black/50 rounded-full w-10 h-10 flex items-center justify-center"
                >
                  {emoji}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20"
                onClick={handleMute}
                title={isMuted ? 'Activer le son' : 'Couper le son'}
              >
                {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20"
                onClick={handleFullscreen}
              >
                {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Section */}
      <div className="lg:w-96 h-80 lg:h-auto flex flex-col bg-card border-l">
        {/* Chat Header */}
        <div className="p-4 border-b">
          <h3 className="font-bold flex items-center gap-2">
            <Users className="h-5 w-5" />
            Chat en direct
          </h3>
        </div>

        {/* Messages */}
        <div
          ref={chatContainerRef}
          className="flex-1 overflow-y-auto p-4 space-y-3"
        >
          {chatMessages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center">Aucun message pour le moment.</p>
          )}
          {chatMessages.map((msg) => (
            <div key={msg.id} className="flex gap-2">
              <Avatar className="h-8 w-8">
                <AvatarImage src={msg.avatar || undefined} />
                <AvatarFallback>
                  {msg.username.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">@{msg.username}</span>
                  {msg.isCreator && (
                    <Badge variant="destructive" className="text-xs">Créateur</Badge>
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

        {/* Message Input */}
        <div className="p-4 border-t space-y-2">
          {chatError && <p className="text-xs text-destructive">{chatError}</p>}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Envoyer un message..."
              value={chatMessage}
              maxLength={500}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              className="flex-1 px-3 py-2 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-ring bg-background"
            />
            <Button onClick={handleSendMessage} size="icon">
              <Send className="h-4 w-4" />
            </Button>
          </div>

          {user?.id !== stream.creator.id && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setShowTipModal(true)}
            >
              <DollarSign className="h-4 w-4 mr-2" />
              Envoyer un pourboire
            </Button>
          )}
        </div>
      </div>

      {/* Tip Modal: choose the amount, then pay (saved card or Stripe Elements) */}
      {showTipModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto py-8">
          {tipCheckout ? (
            <div className="w-full max-w-md mx-4">
              <OneTimeCheckout
                kind="tip"
                compact
                amount={tipAmount}
                description={`Pourboire pour @${stream.creator.username}`}
                start={async (paymentMethodId) =>
                  (
                    await liveApi.sendTip(stream.creator.id, tipAmount, {
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
            </div>
          ) : (
            <Card className="w-full max-w-md mx-4">
              <CardContent className="pt-6">
                <h3 className="text-xl font-bold mb-4">Envoyer un pourboire</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    {[5, 10, 20, 50, 100, 200].map((amount) => (
                      <Button
                        key={amount}
                        variant={tipAmount === amount ? 'default' : 'outline'}
                        onClick={() => setTipAmount(amount)}
                      >
                        {formatEuros(amount)}
                      </Button>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder="Message (optionnel)"
                    value={tipMessage}
                    maxLength={200}
                    onChange={(e) => setTipMessage(e.target.value)}
                    className="w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-ring bg-background"
                  />
                  <p className="text-xs text-muted-foreground">
                    Votre pourboire sera annoncé dans le chat une fois le paiement validé.
                  </p>
                  <div className="flex gap-2">
                    <Button className="flex-1" onClick={() => setTipCheckout(true)}>
                      Envoyer {formatEuros(tipAmount)}
                    </Button>
                    <Button variant="outline" onClick={closeTipModal}>
                      Annuler
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
