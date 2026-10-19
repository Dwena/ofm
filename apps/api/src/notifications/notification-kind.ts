import { NotificationType } from '@prisma/client';

/**
 * `metadata.kind` markers attached to notifications. Clients (live analytics,
 * toasts) rely on them to know what happened without parsing titles.
 */
export const NotificationKind = {
  TIP: 'TIP',
  PPV_PURCHASE: 'PPV_PURCHASE',
  PURCHASE: 'PURCHASE',
  NEW_SUBSCRIBER: 'NEW_SUBSCRIBER',
  SUBSCRIPTION_RENEWAL: 'SUBSCRIPTION_RENEWAL',
  NEW_FOLLOWER: 'NEW_FOLLOWER',
  COMMENT: 'COMMENT',
  MESSAGE: 'MESSAGE',
  PAYOUT: 'PAYOUT',
} as const;

export type NotificationKindValue = (typeof NotificationKind)[keyof typeof NotificationKind];

const VALID_TYPES = new Set<string>(Object.values(NotificationType ?? {}));

const KIND_BY_TYPE: Record<string, string> = {
  NEW_TIP: NotificationKind.TIP,
  NEW_SUBSCRIBER: NotificationKind.NEW_SUBSCRIBER,
  SUBSCRIPTION_RENEWAL: NotificationKind.SUBSCRIPTION_RENEWAL,
  NEW_FOLLOWER: NotificationKind.NEW_FOLLOWER,
  NEW_COMMENT: NotificationKind.COMMENT,
  NEW_MESSAGE: NotificationKind.MESSAGE,
  PAYOUT_COMPLETED: NotificationKind.PAYOUT,
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Infer the `metadata.kind` of a notification from its type and metadata.
 * Returns undefined when nothing meaningful can be inferred.
 */
export function inferNotificationKind(type: unknown, metadata: unknown): string | undefined {
  const meta = isPlainObject(metadata) ? metadata : {};
  if (typeof meta.kind === 'string' && meta.kind) {
    return meta.kind.toUpperCase();
  }
  if (typeof type !== 'string') {
    return undefined;
  }
  if (KIND_BY_TYPE[type]) {
    return KIND_BY_TYPE[type];
  }
  // PPV unlocks are stored as SYSTEM notifications carrying the content and amount
  if (type === 'SYSTEM' && meta.contentId && meta.amount !== undefined) {
    return NotificationKind.PPV_PURCHASE;
  }
  return undefined;
}

/**
 * Normalize the `data` of a `notification.create` call (mutates and returns it):
 * - a type that is not part of the NotificationType enum (e.g. PAYMENT_FAILED)
 *   would make Prisma reject the row: it is stored as SYSTEM with the original
 *   type kept as `metadata.kind`;
 * - `metadata.kind` is filled in when it can be inferred.
 */
export function normalizeNotificationData(data: Record<string, any>): Record<string, any> {
  if (!isPlainObject(data)) {
    return data;
  }
  const record = data as Record<string, any>;
  const metadata: Record<string, unknown> = isPlainObject(record.metadata) ? { ...record.metadata } : {};
  const canSetMetadata = record.metadata === undefined || record.metadata === null || isPlainObject(record.metadata);

  if (typeof record.type === 'string' && VALID_TYPES.size > 0 && !VALID_TYPES.has(record.type)) {
    if (!metadata.kind) {
      metadata.kind = record.type;
    }
    record.type = NotificationType.SYSTEM;
  }

  const kind = inferNotificationKind(record.type, metadata);
  if (kind) {
    metadata.kind = kind;
  }

  if (canSetMetadata && Object.keys(metadata).length > 0) {
    record.metadata = metadata;
  }
  return data;
}
