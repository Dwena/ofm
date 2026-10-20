'use client';

import { useState, useEffect, useRef, useReducer, useCallback } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { liveApi } from '@/lib/api';
import {
  createLiveSocket,
  closeLiveSocket,
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
import { ViewerQualityIndicator, ViewerQualityMenu } from '@/components/live/viewer-connection-quality';
import { useViewerConnectionQuality } from '@/hooks/use-viewer-connection-quality';
import { useLiveKitViewer } from '@/hooks/use-livekit-viewer';
import {
  isLiveKitViewerQualityMode,
  viewerQualityOptionsFor,
  type LiveKitViewerQualityMode,
} from '@/lib/livekit/presets';
import type { LiveTransport } from '@/lib/livekit/token';
import { useChatAutoscroll } from '@/hooks/use-chat-autoscroll';
import { getLiveIceServers, prefetchLiveIceServers } from '@/lib/webrtc/ice-servers';
import type { ViewerQualityMode } from '@/lib/webrtc/bitrate-controller';
import { TipMenuPanel } from '@/components/live/tip-menu-panel';
import {
  bindLiveTipEvents,
  initialLiveTipState,
  liveTipsReducer,
  type LiveTipSnapshot,
  type TipMenuItem,
} from '@/lib/live-tips';
import { formatEuros } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

// Tip total, donation goals, tip menu and requests come with the stream detail (LiveTipSnapshot)
interface LiveStream extends LiveTipSnapshot {
  id: string;
  title: string;
  description?: string | null;
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
  startedAt?: string | null;
  scheduledFor?: string | null;
  viewerCount: number;
  hasAccess?: boolean;
  accessDeniedReason?: string | null;
  /** Video transport: LiveKit SFU, or the creator's peer-to-peer mesh */
  transport?: LiveTransport;
  /** Video source: the creator's browser, or OBS (LiveKit Ingress) */
  source?: 'BROWSER' | 'OBS';
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

type ConnectionState = 'connecting' | 'waiting' | 'playing' | 'reconnecting' | 'error' | 'offline';

// Automatic video reconnection: delays of the attempts before the manual "Réessayer"
const RETRY_DELAYS_MS = [1000, 3000, 6000];
// ICE 'disconnected' often recovers by itself: wait this long before reacting
const ICE_DISCONNECTED_GRACE_MS = 3000;
// An offer that does not lead to a connection within this delay counts as a failure
const CONNECT_TIMEOUT_MS = 15000;
const QUALITY_STORAGE_KEY = 'live-viewer-quality';
const LIVEKIT_QUALITY_STORAGE_KEY = 'live-viewer-quality-livekit';

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
  // Tip menu item the tip pays for (null: free tip)
  const [tipMenuItem, setTipMenuItem] = useState<TipMenuItem | null>(null);
  // Tip total, donation goals, tip menu and requests of the live (stream detail + socket events)
  const [tipState, dispatchTips] = useReducer(liveTipsReducer, initialLiveTipState);
  const [showPurchase, setShowPurchase] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [joined, setJoined] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [sendingChat, setSendingChat] = useState(false);
  const [mutedInChat, setMutedInChat] = useState(false);
  // Bumped to rebuild the socket connection (retry button)
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [socketConnected, setSocketConnected] = useState(false);
  const [qualityMode, setQualityMode] = useState<ViewerQualityMode>('auto');
  // LiveKit transport: simulcast layer chosen by the viewer (auto = adaptive)
  const [liveKitQuality, setLiveKitQuality] = useState<LiveKitViewerQualityMode>('auto');

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket>();
  const requestOfferRef = useRef<() => void>();
  const chatErrorTimer = useRef<ReturnType<typeof setTimeout>>();
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const qualityModeRef = useRef<ViewerQualityMode>('auto');
  const mutedRef = useRef(isMuted);
  mutedRef.current = isMuted;
  const reactionTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  // Once watching, a poll result (e.g. hasAccess flipping) never tears the connection down
  const watchingRef = useRef(false);

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
    // Poll while waiting for a scheduled live to start or for a purchase. While
    // watching, the socket pushes everything (viewer count, end of the live):
    // only a slow poll runs while it is disconnected.
    refetchInterval: (query) => {
      const data = query.state.data as LiveStream | undefined;
      if (data && (data.status === 'ENDED' || data.status === 'CANCELLED')) return false;
      if (data?.status === 'LIVE' && data.hasAccess !== false) return socketConnected ? false : 60000;
      return 10000;
    },
    retry: (count, error: any) => error?.response?.status !== 404 && error?.response?.status !== 403 && count < 2,
  });

  const tipMinimum = Math.max(1, stream?.tips?.minimum ?? 1);
  // A tip menu item cannot be paid less than its amount
  const tipFloor = Math.max(tipMinimum, tipMenuItem?.amount ?? 0);
  const tipValue = Number(tipAmount.replace(',', '.'));

  // Tip fields of the stream detail (kept by reference between polls)
  const streamTipGoals = stream?.tipGoals;
  const streamTipTotal = stream?.tipTotal;
  const streamTipMenu = stream?.tipMenu;
  const streamTipActions = stream?.pendingTipActions;
  useEffect(() => {
    if (streamTipMenu === undefined && streamTipGoals === undefined) return;
    dispatchTips({
      type: 'snapshot',
      snapshot: {
        tipGoals: streamTipGoals,
        tipTotal: streamTipTotal,
        tipMenu: streamTipMenu,
        pendingTipActions: streamTipActions,
      },
    });
  }, [streamTipGoals, streamTipTotal, streamTipMenu, streamTipActions]);
  const endGoalCelebration = useCallback((key: number) => dispatchTips({ type: 'celebration-end', key }), []);

  const openTipModal = (item: TipMenuItem | null) => {
    setTipMenuItem(item);
    setTipAmount(String(item ? Math.max(item.amount, tipMinimum) : Math.max(5, tipMinimum)));
    setTipError(null);
    setTipCheckout(false);
    setShowTipModal(true);
  };

  const closeTipModal = () => {
    setShowTipModal(false);
    setTipCheckout(false);
    setTipMenuItem(null);
    setTipAmount(String(Math.max(5, tipMinimum)));
    setTipMessage('');
    setTipError(null);
  };

  const isLive = stream?.status === 'LIVE';
  if (isLive && stream?.hasAccess !== false) watchingRef.current = true;
  else if (!isLive) watchingRef.current = false;
  const canWatch = isLive && (stream?.hasAccess !== false || watchingRef.current);
  const userId = user?.id;
  // With LiveKit the video comes from the SFU: the socket only carries chat, tips, counts...
  const isLiveKit = stream?.transport === 'livekit';

  // WebSocket + WebRTC (the creator is the offerer, this page answers).
  // In LiveKit mode only the socket part runs (no peer connection, no offers).
  useEffect(() => {
    if (!canWatch || !userId) return;

    setConnectionState('connecting');
    if (!isLiveKit) prefetchLiveIceServers(true);
    const socket = createLiveSocket({
      onAuthError: () => {
        setJoined(false);
        setConnectionState('offline');
      },
    });
    socketRef.current = socket;
    bindLiveTipEvents(socket, dispatchTips);
    let peer: RTCPeerConnection | null = null;
    // Negotiation id chosen by the broadcaster for the current offer
    let sessionId: string | undefined;
    let pendingCandidates: RTCIceCandidateInit[] = [];
    let hasVideo = false;
    // Automatic recovery state
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disconnectedTimer: ReturnType<typeof setTimeout> | undefined;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const clearRecoveryTimers = () => {
      clearTimeout(retryTimer);
      clearTimeout(disconnectedTimer);
      clearTimeout(connectTimer);
      retryTimer = disconnectedTimer = connectTimer = undefined;
    };

    const closePeer = () => {
      if (peer) {
        peer.ontrack = null;
        peer.onicecandidate = null;
        peer.onconnectionstatechange = null;
        peer.oniceconnectionstatechange = null;
        peer.close();
        peer = null;
      }
      peerRef.current = null;
      sessionId = undefined;
      pendingCandidates = [];
      hasVideo = false;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };

    const sendQualityMode = () => {
      if (qualityModeRef.current !== 'auto' && socket.connected) {
        socket.emit('set-viewer-quality', { streamId, mode: qualityModeRef.current });
      }
    };

    const requestOffer = (options: { iceRestart?: boolean } = {}) => {
      if (!options.iceRestart) closePeer();
      setConnectionState(hasVideo ? 'reconnecting' : 'connecting');
      socket
        .timeout(LIVE_ACK_TIMEOUT)
        .emit('request-offer', { streamId, iceRestart: !!options.iceRestart }, (err: Error | null, ack: LiveAck) => {
          if (disposed) return;
          if (err) {
            scheduleRecovery();
            return;
          }
          if (ack?.reason === 'BROADCASTER_OFFLINE') {
            clearRecoveryTimers();
            retryCount = 0;
            closePeer();
            setConnectionState('waiting');
          } else if (ack?.error) {
            scheduleRecovery();
          } else {
            // Watchdog: the negotiation must end with a connection
            clearTimeout(connectTimer);
            connectTimer = setTimeout(() => {
              if (!peer || peer.connectionState !== 'connected') scheduleRecovery();
            }, CONNECT_TIMEOUT_MS);
          }
        });
    };

    // Retry with backoff (ICE restart first when the connection still exists,
    // then fresh offers); after the last attempt the manual button is shown.
    const scheduleRecovery = () => {
      if (disposed || retryTimer) return;
      clearTimeout(connectTimer);
      clearTimeout(disconnectedTimer);
      if (retryCount >= RETRY_DELAYS_MS.length) {
        setConnectionState('error');
        return;
      }
      const attempt = retryCount;
      retryCount += 1;
      setConnectionState(hasVideo ? 'reconnecting' : 'connecting');
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        // Without the socket, the reconnection handler rejoins and asks for an offer
        if (!socket.connected) return;
        const canRestart = attempt === 0 && !!peer && peer.signalingState === 'stable' && !!sessionId;
        requestOffer({ iceRestart: canRestart });
      }, RETRY_DELAYS_MS[attempt]);
    };

    const manualRetry = () => {
      clearRecoveryTimers();
      retryCount = 0;
      requestOffer();
    };
    requestOfferRef.current = manualRetry;

    const onPeerStateChange = (pc: RTCPeerConnection) => {
      if (peer !== pc) return;
      const ice = pc.iceConnectionState;
      if (pc.connectionState === 'connected' || ice === 'connected' || ice === 'completed') {
        clearRecoveryTimers();
        retryCount = 0;
        if (hasVideo) setConnectionState('playing');
      } else if (pc.connectionState === 'failed' || ice === 'failed') {
        scheduleRecovery();
      } else if (ice === 'disconnected' && !disconnectedTimer) {
        disconnectedTimer = setTimeout(() => {
          disconnectedTimer = undefined;
          if (peer === pc && (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed')) {
            scheduleRecovery();
          }
        }, ICE_DISCONNECTED_GRACE_MS);
      }
    };

    const createPeer = (iceServers: RTCIceServer[]) => {
      const pc = new RTCPeerConnection({ iceServers });
      const offerSessionId = sessionId;

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          if (videoRef.current.srcObject !== event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
          }
          videoRef.current.play().catch(() => undefined);
          hasVideo = true;
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

      pc.onconnectionstatechange = () => onPeerStateChange(pc);
      pc.oniceconnectionstatechange = () => onPeerStateChange(pc);

      peer = pc;
      peerRef.current = pc;
      return pc;
    };

    // (Re)join on every connection, including automatic reconnections
    socket.on('connect', () => {
      setSocketConnected(true);
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
        dispatchTips({ type: 'snapshot', snapshot: ack as LiveTipSnapshot });
        if (typeof ack.viewerCount === 'number') {
          queryClient.setQueryData(['live-stream', streamId], (old: LiveStream | undefined) =>
            old ? { ...old, viewerCount: ack.viewerCount as number } : old,
          );
        }
        if (isLiveKit) return;
        if (ack.broadcasterOnline) {
          requestOffer();
        } else {
          setConnectionState('waiting');
        }
      });
    });

    socket.on('disconnect', () => {
      // The server drops this socket's viewer slot: a new offer is negotiated after reconnecting
      setSocketConnected(false);
      setJoined(false);
      // LiveKit: the video does not depend on the socket
      if (isLiveKit) return;
      clearRecoveryTimers();
      closePeer();
      setConnectionState('offline');
    });

    // A new session id starts a fresh peer connection; the same session id is
    // an ICE restart of the current one
    if (!isLiveKit) socket.on(
      'offer',
      async (data: { streamId: string; offer: RTCSessionDescriptionInit; sessionId?: string }) => {
        const offerSessionId = data.sessionId;
        const restart =
          !!peer && !!offerSessionId && offerSessionId === sessionId && peer.signalingState === 'stable';
        if (!restart) {
          closePeer();
          // Candidates of this session that arrive meanwhile are queued
          sessionId = offerSessionId;
        }
        try {
          const iceServers = await getLiveIceServers();
          if (disposed || sessionId !== offerSessionId) return; // superseded by a newer offer
          const pc = restart && peer ? peer : createPeer(iceServers);
          await pc.setRemoteDescription(data.offer);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (peer !== pc) return; // superseded by a newer offer
          socket.emit('answer', { streamId, answer: pc.localDescription, sessionId: offerSessionId });
          sendQualityMode();

          const queued = pendingCandidates;
          pendingCandidates = [];
          for (const candidate of queued) {
            await pc.addIceCandidate(candidate).catch(() => undefined);
          }
        } catch (error) {
          console.error('WebRTC offer error:', error);
          scheduleRecovery();
        }
      },
    );

    if (!isLiveKit) socket.on(
      'ice-candidate',
      async (data: { streamId: string; candidate: RTCIceCandidateInit; sessionId?: string }) => {
        const candidate = data.candidate;
        if (!candidate || data.sessionId !== sessionId) return;
        try {
          if (peer && peer.remoteDescription && peer.signalingState === 'stable') {
            await peer.addIceCandidate(candidate);
          } else {
            pendingCandidates.push(candidate);
          }
        } catch (error) {
          console.error('ICE candidate error:', error);
        }
      },
    );

    // The broadcaster (re)connected its socket: keep a working connection
    socket.on('broadcaster-ready', () => {
      if (isLiveKit) return;
      if (peer && peer.connectionState === 'connected') return;
      clearRecoveryTimers();
      retryCount = 0;
      requestOffer();
    });

    socket.on('broadcaster-disconnected', () => {
      // Only signaling is gone (e.g. the creator's network blipped): the video
      // keeps flowing peer-to-peer (or through LiveKit), so a connected peer is kept
      if (isLiveKit) return;
      if (peer && peer.connectionState === 'connected') return;
      clearRecoveryTimers();
      closePeer();
      setConnectionState('waiting');
    });

    socket.on('stream-ended', () => {
      clearRecoveryTimers();
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

    const timers = reactionTimers.current;
    socket.on('reaction', (reaction: { emoji: string; x: number; y: number }) => {
      const id = Math.random().toString();
      setReactions((prev) => [...prev.slice(-30), { id, emoji: reaction.emoji, x: reaction.x, y: reaction.y }]);
      const timer = setTimeout(() => {
        timers.delete(timer);
        setReactions((prev) => prev.filter((r) => r.id !== id));
      }, 3000);
      timers.add(timer);
    });

    socket.on('viewer-count', (count: number) => {
      queryClient.setQueryData(['live-stream', streamId], (old: LiveStream | undefined) =>
        old ? { ...old, viewerCount: count } : old,
      );
    });

    return () => {
      disposed = true;
      clearRecoveryTimers();
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      // Leave the room before closing (the server also cleans up on disconnect)
      if (socket.connected) socket.emit('leave-live-stream', { streamId });
      closeLiveSocket(socket);
      socketRef.current = undefined;
      requestOfferRef.current = undefined;
      closePeer();
      setJoined(false);
      setSocketConnected(false);
    };
  }, [canWatch, userId, streamId, queryClient, toast, connectAttempt, isLiveKit]);

  // Last quality choice of this browser
  useEffect(() => {
    try {
      const saved = localStorage.getItem(QUALITY_STORAGE_KEY);
      if (saved === 'low' || saved === 'auto') {
        qualityModeRef.current = saved;
        setQualityMode(saved);
      }
      const savedLiveKit = localStorage.getItem(LIVEKIT_QUALITY_STORAGE_KEY);
      if (isLiveKitViewerQualityMode(savedLiveKit)) setLiveKitQuality(savedLiveKit);
    } catch {
      // Storage unavailable
    }
  }, []);

  const handleLiveKitQualityChange = (mode: LiveKitViewerQualityMode) => {
    setLiveKitQuality(mode);
    try {
      localStorage.setItem(LIVEKIT_QUALITY_STORAGE_KEY, mode);
    } catch {
      // Storage unavailable
    }
  };

  const liveKit = useLiveKitViewer({
    streamId,
    enabled: isLiveKit && canWatch && !!userId && !joinError,
    videoRef,
    mutedRef,
    mode: liveKitQuality,
    onEnded: () => queryClient.invalidateQueries({ queryKey: ['live-stream', streamId] }),
  });
  const liveKitAccessError = liveKit.accessError;
  useEffect(() => {
    // Access refused by the token endpoint (same reasons as join-live-stream)
    if (liveKitAccessError) setJoinError(liveKitAccessError);
  }, [liveKitAccessError]);
  // Video state of the player, whatever the transport
  const videoState: ConnectionState = isLiveKit ? liveKit.state : connectionState;
  // Quality choices: only the layers the publisher actually sends
  const liveKitQualityOptions = viewerQualityOptionsFor(liveKit.layerCount);
  const liveKitQualityMode = liveKitQualityOptions.some((option) => option.value === liveKitQuality)
    ? liveKitQuality
    : 'auto';
  const isObsSource = stream?.source === 'OBS';

  const handleQualityChange = (mode: ViewerQualityMode) => {
    qualityModeRef.current = mode;
    setQualityMode(mode);
    try {
      localStorage.setItem(QUALITY_STORAGE_KEY, mode);
    } catch {
      // Storage unavailable
    }
    // Applied by the creator to this viewer's connection (re-sent after each new offer)
    if (joined) socketRef.current?.emit('set-viewer-quality', { streamId, mode });
  };

  const p2pVideoQuality = useViewerConnectionQuality(
    peerRef,
    !isLiveKit && (connectionState === 'playing' || connectionState === 'reconnecting'),
  );
  const videoQuality = isLiveKit ? liveKit.quality : p2pVideoQuality;

  // Auto-scroll chat (unless the user scrolled up to read older messages)
  const { onScroll: onChatScroll } = useChatAutoscroll(chatContainerRef, chatMessages);

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
  }, [volume, isMuted, videoState]);

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
    if (tipValue < tipFloor) {
      setTipError(
        tipMenuItem
          ? `« ${tipMenuItem.label} » coûte au moins ${formatEuros(tipFloor)}.`
          : `Le pourboire minimum est de ${formatEuros(tipMinimum)}.`,
      );
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

  const deniedReason =
    stream.hasAccess === false && !canWatch ? stream.accessDeniedReason || 'PRIVATE' : joinError;
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
  const tipPresets = TIP_PRESETS.filter((amount) => amount >= tipFloor);

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

          {videoState !== 'playing' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 gap-3 p-4 text-center">
              {videoState === 'error' || videoState === 'offline' ? (
                <>
                  <p>
                    {videoState === 'offline'
                      ? 'Connexion au live perdue. Reconnexion...'
                      : 'Connexion à la vidéo impossible.'}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (isLiveKit) {
                        if (videoState === 'error') liveKit.retry();
                        else setConnectAttempt((n) => n + 1);
                      } else if (videoState === 'error' && joined && requestOfferRef.current) {
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
                    {videoState === 'waiting'
                      ? isObsSource
                        ? 'En attente du signal OBS…'
                        : isOwnStream
                          ? "Vous ne diffusez pas encore : lancez la caméra depuis l'espace Live."
                          : 'En attente du créateur...'
                      : videoState === 'reconnecting'
                        ? 'Connexion instable, reconnexion de la vidéo...'
                        : 'Connexion au live...'}
                  </p>
                </>
              )}
            </div>
          )}

          {(videoState === 'playing' || videoState === 'reconnecting') && (
            <div className="absolute top-3 right-3">
              <ViewerQualityIndicator quality={videoQuality} />
            </div>
          )}

          {videoState === 'playing' && isMuted && (
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
              {isLiveKit ? (
                <ViewerQualityMenu
                  mode={liveKitQualityMode}
                  options={liveKitQualityOptions}
                  onChange={handleLiveKitQualityChange}
                />
              ) : (
                <ViewerQualityMenu mode={qualityMode} onChange={handleQualityChange} />
              )}
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

        {/* Donation goals, tip menu and requests in progress */}
        <TipMenuPanel
          state={tipState}
          canTip={canTip}
          currentUserId={user?.id}
          onSelectItem={(item) => openTipModal(item)}
          onCelebrationEnd={endGoalCelebration}
          className="shrink-0"
        />
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
        <div ref={chatContainerRef} onScroll={onChatScroll} className="flex-1 overflow-y-auto p-4 space-y-3">
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
              onClick={() => openTipModal(null)}
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
              ? 'w-[calc(100%-2rem)] max-w-md max-h-[90vh] overflow-y-auto bg-transparent border-0 shadow-none p-0 [&>button]:hidden'
              : 'w-[calc(100%-2rem)] max-w-md max-h-[90vh] overflow-y-auto rounded-lg'
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
                description={`Pourboire pour @${stream.creator.username}${tipMenuItem ? ` · Demande : ${tipMenuItem.label}` : ''}`}
                start={async (paymentMethodId) =>
                  (
                    await liveApi.sendTip(stream.creator.id, tipValue, {
                      streamId,
                      menuItemId: tipMenuItem?.id,
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
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  handleTipContinue();
                }}
              >
                {tipMenuItem && (
                  <div
                    className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40"
                    data-testid="tip-modal-request"
                  >
                    <span className="text-xl leading-5 shrink-0" aria-hidden>
                      {tipMenuItem.emoji || '🎁'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium break-words">Demande : {tipMenuItem.label}</p>
                      <p className="text-xs text-muted-foreground">
                        À partir de {formatEuros(tipMenuItem.amount)} · le créateur la verra dans ses demandes.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-xs"
                      onClick={() => {
                        setTipMenuItem(null);
                        setTipError(null);
                      }}
                    >
                      Pourboire libre
                    </Button>
                  </div>
                )}
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
                    min={tipFloor}
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
                    <p className="text-xs text-muted-foreground">Minimum {formatEuros(tipFloor)}</p>
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
