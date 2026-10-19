import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionSyncService } from './subscription-sync.service';
import { PrismaService } from '../common/database/prisma.service';

describe('SubscriptionSyncService', () => {
  let service: SubscriptionSyncService;

  const mockPrismaService = {
    subscription: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    subscriptionTier: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    creatorProfile: {
      updateMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
  };

  const stripeSubscription = (overrides: any = {}): any => ({
    id: 'sub_stripe',
    status: 'active',
    current_period_start: 1700000000,
    current_period_end: 1702592000,
    cancel_at_period_end: false,
    canceled_at: null,
    metadata: { subscriberId: 'fan-1', tierId: 'tier-1' },
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionSyncService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<SubscriptionSyncService>(SubscriptionSyncService);

    jest.clearAllMocks();
    mockPrismaService.subscription.findMany.mockResolvedValue([]);
  });

  it('should map Stripe statuses', () => {
    expect(service.mapStatus('active')).toBe('ACTIVE');
    expect(service.mapStatus('trialing')).toBe('ACTIVE');
    expect(service.mapStatus('past_due')).toBe('PAST_DUE');
    expect(service.mapStatus('canceled')).toBe('CANCELLED');
    expect(service.mapStatus('incomplete_expired')).toBe('EXPIRED');
    expect(service.mapStatus('incomplete')).toBeNull();
  });

  it('should update an existing row and refresh the counter on status change', async () => {
    mockPrismaService.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      status: 'ACTIVE',
      tier: { creatorId: 'creator-1' },
    });
    mockPrismaService.subscription.update.mockResolvedValue({ id: 'sub-1', status: 'CANCELLED' });

    await service.syncFromStripe(stripeSubscription({ status: 'canceled', canceled_at: 1701000000 }));

    expect(mockPrismaService.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: expect.objectContaining({
        status: 'CANCELLED',
        cancelledAt: new Date(1701000000 * 1000),
        currentPeriodEnd: new Date(1702592000 * 1000),
      }),
    });
    expect(mockPrismaService.creatorProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'creator-1' },
      data: { totalSubscribers: 0 },
    });
  });

  it('should not create a row for an incomplete subscription', async () => {
    mockPrismaService.subscription.findUnique.mockResolvedValue(null);

    const result = await service.syncFromStripe(stripeSubscription({ status: 'incomplete' }));

    expect(result).toBeNull();
    expect(mockPrismaService.subscription.upsert).not.toHaveBeenCalled();
  });

  it('should create the row from metadata once active', async () => {
    mockPrismaService.subscription.findUnique.mockResolvedValue(null);
    mockPrismaService.subscriptionTier.findUnique.mockResolvedValue({
      id: 'tier-1',
      creatorId: 'creator-1',
      name: 'Premium',
    });
    mockPrismaService.subscription.upsert.mockResolvedValue({ id: 'sub-1' });

    await service.syncFromStripe(stripeSubscription());

    expect(mockPrismaService.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subscriberId_tierId: { subscriberId: 'fan-1', tierId: 'tier-1' } },
        create: expect.objectContaining({ stripeSubscriptionId: 'sub_stripe', status: 'ACTIVE' }),
      }),
    );
    expect(mockPrismaService.notification.create).toHaveBeenCalled();
  });

  describe('tier changes', () => {
    const periodStart = 1700000000;
    const periodEnd = 1702592000;

    const withItem = (priceId: string, productId: string, overrides: any = {}) =>
      stripeSubscription({
        items: { data: [{ id: 'si_1', price: { id: priceId, product: productId } }] },
        ...overrides,
      });

    const existingRow = (overrides: any = {}) => ({
      id: 'sub-1',
      subscriberId: 'fan-1',
      tierId: 'tier-basic',
      status: 'ACTIVE',
      tier: { creatorId: 'creator-1' },
      ...overrides,
    });

    beforeEach(() => {
      // Tier lookup by the subscription item's price / product
      mockPrismaService.subscriptionTier.findFirst.mockImplementation(({ where }: any) => {
        const ids = where.OR.map((c: any) => c.stripePriceId || c.stripeProductId);
        if (ids.includes('prod_premium')) return Promise.resolve({ id: 'tier-premium' });
        if (ids.includes('prod_basic')) return Promise.resolve({ id: 'tier-basic' });
        return Promise.resolve(null);
      });
      mockPrismaService.subscription.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'sub-1', ...data }),
      );
    });

    it('should move the row to the tier billed by Stripe after an upgrade', async () => {
      mockPrismaService.subscription.findUnique
        .mockResolvedValueOnce(existingRow())
        // (subscriberId, tierId) slot of the target tier
        .mockResolvedValueOnce(null);

      await service.syncFromStripe(withItem('price_premium', 'prod_premium'));

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ tierId: 'tier-premium', pendingTierId: null }),
      });
    });

    it('should drop an ended row holding the target tier before moving', async () => {
      mockPrismaService.subscription.findUnique
        .mockResolvedValueOnce(existingRow())
        .mockResolvedValueOnce({ id: 'sub-old', status: 'CANCELLED' });

      await service.syncFromStripe(withItem('price_premium', 'prod_premium'));

      expect(mockPrismaService.subscription.delete).toHaveBeenCalledWith({ where: { id: 'sub-old' } });
      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ tierId: 'tier-premium' }),
      });
    });

    it('should keep the paid tier and expose the pending one during a scheduled downgrade', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValueOnce(
        existingRow({ tierId: 'tier-premium' }),
      );

      await service.syncFromStripe(
        withItem('price_basic', 'prod_basic', {
          current_period_start: periodStart,
          current_period_end: periodEnd,
          metadata: {
            subscriberId: 'fan-1',
            tierId: 'tier-premium',
            downgradeTierId: 'tier-basic',
            downgradeFromTierId: 'tier-premium',
            downgradeAt: String(periodEnd),
          },
        }),
      );

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ tierId: 'tier-premium', pendingTierId: 'tier-basic' }),
      });
      expect(mockPrismaService.subscription.delete).not.toHaveBeenCalled();
    });

    it('should apply the downgrade once the new period started', async () => {
      mockPrismaService.subscription.findUnique
        .mockResolvedValueOnce(existingRow({ tierId: 'tier-premium', pendingTierId: 'tier-basic' }))
        .mockResolvedValueOnce(null);

      await service.syncFromStripe(
        withItem('price_basic', 'prod_basic', {
          current_period_start: periodEnd,
          current_period_end: periodEnd + 2592000,
          metadata: {
            subscriberId: 'fan-1',
            downgradeTierId: 'tier-basic',
            downgradeFromTierId: 'tier-premium',
            downgradeAt: String(periodEnd),
          },
        }),
      );

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ tierId: 'tier-basic', pendingTierId: null }),
      });
    });

    it('should activate the free tier when a paid → free downgrade ends', async () => {
      const freeTier = {
        id: 'tier-free',
        creatorId: 'creator-1',
        name: 'Free',
        price: 0,
        interval: 'month',
        isActive: true,
      };
      mockPrismaService.subscription.findUnique.mockResolvedValueOnce(existingRow());
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue(freeTier);
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);
      mockPrismaService.subscription.upsert.mockResolvedValue({ id: 'sub-free' });

      await service.syncFromStripe(
        withItem('price_basic', 'prod_basic', {
          status: 'canceled',
          canceled_at: periodEnd,
          current_period_start: periodStart,
          current_period_end: periodEnd,
          metadata: {
            subscriberId: 'fan-1',
            downgradeTierId: 'tier-free',
            downgradeFromTierId: 'tier-basic',
            downgradeAt: String(periodEnd),
          },
        }),
      );

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ status: 'CANCELLED', pendingTierId: null }),
      });
      expect(mockPrismaService.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subscriberId_tierId: { subscriberId: 'fan-1', tierId: 'tier-free' } },
          create: expect.objectContaining({ status: 'ACTIVE', stripeSubscriptionId: null }),
        }),
      );
    });

    it('should end the free subscription replaced by a new paid one', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValueOnce(null);
      mockPrismaService.subscriptionTier.findUnique.mockResolvedValue({
        id: 'tier-premium',
        creatorId: 'creator-1',
        name: 'Premium',
      });
      mockPrismaService.subscription.upsert.mockResolvedValue({ id: 'sub-paid' });

      await service.syncFromStripe(
        withItem('price_premium', 'prod_premium', {
          metadata: {
            subscriberId: 'fan-1',
            tierId: 'tier-premium',
            replacesSubscriptionId: 'sub-free',
          },
        }),
      );

      expect(mockPrismaService.subscription.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'sub-free',
          subscriberId: 'fan-1',
          stripeSubscriptionId: null,
          status: 'ACTIVE',
        },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      });
    });
  });
});
