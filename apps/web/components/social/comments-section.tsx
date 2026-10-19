'use client'

import { useState } from 'react'
import { InfiniteData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { socialApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  MessageCircle,
  Send,
  Trash2,
  Edit,
  MoreVertical,
  Loader2,
  AlertCircle,
  Flag,
} from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { useConfirm } from '@/hooks/use-confirm'
import { toast } from '@/hooks/use-toast'
import { patchContentCaches } from '@/hooks/use-content-actions'
import ReportDialog, { ReportTarget } from '@/components/social/report-dialog'
import { formatRelativeTime } from '@/lib/utils'

const MAX_LENGTH = 500
const PAGE_SIZE = 10

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
    displayName?: string | null
    avatar?: string | null
  }
}

interface CommentsPage {
  items: Comment[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

interface CommentsSectionProps {
  contentId: string
  /** The content's creator can moderate (delete) every comment */
  contentCreatorId?: string
  initialCount?: number
}

const errorMessage = (error: any, fallback: string) => {
  const message = error?.response?.data?.message
  return (Array.isArray(message) ? message[0] : message) || fallback
}

// The API bumps updatedAt on edit only; ignore sub-second drift from creation
const isEdited = (comment: Comment) =>
  new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 1000

export default function CommentsSection({ contentId, contentCreatorId, initialCount = 0 }: CommentsSectionProps) {
  const { user } = useAuth()
  const { confirm } = useConfirm()
  const queryClient = useQueryClient()
  const [commentText, setCommentText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null)
  const queryKey = ['comments', contentId]

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const response = await socialApi.getComments(contentId, pageParam, PAGE_SIZE)
      return response.data as CommentsPage
    },
    getNextPageParam: (lastPage) =>
      lastPage.pagination.page < lastPage.pagination.totalPages ? lastPage.pagination.page + 1 : undefined,
  })

  // Pages are offset-based: drop duplicates when a comment was added meanwhile
  const comments: Comment[] = []
  const seen = new Set<string>()
  for (const page of data?.pages ?? []) {
    for (const comment of page.items) {
      if (!seen.has(comment.id)) {
        seen.add(comment.id)
        comments.push(comment)
      }
    }
  }
  const total = data?.pages[0]?.pagination.total ?? initialCount

  const updateCommentInCache = (commentId: string, updater: (comment: Comment) => Comment | null) => {
    queryClient.setQueryData<InfiniteData<CommentsPage>>(queryKey, (current) => {
      if (!current) return current
      return {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          items: page.items.flatMap((comment) => {
            if (comment.id !== commentId) return [comment]
            const next = updater(comment)
            return next ? [next] : []
          }),
        })),
      }
    })
  }

  const createCommentMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await socialApi.createComment(contentId, text)
      return response.data as Comment
    },
    onSuccess: () => {
      setCommentText('')
      patchContentCaches(queryClient, contentId, { commentDelta: 1 })
      // Newest first: reload from the first page
      queryClient.resetQueries({ queryKey })
    },
  })

  const updateCommentMutation = useMutation({
    mutationFn: async ({ commentId, text }: { commentId: string; text: string }) => {
      const response = await socialApi.updateComment(commentId, text)
      return response.data as Comment
    },
    onSuccess: (updated) => {
      updateCommentInCache(updated.id, (comment) => ({ ...comment, ...updated }))
      setEditingId(null)
      setEditText('')
    },
    onError: (error: any) => {
      toast({
        title: 'Modification impossible',
        description: errorMessage(error, 'Le commentaire n’a pas pu être modifié.'),
        variant: 'destructive',
      })
    },
  })

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: string) => {
      await socialApi.deleteComment(commentId)
      return commentId
    },
    onSuccess: (commentId) => {
      updateCommentInCache(commentId, () => null)
      patchContentCaches(queryClient, contentId, { commentDelta: -1 })
      queryClient.setQueryData<InfiniteData<CommentsPage>>(queryKey, (current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                pagination: { ...page.pagination, total: Math.max(0, page.pagination.total - 1) },
              })),
            }
          : current,
      )
      toast({ title: 'Commentaire supprimé' })
    },
    onError: (error: any) => {
      toast({
        title: 'Suppression impossible',
        description: errorMessage(error, 'Le commentaire n’a pas pu être supprimé.'),
        variant: 'destructive',
      })
    },
  })

  const handlePostComment = () => {
    const text = commentText.trim()
    if (!text || createCommentMutation.isPending) return
    createCommentMutation.mutate(text)
  }

  const handleEditComment = (comment: Comment) => {
    setEditingId(comment.id)
    setEditText(comment.text)
  }

  const handleSaveEdit = (comment: Comment) => {
    const text = editText.trim()
    if (!text) return
    if (text === comment.text) {
      handleCancelEdit()
      return
    }
    updateCommentMutation.mutate({ commentId: comment.id, text })
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  const handleDeleteComment = async (comment: Comment) => {
    const ok = await confirm({
      title: 'Supprimer ce commentaire ?',
      description:
        comment.userId === user?.id
          ? 'Votre commentaire sera définitivement supprimé.'
          : `Le commentaire de @${comment.user.username} sera retiré de votre publication.`,
      confirmText: 'Supprimer',
      variant: 'destructive',
    })
    if (!ok) return
    deleteCommentMutation.mutate(comment.id)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5" />
          Commentaires
          <Badge variant="secondary">{total}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add Comment Form */}
        {user && (
          <div className="space-y-2">
            <div className="flex gap-3">
              <Avatar className="h-10 w-10 hidden sm:flex">
                <AvatarImage src={user.avatar ?? undefined} alt={user.username} />
                <AvatarFallback>{user.username.substring(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-2 min-w-0">
                <textarea
                  value={commentText}
                  onChange={(e) => {
                    setCommentText(e.target.value)
                    if (createCommentMutation.isError) createCommentMutation.reset()
                  }}
                  placeholder="Ajouter un commentaire..."
                  maxLength={MAX_LENGTH}
                  aria-label="Votre commentaire"
                  className="w-full min-h-[80px] px-3 py-2 text-sm bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      handlePostComment()
                    }
                  }}
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {commentText.length}/{MAX_LENGTH}
                    <span className="hidden sm:inline"> • Ctrl+Entrée pour publier</span>
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
              <div className="flex items-center gap-2 text-destructive text-sm p-2 bg-destructive/10 rounded">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{errorMessage(createCommentMutation.error, 'Erreur lors de la publication')}</span>
              </div>
            )}
          </div>
        )}

        {/* Comments List */}
        {isLoading ? (
          <div className="text-center py-8">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="text-center py-6 space-y-3">
            <p className="text-sm text-muted-foreground">Impossible de charger les commentaires.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Réessayer
            </Button>
          </div>
        ) : comments.length > 0 ? (
          <div className="space-y-4">
            {comments.map((comment) => {
              const isAuthor = !!user && comment.userId === user.id
              const canDelete = isAuthor || (!!user && user.id === contentCreatorId)
              const name = comment.user.displayName || comment.user.username
              return (
                <div key={comment.id} className="flex gap-3">
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarImage src={comment.user.avatar ?? undefined} alt={comment.user.username} />
                    <AvatarFallback>{comment.user.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>

                  <div className="flex-1 space-y-1 min-w-0">
                    <div className="flex items-start gap-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0 flex-1">
                        <span className="font-medium text-sm truncate">{name}</span>
                        <span className="text-xs text-muted-foreground truncate">@{comment.user.username}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(comment.createdAt)}
                        </span>
                        {isEdited(comment) && (
                          <span className="text-xs text-muted-foreground italic">(modifié)</span>
                        )}
                      </div>

                      {user && editingId !== comment.id && (
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 flex-shrink-0"
                              aria-label="Actions du commentaire"
                              disabled={deleteCommentMutation.isPending && deleteCommentMutation.variables === comment.id}
                            >
                              {deleteCommentMutation.isPending && deleteCommentMutation.variables === comment.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <MoreVertical className="h-4 w-4" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {isAuthor && (
                              <DropdownMenuItem onSelect={() => handleEditComment(comment)}>
                                <Edit className="h-4 w-4 mr-2" />
                                Modifier
                              </DropdownMenuItem>
                            )}
                            {canDelete && (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => handleDeleteComment(comment)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Supprimer
                              </DropdownMenuItem>
                            )}
                            {!isAuthor && (
                              <DropdownMenuItem
                                onSelect={() => setReportTarget({ type: 'COMMENT', id: comment.id })}
                              >
                                <Flag className="h-4 w-4 mr-2" />
                                Signaler
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>

                    {editingId === comment.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          maxLength={MAX_LENGTH}
                          autoFocus
                          aria-label="Modifier le commentaire"
                          className="w-full min-h-[60px] px-3 py-2 text-sm bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') handleCancelEdit()
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                              e.preventDefault()
                              handleSaveEdit(comment)
                            }
                          }}
                        />
                        {!editText.trim() && (
                          <p className="text-xs text-destructive">Le commentaire ne peut pas être vide</p>
                        )}
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleCancelEdit}
                            disabled={updateCommentMutation.isPending}
                          >
                            Annuler
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleSaveEdit(comment)}
                            disabled={!editText.trim() || updateCommentMutation.isPending}
                          >
                            {updateCommentMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Enregistrer
                          </Button>
                          <span className="text-xs text-muted-foreground ml-auto">
                            {editText.length}/{MAX_LENGTH}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap break-words">{comment.text}</p>
                    )}
                  </div>
                </div>
              )
            })}

            {hasNextPage && (
              <div className="text-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Voir plus de commentaires
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <MessageCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground">Aucun commentaire pour le moment</p>
            {user && <p className="text-sm text-muted-foreground mt-2">Soyez le premier à commenter !</p>}
          </div>
        )}
      </CardContent>

      <ReportDialog target={reportTarget} onClose={() => setReportTarget(null)} />
    </Card>
  )
}
