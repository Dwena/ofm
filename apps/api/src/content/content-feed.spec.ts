import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ContentService } from './content.service';
import { PrismaService } from '../common/database/prisma.service';
import { PaymentFlowService } from '../payments/payment-flow.service';
import { StorageService } from '../storage/storage.service';

describe('ContentService feed', () => {
  let service: ContentService;

  const mockPrismaService = {
    content: { findMany: jest.fn() },
    subscription: { findMany: jest.fn() },
    contentUnlock: { findMany: jest.fn() },
    contentLike: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: PaymentFlowService, useValue: {} },
        { provide: StorageService, useValue: { getSignedUrl: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
    jest.clearAllMocks();
    mockPrismaService.content.findMany.mockResolvedValue([]);
    mockPrismaService.subscription.findMany.mockResolvedValue([]);
  });

  it('counts only comments that are not soft-deleted', async () => {
    await service.getFeed('viewer-1', 2, 10);

    expect(mockPrismaService.content.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          _count: { select: { likes: true, comments: { where: { deletedAt: null } } } },
        }),
        skip: 10,
        take: 10,
      }),
    );
  });

  it('returns an empty subscriptions feed without querying content when not subscribed', async () => {
    const result = await service.getSubscriptionsFeed('viewer-1');

    expect(result).toEqual([]);
    expect(mockPrismaService.content.findMany).not.toHaveBeenCalled();
  });
});
