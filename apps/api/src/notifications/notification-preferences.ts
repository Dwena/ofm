import type { Prisma } from '@prisma/client';

/**
 * Notification preferences stored in `User.notificationPreferences` (JSON).
 *
 * Each category can be toggled per channel:
 * - `inApp`: badge + realtime alert. When off, the notification is still kept in
 *   the history but stored as already read and not pushed on the socket;
 * - `push`: web push delivered to the user's registered devices.
 *
 * Account notifications (moderation, payment failures, security...) have no
 * category and are always delivered.
 */
export const NOTIFICATION_CATEGORIES = [
  'messages',
  'subscribers',
  'followers',
  'comments',
  'purchases',
  'payouts',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationChannel = 'inApp' | 'push';

export interface ChannelPreferences {
  inApp: boolean;
  push: boolean;
}

export type NotificationPreferences = Record<NotificationCategory, ChannelPreferences>;

export const DEFAULT_CHANNEL_PREFERENCES: ChannelPreferences = { inApp: true, push: true };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return typeof value === 'string' && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

/** Stored (possibly partial or malformed) JSON merged over the defaults */
export function resolveNotificationPreferences(raw: unknown): NotificationPreferences {
  const stored = isPlainObject(raw) ? raw : {};
  const result = {} as NotificationPreferences;
  for (const category of NOTIFICATION_CATEGORIES) {
    const entry = isPlainObject(stored[category]) ? stored[category] : {};
    result[category] = {
      inApp: typeof entry.inApp === 'boolean' ? entry.inApp : DEFAULT_CHANNEL_PREFERENCES.inApp,
      push: typeof entry.push === 'boolean' ? entry.push : DEFAULT_CHANNEL_PREFERENCES.push,
    };
  }
  return result;
}

/** Apply a partial update (unknown categories / non-boolean values are ignored) */
export function mergeNotificationPreferences(
  current: unknown,
  update: Partial<Record<string, Partial<ChannelPreferences>>>,
): NotificationPreferences {
  const result = resolveNotificationPreferences(current);
  for (const category of NOTIFICATION_CATEGORIES) {
    const patch = update?.[category];
    if (!isPlainObject(patch)) continue;
    if (typeof patch.inApp === 'boolean') result[category].inApp = patch.inApp;
    if (typeof patch.push === 'boolean') result[category].push = patch.push;
  }
  return result;
}

const PURCHASE_KINDS = ['TIP', 'PPV_PURCHASE', 'PURCHASE'];
const PAYOUT_KINDS = ['PAYOUT', 'PAYOUT_COMPLETED', 'PAYOUT_FAILED'];

/** Category of a notification, or null for account notifications (always delivered) */
export function getNotificationCategory(type: unknown, metadata: unknown): NotificationCategory | null {
  const kind = isPlainObject(metadata) && typeof metadata.kind === 'string' ? metadata.kind.toUpperCase() : '';
  switch (type) {
    case 'NEW_MESSAGE':
      return 'messages';
    case 'NEW_SUBSCRIBER':
    case 'SUBSCRIPTION_RENEWAL':
      return 'subscribers';
    case 'NEW_FOLLOWER':
      return 'followers';
    case 'NEW_COMMENT':
      return 'comments';
    case 'NEW_TIP':
      return 'purchases';
    case 'PAYOUT_COMPLETED':
      return 'payouts';
    default:
      break;
  }
  if (PURCHASE_KINDS.includes(kind)) return 'purchases';
  if (PAYOUT_KINDS.includes(kind)) return 'payouts';
  return null;
}

/** Whether a notification should be delivered on a channel given the stored preferences */
export function isNotificationChannelEnabled(
  rawPreferences: unknown,
  type: unknown,
  metadata: unknown,
  channel: NotificationChannel,
): boolean {
  const category = getNotificationCategory(type, metadata);
  if (!category) return true;
  return resolveNotificationPreferences(rawPreferences)[category][channel];
}

const kindIn = (kinds: string[]): Prisma.NotificationWhereInput[] =>
  kinds.map((kind) => ({ metadata: { path: ['kind'], equals: kind } }));

/** Prisma filter matching the notifications of a category (list filter) */
export function categoryWhere(category: NotificationCategory): Prisma.NotificationWhereInput {
  switch (category) {
    case 'messages':
      return { type: 'NEW_MESSAGE' };
    case 'subscribers':
      return { type: { in: ['NEW_SUBSCRIBER', 'SUBSCRIPTION_RENEWAL'] } };
    case 'followers':
      return { type: 'NEW_FOLLOWER' };
    case 'comments':
      return { type: 'NEW_COMMENT' };
    case 'purchases':
      return { OR: [{ type: 'NEW_TIP' }, ...kindIn(PURCHASE_KINDS)] };
    case 'payouts':
      return { OR: [{ type: 'PAYOUT_COMPLETED' }, ...kindIn(PAYOUT_KINDS)] };
  }
}
