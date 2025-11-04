import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../common/database/prisma.service';
import { ModerationService } from './moderation.service';

@Injectable()
export class SuspensionSchedulerService {
  private readonly logger = new Logger(SuspensionSchedulerService.name);

  constructor(
    private prisma: PrismaService,
    private moderationService: ModerationService,
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

      const report = {
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

      // TODO: Send this report to admins via email or notification

      return report;
    } catch (error) {
      this.logger.error('Failed to generate daily report:', error);
      throw error;
    }
  }
}
