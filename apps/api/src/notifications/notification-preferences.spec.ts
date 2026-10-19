import {
  categoryWhere,
  getNotificationCategory,
  isNotificationChannelEnabled,
  mergeNotificationPreferences,
  resolveNotificationPreferences,
} from './notification-preferences';

describe('notification preferences', () => {
  it('defaults every category to all channels on', () => {
    const prefs = resolveNotificationPreferences(null);
    expect(Object.keys(prefs)).toEqual(['messages', 'subscribers', 'followers', 'comments', 'purchases', 'payouts']);
    expect(Object.values(prefs).every((c) => c.inApp && c.push)).toBe(true);
  });

  it('merges stored values over the defaults and ignores garbage', () => {
    const prefs = resolveNotificationPreferences({ comments: { push: false, inApp: 'nope' }, unknown: { push: false } });
    expect(prefs.comments).toEqual({ inApp: true, push: false });
    expect((prefs as any).unknown).toBeUndefined();
  });

  it('applies partial updates', () => {
    const prefs = mergeNotificationPreferences({ comments: { push: false } }, { comments: { inApp: false }, followers: { push: false } });
    expect(prefs.comments).toEqual({ inApp: false, push: false });
    expect(prefs.followers).toEqual({ inApp: true, push: false });
    expect(prefs.messages).toEqual({ inApp: true, push: true });
  });

  it('maps notification types and kinds to categories', () => {
    expect(getNotificationCategory('NEW_COMMENT', null)).toBe('comments');
    expect(getNotificationCategory('SUBSCRIPTION_RENEWAL', {})).toBe('subscribers');
    expect(getNotificationCategory('NEW_TIP', {})).toBe('purchases');
    expect(getNotificationCategory('SYSTEM', { kind: 'PPV_PURCHASE' })).toBe('purchases');
    expect(getNotificationCategory('SYSTEM', { kind: 'PAYOUT_FAILED' })).toBe('payouts');
    // Account notifications cannot be muted
    expect(getNotificationCategory('SYSTEM', { kind: 'PAYMENT_FAILED' })).toBeNull();
    expect(getNotificationCategory('CONTENT_REJECTED', null)).toBeNull();
  });

  it('tells whether a channel is enabled', () => {
    const stored = { comments: { push: false } };
    expect(isNotificationChannelEnabled(stored, 'NEW_COMMENT', null, 'push')).toBe(false);
    expect(isNotificationChannelEnabled(stored, 'NEW_COMMENT', null, 'inApp')).toBe(true);
    expect(isNotificationChannelEnabled({ followers: { push: false } }, 'CONTENT_REJECTED', null, 'push')).toBe(true);
  });

  it('builds category list filters', () => {
    expect(categoryWhere('subscribers')).toEqual({ type: { in: ['NEW_SUBSCRIBER', 'SUBSCRIPTION_RENEWAL'] } });
    expect(categoryWhere('purchases').OR).toEqual(
      expect.arrayContaining([{ type: 'NEW_TIP' }, { metadata: { path: ['kind'], equals: 'PPV_PURCHASE' } }]),
    );
  });
});
