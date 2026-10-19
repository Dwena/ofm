'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { formatEuros } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { AlertCircle, ExternalLink, ImageIcon, Loader2, Settings, Shield, Trash2, Upload, User } from 'lucide-react';

const PROFILE_QUERY_KEY = ['profile'];

interface ProfileForm {
  displayName: string;
  bio: string;
  location: string;
  website: string;
  welcomeMessage: string;
  allowMessages: boolean;
  allowTips: boolean;
  minimumTip: string;
}

type FieldErrors = Partial<Record<keyof ProfileForm, string>>;

const PROFILE_FIELDS: (keyof ProfileForm)[] = ['displayName', 'bio', 'location', 'website'];

function toForm(user: any): ProfileForm {
  return {
    displayName: user?.displayName || '',
    bio: user?.bio || '',
    location: user?.location || '',
    website: user?.website || '',
    welcomeMessage: user?.creatorProfile?.welcomeMessage || '',
    allowMessages: user?.creatorProfile?.allowMessages ?? true,
    allowTips: user?.creatorProfile?.allowTips ?? true,
    minimumTip: Number(user?.creatorProfile?.minimumTip ?? 5).toFixed(2).replace('.', ','),
  };
}

function validate(form: ProfileForm): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.displayName.trim()) errors.displayName = "Le nom d'affichage est requis";
  else if (form.displayName.trim().length > 100) errors.displayName = '100 caractères maximum';
  if (form.bio.length > 500) errors.bio = '500 caractères maximum';
  if (form.location.length > 100) errors.location = '100 caractères maximum';
  const website = form.website.trim();
  if (website) {
    try {
      const url = new URL(website);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
      if (!url.hostname.includes('.')) throw new Error();
    } catch {
      errors.website = 'Adresse invalide (ex. https://monsite.com)';
    }
  }
  if (form.welcomeMessage.length > 1000) errors.welcomeMessage = '1000 caractères maximum';
  const rawTip = form.minimumTip.replace(',', '.').trim();
  const tip = Number(rawTip);
  if (!rawTip || !Number.isFinite(tip)) errors.minimumTip = 'Montant invalide';
  else if (!/^\d+(\.\d{1,2})?$/.test(rawTip)) errors.minimumTip = 'Deux décimales maximum';
  else if (tip < 1) errors.minimumTip = `Minimum ${formatEuros(1)}`;
  else if (tip > 10000) errors.minimumTip = `Maximum ${formatEuros(10000)}`;
  return errors;
}

function apiErrorMessage(error: any, fallback: string): string {
  const message = error?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' && message ? message : fallback;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export default function CreatorProfilePage() {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const { refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<ProfileForm>(toForm(null));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [tab, setTab] = useState('profile');
  const [uploading, setUploading] = useState<'avatar' | 'cover' | null>(null);

  const { data: user, isLoading, isError, refetch } = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: async () => {
      const response = await usersApi.getMe();
      return response.data;
    },
  });

  // Reset the form whenever fresh profile data arrives
  useEffect(() => {
    if (user) setForm(toForm(user));
  }, [user]);

  const onProfileSaved = async (updated: any) => {
    queryClient.setQueryData(PROFILE_QUERY_KEY, updated);
    queryClient.invalidateQueries({ queryKey: ['creator-profile', user?.username] });
    await refreshUser().catch(() => undefined);
  };

  const updateProfileMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const response = await usersApi.updateProfile(data);
      return response.data;
    },
  });

  const handleImageUpload = async (kind: 'avatar' | 'cover', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!IMAGE_TYPES.includes(file.type)) {
      toast({ title: 'Format non supporté', description: 'Choisissez une image JPG, PNG, GIF ou WebP.', variant: 'destructive' });
      return;
    }
    const maxMb = kind === 'avatar' ? 5 : 10;
    if (file.size > maxMb * 1024 * 1024) {
      toast({ title: 'Image trop lourde', description: `L'image ne doit pas dépasser ${maxMb} Mo.`, variant: 'destructive' });
      return;
    }

    setUploading(kind);
    try {
      const response = kind === 'avatar' ? await usersApi.uploadAvatar(file) : await usersApi.uploadCover(file);
      await onProfileSaved(response.data);
      toast({ title: kind === 'avatar' ? 'Photo de profil mise à jour' : 'Photo de couverture mise à jour' });
    } catch (error: any) {
      toast({
        title: 'Erreur',
        description: apiErrorMessage(error, "Impossible de télécharger l'image"),
        variant: 'destructive',
      });
    } finally {
      setUploading(null);
    }
  };

  const handleImageRemove = async (kind: 'avatar' | 'cover') => {
    const ok = await confirm({
      title: kind === 'avatar' ? 'Retirer la photo de profil ?' : 'Retirer la photo de couverture ?',
      confirmText: 'Retirer',
      variant: 'destructive',
    });
    if (!ok) return;
    setUploading(kind);
    try {
      const updated = await updateProfileMutation.mutateAsync(kind === 'avatar' ? { avatar: null } : { coverImage: null });
      await onProfileSaved(updated);
      toast({ title: 'Image retirée' });
    } catch (error: any) {
      toast({ title: 'Erreur', description: apiErrorMessage(error, "Impossible de retirer l'image"), variant: 'destructive' });
    } finally {
      setUploading(null);
    }
  };

  const updateField = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const nextErrors = validate(form);
    setErrors(nextErrors);
    const invalid = Object.keys(nextErrors) as (keyof ProfileForm)[];
    if (invalid.length > 0) {
      setTab(PROFILE_FIELDS.includes(invalid[0]) ? 'profile' : 'creator');
      return;
    }

    const isCreator = user?.role === 'CREATOR';
    const data: Record<string, unknown> = {
      displayName: form.displayName.trim(),
      bio: form.bio.trim(),
      location: form.location.trim(),
      website: form.website.trim() || null,
      ...(isCreator && {
        welcomeMessage: form.welcomeMessage.trim() || null,
        allowMessages: form.allowMessages,
        allowTips: form.allowTips,
        minimumTip: Math.round(Number(form.minimumTip.replace(',', '.')) * 100) / 100,
      }),
    };

    try {
      const updated = await updateProfileMutation.mutateAsync(data);
      await onProfileSaved(updated);
      toast({ title: 'Profil mis à jour', description: 'Vos modifications ont été enregistrées.' });
    } catch (error: any) {
      toast({
        title: 'Erreur',
        description: apiErrorMessage(error, 'Impossible de mettre à jour le profil'),
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (isError || !user) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 min-h-[60vh] text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-muted-foreground">Impossible de charger votre profil.</p>
        <Button variant="outline" onClick={() => refetch()}>
          Réessayer
        </Button>
      </div>
    );
  }

  const isCreator = user.role === 'CREATOR';
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(user));
  const saving = updateProfileMutation.isPending && !uploading;
  const displayName = user.displayName || user.username;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Modifier mon profil</h1>
          <p className="text-muted-foreground mt-2">Personnalisez votre profil pour attirer plus d&apos;abonnés</p>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/${user.username}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 mr-2" />
            Voir mon profil public
          </Link>
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">
            <User className="h-4 w-4 mr-2" />
            Profil
          </TabsTrigger>
          {isCreator && (
            <TabsTrigger value="creator">
              <Settings className="h-4 w-4 mr-2" />
              Paramètres créateur
            </TabsTrigger>
          )}
        </TabsList>

        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          <TabsContent value="profile" className="space-y-6 mt-0">
            {/* Cover Photo */}
            <Card>
              <CardHeader>
                <CardTitle>Photo de couverture</CardTitle>
                <CardDescription>Image d&apos;arrière-plan de votre profil (recommandé : 1500x500px, 10 Mo max.)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative w-full h-32 sm:h-48 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
                  {user.coverImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.coverImage} alt="Couverture" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon className="h-10 w-10 text-muted-foreground" />
                  )}
                  {uploading === 'cover' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => coverInputRef.current?.click()}
                    disabled={!!uploading}
                  >
                    {uploading === 'cover' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                    {uploading === 'cover' ? 'Téléchargement...' : 'Changer la couverture'}
                  </Button>
                  {user.coverImage && (
                    <Button type="button" variant="ghost" onClick={() => handleImageRemove('cover')} disabled={!!uploading}>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Retirer
                    </Button>
                  )}
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept={IMAGE_TYPES.join(',')}
                    className="hidden"
                    onChange={(e) => handleImageUpload('cover', e)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Avatar */}
            <Card>
              <CardHeader>
                <CardTitle>Photo de profil</CardTitle>
                <CardDescription>Votre avatar visible partout sur la plateforme</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
                  <div className="relative w-fit">
                    <Avatar className="h-24 w-24">
                      <AvatarImage src={user.avatar || undefined} alt={displayName} />
                      <AvatarFallback className="text-2xl">{displayName.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    {uploading === 'avatar' && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60">
                        <Loader2 className="h-6 w-6 animate-spin" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => avatarInputRef.current?.click()}
                        disabled={!!uploading}
                      >
                        {uploading === 'avatar' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                        {uploading === 'avatar' ? 'Téléchargement...' : "Changer l'avatar"}
                      </Button>
                      {user.avatar && (
                        <Button type="button" variant="ghost" onClick={() => handleImageRemove('avatar')} disabled={!!uploading}>
                          <Trash2 className="h-4 w-4 mr-2" />
                          Retirer
                        </Button>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">JPG, PNG, GIF ou WebP. 5 Mo max.</p>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept={IMAGE_TYPES.join(',')}
                      className="hidden"
                      onChange={(e) => handleImageUpload('avatar', e)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Basic Info */}
            <Card>
              <CardHeader>
                <CardTitle>Informations de base</CardTitle>
                <CardDescription>Ces informations sont visibles sur votre profil public</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Nom d&apos;utilisateur</Label>
                  <Input id="username" value={user.username} disabled className="bg-muted" />
                  <p className="text-sm text-muted-foreground">Le nom d&apos;utilisateur ne peut pas être modifié</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="displayName">
                    Nom d&apos;affichage <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="displayName"
                    value={form.displayName}
                    onChange={(e) => updateField('displayName', e.target.value)}
                    maxLength={100}
                    placeholder="Votre nom ou pseudonyme"
                    aria-invalid={!!errors.displayName}
                  />
                  {errors.displayName && <p className="text-sm text-destructive">{errors.displayName}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bio">Biographie</Label>
                  <Textarea
                    id="bio"
                    value={form.bio}
                    onChange={(e) => updateField('bio', e.target.value)}
                    maxLength={500}
                    placeholder="Parlez de vous et de votre contenu..."
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground text-right">{form.bio.length}/500</p>
                  {errors.bio && <p className="text-sm text-destructive">{errors.bio}</p>}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="location">Localisation</Label>
                    <Input
                      id="location"
                      value={form.location}
                      onChange={(e) => updateField('location', e.target.value)}
                      maxLength={100}
                      placeholder="Paris, France"
                    />
                    {errors.location && <p className="text-sm text-destructive">{errors.location}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="website">Site web</Label>
                    <Input
                      id="website"
                      type="url"
                      value={form.website}
                      onChange={(e) => updateField('website', e.target.value)}
                      placeholder="https://..."
                      aria-invalid={!!errors.website}
                    />
                    {errors.website && <p className="text-sm text-destructive">{errors.website}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {isCreator && (
            <TabsContent value="creator" className="space-y-6 mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>Messages</CardTitle>
                  <CardDescription>Configurez comment vos fans peuvent vous contacter</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <label className="flex items-start justify-between gap-4 cursor-pointer">
                    <span>
                      <span className="block text-sm font-medium">Messages privés</span>
                      <span className="block text-sm text-muted-foreground">
                        Autoriser les fans à vous envoyer des messages
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0"
                      checked={form.allowMessages}
                      onChange={(e) => updateField('allowMessages', e.target.checked)}
                    />
                  </label>

                  <div className="space-y-2">
                    <Label htmlFor="welcomeMessage">Message de bienvenue</Label>
                    <Textarea
                      id="welcomeMessage"
                      value={form.welcomeMessage}
                      onChange={(e) => updateField('welcomeMessage', e.target.value)}
                      maxLength={1000}
                      placeholder="Message privé envoyé automatiquement à chaque nouvel abonné..."
                      rows={3}
                    />
                    <p className="text-sm text-muted-foreground">
                      Envoyé en message privé à chaque nouvel abonné. Laissez vide pour ne rien envoyer.
                    </p>
                    {errors.welcomeMessage && <p className="text-sm text-destructive">{errors.welcomeMessage}</p>}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Pourboires</CardTitle>
                  <CardDescription>Permettez à vos fans de vous soutenir ponctuellement</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <label className="flex items-start justify-between gap-4 cursor-pointer">
                    <span>
                      <span className="block text-sm font-medium">Autoriser les pourboires</span>
                      <span className="block text-sm text-muted-foreground">
                        Permettre aux fans de vous envoyer des pourboires
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0"
                      checked={form.allowTips}
                      onChange={(e) => updateField('allowTips', e.target.checked)}
                    />
                  </label>

                  <div className="space-y-2">
                    <Label htmlFor="minimumTip">Montant minimum du pourboire (€)</Label>
                    <Input
                      id="minimumTip"
                      type="text"
                      inputMode="decimal"
                      value={form.minimumTip}
                      onChange={(e) => updateField('minimumTip', e.target.value)}
                      disabled={!form.allowTips}
                      placeholder="5,00"
                      className="sm:max-w-[200px]"
                      aria-invalid={!!errors.minimumTip}
                    />
                    {errors.minimumTip ? (
                      <p className="text-sm text-destructive">{errors.minimumTip}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">Montant minimum qu&apos;un fan peut vous offrir (1 € minimum)</p>
                    )}
                  </div>

                  <div className="p-4 bg-muted rounded-lg">
                    <div className="flex items-start gap-3">
                      <Shield className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                      <div>
                        <h4 className="font-medium">Paiements sécurisés par Stripe</h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          Tous les paiements sont traités de manière sécurisée par Stripe.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setForm(toForm(user));
                setErrors({});
              }}
              disabled={!dirty || saving}
            >
              Annuler les modifications
            </Button>
            <Button type="submit" disabled={!dirty || saving || !!uploading}>
              {saving ? (
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
