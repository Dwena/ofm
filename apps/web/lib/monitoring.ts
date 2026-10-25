'use client';

import * as Sentry from '@sentry/nextjs';

/**
 * Error tracking only (Sentry), configured so that it needs no consent (CNIL):
 * - no session recording (no Sentry Replay, no LogRocket): on an adult platform, a recording of
 *   what a user watches reveals their sex life (sensitive data, art. 9 GDPR);
 * - no cookie: the Sentry browser SDK does not set any; release-health sessions are disabled;
 * - no PII: sendDefaultPii false, user reduced to an opaque id, IP / cookies / headers / query
 *   strings stripped, UI and console breadcrumbs dropped;
 * - no performance tracing (it would send every visited URL).
 * Also enable "Prevent Storing of IP Addresses" and the EU data region in the Sentry project.
 *
 * Do not add analytics, advertising or session-replay tools here without updating the cookie
 * policy (apps/web/app/legal/cookies) and adding a consent banner first.
 */

/** Removes the query string and fragment of a URL (they may hold tokens or search terms) */
function stripQuery(url?: string): string | undefined {
  if (!url) return url;
  return url.split(/[?#]/)[0];
}

export function initSentry() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',

    sendDefaultPii: false,
    autoSessionTracking: false,
    tracesSampleRate: 0,

    // No Session Replay integration, on purpose (see above)

    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
      'ChunkLoadError',
      'Loading chunk',
      /Loading CSS chunk/i,
    ],

    beforeBreadcrumb(breadcrumb) {
      // Clicks, inputs and console output may contain what the user reads or types
      if (breadcrumb.category?.startsWith('ui.') || breadcrumb.category === 'console') {
        return null;
      }
      if (breadcrumb.data) {
        if (typeof breadcrumb.data.url === 'string') breadcrumb.data.url = stripQuery(breadcrumb.data.url);
        if (typeof breadcrumb.data.from === 'string') breadcrumb.data.from = stripQuery(breadcrumb.data.from);
        if (typeof breadcrumb.data.to === 'string') breadcrumb.data.to = stripQuery(breadcrumb.data.to);
      }
      return breadcrumb;
    },

    beforeSend(event, hint) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.query_string;
        event.request.url = stripQuery(event.request.url);
        if (event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['Authorization'];
          delete event.request.headers['cookie'];
          delete event.request.headers['Cookie'];
        }
      }
      // Opaque id only: no e-mail, username or IP address
      event.user = event.user?.id ? { id: event.user.id } : undefined;

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

/** Attach the (opaque) user id to error reports */
export function identifyUser(user: { id: string }) {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.setUser({ id: user.id });
  }
}

/** Clear user identification (on logout) */
export function clearUser() {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.setUser(null);
  }
}

/** Capture an exception manually */
export function captureException(error: Error, context?: Record<string, any>) {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.captureException(error, {
      contexts: context ? { custom: context } : undefined,
    });
  }

  console.error('Exception captured:', error, context);
}

/** Initialize monitoring (error tracking only) */
export function initMonitoring() {
  initSentry();
}
