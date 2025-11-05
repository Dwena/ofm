'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Ban, Clock, CheckCircle, Search, AlertTriangle } from 'lucide-react';
import axios from 'axios';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface User {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatar: string;
  status: string;
  role: string;
  createdAt: string;
  bannedAt?: string;
  banReason?: string;
  suspendedUntil?: string;
  suspensionReason?: string;
}

export function UserModeration() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [dialogType, setDialogType] = useState<'ban' | 'suspend' | 'unsuspend' | null>(null);
  const [reason, setReason] = useState('');
  const [durationDays, setDurationDays] = useState(7);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch users
  const { data: usersData, isLoading } = useQuery({
    queryKey: ['admin-users', searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);

      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/users?${params}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('access_token')}`,
          },
        }
      );
      return response.data;
    },
  });

  // Ban user mutation
  const banUserMutation = useMutation({
    mutationFn: async ({ userId, reason }: any) => {
      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/moderation/users/${userId}/ban`,
        { reason },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('access_token')}`,
          },
        }
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast({
        title: 'Utilisateur banni',
        description: 'L\'utilisateur a été banni avec succès',
      });
      closeDialog();
    },
    onError: () => {
      toast({
        title: 'Erreur',
        description: 'Impossible de bannir l\'utilisateur',
        variant: 'destructive',
      });
    },
  });

  // Suspend user mutation
  const suspendUserMutation = useMutation({
    mutationFn: async ({ userId, reason, durationDays }: any) => {
      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/moderation/users/${userId}/suspend`,
        { reason, durationDays },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('access_token')}`,
          },
        }
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast({
        title: 'Utilisateur suspendu',
        description: 'L\'utilisateur a été suspendu avec succès',
      });
      closeDialog();
    },
    onError: () => {
      toast({
        title: 'Erreur',
        description: 'Impossible de suspendre l\'utilisateur',
        variant: 'destructive',
      });
    },
  });

  // Unsuspend user mutation
  const unsuspendUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/moderation/users/${userId}/unsuspend`,
        {},
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('access_token')}`,
          },
        }
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast({
        title: 'Suspension levée',
        description: 'La suspension a été levée avec succès',
      });
      closeDialog();
    },
    onError: () => {
      toast({
        title: 'Erreur',
        description: 'Impossible de lever la suspension',
        variant: 'destructive',
      });
    },
  });

  const openDialog = (user: User, type: 'ban' | 'suspend' | 'unsuspend') => {
    setSelectedUser(user);
    setDialogType(type);
    setReason('');
    setDurationDays(7);
  };

  const closeDialog = () => {
    setSelectedUser(null);
    setDialogType(null);
    setReason('');
  };

  const confirmAction = () => {
    if (!selectedUser) return;

    if (dialogType === 'ban') {
      if (!reason.trim()) {
        toast({
          title: 'Erreur',
          description: 'Veuillez fournir une raison',
          variant: 'destructive',
        });
        return;
      }
      banUserMutation.mutate({ userId: selectedUser.id, reason });
    } else if (dialogType === 'suspend') {
      if (!reason.trim()) {
        toast({
          title: 'Erreur',
          description: 'Veuillez fournir une raison',
          variant: 'destructive',
        });
        return;
      }
      suspendUserMutation.mutate({
        userId: selectedUser.id,
        reason,
        durationDays,
      });
    } else if (dialogType === 'unsuspend') {
      unsuspendUserMutation.mutate(selectedUser.id);
    }
  };

  const getStatusBadge = (status: string) => {
    const config = {
      ACTIVE: { color: 'bg-green-500', label: 'Actif' },
      SUSPENDED: { color: 'bg-yellow-500', label: 'Suspendu' },
      BANNED: { color: 'bg-red-500', label: 'Banni' },
      PENDING_VERIFICATION: { color: 'bg-blue-500', label: 'En attente' },
    };

    const { color, label } = config[status as keyof typeof config] || {
      color: 'bg-gray-500',
      label: status,
    };

    return <Badge className={`${color} text-white`}>{label}</Badge>;
  };

  if (isLoading) {
    return <div>Chargement...</div>;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Gestion des utilisateurs</CardTitle>
              <CardDescription>
                Modérer les utilisateurs de la plateforme
              </CardDescription>
            </div>
            <div className="flex gap-2 items-center">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Rechercher un utilisateur..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 w-[300px]"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {usersData?.users?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Aucun utilisateur trouvé
              </div>
            ) : (
              usersData?.users?.map((user: User) => (
                <Card key={user.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-4">
                        <Avatar className="h-12 w-12">
                          <AvatarImage src={user.avatar} />
                          <AvatarFallback>
                            {user.displayName?.[0] || 'U'}
                          </AvatarFallback>
                        </Avatar>

                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-lg">
                              {user.displayName || user.username}
                            </span>
                            {getStatusBadge(user.status)}
                            <Badge variant="outline">{user.role}</Badge>
                          </div>

                          <p className="text-sm text-muted-foreground">
                            @{user.username}
                          </p>

                          <p className="text-sm text-muted-foreground">
                            {user.email}
                          </p>

                          <p className="text-xs text-muted-foreground">
                            Inscrit {formatDistanceToNow(new Date(user.createdAt), {
                              addSuffix: true,
                              locale: fr,
                            })}
                          </p>

                          {user.status === 'SUSPENDED' && user.suspendedUntil && (
                            <div className="flex items-center gap-1 text-sm text-yellow-600">
                              <Clock className="h-4 w-4" />
                              <span>
                                Suspendu jusqu'au{' '}
                                {new Date(user.suspendedUntil).toLocaleDateString('fr-FR')}
                              </span>
                            </div>
                          )}

                          {user.status === 'SUSPENDED' && user.suspensionReason && (
                            <p className="text-sm text-muted-foreground">
                              Raison: {user.suspensionReason}
                            </p>
                          )}

                          {user.status === 'BANNED' && user.banReason && (
                            <p className="text-sm text-red-600">
                              Raison du bannissement: {user.banReason}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {user.status === 'ACTIVE' && user.role !== 'ADMIN' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openDialog(user, 'suspend')}
                            >
                              <Clock className="h-4 w-4 mr-1" />
                              Suspendre
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => openDialog(user, 'ban')}
                            >
                              <Ban className="h-4 w-4 mr-1" />
                              Bannir
                            </Button>
                          </>
                        )}

                        {user.status === 'SUSPENDED' && (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => openDialog(user, 'unsuspend')}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Lever la suspension
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Action Dialog */}
      <Dialog open={dialogType !== null} onOpenChange={() => closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogType === 'ban' && 'Bannir l\'utilisateur'}
              {dialogType === 'suspend' && 'Suspendre l\'utilisateur'}
              {dialogType === 'unsuspend' && 'Lever la suspension'}
            </DialogTitle>
            <DialogDescription>
              {dialogType === 'ban' &&
                'Cette action bannira définitivement l\'utilisateur de la plateforme.'}
              {dialogType === 'suspend' &&
                'Cette action suspendra temporairement l\'utilisateur.'}
              {dialogType === 'unsuspend' &&
                'Cette action lèvera la suspension de l\'utilisateur.'}
            </DialogDescription>
          </DialogHeader>

          {dialogType !== 'unsuspend' && (
            <div className="space-y-4">
              {dialogType === 'suspend' && (
                <div className="space-y-2">
                  <Label>Durée (jours)</Label>
                  <Input
                    type="number"
                    value={durationDays}
                    onChange={(e) => setDurationDays(parseInt(e.target.value))}
                    min={1}
                    max={365}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>Raison *</Label>
                <Textarea
                  placeholder="Expliquez la raison de cette action..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={4}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Annuler
            </Button>
            <Button
              onClick={confirmAction}
              variant={dialogType === 'ban' ? 'destructive' : 'default'}
              disabled={dialogType !== 'unsuspend' && !reason.trim()}
            >
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
