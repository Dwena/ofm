'use client';

import React from 'react';
import { Bell, BellOff } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { useToast } from '@/hooks/use-toast';

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

  const handleSubscribe = async () => {
    try {
      await subscribe();
      toast({
        title: 'Notifications activées',
        description: 'Vous recevrez maintenant des notifications push.',
      });
    } catch (error) {
      toast({
        title: 'Erreur',
        description: 'Impossible d\'activer les notifications.',
        variant: 'destructive',
      });
    }
  };

  const handleUnsubscribe = async () => {
    try {
      await unsubscribe();
      toast({
        title: 'Notifications désactivées',
        description: 'Vous ne recevrez plus de notifications push.',
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
    try {
      await showLocalNotification({
        title: 'Notification de test',
        body: 'Ceci est une notification de test de la plateforme OFM.',
        icon: '/icon-192x192.png',
        url: '/',
      });
    } catch (error) {
      toast({
        title: 'Erreur',
        description: 'Impossible d\'envoyer la notification de test.',
        variant: 'destructive',
      });
    }
  };

  if (!isSupported) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Notifications Push</CardTitle>
          <CardDescription>
            Les notifications push ne sont pas supportées par votre navigateur.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Notifications Push
        </CardTitle>
        <CardDescription>
          Gérez vos préférences de notifications push pour rester informé.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="space-y-1">
            <p className="font-medium">
              {isSubscribed ? 'Notifications activées' : 'Notifications désactivées'}
            </p>
            <p className="text-sm text-muted-foreground">
              {permission === 'granted' && isSubscribed
                ? 'Vous recevez les notifications push'
                : permission === 'denied'
                ? 'Autorisations refusées'
                : 'Activez pour recevoir des notifications'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSubscribed ? (
              <Button
                variant="outline"
                onClick={handleUnsubscribe}
                disabled={isLoading}
              >
                <BellOff className="h-4 w-4 mr-2" />
                Désactiver
              </Button>
            ) : (
              <Button onClick={handleSubscribe} disabled={isLoading}>
                <Bell className="h-4 w-4 mr-2" />
                Activer
              </Button>
            )}
          </div>
        </div>

        {isSubscribed && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Test des notifications</p>
            <Button variant="outline" onClick={handleTestNotification} size="sm">
              Envoyer une notification de test
            </Button>
          </div>
        )}

        <div className="space-y-2 pt-4 border-t">
          <p className="text-sm font-medium">Types de notifications</p>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" defaultChecked className="rounded" />
              Nouveaux messages
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" defaultChecked className="rounded" />
              Nouveaux abonnés
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" defaultChecked className="rounded" />
              Nouveaux achats
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" defaultChecked className="rounded" />
              Nouveaux commentaires
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" defaultChecked className="rounded" />
              Nouveaux likes
            </label>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
