import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { ContentModerationService } from './content-moderation.service';
import { ModerationService } from './moderation.service';

@Injectable()
@Processor('moderation')
export class ModerationProcessor {
  private readonly logger = new Logger(ModerationProcessor.name);

  constructor(
    private prisma: PrismaService,
    private contentModerationService: ContentModerationService,
    private moderationService: ModerationService,
  ) {}

  /**
   * Process incoming reports
   */
  @Process('process-report')
  async processReport(job: Job) {
    const { reportId, reportedType, reportedId, reason } = job.data;
    this.logger.log(`Processing report ${reportId} for ${reportedType}:${reportedId}`);

    try {
      // Get report details
      const report = await this.prisma.report.findUnique({
        where: { id: reportId },
      });

      if (!report) {
        throw new Error(`Report ${reportId} not found`);
      }

      // Check if this entity has multiple reports (auto-action threshold)
      const reportCount = await this.prisma.report.count({
        where: {
          reportedType,
          reportedId,
          status: { in: ['pending', 'reviewed'] },
        },
      });

      this.logger.log(`Entity has ${reportCount} active reports`);

      // Auto-action if threshold exceeded
      if (reportCount >= 5) {
        this.logger.warn(`Report threshold exceeded for ${reportedType}:${reportedId}`);
        await this.takeAutoAction(reportedType, reportedId, reportCount);
      }

      // If content, run automatic moderation
      if (reportedType === 'CONTENT') {
        const content = await this.prisma.content.findUnique({
          where: { id: reportedId },
        });

        if (content) {
          const analysis = await this.contentModerationService.analyzeContent(
            content.title,
            content.description || '',
          );

          if (analysis.shouldAutoReject || analysis.shouldRequireReview) {
            await this.moderationService.autoModerateContent(reportedId, analysis);
          }
        }
      }

      // Update report status
      await this.prisma.report.update({
        where: { id: reportId },
        data: { status: 'reviewed' },
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to process report ${reportId}:`, error);
      throw error;
    }
  }

  /**
   * Review content automatically flagged
   */
  @Process('review-content')
  async reviewContent(job: Job) {
    const { contentId, reason, keywords } = job.data;
    this.logger.log(`Reviewing content ${contentId} - Reason: ${reason}`);

    try {
      // Mark content for manual review
      await this.prisma.content.update({
        where: { id: contentId },
        data: {
          status: 'UNDER_REVIEW',
          moderationNotes: `Auto-flagged: ${keywords.join(', ')}`,
        },
      });

      // Notify admins
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true },
      });

      // Create notification for each admin
      for (const admin of admins) {
        await this.prisma.notification.create({
          data: {
            userId: admin.id,
            type: 'SYSTEM',
            title: 'Contenu à réviser',
            message: `Contenu ${contentId} a été marqué automatiquement pour révision`,
            linkUrl: `/admin/moderation/content/${contentId}`,
            isRead: false,
          },
        });
      }

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to review content ${contentId}:`, error);
      throw error;
    }
  }

  /**
   * Expire user suspension
   */
  @Process('expire-suspension')
  async expireSuspension(job: Job) {
    const { userId } = job.data;
    this.logger.log(`Expiring suspension for user ${userId}`);

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      // Check if suspension should be lifted
      if (user.status === 'SUSPENDED' && user.suspendedUntil) {
        const now = new Date();
        if (now >= user.suspendedUntil) {
          await this.moderationService.unsuspendUser(userId, true);
          this.logger.log(`User ${userId} suspension expired and account reactivated`);
        }
      }

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to expire suspension for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Take automatic action based on report threshold
   */
  private async takeAutoAction(type: string, id: string, reportCount: number) {
    this.logger.log(`Taking auto-action for ${type}:${id} with ${reportCount} reports`);

    switch (type) {
      case 'CONTENT':
        // Auto-hide content
        await this.prisma.content.update({
          where: { id },
          data: {
            status: 'UNDER_REVIEW',
            isModerated: false,
            moderationNotes: `Auto-flagged: ${reportCount} reports received`,
          },
        });
        break;

      case 'USER':
        // Auto-suspend user for 24 hours
        const suspendedUntil = new Date();
        suspendedUntil.setHours(suspendedUntil.getHours() + 24);

        await this.prisma.user.update({
          where: { id },
          data: {
            status: 'SUSPENDED',
            suspendedUntil,
            suspensionReason: `Auto-suspended: ${reportCount} reports received`,
          },
        });

        // Notify user
        await this.prisma.notification.create({
          data: {
            userId: id,
            type: 'SYSTEM',
            title: 'Compte temporairement suspendu',
            message: `Votre compte a été temporairement suspendu en raison de plusieurs signalements. Durée: 24 heures.`,
            linkUrl: '/support',
            isRead: false,
          },
        });
        break;

      case 'COMMENT':
        // Delete comment
        await this.prisma.comment.update({
          where: { id },
          data: { isDeleted: true },
        });
        break;
    }
  }
}
