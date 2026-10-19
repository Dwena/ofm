'use client'

import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

interface UseSocketOptions {
  autoConnect?: boolean
}

interface Message {
  id: string
  content: string
  type: string
  senderId: string
  recipientId: string
  createdAt: string
  hasAttachment?: boolean
  attachmentUrl?: string
  sender?: {
    id: string
    username: string
    creatorProfile?: {
      displayName?: string
      profilePicture?: string
    }
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

  // Send message
  const sendMessage = (
    recipientId: string,
    content: string,
    type = 'TEXT',
    attachmentUrl?: string
  ) => {
    return new Promise((resolve, reject) => {
      if (!socketRef.current?.connected) {
        reject(new Error('Socket not connected'))
        return
      }

      socketRef.current.emit(
        'message:send',
        { recipientId, content, type, attachmentUrl },
        (response: any) => {
          if (response.error) {
            reject(new Error(response.error))
          } else {
            resolve(response)
          }
        }
      )
    })
  }

  // Typing indicator
  const setTyping = (recipientId: string, isTyping: boolean) => {
    if (!socketRef.current?.connected) return

    socketRef.current.emit('message:typing', { recipientId, isTyping })
  }

  // Mark as read
  const markAsRead = (messageIds: string[]) => {
    if (!socketRef.current?.connected) return

    socketRef.current.emit('message:read', { messageIds })
  }

  // Subscribe to new messages
  const onNewMessage = (callback: (message: Message) => void) => {
    if (!socketRef.current) return () => {}

    const handler = ({ message }: { message: Message }) => {
      callback(message)
    }

    socketRef.current.on('message:new', handler)

    return () => {
      socketRef.current?.off('message:new', handler)
    }
  }

  // Subscribe to message sent
  const onMessageSent = (callback: (message: Message) => void) => {
    if (!socketRef.current) return () => {}

    const handler = ({ message }: { message: Message }) => {
      callback(message)
    }

    socketRef.current.on('message:sent', handler)

    return () => {
      socketRef.current?.off('message:sent', handler)
    }
  }

  // Subscribe to typing
  const onTyping = (callback: (data: { userId: string; isTyping: boolean }) => void) => {
    if (!socketRef.current) return () => {}

    socketRef.current.on('message:typing', callback)

    return () => {
      socketRef.current?.off('message:typing', callback)
    }
  }

  // Subscribe to read receipts
  const onMessageRead = (callback: (data: { messageIds: string[]; readBy: string }) => void) => {
    if (!socketRef.current) return () => {}

    socketRef.current.on('message:read', callback)

    return () => {
      socketRef.current?.off('message:read', callback)
    }
  }

  // Subscribe to realtime notifications (emitted for every Notification row created server-side)
  const onNotification = (callback: (notification: RealtimeNotification) => void) => {
    if (!socketRef.current) return () => {}

    const target = socketRef.current
    target.on('notification:new', callback)

    return () => {
      target.off('notification:new', callback)
    }
  }

  return {
    socket,
    connected,
    onlineUsers,
    sendMessage,
    setTyping,
    markAsRead,
    onNewMessage,
    onMessageSent,
    onTyping,
    onMessageRead,
    onNotification,
  }
}
