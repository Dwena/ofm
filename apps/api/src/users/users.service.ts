import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

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
        role: true,
        createdAt: true,
        creatorProfile: {
          select: {
            totalSubscribers: true,
            totalContent: true,
            averageRating: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(userId: string, updateProfileDto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...updateProfileDto,
      },
      select: {
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

    return user;
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
