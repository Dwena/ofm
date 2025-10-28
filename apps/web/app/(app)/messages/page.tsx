'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { messagesApi, mediaApi } from '@/lib/api'
import { useSocket } from '@/hooks/use-socket'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Send, Loader2, Image as ImageIcon, X, FileVideo } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useAuth } from '@/contexts/auth-context'

interface Conversation {
  id: string
  participant: {
    id: string
    username: string
    creatorProfile?: {
      displayName?: string
      profilePicture?: string
    }
  }
  lastMessage?: {
    id: string
    content: string
    createdAt: string
  }
  unreadCount: number
  updatedAt: string
}

interface Message {
  id: string
  content: string
  senderId: string
  recipientId: string
  createdAt: string
  hasAttachment?: boolean
  attachmentUrl?: string
  sender: {
    id: string
    username: string
    creatorProfile?: {
      displayName?: string
      profilePicture?: string
    }
  }
}

export default function MessagesPage() {
  const { user } = useAuth()
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [messageInput, setMessageInput] = useState('')
  const [sending, setSending] = useState(false)
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set())
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [selectedMedia, setSelectedMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  const {
    connected,
    onlineUsers,
    sendMessage,
    setTyping,
    markAsRead,
    onNewMessage,
    onMessageSent,
    onTyping,
  } = useSocket()

  // Fetch conversations
  const { data: conversations, isLoading: conversationsLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const response = await messagesApi.getConversations()
      return response.data as Conversation[]
    },
  })

  // Fetch messages for selected conversation
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['messages', selectedConversation?.participant.id],
    queryFn: async () => {
      if (!selectedConversation) return null
      const response = await messagesApi.getMessages(selectedConversation.participant.id)
      return response.data
    },
    enabled: !!selectedConversation,
  })

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messagesData])

  // Socket event handlers
  useEffect(() => {
    if (!connected) return

    const unsubscribeNew = onNewMessage((message) => {
      // Update messages list
      queryClient.invalidateQueries({ queryKey: ['messages'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })

      // Mark as read if conversation is open
      if (selectedConversation && message.senderId === selectedConversation.participant.id) {
        markAsRead([message.id])
      }
    })

    const unsubscribeSent = onMessageSent(() => {
      queryClient.invalidateQueries({ queryKey: ['messages'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    })

    const unsubscribeTyping = onTyping((data) => {
      if (data.isTyping) {
        setTypingUsers(prev => new Set(prev).add(data.userId))
        // Clear typing after 3 seconds
        setTimeout(() => {
          setTypingUsers(prev => {
            const next = new Set(prev)
            next.delete(data.userId)
            return next
          })
        }, 3000)
      } else {
        setTypingUsers(prev => {
          const next = new Set(prev)
          next.delete(data.userId)
          return next
        })
      }
    })

    return () => {
      unsubscribeNew()
      unsubscribeSent()
      unsubscribeTyping()
    }
  }, [connected, selectedConversation])

  const handleSendMessage = async () => {
    if ((!messageInput.trim() && !selectedMedia) || !selectedConversation || !connected) return

    setSending(true)
    try {
      const content = messageInput.trim() || (selectedMedia ? 'Fichier joint' : '')
      await sendMessage(
        selectedConversation.participant.id,
        content,
        'TEXT',
        selectedMedia?.url
      )
      setMessageInput('')
      setSelectedMedia(null)
      setTyping(selectedConversation.participant.id, false)
    } catch (error) {
      console.error('Failed to send message:', error)
    } finally {
      setSending(false)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Check file type
    const isImage = file.type.startsWith('image/')
    const isVideo = file.type.startsWith('video/')

    if (!isImage && !isVideo) {
      alert('Veuillez sélectionner une image ou une vidéo')
      return
    }

    // Check file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      alert('Le fichier est trop volumineux (max 50MB)')
      return
    }

    setUploadingMedia(true)
    try {
      const response = await mediaApi.upload(
        (() => {
          const formData = new FormData()
          formData.append('file', file)
          return formData
        })(),
        {
          onUploadProgress: (progressEvent: any) => {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            )
            console.log('Upload progress:', percentCompleted)
          },
        }
      )

      setSelectedMedia({
        url: response.data.url,
        type: isImage ? 'image' : 'video',
      })
    } catch (error) {
      console.error('Failed to upload file:', error)
      alert('Échec du téléchargement du fichier')
    } finally {
      setUploadingMedia(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleRemoveMedia = () => {
    setSelectedMedia(null)
  }

  const handleInputChange = (value: string) => {
    setMessageInput(value)

    if (!selectedConversation) return

    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    // Send typing indicator
    setTyping(selectedConversation.participant.id, value.length > 0)

    // Stop typing after 1 second of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      setTyping(selectedConversation.participant.id, false)
    }, 1000)
  }

  return (
    <div className="grid md:grid-cols-[350px_1fr] gap-4 h-[calc(100vh-12rem)]">
      {/* Conversations List */}
      <Card className="p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Messages</h2>
          {connected ? (
            <Badge variant="success">En ligne</Badge>
          ) : (
            <Badge variant="secondary">Hors ligne</Badge>
          )}
        </div>

        {conversationsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : conversations && conversations.length > 0 ? (
          <div className="space-y-2">
            {conversations.map((conv) => {
              const isOnline = onlineUsers.has(conv.participant.id)
              const displayName = conv.participant.creatorProfile?.displayName || conv.participant.username

              return (
                <div
                  key={conv.id}
                  onClick={() => setSelectedConversation(conv)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    selectedConversation?.id === conv.id
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-accent'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      <Avatar>
                        <AvatarImage src={conv.participant.creatorProfile?.profilePicture} />
                        <AvatarFallback>
                          {displayName.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      {isOnline && (
                        <div className="absolute bottom-0 right-0 h-3 w-3 bg-green-500 border-2 border-background rounded-full" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="font-medium truncate">{displayName}</p>
                        {conv.unreadCount > 0 && (
                          <Badge variant="destructive" className="ml-2">
                            {conv.unreadCount}
                          </Badge>
                        )}
                      </div>
                      {conv.lastMessage && (
                        <p className="text-sm text-muted-foreground truncate">
                          {conv.lastMessage.content}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <p>Aucune conversation</p>
          </div>
        )}
      </Card>

      {/* Messages */}
      <Card className="flex flex-col">
        {selectedConversation ? (
          <>
            {/* Header */}
            <div className="p-4 border-b flex items-center space-x-3">
              <div className="relative">
                <Avatar>
                  <AvatarImage src={selectedConversation.participant.creatorProfile?.profilePicture} />
                  <AvatarFallback>
                    {(selectedConversation.participant.creatorProfile?.displayName || selectedConversation.participant.username).substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {onlineUsers.has(selectedConversation.participant.id) && (
                  <div className="absolute bottom-0 right-0 h-3 w-3 bg-green-500 border-2 border-background rounded-full" />
                )}
              </div>
              <div>
                <p className="font-semibold">
                  {selectedConversation.participant.creatorProfile?.displayName || selectedConversation.participant.username}
                </p>
                <p className="text-xs text-muted-foreground">
                  {onlineUsers.has(selectedConversation.participant.id) ? 'En ligne' : 'Hors ligne'}
                </p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messagesLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : messagesData && messagesData.items.length > 0 ? (
                <>
                  {messagesData.items.map((message: Message) => {
                    const isOwn = message.senderId === user?.id

                    return (
                      <div
                        key={message.id}
                        className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[70%] rounded-lg overflow-hidden ${
                            isOwn
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted'
                          }`}
                        >
                          {message.hasAttachment && message.attachmentUrl && (
                            <div className="mb-2">
                              {message.attachmentUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                                <img
                                  src={message.attachmentUrl}
                                  alt="Attachment"
                                  className="max-w-full h-auto rounded cursor-pointer"
                                  onClick={() => window.open(message.attachmentUrl, '_blank')}
                                />
                              ) : (
                                <video
                                  src={message.attachmentUrl}
                                  controls
                                  className="max-w-full h-auto rounded"
                                />
                              )}
                            </div>
                          )}
                          <div className="p-3">
                            {message.content && (
                              <p className="text-sm">{message.content}</p>
                            )}
                            <p className="text-xs opacity-70 mt-1">
                              {formatDistanceToNow(new Date(message.createdAt), {
                                addSuffix: true,
                                locale: fr,
                              })}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {typingUsers.has(selectedConversation.participant.id) && (
                    <div className="flex justify-start">
                      <div className="bg-muted rounded-lg p-3">
                        <div className="flex space-x-1">
                          <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" />
                          <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce delay-100" />
                          <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce delay-200" />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p>Aucun message</p>
                  <p className="text-sm mt-2">Commencez la conversation</p>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-4 border-t space-y-2">
              {/* Media Preview */}
              {selectedMedia && (
                <div className="relative inline-block">
                  {selectedMedia.type === 'image' ? (
                    <img
                      src={selectedMedia.url}
                      alt="Preview"
                      className="max-h-32 rounded border"
                    />
                  ) : (
                    <div className="flex items-center gap-2 p-3 bg-muted rounded border">
                      <FileVideo className="h-6 w-6" />
                      <span className="text-sm">Vidéo sélectionnée</span>
                    </div>
                  )}
                  <button
                    onClick={handleRemoveMedia}
                    className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 hover:bg-destructive/90"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleSendMessage()
                }}
                className="flex space-x-2"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingMedia || sending || !connected}
                >
                  {uploadingMedia ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImageIcon className="h-4 w-4" />
                  )}
                </Button>
                <Input
                  placeholder="Tapez votre message..."
                  value={messageInput}
                  onChange={(e) => handleInputChange(e.target.value)}
                  disabled={sending || !connected}
                  className="flex-1"
                />
                <Button
                  type="submit"
                  disabled={sending || !connected || (!messageInput.trim() && !selectedMedia)}
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <p>Sélectionnez une conversation</p>
          </div>
        )}
      </Card>
    </div>
  )
}
