'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

interface UseSocketOptions {
  autoConnect?: boolean
}

/** Message as pushed by the messaging gateway (already shaped for the viewer) */
export interface SocketMessage {
  id: string
  content: string
  senderId: string
  receiverId: string
  createdAt: string
  status?: 'SENT' | 'DELIVERED' | 'READ' | 'DELETED'
  hasAttachment?: boolean
  attachmentUrl?: string | null
  isPpv?: boolean
  ppvPrice?: number | null
  isPurchased?: boolean
  // PPV message not purchased yet by the viewer: no text, no attachment
  locked?: boolean
  sender?: {
    id: string
    username: string
    displayName?: string | null
    avatar?: string | null
  }
}

export interface RealtimeNotification {
  id: string
  userId: string
  type: string
  title: string
  message: string
  linkUrl?: string | null
  isRead?: boolean
  metadata?: { kind?: string; [key: string]: unknown } | null
  createdAt: string
}

/**
 * One socket per browser tab, shared by every component using the hook
 * (notifications dropdown, messages page, live analytics...). It is opened by
 * the first consumer and closed when the last one unmounts.
 */
let sharedSocket: Socket | null = null
let sharedToken: string | null = null
let consumers = 0

function acquireSocket(token: string): Socket {
  if (sharedSocket && sharedToken !== token) {
    // Logged in as someone else: drop the stale connection
    sharedSocket.disconnect()
    sharedSocket = null
  }
  if (!sharedSocket) {
    sharedSocket = io(`${SOCKET_URL}/messaging`, {
      auth: { token },
      transports: ['websocket', 'polling'],
    })
    sharedToken = token
  }
  consumers += 1
  return sharedSocket
}

function releaseSocket(socket: Socket) {
  if (socket !== sharedSocket) {
    socket.disconnect()
    return
  }
  consumers = Math.max(0, consumers - 1)
  if (consumers === 0) {
    sharedSocket.disconnect()
    sharedSocket = null
    sharedToken = null
  }
}

export function useSocket(options: UseSocketOptions = {}) {
  const { autoConnect = true } = options
  const socketRef = useRef<Socket | null>(null)
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!autoConnect) return

    const token = localStorage.getItem('accessToken')
    if (!token) return

    const socket = acquireSocket(token)
    socketRef.current = socket
    setSocket(socket)
    setConnected(socket.connected)

    const handleConnect = () => setConnected(true)
    const handleDisconnect = () => setConnected(false)
    const handleError = (error: unknown) => {
      console.error('Socket error:', error)
    }
    const handleOnline = ({ userId }: { userId: string }) => {
      setOnlineUsers(prev => new Set(prev).add(userId))
    }
    const handleOffline = ({ userId }: { userId: string }) => {
      setOnlineUsers(prev => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('error', handleError)
    socket.on('user:online', handleOnline)
    socket.on('user:offline', handleOffline)

    // Cleanup
    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('error', handleError)
      socket.off('user:online', handleOnline)
      socket.off('user:offline', handleOffline)
      socketRef.current = null
      releaseSocket(socket)
    }
  }, [autoConnect])

  // Send message over the socket (the messages page sends through REST: POST /messages)
  const sendMessage = useCallback(
    (recipientId: string, content: string, type = 'TEXT', attachmentUrl?: string) => {
      return new Promise((resolve, reject) => {
        if (!socketRef.current?.connected) {
          reject(new Error('Socket not connected'))
          return
        }

        socketRef.current.emit(
          'message:send',
          { recipientId, content, type, attachmentUrl },
          (response: any) => {
            if (response?.error) {
              reject(new Error(response.error))
            } else {
              resolve(response)
            }
          }
        )
      })
    },
    []
  )

  // Typing indicator
  const setTyping = useCallback((recipientId: string, isTyping: boolean) => {
    if (!socketRef.current?.connected) return

    socketRef.current.emit('message:typing', { recipientId, isTyping })
  }, [])

  // Mark as read
  const markAsRead = useCallback((messageIds: string[]) => {
    if (!socketRef.current?.connected) return

    socketRef.current.emit('message:read', { messageIds })
  }, [])

  // Ask which of these users are connected right now (merged into onlineUsers)
  const queryPresence = useCallback((userIds: string[]) => {
    const target = socketRef.current
    if (!target?.connected || userIds.length === 0) return

    target.emit('presence:query', { userIds }, (response: { online?: string[] } | undefined) => {
      const online = new Set(response?.online ?? [])
      setOnlineUsers(prev => {
        const next = new Set(prev)
        userIds.forEach(id => (online.has(id) ? next.add(id) : next.delete(id)))
        return next
      })
    })
  }, [])

  // Subscribe to new messages
  const onNewMessage = useCallback((callback: (message: SocketMessage) => void) => {
    const target = socketRef.current
    if (!target) return () => {}

    const handler = ({ message }: { message: SocketMessage }) => {
      callback(message)
    }

    target.on('message:new', handler)

    return () => {
      target.off('message:new', handler)
    }
  }, [])

  // Subscribe to messages sent by the current user (from any of their tabs)
  const onMessageSent = useCallback((callback: (message: SocketMessage) => void) => {
    const target = socketRef.current
    if (!target) return () => {}

    const handler = ({ message }: { message: SocketMessage }) => {
      callback(message)
    }

    target.on('message:sent', handler)

    return () => {
      target.off('message:sent', handler)
    }
  }, [])

  // Subscribe to typing
  const onTyping = useCallback((callback: (data: { userId: string; isTyping: boolean }) => void) => {
    const target = socketRef.current
    if (!target) return () => {}

    target.on('message:typing', callback)

    return () => {
      target.off('message:typing', callback)
    }
  }, [])

  // Subscribe to read receipts
  const onMessageRead = useCallback(
    (callback: (data: { messageIds: string[]; readBy: string }) => void) => {
      const target = socketRef.current
      if (!target) return () => {}

      target.on('message:read', callback)

      return () => {
        target.off('message:read', callback)
      }
    },
    []
  )

  // Subscribe to deleted messages (either side of a conversation)
  const onMessageDeleted = useCallback(
    (callback: (data: { messageId: string; senderId: string; receiverId: string }) => void) => {
      const target = socketRef.current
      if (!target) return () => {}

      target.on('message:deleted', callback)

      return () => {
        target.off('message:deleted', callback)
      }
    },
    []
  )

  // Subscribe to realtime notifications (emitted for every Notification row created server-side)
  const onNotification = useCallback((callback: (notification: RealtimeNotification) => void) => {
    const target = socketRef.current
    if (!target) return () => {}

    target.on('notification:new', callback)

    return () => {
      target.off('notification:new', callback)
    }
  }, [])

  return {
    socket,
    connected,
    onlineUsers,
    sendMessage,
    setTyping,
    markAsRead,
    queryPresence,
    onNewMessage,
    onMessageSent,
    onTyping,
    onMessageRead,
    onMessageDeleted,
    onNotification,
  }
}
