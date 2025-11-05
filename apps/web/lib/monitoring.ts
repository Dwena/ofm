'use client';

import * as Sentry from '@sentry/nextjs';
import LogRocket from 'logrocket';

/**
 * Initialize Sentry for error tracking
 */
export function initSentry() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    console.log('Sentry DSN not configured');
    return;
  }

  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    
    // Adjust this value in production, or use tracesSampler for greater control
    tracesSampleRate: 0.1,

    // Session Replay
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    integrations: [
      new Sentry.Replay({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    // Ignore common errors
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
      'ChunkLoadError',
      'Loading chunk',
      /Loading CSS chunk/i,
    ],

    beforeSend(event, hint) {
      // Filter PII from events
      if (event.request) {
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['cookie'];
        }
      }

      // Don't send network errors
      const error = hint.originalException;
      if (error && typeof error === 'object' && 'message' in error) {
        const message = (error as any).message;
        if (message?.includes('Network') || message?.includes('Failed to fetch')) {
          return null;
        }
      }

      return event;
    },
  });
}

/**
 * Initialize LogRocket for session recording
 */
export function initLogRocket() {
  if (!process.env.NEXT_PUBLIC_LOGROCKET_APP_ID) {
    console.log('LogRocket App ID not configured');
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('LogRocket disabled in development');
    return;
  }

  LogRocket.init(process.env.NEXT_PUBLIC_LOGROCKET_APP_ID, {
    // Network
    network: {
      requestSanitizer: (request) => {
        // Remove sensitive headers
        if (request.headers) {
          request.headers['authorization'] = undefined;
          request.headers['cookie'] = undefined;
        }

        // Remove sensitive query params
        if (request.url) {
          const url = new URL(request.url);
          if (url.searchParams.has('token')) {
            url.searchParams.delete('token');
          }
          if (url.searchParams.has('password')) {
            url.searchParams.delete('password');
          }
          request.url = url.toString();
        }

        return request;
      },

      responseSanitizer: (response) => {
        // Remove sensitive response data
        if (response.body) {
          try {
            const body = JSON.parse(response.body);
            if (body.token) body.token = '[REDACTED]';
            if (body.password) body.password = '[REDACTED]';
            if (body.accessToken) body.accessToken = '[REDACTED]';
            response.body = JSON.stringify(body);
          } catch (e) {
            // Not JSON, leave as is
          }
        }
        return response;
      },
    },

    // DOM
    dom: {
      inputSanitizer: true,
      textSanitizer: true,
    },

    // Console
    console: {
      shouldAggregateConsoleErrors: true,
    },
  });

  // Integrate LogRocket with Sentry
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    LogRocket.getSessionURL((sessionURL) => {
      Sentry.setContext('LogRocket', { sessionURL });
    });
  }

  console.log('LogRocket initialized');
}

/**
 * Identify user in monitoring tools
 */
export function identifyUser(user: {
  id: string;
  email?: string;
  username?: string;
  role?: string;
}) {
  // Sentry
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.setUser({
      id: user.id,
      email: user.email,
      username: user.username,
    });
  }

  // LogRocket
  if (process.env.NEXT_PUBLIC_LOGROCKET_APP_ID && process.env.NODE_ENV === 'production') {
    LogRocket.identify(user.id, {
      email: user.email,
      username: user.username,
      role: user.role,
    });
  }
}

/**
 * Clear user identification (on logout)
 */
export function clearUser() {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.setUser(null);
  }
}

/**
 * Track custom events
 */
export function trackEvent(name: string, properties?: Record<string, any>) {
  // LogRocket custom events
  if (process.env.NEXT_PUBLIC_LOGROCKET_APP_ID && process.env.NODE_ENV === 'production') {
    LogRocket.track(name, properties);
  }

  // You can also send to other analytics tools here
  // Google Analytics, Mixpanel, etc.
}

/**
 * Capture exception manually
 */
export function captureException(error: Error, context?: Record<string, any>) {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.captureException(error, {
      contexts: context ? { custom: context } : undefined,
    });
  }

  console.error('Exception captured:', error, context);
}

/**
 * Initialize all monitoring tools
 */
export function initMonitoring() {
  initSentry();
  initLogRocket();
}
