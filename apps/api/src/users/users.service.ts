import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MessagingService } from '../messaging/messaging.service';
import { UpdateProfileDto, CREATOR_PROFILE_FIELDS } from './dto/update-profile.dto';

export type ProfileImageKind = 'avatar' | 'cover';

export const PROFILE_IMAGE_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export const PROFILE_IMAGE_MAX_SIZE: Record<ProfileImageKind, number> = {
  avatar: 5 * 1024 * 1024,
  cover: 10 * 1024 * 1024,
};

// Storage keys of profile images: profiles/<userId>/<random id>.<ext>
export const PROFILE_IMAGE_KEY_PATTERN =
  /^profiles\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{8,32}\.(jpg|png|gif|webp)$/;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
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

  /**
   * Update the public profile (User) and, for creators, the creator settings
   * (CreatorProfile: welcome message, messages, tips). Returns the same shape
   * as GET /users/me.
   */
  async updateProfile(userId: string, updateProfileDto: UpdateProfileDto) {
    // Only the fields sent are changed; an empty string (or null) clears the field
    const userData: Record<string, unknown> = {};
    const creatorData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updateProfileDto)) {
      if (value === undefined) continue;
      const trimmed = typeof value === 'string' ? value.trim() : value;
      const target = (CREATOR_PROFILE_FIELDS as readonly string[]).includes(key) ? creatorData : userData;
      target[key] = trimmed === '' ? null : trimmed;
    }

    if (Object.keys(creatorData).length > 0) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      if (user.role !== 'CREATOR') {
        throw new BadRequestException('Seuls les créateurs ont des paramètres créateur');
      }
      await this.prisma.creatorProfile.upsert({
        where: { userId },
        create: { userId, ...creatorData },
        update: creatorData,
      });
    }

    if (Object.keys(userData).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: userData,
      });
    }

    return this.findById(userId);
  }

  /**
   * Upload a profile image (avatar or cover) and set it on the user.
   * The file is stored privately and served by GET /users/profile-images/...
   * so it can be shown anywhere with a plain <img src>.
   */
  async uploadProfileImage(
    userId: string,
    kind: ProfileImageKind,
    file: Express.Multer.File | undefined,
    publicBaseUrl: string,
  ) {
    if (!file || !file.size) {
      throw new BadRequestException('Aucune image fournie');
    }
    const ext = PROFILE_IMAGE_MIME_TYPES[file.mimetype];
    if (!ext) {
      throw new BadRequestException('Format non supporté (JPG, PNG, GIF ou WebP)');
    }
    const maxSize = PROFILE_IMAGE_MAX_SIZE[kind];
    if (file.size > maxSize) {
      throw new BadRequestException(`L'image ne doit pas dépasser ${maxSize / 1024 / 1024} Mo`);
    }

    let key: string;
    try {
      ({ key } = await this.storageService.uploadFile(
        file.buffer,
        `${kind}.${ext}`,
        file.mimetype,
        `profiles/${userId}`,
      ));
    } catch {
      throw new ServiceUnavailableException(
        "Le stockage des fichiers est indisponible. Réessayez dans quelques instants.",
      );
    }
    const url = `${publicBaseUrl.replace(/\/$/, '')}/users/profile-images/${key}`;

    const field = kind === 'avatar' ? 'avatar' : 'coverImage';
    const previous = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true, coverImage: true },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { [field]: url },
    });

    // Drop the replaced upload (seeded / external URLs are left alone)
    const previousKey = this.profileImageKey(previous?.[field]);
    if (previousKey && previousKey !== key) {
      this.storageService.deleteFile(previousKey).catch((error) =>
        this.logger.warn(`Failed to delete old profile image ${previousKey}: ${error.message}`),
      );
    }

    return this.findById(userId);
  }

  /**
   * Storage key of an uploaded profile image URL, null for any other URL
   */
  profileImageKey(url?: string | null): string | null {
    if (!url) return null;
    const marker = '/users/profile-images/';
    const index = url.indexOf(marker);
    if (index === -1) return null;
    const key = url.slice(index + marker.length);
    return PROFILE_IMAGE_KEY_PATTERN.test(key) ? key : null;
  }

  async getProfileImage(key: string): Promise<{ buffer: Buffer; contentType: string }> {
    if (!PROFILE_IMAGE_KEY_PATTERN.test(key)) {
      throw new NotFoundException('Image introuvable');
    }
    try {
      const buffer = await this.storageService.getFile(key);
      const ext = key.split('.').pop() as string;
      const contentType =
        Object.entries(PROFILE_IMAGE_MIME_TYPES).find(([, value]) => value === ext)?.[0] ||
        'application/octet-stream';
      return { buffer, contentType };
    } catch {
      throw new NotFoundException('Image introuvable');
    }
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
