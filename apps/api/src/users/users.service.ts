import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { MessagingService } from '../messaging/messaging.service';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private messagingService: MessagingService,
  ) {}

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

  /**
   * Public profile of a user, as seen by `viewerId`. Counters are computed
   * from live data (active subscribers, visible publications, follows) and
   * the viewer-specific flags drive the profile actions (message, stories, live).
   */
  async findByUsername(username: string, viewerId?: string) {
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
        status: true,
        kycStatus: true,
        deletedAt: true,
        createdAt: true,
        creatorProfile: {
          select: {
            averageRating: true,
            allowMessages: true,
            allowTips: true,
            minimumTip: true,
          },
        },
        _count: {
          select: { followers: true },
        },
      },
    });

    // Banned or deleted accounts have no public profile
    if (!user || user.deletedAt || user.status === 'BANNED') {
      throw new NotFoundException('User not found');
    }

    const { _count, creatorProfile } = user;
    const isSelf = viewerId === user.id;
    const isOther = !!viewerId && !isSelf;

    let creator: {
      totalSubscribers: number;
      totalContent: number;
      averageRating: number;
      allowMessages: boolean;
      allowTips: boolean;
      minimumTip: number;
    } | null = null;
    let liveStream: { id: string; title: string } | null = null;
    let hasActiveStories = false;
    let hasUnseenStories = false;

    if (user.role === 'CREATOR' && creatorProfile) {
      const now = new Date();
      const activeStoriesWhere = { creatorId: user.id, deletedAt: null, expiresAt: { gt: now } };

      const [subscribers, totalContent, live, activeStories, unseenStories] = await Promise.all([
        // Distinct fans with an active subscription (free or paid)
        this.prisma.subscription.findMany({
          where: { tier: { creatorId: user.id }, status: 'ACTIVE' },
          distinct: ['subscriberId'],
          select: { subscriberId: true },
        }),
        // Same visibility rules as the profile's content grid
        this.prisma.content.count({
          where: {
            creatorId: user.id,
            status: 'PUBLISHED',
            deletedAt: null,
            ...(!isSelf && { visibility: { not: 'PRIVATE' as const } }),
          },
        }),
        this.prisma.liveStream.findFirst({
          where: { creatorId: user.id, status: 'LIVE' },
          orderBy: { startedAt: 'desc' },
          select: { id: true, title: true },
        }),
        this.prisma.story.count({ where: activeStoriesWhere }),
        isOther
          ? this.prisma.story.count({
              where: { ...activeStoriesWhere, views: { none: { viewerId } } },
            })
          : Promise.resolve(0),
      ]);

      creator = {
        totalSubscribers: subscribers.length,
        totalContent,
        averageRating: Number(creatorProfile.averageRating),
        allowMessages: creatorProfile.allowMessages,
        allowTips: creatorProfile.allowTips,
        minimumTip: Number(creatorProfile.minimumTip),
      };
      liveStream = live;
      hasActiveStories = activeStories > 0;
      hasUnseenStories = unseenStories > 0;
    }

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      avatar: user.avatar,
      coverImage: user.coverImage,
      location: user.location,
      website: user.website,
      role: user.role,
      createdAt: user.createdAt,
      isVerified: user.kycStatus === 'VERIFIED',
      creatorProfile: creator,
      // Free follows (Follow table), distinct from paid subscribers
      followersCount: _count?.followers ?? 0,
      // Ongoing live of the creator, if any
      liveStream,
      hasActiveStories,
      hasUnseenStories,
      // Creators can disable messages for people they never wrote to
      canMessage: isOther ? await this.messagingService.canMessage(viewerId as string, user.id) : false,
    };
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
