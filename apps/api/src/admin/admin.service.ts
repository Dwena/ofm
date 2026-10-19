import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import {
  ModerateUserDto,
  CreateReportDto,
  HandleReportDto,
  GetReportsDto,
  GetUsersDto,
  GetPlatformStatsDto,
  GetAdminContentDto,
  GetAuditLogsDto,
  AdminContentFilter,
  UserAction,
  ReportStatus,
} from './dto/admin.dto';
import {
  REPORT_STATUS_TO_DB,
  reportStatusValues,
  normalizeReportStatus,
} from './report-status.util';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Record an admin action in the audit log. Never fails the calling action.
   */
  private async logAdminAction(
    adminId: string,
    action: string,
    resource: string,
    resourceId: string,
    metadata?: Record<string, any>,
  ) {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: adminId,
          action,
          resource,
          resourceId,
          metadata,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to write audit log for ${action}: ${error.message}`);
    }
  }

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

    // Never expose credentials to the back-office
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, twoFactorSecret, ...safeUser } = user;

    return {
      user: safeUser,
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

    let expiresAt: Date | null = null;
    const data: Record<string, any> = {};

    switch (action) {
      case UserAction.SUSPEND:
        data.status = 'SUSPENDED';
        data.suspensionReason = reason || null;
        if (durationDays) {
          expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + durationDays);
        }
        // suspendedUntil is picked up by the hourly SuspensionSchedulerService
        data.suspendedUntil = expiresAt;
        break;
      case UserAction.BAN:
        data.status = 'BANNED';
        data.bannedAt = new Date();
        data.banReason = reason || null;
        break;
      case UserAction.ACTIVATE:
        data.status = 'ACTIVE';
        data.bannedAt = null;
        data.banReason = null;
        data.suspendedUntil = null;
        data.suspensionReason = null;
        break;
      case UserAction.WARN:
        // Just log the warning, don't change status
        break;
      default:
        throw new BadRequestException('Invalid action');
    }

    // Update user status
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        bannedAt: true,
        banReason: true,
        suspendedUntil: true,
        suspensionReason: true,
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

    await this.logAdminAction(adminId, `USER_${action}`, 'USER', userId, {
      reason,
      durationDays,
      expiresAt,
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
        reportedId: reportedId || '',
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
      where.status = { in: reportStatusValues(status) };
    }

    if (type) {
      where.reportedType = { in: [type, type.toLowerCase()] };
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

    const items = await Promise.all(
      reports.map(async (report: any) => {
        const target = await this.resolveReportTarget(report.reportedType, report.reportedId);
        return {
          ...report,
          reportedType: report.reportedType?.toUpperCase(),
          status: normalizeReportStatus(report.status),
          reportedEntity: target.entity,
          reportedUser: target.user,
        };
      }),
    );

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Resolve a report's target entity and the user responsible for it.
   * reportedId is the id of the reported entity (user, content, comment, message).
   */
  private async resolveReportTarget(
    reportedType: string,
    reportedId: string,
  ): Promise<{ entity: any; user: { id: string; username: string; displayName: string | null; avatar: string | null } | null }> {
    const userSelect = { id: true, username: true, displayName: true, avatar: true };
    if (!reportedId) return { entity: null, user: null };

    switch (reportedType?.toUpperCase()) {
      case 'CONTENT': {
        const content = await this.prisma.content.findUnique({
          where: { id: reportedId },
          select: {
            id: true,
            title: true,
            type: true,
            status: true,
            deletedAt: true,
            createdAt: true,
            creator: { select: userSelect },
          },
        });
        if (content) return { entity: content, user: content.creator };
        break;
      }
      case 'COMMENT': {
        const comment = await this.prisma.comment.findUnique({
          where: { id: reportedId },
          select: { id: true, text: true, contentId: true, createdAt: true, user: { select: userSelect } },
        });
        if (comment) return { entity: comment, user: comment.user };
        break;
      }
      case 'MESSAGE': {
        const message = await this.prisma.message.findUnique({
          where: { id: reportedId },
          select: { id: true, content: true, createdAt: true, sender: { select: userSelect } },
        });
        if (message) return { entity: message, user: message.sender };
        break;
      }
      default:
        break;
    }

    // USER reports, or legacy reports that stored the reported user's id directly
    const user = await this.prisma.user.findUnique({
      where: { id: reportedId },
      select: userSelect,
    });
    return { entity: user, user };
  }

  /**
   * Handle report (resolve, reject)
   */
  async handleReport(adminId: string, dto: HandleReportDto, actorRole: string = 'ADMIN') {
    const { reportId, status, adminNotes, action, durationDays, removeContent } = dto;

    // Moderators triage reports; sanctions and takedowns stay admin-only
    if (actorRole !== 'ADMIN' && (action || removeContent)) {
      throw new ForbiddenException('Seuls les administrateurs peuvent appliquer des sanctions');
    }

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
        status: REPORT_STATUS_TO_DB[status] ?? status,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        resolution: adminNotes,
      },
    });

    await this.logAdminAction(adminId, `REPORT_${status}`, 'REPORT', reportId, {
      notes: adminNotes,
      action,
      removeContent,
    });

    if (status === ReportStatus.RESOLVED) {
      const target = await this.resolveReportTarget(report.reportedType, report.reportedId);

      // Remove the reported content if requested
      if (removeContent && report.reportedType?.toUpperCase() === 'CONTENT' && target.entity) {
        await this.removeContent(adminId, report.reportedId, `Report resolved: ${report.reason}`);
      }

      // Take action on the responsible user
      if (action && target.user) {
        await this.moderateUser(adminId, {
          userId: target.user.id,
          action,
          durationDays,
          reason: adminNotes || `Report resolved: ${report.reason}`,
        });
      }
    }

    // Let the reporter know once a final decision is taken
    if (report.reporterId && (status === ReportStatus.RESOLVED || status === ReportStatus.REJECTED)) {
      try {
        await this.prisma.notification.create({
          data: {
            userId: report.reporterId,
            type: 'SYSTEM',
            title: 'Mise à jour de votre signalement',
            message:
              status === ReportStatus.RESOLVED
                ? 'Votre signalement a été examiné et des mesures ont été prises. Merci de votre vigilance.'
                : 'Votre signalement a été examiné : aucune infraction n\'a été constatée.',
          },
        });
      } catch (error) {
        this.logger.error(`Failed to notify reporter of report ${reportId}: ${error.message}`);
      }
    }

    this.logger.log(`Report ${reportId} handled by admin ${adminId}: ${status}`);

    return { ...updatedReport, status: normalizeReportStatus(updatedReport.status) };
  }

  // ==================== Content Management ====================

  /**
   * List content for moderation. FLAGGED = under review or with pending reports,
   * REMOVED = soft-deleted content.
   */
  async getContent(dto: GetAdminContentDto) {
    const { query, status, type, filter = AdminContentFilter.ALL, page = 1, limit = 20 } = dto;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filter === AdminContentFilter.REMOVED) {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
    }

    if (filter === AdminContentFilter.FLAGGED) {
      const pendingReports = await this.prisma.report.findMany({
        where: {
          reportedType: { in: ['CONTENT', 'content'] },
          status: { in: reportStatusValues(ReportStatus.PENDING) },
        },
        select: { reportedId: true },
      });
      where.OR = [
        { status: 'UNDER_REVIEW' },
        { id: { in: [...new Set(pendingReports.map((r: any) => r.reportedId))] } },
      ];
    }

    if (status) where.status = status;
    if (type) where.type = type;

    if (query) {
      where.AND = [
        {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
            { creator: { username: { contains: query, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    const [contents, total] = await Promise.all([
      this.prisma.content.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          description: true,
          type: true,
          status: true,
          visibility: true,
          isPpv: true,
          ppvPrice: true,
          viewCount: true,
          likeCount: true,
          commentCount: true,
          isModerated: true,
          moderatedAt: true,
          moderationNotes: true,
          publishedAt: true,
          createdAt: true,
          deletedAt: true,
          creator: {
            select: { id: true, username: true, displayName: true, avatar: true },
          },
          files: {
            select: { id: true, mimeType: true, thumbnailPath: true },
            take: 1,
            orderBy: { order: 'asc' },
          },
        },
      }),
      this.prisma.content.count({ where }),
    ]);

    // Count pending reports for the returned page
    const ids = contents.map((c: any) => c.id);
    const reportCounts = ids.length
      ? await this.prisma.report.groupBy({
          by: ['reportedId'],
          where: {
            reportedId: { in: ids },
            reportedType: { in: ['CONTENT', 'content'] },
            status: { in: reportStatusValues(ReportStatus.PENDING) },
          },
          _count: { id: true },
        })
      : [];
    const countById = new Map<string, number>(
      reportCounts.map((r: any) => [r.reportedId, r._count.id]),
    );

    return {
      items: contents.map((c: any) => ({
        ...c,
        ppvPrice: c.ppvPrice !== null && c.ppvPrice !== undefined ? Number(c.ppvPrice) : null,
        pendingReports: countById.get(c.id) || 0,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Remove content (moderation takedown, soft delete)
   */
  async removeContent(adminId: string, contentId: string, reason?: string) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: { id: true, creatorId: true, title: true, deletedAt: true },
    });

    if (!content) {
      throw new NotFoundException('Content not found');
    }

    if (content.deletedAt) {
      throw new BadRequestException('Content already removed');
    }

    const updated = await this.prisma.content.update({
      where: { id: contentId },
      data: {
        status: 'REJECTED',
        deletedAt: new Date(),
        isModerated: true,
        moderatedAt: new Date(),
        moderatedBy: adminId,
        moderationNotes: reason || null,
      },
      select: { id: true, status: true, deletedAt: true, moderationNotes: true },
    });

    await this.prisma.notification.create({
      data: {
        userId: content.creatorId,
        type: 'CONTENT_REJECTED',
        title: 'Contenu retiré',
        message: `Votre contenu "${content.title || 'Sans titre'}" a été retiré par la modération.${reason ? ` Raison: ${reason}` : ''}`,
      },
    });

    await this.logAdminAction(adminId, 'CONTENT_REMOVED', 'CONTENT', contentId, { reason });

    this.logger.log(`Content ${contentId} removed by admin ${adminId}. Reason: ${reason}`);

    return { success: true, content: updated };
  }

  /**
   * Restore previously removed content
   */
  async restoreContent(adminId: string, contentId: string, reason?: string) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: { id: true, creatorId: true, title: true, deletedAt: true, status: true, publishedAt: true },
    });

    if (!content) {
      throw new NotFoundException('Content not found');
    }

    if (!content.deletedAt && content.status !== 'REJECTED' && content.status !== 'UNDER_REVIEW') {
      throw new BadRequestException('Content is not removed');
    }

    const updated = await this.prisma.content.update({
      where: { id: contentId },
      data: {
        status: content.publishedAt ? 'PUBLISHED' : 'DRAFT',
        deletedAt: null,
        isModerated: true,
        moderatedAt: new Date(),
        moderatedBy: adminId,
        moderationNotes: reason || null,
      },
      select: { id: true, status: true, deletedAt: true, moderationNotes: true },
    });

    await this.prisma.notification.create({
      data: {
        userId: content.creatorId,
        type: 'CONTENT_APPROVED',
        title: 'Contenu restauré',
        message: `Votre contenu "${content.title || 'Sans titre'}" a été restauré.`,
      },
    });

    await this.logAdminAction(adminId, 'CONTENT_RESTORED', 'CONTENT', contentId, { reason });

    return { success: true, content: updated };
  }

  // ==================== Audit Logs ====================

  /**
   * Get audit logs (admin/moderation actions)
   */
  async getAuditLogs(dto: GetAuditLogsDto) {
    const { action, resource, userId, page = 1, limit = 50 } = dto;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (action) where.action = { contains: action, mode: 'insensitive' };
    if (resource) where.resource = resource;
    if (userId) where.userId = userId;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // AuditLog has no relation to User: load actors separately
    const actorIds = [...new Set(logs.map((l: any) => l.userId).filter(Boolean))] as string[];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, username: true, displayName: true, avatar: true },
        })
      : [];
    const actorById = new Map(actors.map((a: any) => [a.id, a]));

    return {
      items: logs.map((log: any) => ({
        ...log,
        actor: log.userId ? actorById.get(log.userId) || null : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
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
        where: { status: { in: reportStatusValues(ReportStatus.PENDING) } },
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
      // Amounts are stored in euros (Decimal)
      revenue: {
        total: Number(totalRevenue._sum.amount || 0),
        platformFees: Number(platformFees._sum.platformFee || 0),
        byType: revenueByType.map((item: any) => ({
          type: item.type,
          amount: Number(item._sum.amount || 0),
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
  async deleteUser(adminId: string, userId: string, reason?: string) {
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

    await this.logAdminAction(adminId, 'USER_DELETED', 'USER', userId, { reason });

    this.logger.warn(`User ${userId} deleted by admin ${adminId}. Reason: ${reason}`);

    return {
      success: true,
      message: 'User deleted successfully',
    };
  }
}
