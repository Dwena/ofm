import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

import {
  DailyModerationReport,
  MailContent,
  dailyModerationReportTemplate,
  passwordChangedEmailTemplate,
  passwordResetEmailTemplate,
  verificationEmailTemplate,
} from './mail.templates';

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

export const EMAIL_VERIFICATION_TTL_HOURS = 24;
export const PASSWORD_RESET_TTL_MINUTES = 60;

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    const isTest = this.configService.get<string>('NODE_ENV') === 'test';

    const fromEmail = this.configService.get<string>('SMTP_FROM_EMAIL', 'noreply@ofm.com');
    const fromName = this.configService.get<string>('SMTP_FROM_NAME', 'FanVIP');
    this.from = `"${fromName}" <${fromEmail}>`;

    if (!host || isTest) {
      this.transporter = null;
      this.logger.warn('SMTP not configured: emails will be logged instead of sent');
      return;
    }

    const port = parseInt(this.configService.get<string>('SMTP_PORT', '587'), 10);
    const secureSetting = this.configService.get<string>('SMTP_SECURE');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASSWORD');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: secureSetting !== undefined ? secureSetting === 'true' : port === 465,
      ...(user ? { auth: { user, pass } } : {}),
    });
  }

  get isEnabled(): boolean {
    return this.transporter !== null;
  }

  /**
   * Send an email. Never throws: failures are logged and `false` is returned
   * so that business flows (registration, password reset...) are not broken
   * by a temporary SMTP outage.
   */
  async sendMail(options: SendMailOptions): Promise<boolean> {
    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    if (recipients.length === 0) {
      return false;
    }

    if (!this.transporter) {
      this.logger.log(
        `[mail:dev] To: ${recipients.join(', ')} | Subject: ${options.subject}\n${options.text ?? options.html}`,
      );
      return true;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: recipients.join(', '),
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      return true;
    } catch (error: any) {
      this.logger.error(
        `Failed to send email "${options.subject}" to ${recipients.join(', ')}: ${error?.message ?? error}`,
      );
      return false;
    }
  }

  async sendVerificationEmail(to: string, username: string, token: string) {
    const url = this.buildWebUrl(`/verify-email?token=${encodeURIComponent(token)}`);
    return this.sendTemplate(to, verificationEmailTemplate(username, url, EMAIL_VERIFICATION_TTL_HOURS));
  }

  async sendPasswordResetEmail(to: string, username: string, token: string) {
    const url = this.buildWebUrl(`/reset-password?token=${encodeURIComponent(token)}`);
    return this.sendTemplate(to, passwordResetEmailTemplate(username, url, PASSWORD_RESET_TTL_MINUTES));
  }

  async sendPasswordChangedEmail(to: string, username: string) {
    return this.sendTemplate(to, passwordChangedEmailTemplate(username, this.buildWebUrl('/login')));
  }

  async sendDailyModerationReport(to: string | string[], report: DailyModerationReport) {
    return this.sendTemplate(
      to,
      dailyModerationReportTemplate(report, this.buildWebUrl('/admin/moderation')),
    );
  }

  buildWebUrl(path: string): string {
    const base = this.configService
      .get<string>('WEB_URL', 'http://localhost:3000')
      .replace(/\/+$/, '');
    return `${base}${path}`;
  }

  private sendTemplate(to: string | string[], content: MailContent) {
    return this.sendMail({ to, ...content });
  }
}
