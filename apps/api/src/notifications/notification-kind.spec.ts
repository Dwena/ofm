import { inferNotificationKind, normalizeNotificationData } from './notification-kind';

describe('notification kind', () => {
  describe('inferNotificationKind', () => {
    it('keeps an explicit kind (upper-cased)', () => {
      expect(inferNotificationKind('SYSTEM', { kind: 'ppv_purchase' })).toBe('PPV_PURCHASE');
    });

    it('maps notification types to kinds', () => {
      expect(inferNotificationKind('NEW_TIP', null)).toBe('TIP');
      expect(inferNotificationKind('NEW_SUBSCRIBER', {})).toBe('NEW_SUBSCRIBER');
      expect(inferNotificationKind('SUBSCRIPTION_RENEWAL', undefined)).toBe('SUBSCRIPTION_RENEWAL');
      expect(inferNotificationKind('NEW_FOLLOWER', undefined)).toBe('NEW_FOLLOWER');
    });

    it('detects PPV unlocks stored as SYSTEM notifications', () => {
      expect(inferNotificationKind('SYSTEM', { contentId: 'c-1', amount: 5 })).toBe('PPV_PURCHASE');
      expect(inferNotificationKind('SYSTEM', { contentId: 'c-1' })).toBeUndefined();
      expect(inferNotificationKind('CONTENT_APPROVED', {})).toBeUndefined();
    });
  });

  describe('normalizeNotificationData', () => {
    it('adds the kind to existing metadata', () => {
      const data = normalizeNotificationData({
        userId: 'u-1',
        type: 'NEW_TIP',
        title: 't',
        message: 'm',
        metadata: { amount: 10, fromUserId: 'u-2' },
      });

      expect(data.type).toBe('NEW_TIP');
      expect(data.metadata).toEqual({ amount: 10, fromUserId: 'u-2', kind: 'TIP' });
    });

    it('creates metadata when missing', () => {
      const data = normalizeNotificationData({ userId: 'u-1', type: 'NEW_SUBSCRIBER', title: 't', message: 'm' });
      expect(data.metadata).toEqual({ kind: 'NEW_SUBSCRIBER' });
    });

    it('stores unknown types as SYSTEM and keeps them as kind', () => {
      const data = normalizeNotificationData({ userId: 'u-1', type: 'PAYMENT_FAILED', title: 't', message: 'm' });
      expect(data.type).toBe('SYSTEM');
      expect(data.metadata).toEqual({ kind: 'PAYMENT_FAILED' });
    });

    it('leaves notifications without a known kind untouched', () => {
      const data = normalizeNotificationData({ userId: 'u-1', type: 'CONTENT_APPROVED', title: 't', message: 'm' });
      expect(data).toEqual({ userId: 'u-1', type: 'CONTENT_APPROVED', title: 't', message: 'm' });
    });
  });
});
