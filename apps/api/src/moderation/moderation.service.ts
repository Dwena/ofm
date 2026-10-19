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

  // Listing and handling reports lives in AdminService (GET /admin/reports,
  // POST /admin/reports/handle) so both back-office screens share one format.

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
        linkUrl: '/admin/reports',
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
