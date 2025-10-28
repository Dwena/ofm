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

export function useSocket(options: UseSocketOptions = {}) {
  const { autoConnect = true } = options
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!autoConnect) return

    const token = localStorage.getItem('accessToken')
    if (!token) return

    // Create socket connection
    const socket = io(`${SOCKET_URL}/messaging`, {
      auth: {
        token,
      },
      transports: ['websocket', 'polling'],
    })

    socketRef.current = socket

    // Connection events
    socket.on('connect', () => {
      console.log('Socket connected')
      setConnected(true)
    })

    socket.on('disconnect', () => {
      console.log('Socket disconnected')
      setConnected(false)
    })

    socket.on('error', (error) => {
      console.error('Socket error:', error)
    })

    // Online status events
    socket.on('user:online', ({ userId }: { userId: string }) => {
      setOnlineUsers(prev => new Set(prev).add(userId))
    })

    socket.on('user:offline', ({ userId }: { userId: string }) => {
      setOnlineUsers(prev => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    })

    // Cleanup
    return () => {
      socket.disconnect()
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

  return {
    socket: socketRef.current,
    connected,
    onlineUsers,
    sendMessage,
    setTyping,
    markAsRead,
    onNewMessage,
    onMessageSent,
    onTyping,
    onMessageRead,
  }
}
