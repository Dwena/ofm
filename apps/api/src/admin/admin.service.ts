import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import {
  ModerateUserDto,
  CreateReportDto,
  HandleReportDto,
  GetReportsDto,
  GetUsersDto,
  GetPlatformStatsDto,
  UserAction,
  ReportStatus,
} from './dto/admin.dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get all users with filters
   */
  async getUsers(dto: GetUsersDto) {
    const { query, role, status, page = 1, limit = 20 } = dto;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
    };

    if (query) {
      where.OR = [
        { username: { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } },
        { displayName: { contains: query, mode: 'insensitive' } },
      ];
    }

    if (role) {
      where.role = role;
    }

    if (status) {
      where.status = status;
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          role: true,
          status: true,
          avatar: true,
          emailVerified: true,
          stripeOnboarded: true,
          createdAt: true,
          lastLoginAt: true,
          creatorProfile: {
            select: {
              totalSubscribers: true,
              totalContent: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get user details
   */
  async getUserDetails(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        creatorProfile: true,
        subscriberProfile: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get user statistics
    const [contentCount, subscriptionCount, transactionSum, reportCount] = await Promise.all([
      this.prisma.content.count({
        where: { creatorId: userId, deletedAt: null },
      }),
      this.prisma.subscription.count({
        where: { subscriberId: userId },
      }),
      this.prisma.transaction.aggregate({
        where: {
          OR: [
            { fromUserId: userId },
            { toUserId: userId },
          ],
          status: 'COMPLETED',
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.report.count({
        where: { reportedId: userId },
      }),
    ]);

    return {
      user,
      stats: {
        contentCount,
        subscriptionCount,
        totalTransactionAmount: Number(transactionSum._sum.amount || 0),
        reportCount,
      },
    };
  }

  /**
   * Moderate user
   */
  async moderateUser(adminId: string, dto: ModerateUserDto) {
    const { userId, action, reason, durationDays } = dto;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === 'ADMIN') {
      throw new ForbiddenException('Cannot moderate admin users');
    }

    let newStatus: string;
    let expiresAt: Date | null = null;

    switch (action) {
      case UserAction.SUSPEND:
        newStatus = 'SUSPENDED';
        if (durationDays) {
          expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + durationDays);
        }
        break;
      case UserAction.BAN:
        newStatus = 'BANNED';
        break;
      case UserAction.ACTIVATE:
        newStatus = 'ACTIVE';
        break;
      case UserAction.WARN:
        newStatus = user.status;
        // Just log the warning, don't change status
        break;
      default:
        throw new BadRequestException('Invalid action');
    }

    // Update user status
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: newStatus as any,
      },
    });

    // Create notification for user
    await this.prisma.notification.create({
      data: {
        userId,
        type: 'SYSTEM',
        title: `Account ${action.toLowerCase()}`,
        message: reason || `Your account has been ${action.toLowerCase()}`,
      },
    });

    this.logger.log(`User ${userId} ${action} by admin ${adminId}. Reason: ${reason}`);

    return {
      success: true,
      action,
      user: updatedUser,
      expiresAt,
    };
  }

  /**
   * Create report
   */
  async createReport(reporterId: string, dto: CreateReportDto) {
    const { type, targetId, reason, description } = dto;

    // Verify target exists based on type
    let reportedId: string | null = null;

    switch (type) {
      case 'CONTENT':
        const content = await this.prisma.content.findUnique({
          where: { id: targetId },
          select: { creatorId: true },
        });
        if (!content) throw new NotFoundException('Content not found');
        reportedId = content.creatorId;
        break;

      case 'USER':
        const user = await this.prisma.user.findUnique({
          where: { id: targetId },
        });
        if (!user) throw new NotFoundException('User not found');
        reportedId = targetId;
        break;

      case 'COMMENT':
        const comment = await this.prisma.comment.findUnique({
          where: { id: targetId },
          select: { userId: true },
        });
        if (!comment) throw new NotFoundException('Comment not found');
        reportedId = comment.userId;
        break;

      case 'MESSAGE':
        // For messages, we'd need to check the message exists
        reportedId = null; // Will need sender ID
        break;
    }

    const report = await this.prisma.report.create({
      data: {
        reporterId,
        reportedId,
        reportedType: type,
        reason,
        description,
        status: 'pending',
      },
      include: {
        reporter: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
      },
    });

    this.logger.log(`Report created: ${report.id} by user ${reporterId}`);

    return report;
  }

  /**
   * Get reports with filters
   */
  async getReports(dto: GetReportsDto) {
    const { status, type, page = 1, limit = 20 } = dto;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (type) {
      where.targetType = type;
    }

    const [reports, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          reporter: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatar: true,
            },
          },
        },
      }),
      this.prisma.report.count({ where }),
    ]);

    return {
      items: reports,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Handle report (resolve, reject)
   */
  async handleReport(adminId: string, dto: HandleReportDto) {
    const { reportId, status, adminNotes, action } = dto;

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    // Update report
    const updatedReport = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        resolution: adminNotes,
      },
    });

    // If resolved with action, take action on reported user
    if (status === 'RESOLVED' && action && report.reportedId) {
      await this.moderateUser(adminId, {
        userId: report.reportedId,
        action,
        reason: `Report resolved: ${report.reason}`,
      });
    }

    this.logger.log(`Report ${reportId} handled by admin ${adminId}: ${status}`);

    return updatedReport;
  }

  /**
   * Get platform statistics
   */
  async getPlatformStats(dto: GetPlatformStatsDto) {
    const { startDate, endDate } = dto;

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Last 30 days
    const end = endDate ? new Date(endDate) : new Date();

    // Run all queries in parallel
    const [
      totalUsers,
      newUsers,
      totalCreators,
      newCreators,
      activeUsers,
      totalContent,
      newContent,
      totalSubscriptions,
      activeSubscriptions,
      totalRevenue,
      platformFees,
      totalReports,
      pendingReports,
    ] = await Promise.all([
      // Total users
      this.prisma.user.count({
        where: { deletedAt: null },
      }),

      // New users in period
      this.prisma.user.count({
        where: {
          createdAt: {
            gte: start,
            lte: end,
          },
          deletedAt: null,
        },
      }),

      // Total creators
      this.prisma.user.count({
        where: {
          role: 'CREATOR',
          deletedAt: null,
        },
      }),

      // New creators in period
      this.prisma.user.count({
        where: {
          role: 'CREATOR',
          createdAt: {
            gte: start,
            lte: end,
          },
          deletedAt: null,
        },
      }),

      // Active users (logged in during period)
      this.prisma.user.count({
        where: {
          lastLoginAt: {
            gte: start,
            lte: end,
          },
          deletedAt: null,
        },
      }),

      // Total content
      this.prisma.content.count({
        where: {
          status: 'PUBLISHED',
          deletedAt: null,
        },
      }),

      // New content in period
      this.prisma.content.count({
        where: {
          publishedAt: {
            gte: start,
            lte: end,
          },
          status: 'PUBLISHED',
          deletedAt: null,
        },
      }),

      // Total subscriptions
      this.prisma.subscription.count(),

      // Active subscriptions
      this.prisma.subscription.count({
        where: { status: 'ACTIVE' },
      }),

      // Total revenue
      this.prisma.transaction.aggregate({
        where: {
          status: 'COMPLETED',
          createdAt: {
            gte: start,
            lte: end,
          },
        },
        _sum: {
          amount: true,
        },
      }),

      // Platform fees
      this.prisma.transaction.aggregate({
        where: {
          status: 'COMPLETED',
          createdAt: {
            gte: start,
            lte: end,
          },
        },
        _sum: {
          platformFee: true,
        },
      }),

      // Total reports
      this.prisma.report.count(),

      // Pending reports
      this.prisma.report.count({
        where: { status: 'PENDING' },
      }),
    ]);

    // Get revenue by type
    const revenueByType = await this.prisma.transaction.groupBy({
      by: ['type'],
      where: {
        status: 'COMPLETED',
        createdAt: {
          gte: start,
          lte: end,
        },
      },
      _sum: {
        amount: true,
      },
    });

    // Get content by type
    const contentByType = await this.prisma.content.groupBy({
      by: ['type'],
      where: {
        status: 'PUBLISHED',
        deletedAt: null,
      },
      _count: {
        id: true,
      },
    });

    // Get top creators
    const topCreators = await this.prisma.user.findMany({
      where: {
        role: 'CREATOR',
        deletedAt: null,
      },
      orderBy: {
        creatorProfile: {
          totalSubscribers: 'desc',
        },
      },
      take: 10,
      select: {
        id: true,
        username: true,
        displayName: true,
        avatar: true,
        creatorProfile: {
          select: {
            totalSubscribers: true,
            totalContent: true,
          },
        },
      },
    });

    return {
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
      users: {
        total: totalUsers,
        new: newUsers,
        active: activeUsers,
        creators: totalCreators,
        newCreators,
      },
      content: {
        total: totalContent,
        new: newContent,
        byType: contentByType.map((item: any) => ({
          type: item.type,
          count: item._count.id,
        })),
      },
      subscriptions: {
        total: totalSubscriptions,
        active: activeSubscriptions,
        churnRate: totalSubscriptions > 0
          ? ((totalSubscriptions - activeSubscriptions) / totalSubscriptions) * 100
          : 0,
      },
      revenue: {
        total: Number(totalRevenue._sum.amount || 0) / 100,
        platformFees: Number(platformFees._sum.platformFee || 0) / 100,
        byType: revenueByType.map((item: any) => ({
          type: item.type,
          amount: Number(item._sum.amount || 0) / 100,
        })),
      },
      reports: {
        total: totalReports,
        pending: pendingReports,
      },
      topCreators,
    };
  }

  /**
   * Get activity logs (recent actions)
   */
  async getActivityLogs(page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;

    // Get recent transactions, content creations, subscriptions, reports
    const [recentTransactions, recentContent, recentSubscriptions, recentReports] = await Promise.all([
      this.prisma.transaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          type: true,
          amount: true,
          status: true,
          createdAt: true,
          fromUser: {
            select: { username: true },
          },
          toUser: {
            select: { username: true },
          },
        },
      }),

      this.prisma.content.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        where: { deletedAt: null },
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          createdAt: true,
          creator: {
            select: { username: true },
          },
        },
      }),

      this.prisma.subscription.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          createdAt: true,
          subscriber: {
            select: { username: true },
          },
          tier: {
            select: {
              name: true,
              creator: {
                select: { username: true },
              },
            },
          },
        },
      }),

      this.prisma.report.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          reason: true,
          status: true,
          reportedType: true,
          createdAt: true,
          reporter: {
            select: { username: true },
          },
        },
      }),
    ]);

    // Combine and format all activities
    const activities: any[] = [];

    recentTransactions.forEach((tx: any) => {
      activities.push({
        type: 'TRANSACTION',
        id: tx.id,
        description: `${tx.fromUser?.username || 'Unknown'} → ${tx.toUser?.username || 'Unknown'}: ${tx.type}`,
        amount: tx.amount,
        status: tx.status,
        timestamp: tx.createdAt,
      });
    });

    recentContent.forEach((content: any) => {
      activities.push({
        type: 'CONTENT',
        id: content.id,
        description: `${content.creator.username} created ${content.type}: ${content.title || 'Untitled'}`,
        status: content.status,
        timestamp: content.createdAt,
      });
    });

    recentSubscriptions.forEach((sub: any) => {
      activities.push({
        type: 'SUBSCRIPTION',
        id: sub.id,
        description: `${sub.subscriber.username} subscribed to ${sub.tier.creator.username} (${sub.tier.name})`,
        status: sub.status,
        timestamp: sub.createdAt,
      });
    });

    recentReports.forEach((report: any) => {
      activities.push({
        type: 'REPORT',
        id: report.id,
        description: `${report.reporter.username} reported ${report.reportedType}: ${report.reason}`,
        status: report.status,
        timestamp: report.createdAt,
      });
    });

    // Sort all activities by timestamp
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return {
      items: activities.slice(skip, skip + limit),
      total: activities.length,
    };
  }

  /**
   * Delete user (admin only, permanent)
   */
  async deleteUser(adminId: string, userId: string, reason: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === 'ADMIN') {
      throw new ForbiddenException('Cannot delete admin users');
    }

    // Soft delete
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        status: 'BANNED',
      },
    });

    this.logger.warn(`User ${userId} deleted by admin ${adminId}. Reason: ${reason}`);

    return {
      success: true,
      message: 'User deleted successfully',
    };
  }
}
