'use client';

import { useState, useEffect, useCallback } from 'react';

export interface PushNotificationOptions {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  image?: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
  vibrate?: number[];
}

export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true);
      setPermission(Notification.permission);

      // Register service worker
      registerServiceWorker();
    }
  }, []);

  const registerServiceWorker = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js');
      console.log('Service Worker registered:', registration);

      // Check for existing subscription
      const existingSubscription = await registration.pushManager.getSubscription();
      if (existingSubscription) {
        setSubscription(existingSubscription);
        setIsSubscribed(true);
      }
    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  };

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!isSupported) {
      throw new Error('Push notifications are not supported');
    }

    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, [isSupported]);

  const subscribe = useCallback(async (): Promise<PushSubscription> => {
    setIsLoading(true);

    try {
      // Request permission first
      const permissionResult = await requestPermission();
      if (permissionResult !== 'granted') {
        throw new Error('Permission denied');
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Subscribe to push notifications
      // Note: You need to generate VAPID keys and replace the publicKey
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

      const pushSubscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      setSubscription(pushSubscription);
      setIsSubscribed(true);

      // Send subscription to server
      await sendSubscriptionToServer(pushSubscription);

      return pushSubscription;
    } catch (error) {
      console.error('Failed to subscribe:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [requestPermission]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    setIsLoading(true);

    try {
      if (subscription) {
        await subscription.unsubscribe();

        // Remove subscription from server
        await removeSubscriptionFromServer(subscription);

        setSubscription(null);
        setIsSubscribed(false);
      }
    } catch (error) {
      console.error('Failed to unsubscribe:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [subscription]);

  const showLocalNotification = useCallback(
    async (options: PushNotificationOptions): Promise<void> => {
      if (!isSupported) {
        throw new Error('Notifications are not supported');
      }

      if (permission !== 'granted') {
        const result = await requestPermission();
        if (result !== 'granted') {
          throw new Error('Permission denied');
        }
      }

      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(options.title, {
        body: options.body,
        icon: options.icon || '/icon-192x192.png',
        badge: options.badge || '/icon-72x72.png',
        image: options.image,
        tag: options.tag || 'default',
        requireInteraction: options.requireInteraction || false,
        vibrate: options.vibrate || [200, 100, 200],
        data: {
          url: options.url || '/',
        },
      });
    },
    [isSupported, permission, requestPermission]
  );

  return {
    isSupported,
    permission,
    subscription,
    isSubscribed,
    isLoading,
    subscribe,
    unsubscribe,
    requestPermission,
    showLocalNotification,
  };
}

// Helper function to convert VAPID key
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Send subscription to your backend
async function sendSubscriptionToServer(subscription: PushSubscription): Promise<void> {
  try {
    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(subscription),
    });

    if (!response.ok) {
      throw new Error('Failed to save subscription');
    }
  } catch (error) {
    console.error('Error sending subscription to server:', error);
    throw error;
  }
}

// Remove subscription from your backend
async function removeSubscriptionFromServer(subscription: PushSubscription): Promise<void> {
  try {
    const response = await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(subscription),
    });

    if (!response.ok) {
      throw new Error('Failed to remove subscription');
    }
  } catch (error) {
    console.error('Error removing subscription from server:', error);
    throw error;
  }
}
