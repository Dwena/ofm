'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { socialApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  MessageCircle,
  Send,
  Trash2,
  Edit,
  MoreVertical,
  Loader2,
  AlertCircle
} from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { formatRelativeTime } from '@/lib/utils'

interface Comment {
  id: string
  text: string
  userId: string
  contentId: string
  createdAt: string
  updatedAt: string
  user: {
    id: string
    username: string
    displayName?: string
    avatar?: string
  }
}

interface CommentsSectionProps {
  contentId: string
  initialCount?: number
}

export default function CommentsSection({ contentId, initialCount = 0 }: CommentsSectionProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [commentText, setCommentText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  // Fetch comments
  const { data: commentsData, isLoading } = useQuery({
    queryKey: ['comments', contentId, page],
    queryFn: async () => {
      const response = await socialApi.getComments(contentId, page, 10)
      return response.data
    },
  })

  const comments = commentsData?.data || []
  const pagination = commentsData?.pagination

  // Create comment mutation
  const createCommentMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await socialApi.createComment(contentId, text)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', contentId] })
      setCommentText('')
    },
  })

  // Update comment mutation
  const updateCommentMutation = useMutation({
    mutationFn: async ({ commentId, text }: { commentId: string; text: string }) => {
      const response = await socialApi.updateComment(commentId, text)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', contentId] })
      setEditingId(null)
      setEditText('')
    },
  })

  // Delete comment mutation
  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: string) => {
      await socialApi.deleteComment(commentId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', contentId] })
    },
  })

  const handlePostComment = () => {
    if (!commentText.trim()) return
    createCommentMutation.mutate(commentText)
  }

  const handleEditComment = (comment: Comment) => {
    setEditingId(comment.id)
    setEditText(comment.text)
  }

  const handleSaveEdit = (commentId: string) => {
    if (!editText.trim()) return
    updateCommentMutation.mutate({ commentId, text: editText })
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  const handleDeleteComment = (commentId: string) => {
    if (confirm('Êtes-vous sûr de vouloir supprimer ce commentaire ?')) {
      deleteCommentMutation.mutate(commentId)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Commentaires
            {pagination && (
              <Badge variant="secondary">{pagination.total}</Badge>
            )}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add Comment Form */}
        {user && (
          <div className="space-y-2">
            <div className="flex gap-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={user.avatar} alt={user.username} />
                <AvatarFallback>
                  {user.username.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-2">
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Ajouter un commentaire..."
                  maxLength={500}
                  className="w-full min-h-[80px] px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      handlePostComment()
                    }
                  }}
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {commentText.length}/500 • Ctrl+Entrée pour publier
                  </p>
                  <Button
                    size="sm"
                    onClick={handlePostComment}
                    disabled={!commentText.trim() || createCommentMutation.isPending}
                  >
                    {createCommentMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Publication...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-2" />
                        Publier
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {createCommentMutation.isError && (
              <div className="flex items-center gap-2 text-red-600 text-sm p-2 bg-red-50 rounded">
                <AlertCircle className="h-4 w-4" />
                <span>
                  {(createCommentMutation.error as any)?.response?.data?.message || 'Erreur lors de la publication'}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Comments List */}
        {isLoading ? (
          <div className="text-center py-8">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          </div>
        ) : comments.length > 0 ? (
          <div className="space-y-4">
            {comments.map((comment: Comment) => (
              <div key={comment.id} className="flex gap-3 group">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={comment.user.avatar} alt={comment.user.username} />
                  <AvatarFallback>
                    {comment.user.username.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">
                      {comment.user.displayName || comment.user.username}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      @{comment.user.username}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      •
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(new Date(comment.createdAt))}
                    </span>
                    {comment.updatedAt !== comment.createdAt && (
                      <span className="text-xs text-muted-foreground italic">
                        (modifié)
                      </span>
                    )}
                  </div>

                  {editingId === comment.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        maxLength={500}
                        className="w-full min-h-[60px] px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCancelEdit}
                        >
                          Annuler
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleSaveEdit(comment.id)}
                          disabled={!editText.trim() || updateCommentMutation.isPending}
                        >
                          {updateCommentMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            'Enregistrer'
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm whitespace-pre-wrap break-words">
                        {comment.text}
                      </p>

                      {/* Comment Actions */}
                      {user && comment.userId === user.id && (
                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditComment(comment)}
                            className="h-7 text-xs"
                          >
                            <Edit className="h-3 w-3 mr-1" />
                            Modifier
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteComment(comment.id)}
                            disabled={deleteCommentMutation.isPending}
                            className="h-7 text-xs text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Supprimer
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <MessageCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">
              Aucun commentaire pour le moment
            </p>
            {user && (
              <p className="text-sm text-muted-foreground mt-2">
                Soyez le premier à commenter !
              </p>
            )}
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              Page {pagination.page} sur {pagination.totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Précédent
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={page >= pagination.totalPages}
              >
                Suivant
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
