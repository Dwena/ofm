'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Image as ImageIcon, Video, FileText } from 'lucide-react';
import axios from 'axios';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Content {
  id: string;
  title: string;
  description: string;
  type: string;
  status: string;
  createdAt: string;
  user: {
    username: string;
    displayName: string;
    avatar: string;
  };
  moderationNotes?: string;
}

export function ContentModeration() {
  const { data, isLoading } = useQuery({
    queryKey: ['content-moderation'],
    queryFn: async () => {
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL}/content/moderation/queue`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('access_token')}`,
          },
        }
      );
      return response.data;
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
          {data?.content?.length || 0} contenus en attente de modération
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {data?.content?.length === 0 ? (
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
                          <span>Par @{content.user.username}</span>
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
                          <Button size="sm" variant="default">
                            Approuver
                          </Button>
                          <Button size="sm" variant="destructive">
                            Rejeter
                          </Button>
                          <Button size="sm" variant="outline">
                            Voir le détail
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
