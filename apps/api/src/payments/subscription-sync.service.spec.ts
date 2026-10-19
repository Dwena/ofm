import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionSyncService } from './subscription-sync.service';
import { PrismaService } from '../common/database/prisma.service';

describe('SubscriptionSyncService', () => {
  let service: SubscriptionSyncService;

  const mockPrismaService = {
    subscription: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    subscriptionTier: {
      findUnique: jest.fn(),
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
});
