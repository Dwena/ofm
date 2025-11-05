import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../common/database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateReportDto } from './dto/moderation.dto';

@Injectable()
export class ModerationService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    @InjectQueue('moderation') private moderationQueue: Queue,
  ) {}

  /**
   * Create a new report (user-facing endpoint)
   */
  async createReport(reporterId: string, dto: CreateReportDto) {
    // Check if reported entity exists
    await this.validateReportedEntity(dto.reportedType, dto.reportedId);

    // Check if user already reported this entity
    const existingReport = await this.prisma.report.findFirst({
      where: {
        reporterId,
        reportedType: dto.reportedType,
        reportedId: dto.reportedId,
        status: { in: ['pending', 'reviewed'] },
      },
    });

    if (existingReport) {
      throw new BadRequestException('Vous avez déjà signalé cet élément');
    }

    // Create report
    const report = await this.prisma.report.create({
      data: {
        reporterId,
        reportedType: dto.reportedType,
        reportedId: dto.reportedId,
        reason: dto.reason,
        description: dto.description,
        status: 'pending',
      },
    });

    // Add to moderation queue for processing
    await this.moderationQueue.add('process-report', {
      reportId: report.id,
      reportedType: dto.reportedType,
      reportedId: dto.reportedId,
      reason: dto.reason,
    });

    // Notify admins
    await this.notifyAdminsOfNewReport(report);

    return {
      success: true,
      message: 'Votre signalement a été enregistré et sera examiné par notre équipe',
      reportId: report.id,
    };
  }

  /**
   * Get reports for moderation queue (admin)
   */
  async getReportsQueue(filters?: {
    status?: string;
    reportedType?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.reportedType) where.reportedType = filters.reportedType;

    const [reports, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
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

    // Enrich with reported entity details
    const enrichedReports = await Promise.all(
      reports.map(async (report) => {
        const entityDetails = await this.getReportedEntityDetails(
          report.reportedType,
          report.reportedId,
        );
        return { ...report, reportedEntity: entityDetails };
      }),
    );

    return {
      reports: enrichedReports,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Handle a report (admin action)
   */
  async handleReport(
    adminId: string,
    reportId: string,
    decision: 'RESOLVE' | 'DISMISS' | 'ESCALATE',
    resolution: string,
  ) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException('Signalement non trouvé');
    }

    const updatedReport = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: decision === 'RESOLVE' ? 'resolved' : decision === 'DISMISS' ? 'dismissed' : 'reviewed',
        reviewedBy: adminId,
        reviewedAt: new Date(),
        resolution,
      },
    });

    // Notify reporter
    await this.notificationsService.create({
      userId: report.reporterId,
      type: 'SYSTEM',
      title: 'Mise à jour de votre signalement',
      message: `Votre signalement a été traité: ${resolution}`,
      linkUrl: `/reports/${report.id}`,
    });

    return updatedReport;
  }

  /**
   * Auto-moderate content based on rules
   */
  async autoModerateContent(contentId: string, analysisResult: any) {
    if (analysisResult.shouldAutoReject) {
      // Auto-reject content
      await this.prisma.content.update({
        where: { id: contentId },
        data: {
          status: 'REJECTED',
          isModerated: true,
          moderatedAt: new Date(),
          moderationNotes: `Auto-rejeté: ${analysisResult.flaggedKeywords.join(', ')}`,
        },
      });

      // Notify creator
      const content = await this.prisma.content.findUnique({
        where: { id: contentId },
        select: { creatorId: true },
      });

      if (content) {
        await this.notificationsService.create({
          userId: content.creatorId,
          type: 'CONTENT_REJECTED',
          title: 'Contenu rejeté',
          message: 'Votre contenu a été rejeté car il ne respecte pas nos règles communautaires',
          linkUrl: `/content/${contentId}`,
        });
      }
    } else if (analysisResult.shouldRequireReview) {
      // Flag for manual review
      await this.prisma.content.update({
        where: { id: contentId },
        data: {
          status: 'UNDER_REVIEW',
          moderationNotes: `Marqué pour révision: ${analysisResult.flaggedKeywords.join(', ')}`,
        },
      });

      // Add to moderation queue
      await this.moderationQueue.add('review-content', {
        contentId,
        reason: 'AUTO_FLAGGED',
        keywords: analysisResult.flaggedKeywords,
      });
    }
  }

  /**
   * Ban user permanently
   */
  async banUser(adminId: string, userId: string, reason: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    if (user.role === 'ADMIN') {
      throw new BadRequestException('Impossible de bannir un administrateur');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: 'BANNED',
        bannedAt: new Date(),
        banReason: reason,
      },
    });

    // Log action
    await this.createAuditLog(adminId, 'USER_BANNED', userId, reason);

    // Notify user
    await this.notificationsService.create({
      userId,
      type: 'SYSTEM',
      title: 'Compte banni',
      message: `Votre compte a été banni. Raison: ${reason}`,
      linkUrl: '/support',
    });

    return { success: true, message: 'Utilisateur banni avec succès' };
  }

  /**
   * Suspend user temporarily
   */
  async suspendUser(
    adminId: string,
    userId: string,
    reason: string,
    durationDays: number,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    if (user.role === 'ADMIN') {
      throw new BadRequestException('Impossible de suspendre un administrateur');
    }

    const suspendedUntil = new Date();
    suspendedUntil.setDate(suspendedUntil.getDate() + durationDays);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: 'SUSPENDED',
        suspendedUntil,
        suspensionReason: reason,
      },
    });

    // Add to suspension expiry queue
    await this.moderationQueue.add(
      'expire-suspension',
      { userId },
      { delay: durationDays * 24 * 60 * 60 * 1000 }, // Delay in milliseconds
    );

    // Log action
    await this.createAuditLog(
      adminId,
      'USER_SUSPENDED',
      userId,
      `${reason} (${durationDays} jours)`,
    );

    // Notify user
    await this.notificationsService.create({
      userId,
      type: 'SYSTEM',
      title: 'Compte suspendu',
      message: `Votre compte a été suspendu pour ${durationDays} jours. Raison: ${reason}`,
      linkUrl: '/support',
    });

    return {
      success: true,
      message: `Utilisateur suspendu pour ${durationDays} jours`,
      suspendedUntil,
    };
  }

  /**
   * Unsuspend user (automatic or manual)
   */
  async unsuspendUser(userId: string, automatic = false) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: 'ACTIVE',
        suspendedUntil: null,
        suspensionReason: null,
      },
    });

    // Notify user
    await this.notificationsService.create({
      userId,
      type: 'SYSTEM',
      title: 'Compte réactivé',
      message: 'Votre suspension a expiré. Votre compte est maintenant actif.',
      linkUrl: '/dashboard',
    });

    return { success: true, message: 'Utilisateur réactivé' };
  }

  // Helper methods

  private async validateReportedEntity(type: string, id: string) {
    let exists = false;

    switch (type) {
      case 'USER':
        exists = !!(await this.prisma.user.findUnique({ where: { id } }));
        break;
      case 'CONTENT':
        exists = !!(await this.prisma.content.findUnique({ where: { id } }));
        break;
      case 'COMMENT':
        exists = !!(await this.prisma.comment.findUnique({ where: { id } }));
        break;
      case 'MESSAGE':
        exists = !!(await this.prisma.message.findUnique({ where: { id } }));
        break;
    }

    if (!exists) {
      throw new NotFoundException('Élément signalé non trouvé');
    }
  }

  private async getReportedEntityDetails(type: string, id: string) {
    switch (type) {
      case 'USER':
        return this.prisma.user.findUnique({
          where: { id },
          select: { id: true, username: true, displayName: true, avatar: true },
        });
      case 'CONTENT':
        return this.prisma.content.findUnique({
          where: { id },
          select: {
            id: true,
            title: true,
            type: true,
            createdAt: true,
            creator: { select: { username: true } },
          },
        });
      case 'COMMENT':
        return this.prisma.comment.findUnique({
          where: { id },
          select: {
            id: true,
            content: true,
            createdAt: true,
            user: { select: { username: true } },
          },
        });
      case 'MESSAGE':
        return this.prisma.message.findUnique({
          where: { id },
          select: { id: true, content: true, createdAt: true },
        });
      default:
        return null;
    }
  }

  private async notifyAdminsOfNewReport(report: any) {
    // Get all admins
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true },
    });

    // Notify each admin
    for (const admin of admins) {
      await this.notificationsService.create({
        userId: admin.id,
        type: 'SYSTEM',
        title: 'Nouveau signalement',
        message: `Un nouveau signalement de type ${report.reportedType} a été reçu`,
        linkUrl: `/admin/moderation/reports/${report.id}`,
      });
    }
  }

  private async createAuditLog(
    adminId: string,
    action: string,
    targetId: string,
    details: string,
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action,
        resource: 'USER',
        resourceId: targetId,
        metadata: {
          details,
        },
        ipAddress: '0.0.0.0', // Should be captured from request
        userAgent: 'System',
      },
    });
  }
}
