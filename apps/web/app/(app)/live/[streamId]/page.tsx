'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { liveApi, messagesApi } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Radio,
  Users,
  Heart,
  Send,
  DollarSign,
  Maximize,
  Minimize,
  Volume2,
  VolumeX,
  Settings as SettingsIcon,
  X,
  Gift
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { io, Socket } from 'socket.io-client';

interface LiveStream {
  id: string;
  title: string;
  description?: string;
  status: 'LIVE' | 'ENDED';
  startedAt: string;
  viewerCount: number;
  creator: {
    id: string;
    username: string;
    displayName?: string;
    avatar?: string;
  };
}

interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  avatar?: string;
  message: string;
  timestamp: string;
  type: 'MESSAGE' | 'TIP' | 'SYSTEM';
  tipAmount?: number;
}

const REACTION_EMOJIS = ['❤️', '🔥', '👏', '😍', '🎉', '💎'];

export default function LiveStreamPage({ params }: { params: { streamId: string } }) {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<{ id: string; emoji: string; x: number; y: number }[]>([]);
  const [showTipModal, setShowTipModal] = useState(false);
  const [tipAmount, setTipAmount] = useState(5);

  const videoRef = useRef<HTMLVideoElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket>();
  const peerConnectionRef = useRef<RTCPeerConnection>();

  // Fetch live stream info
  const { data: stream, isLoading } = useQuery({
    queryKey: ['live-stream', params.streamId],
    queryFn: async () => {
      const response = await liveApi.getStream(params.streamId);
      return response.data as LiveStream;
    },
    refetchInterval: 10000,
  });

  // Send tip mutation
  const sendTipMutation = useMutation({
    mutationFn: async (amount: number) => {
      await liveApi.sendTip(params.streamId, amount);
    },
    onSuccess: () => {
      setShowTipModal(false);
      setTipAmount(5);
    },
  });

  // Initialize WebRTC and WebSocket
  useEffect(() => {
    if (!stream || !user) return;

    // Connect to WebSocket
    socketRef.current = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', {
      auth: {
        token: localStorage.getItem('accessToken'),
      },
    });

    // Join live stream room
    socketRef.current.emit('join-live-stream', { streamId: params.streamId });

    // Listen for chat messages
    socketRef.current.on('chat-message', (message: ChatMessage) => {
      setChatMessages(prev => [...prev, message]);
    });

    // Listen for reactions
    socketRef.current.on('reaction', (reaction: { emoji: string; x: number; y: number }) => {
      const id = Math.random().toString();
      setReactions(prev => [...prev, { id, ...reaction }]);
      setTimeout(() => {
        setReactions(prev => prev.filter(r => r.id !== id));
      }, 3000);
    });

    // Listen for viewer count updates
    socketRef.current.on('viewer-count', (count: number) => {
      queryClient.setQueryData(['live-stream', params.streamId], (old: any) => ({
        ...old,
        viewerCount: count,
      }));
    });

    // Initialize WebRTC
    initializeWebRTC();

    return () => {
      if (socketRef.current) {
        socketRef.current.emit('leave-live-stream', { streamId: params.streamId });
        socketRef.current.disconnect();
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, [stream, user]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const initializeWebRTC = async () => {
    try {
      // Create peer connection
      peerConnectionRef.current = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });

      // Handle incoming tracks
      peerConnectionRef.current.ontrack = (event) => {
        if (videoRef.current) {
          videoRef.current.srcObject = event.streams[0];
        }
      };

      // Handle ICE candidates
      peerConnectionRef.current.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit('ice-candidate', {
            streamId: params.streamId,
            candidate: event.candidate,
          });
        }
      };

      // Request offer from server
      socketRef.current?.emit('request-offer', { streamId: params.streamId });

      // Listen for offer
      socketRef.current?.on('offer', async (offer: RTCSessionDescriptionInit) => {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.setRemoteDescription(offer);
          const answer = await peerConnectionRef.current.createAnswer();
          await peerConnectionRef.current.setLocalDescription(answer);
          socketRef.current?.emit('answer', {
            streamId: params.streamId,
            answer,
          });
        }
      });

      // Listen for ICE candidates from server
      socketRef.current?.on('ice-candidate', async (candidate: RTCIceCandidateInit) => {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.addIceCandidate(candidate);
        }
      });
    } catch (error) {
      console.error('WebRTC initialization error:', error);
    }
  };

  const handleSendMessage = () => {
    if (!chatMessage.trim() || !socketRef.current) return;

    socketRef.current.emit('send-chat-message', {
      streamId: params.streamId,
      message: chatMessage,
    });

    setChatMessage('');
  };

  const handleReaction = (emoji: string) => {
    if (!socketRef.current) return;

    const x = Math.random() * 80 + 10; // Random x position (10% to 90%)
    const y = 80; // Start from bottom

    socketRef.current.emit('send-reaction', {
      streamId: params.streamId,
      emoji,
      x,
      y,
    });
  };

  const handleFullscreen = () => {
    const container = document.getElementById('video-container');
    if (!container) return;

    if (!isFullscreen) {
      if (container.requestFullscreen) {
        container.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
    setIsFullscreen(!isFullscreen);
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

  if (stream.status === 'ENDED') {
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

  return (
    <div className="h-screen flex flex-col lg:flex-row bg-background">
      {/* Video Player Section */}
      <div className="flex-1 flex flex-col bg-black">
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
              <span className="font-semibold">{stream.viewerCount.toLocaleString()}</span>
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
        <div id="video-container" className="flex-1 relative bg-black">
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            autoPlay
            playsInline
            muted={isMuted}
          />

          {/* Floating reactions */}
          {reactions.map((reaction) => (
            <div
              key={reaction.id}
              className="absolute text-4xl animate-float-up pointer-events-none"
              style={{
                left: `$${reaction.x}%`,
                bottom: `$${reaction.y}%`,
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
      <div className="lg:w-96 flex flex-col bg-card border-l">
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
          {chatMessages.map((msg) => (
            <div key={msg.id} className="flex gap-2">
              <Avatar className="h-8 w-8">
                <AvatarImage src={msg.avatar} />
                <AvatarFallback>
                  {msg.username.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">@{msg.username}</span>
                  {msg.type === 'TIP' && (
                    <Badge variant="secondary" className="text-xs">
                      <Gift className="h-3 w-3 mr-1" />
                      {msg.tipAmount}€
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
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Envoyer un message..."
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              className="flex-1 px-3 py-2 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-ring"
            />
            <Button onClick={handleSendMessage} size="icon">
              <Send className="h-4 w-4" />
            </Button>
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => setShowTipModal(true)}
          >
            <DollarSign className="h-4 w-4 mr-2" />
            Envoyer un pourboire
          </Button>
        </div>
      </div>

      {/* Tip Modal */}
      {showTipModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
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
                      {amount}€
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() => sendTipMutation.mutate(tipAmount)}
                    disabled={sendTipMutation.isPending}
                  >
                    {sendTipMutation.isPending ? 'Envoi...' : `Envoyer ${tipAmount}€`}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowTipModal(false)}
                  >
                    Annuler
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
