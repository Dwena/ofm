'use client';

import { useState, useEffect, useCallback } from 'react';
import { pushApi } from '@/lib/api';

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

      // Check for existing subscription
      const existingSubscription = await registration.pushManager.getSubscription();
      if (existingSubscription) {
        setSubscription(existingSubscription);
        setIsSubscribed(true);

        // Re-sync with the backend (e.g. after logging in with another account)
        if (localStorage.getItem('accessToken')) {
          sendSubscriptionToServer(existingSubscription).catch(() => undefined);
        }
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

      // Subscribe to push notifications with the server's VAPID public key
      const vapidPublicKey = await getVapidPublicKey();

      const pushSubscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });

      // Send subscription to server (roll back the browser subscription on failure)
      try {
        await sendSubscriptionToServer(pushSubscription);
      } catch (error) {
        await pushSubscription.unsubscribe().catch(() => undefined);
        throw error;
      }

      setSubscription(pushSubscription);
      setIsSubscribed(true);

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
        // Remove subscription from server first (best effort), then from the browser
        await removeSubscriptionFromServer(subscription).catch((error) =>
          console.error('Failed to remove subscription from server:', error)
        );
        await subscription.unsubscribe();

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
      await registration.showNotification(options.title, <NotificationOptions & { image?: string; vibrate?: number[] }>{
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

async function getVapidPublicKey(): Promise<string> {
  try {
    const response = await pushApi.getVapidPublicKey();
    if (response.data?.enabled && response.data.publicKey) {
      return response.data.publicKey;
    }
  } catch (error) {
    console.error('Failed to fetch VAPID public key:', error);
  }

  const fallback = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!fallback) {
    throw new Error('Push notifications are not configured on the server');
  }
  return fallback;
}

// Send subscription to the backend
async function sendSubscriptionToServer(subscription: PushSubscription): Promise<void> {
  await pushApi.subscribe(subscription.toJSON());
}

// Remove subscription from the backend
async function removeSubscriptionFromServer(subscription: PushSubscription): Promise<void> {
  await pushApi.unsubscribe(subscription.endpoint);
}
