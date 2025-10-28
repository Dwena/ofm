import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { CreateTierDto, UpdateTierDto } from './dto/subscription-tier.dto';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(private prisma: PrismaService) {}

  async getCreatorTiers(creatorId: string) {
    return this.prisma.subscriptionTier.findMany({
      where: {
        creatorId,
        isActive: true,
      },
      orderBy: {
        price: 'asc',
      },
    });
  }

  async getUserSubscriptions(userId: string) {
    return this.prisma.subscription.findMany({
      where: {
        subscriberId: userId,
      },
      include: {
        tier: {
          include: {
            creator: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getCreatorSubscribers(creatorId: string) {
    return this.prisma.subscription.findMany({
      where: {
        tier: {
          creatorId,
        },
        status: 'ACTIVE',
      },
      include: {
        subscriber: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatar: true,
          },
        },
        tier: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // Tier Management
  async createTier(creatorId: string, dto: CreateTierDto) {
    // Verify user is a creator
    const user = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { role: true },
    });

    if (user?.role !== 'CREATOR') {
      throw new ForbiddenException('Only creators can create subscription tiers');
    }

    // Create tier
    const tier = await this.prisma.subscriptionTier.create({
      data: {
        creatorId,
        name: dto.name,
        description: dto.description,
        price: dto.price,
        currency: dto.currency || 'EUR',
        interval: dto.interval || 'month',
        benefits: dto.benefits || [],
        isActive: dto.isActive !== undefined ? dto.isActive : true,
      },
    });

    this.logger.log(`Tier created: ${tier.id} by creator ${creatorId}`);
    return tier;
  }

  async getMyTiers(creatorId: string) {
    // Verify user is a creator
    const user = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { role: true },
    });

    if (user?.role !== 'CREATOR') {
      throw new ForbiddenException('Only creators can view their tiers');
    }

    const tiers = await this.prisma.subscriptionTier.findMany({
      where: { creatorId },
      orderBy: { price: 'asc' },
    });

    // Get subscriber counts for each tier
    const tiersWithCounts = await Promise.all(
      tiers.map(async (tier: any) => {
        const subscribersCount = await this.prisma.subscription.count({
          where: {
            tierId: tier.id,
            status: 'ACTIVE',
          },
        });

        return {
          ...tier,
          subscribersCount,
        };
      }),
    );

    return tiersWithCounts;
  }

  async updateTier(creatorId: string, tierId: string, dto: UpdateTierDto) {
    // Check ownership
    const tier = await this.prisma.subscriptionTier.findUnique({
      where: { id: tierId },
    });

    if (!tier) {
      throw new NotFoundException('Tier not found');
    }

    if (tier.creatorId !== creatorId) {
      throw new ForbiddenException('You can only update your own tiers');
    }

    // Update tier
    const updatedTier = await this.prisma.subscriptionTier.update({
      where: { id: tierId },
      data: {
        name: dto.name,
        description: dto.description,
        price: dto.price,
        currency: dto.currency,
        interval: dto.interval,
        benefits: dto.benefits,
        isActive: dto.isActive,
      },
    });

    this.logger.log(`Tier updated: ${tierId} by creator ${creatorId}`);
    return updatedTier;
  }

  async deleteTier(creatorId: string, tierId: string) {
    // Check ownership
    const tier = await this.prisma.subscriptionTier.findUnique({
      where: { id: tierId },
    });

    if (!tier) {
      throw new NotFoundException('Tier not found');
    }

    if (tier.creatorId !== creatorId) {
      throw new ForbiddenException('You can only delete your own tiers');
    }

    // Check if tier has active subscriptions
    const activeSubscriptions = await this.prisma.subscription.count({
      where: {
        tierId,
        status: 'ACTIVE',
      },
    });

    if (activeSubscriptions > 0) {
      throw new BadRequestException(
        `Cannot delete tier with ${activeSubscriptions} active subscription(s). Please deactivate it instead.`,
      );
    }

    // Delete tier
    await this.prisma.subscriptionTier.delete({
      where: { id: tierId },
    });

    this.logger.log(`Tier deleted: ${tierId} by creator ${creatorId}`);
    return { message: 'Tier deleted successfully' };
  }

  // TODO: Implement subscription creation, cancellation, etc.
}
