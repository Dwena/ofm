import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { CREATOR_SETTING_FIELDS, UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        displayName: true,
        bio: true,
        avatar: true,
        coverImage: true,
        location: true,
        website: true,
        emailVerified: true,
        phoneVerified: true,
        twoFactorEnabled: true,
        kycStatus: true,
        createdAt: true,
        lastActiveAt: true,
        creatorProfile: true,
        subscriberProfile: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findByUsername(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        displayName: true,
        bio: true,
        avatar: true,
        coverImage: true,
        location: true,
        website: true,
        role: true,
        createdAt: true,
        creatorProfile: {
          select: {
            totalSubscribers: true,
            totalContent: true,
            averageRating: true,
            allowMessages: true,
          },
        },
        _count: {
          select: { followers: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const { _count, creatorProfile, ...profile } = user;

    return {
      ...profile,
      creatorProfile: creatorProfile
        ? { ...creatorProfile, averageRating: Number(creatorProfile.averageRating) }
        : null,
      // Free follows (Follow table), distinct from paid subscribers
      followersCount: _count?.followers ?? 0,
    };
  }

  async updateProfile(userId: string, updateProfileDto: UpdateProfileDto) {
    // Only the fields sent are changed; an empty string (or null) clears the field
    const data: Record<string, unknown> = {};
    const creatorData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updateProfileDto)) {
      if (value === undefined) continue;
      const trimmed = typeof value === 'string' ? value.trim() : value;
      const target = (CREATOR_SETTING_FIELDS as readonly string[]).includes(key) ? creatorData : data;
      target[key] = trimmed === '' ? null : trimmed;
    }

    if (Object.keys(creatorData).length > 0) {
      const creatorProfile = await this.prisma.creatorProfile.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!creatorProfile) {
        throw new BadRequestException('Ces paramètres sont réservés aux créateurs');
      }
      data.creatorProfile = { update: creatorData };
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        creatorProfile: {
          select: {
            allowMessages: true,
            allowTips: true,
            autoAcceptSubscribers: true,
            welcomeMessage: true,
            minimumTip: true,
          },
        },
        id: true,
        email: true,
        username: true,
        displayName: true,
        bio: true,
        avatar: true,
        coverImage: true,
        location: true,
        website: true,
      },
    });

    const { creatorProfile, ...profile } = user;
    return {
      ...profile,
      creatorProfile: creatorProfile
        ? { ...creatorProfile, minimumTip: Number(creatorProfile.minimumTip) }
        : null,
    };
  }

  async updateAvatar(userId: string, avatarUrl: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatar: avatarUrl },
    });
  }

  async updateCoverImage(userId: string, coverImageUrl: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { coverImage: coverImageUrl },
    });
  }

  async getCreatorStats(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        creatorProfile: true,
      },
    });

    if (!user || user.role !== 'CREATOR') {
      throw new BadRequestException('User is not a creator');
    }

    // Get active subscribers count
    const activeSubscribers = await this.prisma.subscription.count({
      where: {
        tier: {
          creatorId: userId,
        },
        status: 'ACTIVE',
      },
    });

    // Get total earnings this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyEarnings = await this.prisma.transaction.aggregate({
      where: {
        toUserId: userId,
        status: 'COMPLETED',
        createdAt: {
          gte: startOfMonth,
        },
      },
      _sum: {
        netAmount: true,
      },
    });

    // Get content stats
    const contentStats = await this.prisma.content.groupBy({
      by: ['type'],
      where: {
        creatorId: userId,
        status: 'PUBLISHED',
      },
      _count: true,
    });

    return {
      profile: user.creatorProfile,
      activeSubscribers,
      monthlyEarnings: monthlyEarnings._sum.netAmount || 0,
      contentByType: contentStats,
    };
  }
}
