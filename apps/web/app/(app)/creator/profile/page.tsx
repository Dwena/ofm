'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi, mediaApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Upload, User, Settings, DollarSign, Shield } from 'lucide-react';

export default function CreatorProfilePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);

  // Fetch user profile
  const { data: user, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const response = await usersApi.getMe();
      return response.data;
    },
  });

  // Profile update mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await usersApi.updateProfile(data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      toast({
        title: 'Profil mis à jour',
        description: 'Vos modifications ont été enregistrées avec succès.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Erreur',
        description: error.response?.data?.message || 'Impossible de mettre à jour le profil',
        variant: 'destructive',
      });
    },
  });

  // Avatar upload handler
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner une image',
        variant: 'destructive',
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: 'Erreur',
        description: 'L\'image ne doit pas dépasser 5 MB',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await mediaApi.uploadImage(formData);
      const avatarUrl = response.data.url;

      await updateProfileMutation.mutateAsync({ avatar: avatarUrl });
    } catch (error: any) {
      toast({
        title: 'Erreur',
        description: 'Impossible de télécharger l\'image',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Cover photo upload handler
  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner une image',
        variant: 'destructive',
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: 'Erreur',
        description: 'L\'image ne doit pas dépasser 10 MB',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await mediaApi.uploadImage(formData);
      const coverPhotoUrl = response.data.url;

      await updateProfileMutation.mutateAsync({ coverPhoto: coverPhotoUrl });
    } catch (error: any) {
      toast({
        title: 'Erreur',
        description: 'Impossible de télécharger l\'image',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Form submission
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const data = {
      displayName: formData.get('displayName') as string,
      bio: formData.get('bio') as string,
      location: formData.get('location') as string,
      website: formData.get('website') as string,
      // Creator profile fields
      welcomeMessage: formData.get('welcomeMessage') as string,
      minimumTip: parseFloat(formData.get('minimumTip') as string) || 5,
      allowMessages: formData.get('allowMessages') === 'on',
      allowTips: formData.get('allowTips') === 'on',
      autoAcceptSubscribers: formData.get('autoAcceptSubscribers') === 'on',
    };

    await updateProfileMutation.mutateAsync(data);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container max-w-5xl py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Modifier mon profil</h1>
        <p className="text-muted-foreground mt-2">
          Personnalisez votre profil pour attirer plus d'abonnés
        </p>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">
            <User className="h-4 w-4 mr-2" />
            Profil
          </TabsTrigger>
          <TabsTrigger value="creator">
            <Settings className="h-4 w-4 mr-2" />
            Paramètres créateur
          </TabsTrigger>
          <TabsTrigger value="monetization">
            <DollarSign className="h-4 w-4 mr-2" />
            Monétisation
          </TabsTrigger>
        </TabsList>

        <form onSubmit={handleSubmit}>
          <TabsContent value="profile" className="space-y-6">
            {/* Cover Photo */}
            <Card>
              <CardHeader>
                <CardTitle>Photo de couverture</CardTitle>
                <CardDescription>
                  Image d'arrière-plan de votre profil (recommandé : 1500x500px)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {user?.coverPhoto && (
                    <div className="relative w-full h-48 rounded-lg overflow-hidden bg-muted">
                      <img
                        src={user.coverPhoto}
                        alt="Cover"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <div>
                    <Label htmlFor="cover-upload" className="cursor-pointer">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                        <Upload className="h-4 w-4" />
                        {isUploading ? 'Téléchargement...' : 'Changer la photo de couverture'}
                      </div>
                    </Label>
                    <Input
                      id="cover-upload"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleCoverUpload}
                      disabled={isUploading}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Avatar */}
            <Card>
              <CardHeader>
                <CardTitle>Photo de profil</CardTitle>
                <CardDescription>
                  Votre avatar visible partout sur la plateforme
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  <Avatar className="h-24 w-24">
                    <AvatarImage src={user?.avatar} alt={user?.displayName} />
                    <AvatarFallback>
                      {user?.displayName?.charAt(0) || user?.username?.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <Label htmlFor="avatar-upload" className="cursor-pointer">
                      <Button type="button" variant="outline" disabled={isUploading} asChild>
                        <span>
                          <Upload className="h-4 w-4 mr-2" />
                          {isUploading ? 'Téléchargement...' : 'Changer l\'avatar'}
                        </span>
                      </Button>
                    </Label>
                    <Input
                      id="avatar-upload"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarUpload}
                      disabled={isUploading}
                    />
                    <p className="text-sm text-muted-foreground mt-2">
                      JPG, PNG ou GIF. Max 5 MB.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Basic Info */}
            <Card>
              <CardHeader>
                <CardTitle>Informations de base</CardTitle>
                <CardDescription>
                  Ces informations seront visibles sur votre profil public
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="username">Nom d'utilisateur</Label>
                  <Input
                    id="username"
                    name="username"
                    defaultValue={user?.username}
                    disabled
                    className="bg-muted"
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    Le nom d'utilisateur ne peut pas être modifié
                  </p>
                </div>

                <div>
                  <Label htmlFor="displayName">Nom d'affichage *</Label>
                  <Input
                    id="displayName"
                    name="displayName"
                    defaultValue={user?.displayName}
                    required
                    placeholder="Votre nom ou pseudonyme"
                  />
                </div>

                <div>
                  <Label htmlFor="bio">Biographie</Label>
                  <Textarea
                    id="bio"
                    name="bio"
                    defaultValue={user?.bio}
                    placeholder="Parlez de vous et de votre contenu..."
                    rows={4}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="location">Localisation</Label>
                    <Input
                      id="location"
                      name="location"
                      defaultValue={user?.location}
                      placeholder="Paris, France"
                    />
                  </div>

                  <div>
                    <Label htmlFor="website">Site web</Label>
                    <Input
                      id="website"
                      name="website"
                      type="url"
                      defaultValue={user?.website}
                      placeholder="https://..."
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="creator" className="space-y-6">
            {/* Creator Settings */}
            <Card>
              <CardHeader>
                <CardTitle>Paramètres créateur</CardTitle>
                <CardDescription>
                  Configurez comment vous interagissez avec vos abonnés
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="welcomeMessage">Message de bienvenue</Label>
                  <Textarea
                    id="welcomeMessage"
                    name="welcomeMessage"
                    defaultValue={user?.creatorProfile?.welcomeMessage}
                    placeholder="Message automatique envoyé aux nouveaux abonnés..."
                    rows={3}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="allowMessages">Messages privés</Label>
                      <p className="text-sm text-muted-foreground">
                        Autoriser les abonnés à vous envoyer des messages
                      </p>
                    </div>
                    <Input
                      id="allowMessages"
                      name="allowMessages"
                      type="checkbox"
                      defaultChecked={user?.creatorProfile?.allowMessages}
                      className="w-4 h-4"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="autoAcceptSubscribers">Acceptation automatique</Label>
                      <p className="text-sm text-muted-foreground">
                        Accepter automatiquement les nouveaux abonnés
                      </p>
                    </div>
                    <Input
                      id="autoAcceptSubscribers"
                      name="autoAcceptSubscribers"
                      type="checkbox"
                      defaultChecked={user?.creatorProfile?.autoAcceptSubscribers}
                      className="w-4 h-4"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="monetization" className="space-y-6">
            {/* Monetization Settings */}
            <Card>
              <CardHeader>
                <CardTitle>Paramètres de monétisation</CardTitle>
                <CardDescription>
                  Configurez vos options de paiement et de pourboires
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="allowTips">Autoriser les tips</Label>
                    <p className="text-sm text-muted-foreground">
                      Permettre aux fans de vous donner des pourboires
                    </p>
                  </div>
                  <Input
                    id="allowTips"
                    name="allowTips"
                    type="checkbox"
                    defaultChecked={user?.creatorProfile?.allowTips}
                    className="w-4 h-4"
                  />
                </div>

                <div>
                  <Label htmlFor="minimumTip">Montant minimum du tip (€)</Label>
                  <Input
                    id="minimumTip"
                    name="minimumTip"
                    type="number"
                    step="0.01"
                    min="1"
                    defaultValue={user?.creatorProfile?.minimumTip || 5}
                    placeholder="5.00"
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    Montant minimum qu'un fan peut vous donner en pourboire
                  </p>
                </div>

                <div className="p-4 bg-muted rounded-lg">
                  <div className="flex items-start gap-3">
                    <Shield className="h-5 w-5 text-primary mt-0.5" />
                    <div>
                      <h4 className="font-medium">Paiements sécurisés par Stripe</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Tous les paiements sont traités de manière sécurisée par Stripe.
                        Les frais de plateforme sont de 15% par transaction.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <div className="flex justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => window.location.reload()}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={updateProfileMutation.isPending || isUploading}
            >
              {updateProfileMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enregistrement...
                </>
              ) : (
                'Enregistrer les modifications'
              )}
            </Button>
          </div>
        </form>
      </Tabs>
    </div>
  );
}
