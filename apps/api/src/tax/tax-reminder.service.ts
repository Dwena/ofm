import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/database/prisma.service';
import { MailService } from '../common/mail/mail.service';
import { escapeHtml } from '../common/mail/mail.templates';
import {
  MAX_TAX_PROFILE_REMINDERS,
  PAID_SALE_STATUSES,
  SALE_TYPES,
  SELF_BILLING_DOCUMENT,
  TAX_PROFILE_PATH,
  TAX_PROFILE_REMINDER_INTERVAL_DAYS,
  TAX_PROFILE_REMINDER_KIND,
} from './tax.constants';
import { isMandateAccepted, toProfileFields } from './tax-profile.service';
import { computeMissingFields } from './tax-validation';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether a new reminder is due (pure, unit-tested) */
export function isReminderDue(
  profile: { reminderCount: number; lastReminderAt: Date | null } | null,
  now = new Date(),
): boolean {
  if (!profile) return true;
  if (profile.reminderCount >= MAX_TAX_PROFILE_REMINDERS) return false;
  return !profile.lastReminderAt || now.getTime() - profile.lastReminderAt.getTime() >= TAX_PROFILE_REMINDER_INTERVAL_DAYS * DAY_MS;
}

/**
 * DAC7 reminders (art. 1649 ter C CGI / annex III section II of directive
 * 2011/16/EU as amended by 2021/514): the platform must collect the seller's
 * tax information and, when it is still missing after two reminders, withhold
 * the payment of the consideration until it is provided (and, after 60 days,
 * may close the account). Payouts are already blocked while the profile is
 * incomplete (TaxProfileService.isComplete() is checked by the payments
 * module), which satisfies the withholding obligation; these reminders are
 * the two notices required before.
 */
@Injectable()
export class TaxReminderService {
  private readonly logger = new Logger(TaxReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /** Every day at 10:20 (spaced 30 days per creator, at most 2 reminders) */
  @Cron('20 10 * * *')
  async handleCron() {
    try {
      await this.sendReminders();
    } catch (error) {
      this.logger.error(`Tax profile reminders failed: ${(error as Error).message}`);
    }
  }

  async sendReminders(now = new Date()): Promise<{ checked: number; sent: number }> {
    // Creators with at least one paid sale
    const sellers = await this.prisma.transaction.findMany({
      where: { type: { in: [...SALE_TYPES] }, status: { in: [...PAID_SALE_STATUSES] }, toUserId: { not: null } },
      distinct: ['toUserId'],
      select: { toUserId: true },
    });
    const creatorIds = sellers.map((s) => s.toUserId!).filter(Boolean);
    if (creatorIds.length === 0) return { checked: 0, sent: 0 };

    const [profiles, acceptances, users] = await Promise.all([
      this.prisma.creatorTaxProfile.findMany({ where: { userId: { in: creatorIds } } }),
      this.prisma.legalAcceptance.findMany({
        where: { userId: { in: creatorIds }, document: SELF_BILLING_DOCUMENT },
        orderBy: { acceptedAt: 'asc' },
        select: { userId: true, version: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: creatorIds }, deletedAt: null, status: { not: 'BANNED' } },
        select: { id: true, email: true, displayName: true, username: true },
      }),
    ]);
    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));
    const versionByUser = new Map<string, string>();
    acceptances.forEach((a) => versionByUser.set(a.userId, a.version)); // ascending: the last one wins

    let sent = 0;
    for (const user of users) {
      const profile = profileByUser.get(user.id) ?? null;
      const accepted = isMandateAccepted(profile, versionByUser.get(user.id) ?? null);
      const missing = profile ? computeMissingFields(toProfileFields(profile, accepted)) : ['profile'];
      if (missing.length === 0) continue;

      // completedAt kept from before a mandate version change: clear it
      if (profile?.completedAt) {
        await this.prisma.creatorTaxProfile.update({ where: { userId: user.id }, data: { completedAt: null } });
      }
      if (!isReminderDue(profile, now)) continue;

      try {
        await this.sendReminder(user, (profile?.reminderCount ?? 0) + 1, now);
        sent++;
      } catch (error) {
        this.logger.error(`Failed to send the tax profile reminder to ${user.id}: ${(error as Error).message}`);
      }
    }

    this.logger.log(`Tax profile reminders: ${sent} sent (${users.length} sellers checked)`);
    return { checked: users.length, sent };
  }

  private async sendReminder(
    user: { id: string; email: string; displayName: string | null; username: string },
    reminderNumber: number,
    now: Date,
  ) {
    const last = reminderNumber >= MAX_TAX_PROFILE_REMINDERS;
    const title = last ? 'Dernier rappel : complétez votre profil fiscal' : 'Complétez votre profil fiscal';
    const message =
      'La réglementation (directive DAC7, art. 1649 ter A et suivants du CGI) nous impose de recueillir votre identité fiscale et vos coordonnées bancaires. ' +
      'Tant que votre profil fiscal est incomplet, vos virements sont bloqués.' +
      (last ? ' Sans réponse de votre part, vos revenus resteront retenus et votre compte pourra être suspendu.' : '');

    await this.prisma.$transaction([
      this.prisma.creatorTaxProfile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, reminderCount: reminderNumber, lastReminderAt: now },
        update: { reminderCount: reminderNumber, lastReminderAt: now },
      }),
      this.prisma.notification.create({
        data: {
          userId: user.id,
          type: 'SYSTEM',
          title,
          message,
          linkUrl: TAX_PROFILE_PATH,
          metadata: { kind: TAX_PROFILE_REMINDER_KIND, reminder: reminderNumber },
        },
      }),
    ]);

    const webUrl = this.config.get<string>('WEB_URL', 'http://localhost:3000').replace(/\/$/, '');
    const url = `${webUrl}${TAX_PROFILE_PATH}`;
    const name = user.displayName || user.username;
    await this.mail.sendMail({
      to: user.email,
      subject: `FanVIP — ${title}`,
      html: `<p>Bonjour ${escapeHtml(name)},</p><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(url)}">Compléter mon profil fiscal</a></p>`,
      text: `Bonjour ${name},\n\n${message}\n\nCompléter mon profil fiscal : ${url}`,
    });
  }
}
