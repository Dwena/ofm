'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Image as ImageIcon, Video, FileText } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Content {
  id: string;
  title: string;
  description: string;
  type: string;
  status: string;
  createdAt: string;
  pendingReports?: number;
  creator: {
    username: string;
    displayName: string;
    avatar: string;
  };
  moderationNotes?: string;
}

export function ContentModeration() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const decisionMutation = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      approve ? adminApi.restoreContent(id, 'Approuvé par la modération') : adminApi.removeContent(id),
    onSuccess: (_data, { approve }) => {
      queryClient.invalidateQueries({ queryKey: ['content-moderation'] });
      queryClient.invalidateQueries({ queryKey: ['admin-content'] });
      toast({ title: approve ? 'Contenu approuvé' : 'Contenu retiré' });
    },
    onError: (error: any) => {
      toast({
        title: 'Erreur',
        description: error?.response?.data?.message || 'Action impossible',
        variant: 'destructive',
      });
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['content-moderation'],
    queryFn: async () => {
      const response = await adminApi.getContent({ filter: 'FLAGGED', limit: 50 });
      return { content: response.data?.items ?? [], total: response.data?.pagination?.total ?? 0 };
    },
  });

  const getContentIcon = (type: string) => {
    switch (type) {
      case 'PHOTO':
        return <ImageIcon className="h-5 w-5" />;
      case 'VIDEO':
        return <Video className="h-5 w-5" />;
      default:
        return <FileText className="h-5 w-5" />;
    }
  };

  if (isLoading) {
    return <div>Chargement...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contenus en révision</CardTitle>
        <CardDescription>
          {data?.total || 0} contenus en attente de modération
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {!data?.content?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              Aucun contenu en attente de révision
            </div>
          ) : (
            data?.content?.map((content: Content) => (
              <Card key={content.id} className="border-l-4 border-l-blue-500">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4 flex-1">
                      {getContentIcon(content.type)}

                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{content.title}</span>
                          <Badge variant="outline">{content.type}</Badge>
                          {content.status === 'UNDER_REVIEW' && (
                            <Badge className="bg-orange-500 text-white">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              En révision
                            </Badge>
                          )}
                        </div>

                        {content.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {content.description}
                          </p>
                        )}

                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>Par @{content.creator?.username}</span>
                          {!!content.pendingReports && (
                            <span>{content.pendingReports} signalement(s) en attente</span>
                          )}
                          <span>
                            {formatDistanceToNow(new Date(content.createdAt), {
                              addSuffix: true,
                              locale: fr,
                            })}
                          </span>
                        </div>

                        {content.moderationNotes && (
                          <div className="p-2 bg-yellow-50 border border-yellow-200 rounded text-sm">
                            <strong>Notes:</strong> {content.moderationNotes}
                          </div>
                        )}

                        <div className="flex gap-2 pt-2">
                          {content.status === 'UNDER_REVIEW' && (
                            <Button
                              size="sm"
                              variant="default"
                              disabled={decisionMutation.isPending}
                              onClick={() => decisionMutation.mutate({ id: content.id, approve: true })}
                            >
                              Approuver
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={decisionMutation.isPending}
                            onClick={() => decisionMutation.mutate({ id: content.id, approve: false })}
                          >
                            Retirer
                          </Button>
                          <Button size="sm" variant="outline" asChild>
                            <Link href="/admin/content">Voir le détail</Link>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
