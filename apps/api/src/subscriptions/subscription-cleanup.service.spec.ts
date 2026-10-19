import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionCleanupService } from './subscription-cleanup.service';
import { StripeService } from '../payments/stripe.service';

describe('SubscriptionCleanupService', () => {
  let service: SubscriptionCleanupService;

  const mockStripeService = {
    listIncompleteSubscriptions: jest.fn(),
    cancelSubscription: jest.fn(),
  };

  const now = new Date('2026-10-19T12:00:00Z');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionCleanupService,
        { provide: StripeService, useValue: mockStripeService },
      ],
    }).compile();

    service = module.get<SubscriptionCleanupService>(SubscriptionCleanupService);

    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should only look at subscriptions incomplete for more than 23 hours', async () => {
    mockStripeService.listIncompleteSubscriptions.mockResolvedValue([]);

    await service.cancelAbandonedIncompleteSubscriptions();

    expect(mockStripeService.listIncompleteSubscriptions).toHaveBeenCalledWith({
      createdBefore: Math.floor(now.getTime() / 1000) - 23 * 3600,
    });
  });

  it('should cancel abandoned subscriptions created by subscribe only', async () => {
    mockStripeService.listIncompleteSubscriptions.mockResolvedValue([
      { id: 'sub_ofm', metadata: { platform: 'ofm', subscriberId: 'fan-1', tierId: 'tier-1' } },
      { id: 'sub_foreign', metadata: {} },
      { id: 'sub_legacy', metadata: { platform: 'ofm' } },
    ]);
    mockStripeService.cancelSubscription.mockResolvedValue({});

    const result = await service.cancelAbandonedIncompleteSubscriptions();

    expect(mockStripeService.cancelSubscription).toHaveBeenCalledTimes(1);
    expect(mockStripeService.cancelSubscription).toHaveBeenCalledWith('sub_ofm');
    expect(result).toEqual({ cancelledCount: 1, failedCount: 0 });
  });

  it('should keep going when one cancellation fails', async () => {
    mockStripeService.listIncompleteSubscriptions.mockResolvedValue([
      { id: 'sub_1', metadata: { platform: 'ofm', subscriberId: 'fan-1' } },
      { id: 'sub_2', metadata: { platform: 'ofm', subscriberId: 'fan-2' } },
    ]);
    mockStripeService.cancelSubscription
      .mockRejectedValueOnce(new Error('No such subscription'))
      .mockResolvedValueOnce({});

    const result = await service.cancelAbandonedIncompleteSubscriptions();

    expect(mockStripeService.cancelSubscription).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ cancelledCount: 1, failedCount: 1 });
  });

  it('should not throw when Stripe cannot be reached', async () => {
    mockStripeService.listIncompleteSubscriptions.mockRejectedValue(new Error('Network error'));

    await expect(service.cancelAbandonedIncompleteSubscriptions()).resolves.toEqual({
      cancelledCount: 0,
      failedCount: 0,
    });
  });
});
