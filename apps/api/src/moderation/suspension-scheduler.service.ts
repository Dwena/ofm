import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/database/prisma.service';
import { ModerationService } from './moderation.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../common/mail/mail.service';
import { DailyModerationReport } from '../common/mail/mail.templates';

@Injectable()
export class SuspensionSchedulerService {
  private readonly logger = new Logger(SuspensionSchedulerService.name);

  constructor(
    private prisma: PrismaService,
    private moderationService: ModerationService,
    private notificationsService: NotificationsService,
    private mailService: MailService,
  ) {}

  /**
   * Check every hour for expired suspensions
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkExpiredSuspensions() {
    this.logger.log('Checking for expired suspensions...');

    try {
      const now = new Date();

      // Find users with expired suspensions
      const expiredUsers = await this.prisma.user.findMany({
        where: {
          status: 'SUSPENDED',
          suspendedUntil: {
            lte: now,
          },
        },
        select: {
          id: true,
          username: true,
          suspendedUntil: true,
        },
      });

      this.logger.log(`Found ${expiredUsers.length} expired suspensions`);

      // Unsuspend each user
      for (const user of expiredUsers) {
        try {
          await this.moderationService.unsuspendUser(user.id, true);
          this.logger.log(`Unsuspended user ${user.username} (${user.id})`);
        } catch (error) {
          this.logger.error(`Failed to unsuspend user ${user.id}:`, error);
        }
      }

      return {
        success: true,
        unsuspendedCount: expiredUsers.length,
      };
    } catch (error) {
      this.logger.error('Failed to check expired suspensions:', error);
      throw error;
    }
  }

  /**
   * Clean up old resolved reports (every day at 3 AM)
   */
  @Cron('0 3 * * *')
  async cleanupOldReports() {
    this.logger.log('Cleaning up old reports...');

    try {
      // Delete reports older than 90 days that are resolved/dismissed
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const result = await this.prisma.report.deleteMany({
        where: {
          status: { in: ['resolved', 'dismissed'] },
          createdAt: {
            lt: ninetyDaysAgo,
          },
        },
      });

      this.logger.log(`Deleted ${result.count} old reports`);

      return {
        success: true,
        deletedCount: result.count,
      };
    } catch (error) {
      this.logger.error('Failed to cleanup old reports:', error);
      throw error;
    }
  }

  /**
   * Generate daily moderation report (every day at 9 AM)
   */
  @Cron('0 9 * * *')
  async generateDailyReport() {
    this.logger.log('Generating daily moderation report...');

    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [
        newReports,
        resolvedReports,
        bannedUsers,
        suspendedUsers,
      ] = await Promise.all([
        this.prisma.report.count({
          where: {
            createdAt: { gte: yesterday, lt: today },
          },
        }),
        this.prisma.report.count({
          where: {
            status: { in: ['resolved', 'dismissed'] },
            reviewedAt: { gte: yesterday, lt: today },
          },
        }),
        this.prisma.user.count({
          where: {
            status: 'BANNED',
            bannedAt: { gte: yesterday, lt: today },
          },
        }),
        this.prisma.user.count({
          where: {
            status: 'SUSPENDED',
            updatedAt: { gte: yesterday, lt: today },
          },
        }),
      ]);

      const report: DailyModerationReport = {
        date: yesterday.toISOString().split('T')[0],
        newReports,
        resolvedReports,
        bannedUsers,
        suspendedUsers,
        pendingReports: await this.prisma.report.count({
          where: { status: 'pending' },
        }),
      };

      this.logger.log('Daily moderation report:', report);

      await this.sendReportToAdmins(report);

      return report;
    } catch (error) {
      this.logger.error('Failed to generate daily report:', error);
      throw error;
    }
  }

  /**
   * Deliver the daily report to every active admin (in-app notification + email).
   * Failures are logged but never fail the report generation.
   */
  private async sendReportToAdmins(report: DailyModerationReport) {
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
        select: { id: true, email: true },
      });

      if (admins.length === 0) {
        this.logger.warn('No active admin to send the daily moderation report to');
        return;
      }

      const message =
        `${report.newReports} nouveau(x) signalement(s), ${report.resolvedReports} traité(s), ` +
        `${report.pendingReports} en attente, ${report.bannedUsers} banni(s), ${report.suspendedUsers} suspendu(s).`;

      await Promise.all(
        admins.map((admin) =>
          this.notificationsService.create({
            userId: admin.id,
            type: 'SYSTEM',
            title: `Rapport de modération du ${report.date}`,
            message,
            linkUrl: '/admin/moderation',
            metadata: { kind: 'daily_moderation_report', report },
          }),
        ),
      );

      // One email per admin so addresses are not disclosed to each other
      await Promise.all(
        admins.map((admin) => this.mailService.sendDailyModerationReport(admin.email, report)),
      );

      this.logger.log(`Daily moderation report sent to ${admins.length} admin(s)`);
    } catch (error) {
      this.logger.error('Failed to send daily moderation report to admins:', error);
    }
  }
}
