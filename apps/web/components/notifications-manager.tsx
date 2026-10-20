'use client';

import React, { useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { useToast } from '@/hooks/use-toast';
import { useSocket } from '@/hooks/use-socket';

function describePushError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Permission denied') {
    return 'Vous avez refusé les notifications. Autorisez-les dans les réglages de votre navigateur pour ce site.';
  }
  if (message === 'Push notifications are not configured on the server') {
    return "Les notifications push ne sont pas configurées sur le serveur.";
  }
  return fallback;
}

/** Web push subscription of this browser (realtime status, enable/disable, test) */
export function NotificationsManager() {
  const {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    subscribe,
    unsubscribe,
    showLocalNotification,
  } = usePushNotifications();
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  // In-app notifications arrive in realtime over the socket (notification:new)
  const { connected: realtimeConnected } = useSocket();

  const handleSubscribe = async () => {
    try {
      await subscribe();
      toast({
        title: 'Notifications activées',
        description: 'Vous recevrez maintenant des notifications push sur cet appareil.',
      });
    } catch (error) {
      toast({
        title: 'Erreur',
        description: describePushError(error, "Impossible d'activer les notifications."),
        variant: 'destructive',
      });
    }
  };

  const handleUnsubscribe = async () => {
    try {
      await unsubscribe();
      toast({
        title: 'Notifications désactivées',
        description: 'Vous ne recevrez plus de notifications push sur cet appareil.',
      });
    } catch (error) {
      toast({
        title: 'Erreur',
        description: 'Impossible de désactiver les notifications.',
        variant: 'destructive',
      });
    }
  };

  const handleTestNotification = async () => {
    setTesting(true);
    try {
      await showLocalNotification({
        title: 'Notification de test',
        body: 'Ceci est une notification de test de la plateforme FanVIP.',
        icon: '/icon-192x192.png',
        url: '/notifications',
      });
      toast({ title: 'Notification de test envoyée' });
    } catch (error) {
      toast({
        title: 'Erreur',
        description: describePushError(error, "Impossible d'envoyer la notification de test."),
        variant: 'destructive',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Notifications push
        </CardTitle>
        <CardDescription>
          {isSupported
            ? 'Recevez vos notifications sur cet appareil, même lorsque l’application est fermée.'
            : 'Les notifications push ne sont pas prises en charge par votre navigateur.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 p-4 border rounded-lg">
          <div className="space-y-1">
            <p className="font-medium">Notifications en temps réel</p>
            <p className="text-sm text-muted-foreground">
              {realtimeConnected
                ? 'Les nouvelles notifications s’affichent instantanément dans l’application'
                : 'Connexion en cours... les notifications seront synchronisées automatiquement'}
            </p>
          </div>
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${realtimeConnected ? 'bg-green-500' : 'bg-muted-foreground'}`}
            role="status"
            aria-label={realtimeConnected ? 'Connecté' : 'Déconnecté'}
          />
        </div>

        {isSupported && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4 border rounded-lg">
            <div className="space-y-1">
              <p className="font-medium">
                {isSubscribed ? 'Notifications push activées' : 'Notifications push désactivées'}
              </p>
              <p className="text-sm text-muted-foreground">
                {permission === 'granted' && isSubscribed
                  ? 'Cet appareil reçoit les notifications push'
                  : permission === 'denied'
                    ? 'Autorisation refusée : modifiez-la dans les réglages du navigateur'
                    : 'Activez-les pour être prévenu sur cet appareil'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isSubscribed && (
                <Button variant="ghost" size="sm" onClick={handleTestNotification} disabled={testing}>
                  {testing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Tester
                </Button>
              )}
              {isSubscribed ? (
                <Button variant="outline" onClick={handleUnsubscribe} disabled={isLoading}>
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <BellOff className="h-4 w-4 mr-2" />
                  )}
                  Désactiver
                </Button>
              ) : (
                <Button onClick={handleSubscribe} disabled={isLoading || permission === 'denied'}>
                  {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Bell className="h-4 w-4 mr-2" />}
                  Activer
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
