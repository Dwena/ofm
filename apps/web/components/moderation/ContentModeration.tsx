'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ExternalLink, Image as ImageIcon, Loader2, Video, FileText } from 'lucide-react';
import { adminApi } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  ReasonDialog,
  getErrorMessage,
  timeAgo,
} from '@/components/admin/admin-shared';

interface Content {
  id: string;
  title?: string | null;
  description?: string | null;
  type: string;
  status: string;
  createdAt: string;
  pendingReports?: number;
  creator: {
    id: string;
    username: string;
    displayName?: string | null;
    avatar?: string | null;
  };
  moderationNotes?: string | null;
}

const typeLabels: Record<string, string> = {
  PHOTO: 'Photo',
  VIDEO: 'Vidéo',
  AUDIO: 'Audio',
  TEXT: 'Texte',
  ALBUM: 'Album',
};

const PAGE_SIZE = 20;

/**
 * « Contenus » tab of /admin/moderation: content under review or with pending reports.
 * Admin-only (the API refuses moderators with 403).
 */
export function ContentModeration() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [removeTarget, setRemoveTarget] = useState<Content | null>(null);
  const [reason, setReason] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['content-moderation'],
    queryFn: async () => {
      const response = await adminApi.getContent({ filter: 'FLAGGED', limit: PAGE_SIZE });
      return {
        content: (response.data?.items ?? []) as Content[],
        total: (response.data?.pagination?.total ?? 0) as number,
      };
    },
  });

  const decisionMutation = useMutation({
    mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note?: string }) =>
      approve ? adminApi.restoreContent(id, 'Approuvé par la modération') : adminApi.removeContent(id, note),
    onSuccess: (_data, { approve }) => {
      queryClient.invalidateQueries({ queryKey: ['content-moderation'] });
      queryClient.invalidateQueries({ queryKey: ['admin-content'] });
      queryClient.invalidateQueries({ queryKey: ['moderation-stats'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
      toast({ title: approve ? 'Contenu approuvé' : 'Contenu retiré', description: 'Le créateur a été notifié.' });
      setRemoveTarget(null);
    },
    onError: (err) => {
      toast({ title: 'Action impossible', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  const approve = async (content: Content) => {
    const ok = await confirm({
      title: 'Approuver ce contenu ?',
      description: `« ${content.title || 'Sans titre'} » de @${content.creator?.username} sera publié à nouveau.`,
      confirmText: 'Approuver',
    });
    if (ok) decisionMutation.mutate({ id: content.id, approve: true });
  };

  const getContentIcon = (type: string) => {
    switch (type) {
      case 'PHOTO':
        return <ImageIcon className="h-5 w-5 flex-shrink-0" />;
      case 'VIDEO':
        return <Video className="h-5 w-5 flex-shrink-0" />;
      default:
        return <FileText className="h-5 w-5 flex-shrink-0" />;
    }
  };

  const pendingId = decisionMutation.isPending ? decisionMutation.variables?.id : null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Contenus en révision</CardTitle>
          <CardDescription>
            {data?.total || 0} contenu(s) signalé(s) ou en attente de modération
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} label="Impossible de charger les contenus" />
          ) : !data?.content.length ? (
            <EmptyState>Aucun contenu en attente de révision</EmptyState>
          ) : (
            <div className="space-y-4">
              {data.content.map((content) => (
                <Card key={content.id} className="border-l-4 border-l-blue-500">
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-4">
                      {getContentIcon(content.type)}

                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium break-words">{content.title || 'Sans titre'}</span>
                          <Badge variant="outline">{typeLabels[content.type] || content.type}</Badge>
                          {content.status === 'UNDER_REVIEW' && (
                            <Badge className="bg-orange-500 text-white">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              En révision
                            </Badge>
                          )}
                        </div>

                        {content.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">{content.description}</p>
                        )}

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>Par @{content.creator?.username}</span>
                          {!!content.pendingReports && (
                            <span>{content.pendingReports} signalement(s) en attente</span>
                          )}
                          <span>{timeAgo(content.createdAt)}</span>
                        </div>

                        {content.moderationNotes && (
                          <div className="p-2 bg-yellow-50 border border-yellow-200 rounded text-sm dark:bg-yellow-950/30 dark:border-yellow-900">
                            <strong>Notes :</strong> {content.moderationNotes}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 pt-2">
                          {content.status === 'UNDER_REVIEW' && (
                            <Button
                              size="sm"
                              variant="default"
                              disabled={!!pendingId}
                              onClick={() => approve(content)}
                            >
                              {pendingId === content.id && decisionMutation.variables?.approve && (
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              )}
                              Approuver
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={!!pendingId}
                            onClick={() => {
                              setReason('');
                              setRemoveTarget(content);
                            }}
                          >
                            Retirer
                          </Button>
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/content/${content.id}`} target="_blank">
                              <ExternalLink className="h-4 w-4 mr-1" />
                              Voir le contenu
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {data.total > data.content.length && (
                <Button variant="link" asChild className="px-0">
                  <Link href="/admin/content?filter=FLAGGED">
                    Voir les {data.total} contenus dans la page Contenus
                  </Link>
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {removeTarget && (
        <ReasonDialog
          open={!!removeTarget}
          onOpenChange={(open) => !open && !decisionMutation.isPending && setRemoveTarget(null)}
          title="Retirer le contenu"
          description={`« ${removeTarget.title || 'Sans titre'} » de @${removeTarget.creator?.username}. Le créateur sera notifié.`}
          confirmLabel="Retirer"
          destructive
          reason={reason}
          onReasonChange={setReason}
          reasonLabel="Raison (envoyée au créateur)"
          isPending={decisionMutation.isPending}
          onConfirm={() => decisionMutation.mutate({ id: removeTarget.id, approve: false, note: reason.trim() })}
        />
      )}
    </>
  );
}
