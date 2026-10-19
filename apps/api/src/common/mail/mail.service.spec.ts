import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

import { MailService } from './mail.service';
import { escapeHtml } from './mail.templates';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

function buildConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: any) =>
      values[key] !== undefined ? values[key] : defaultValue,
    ),
  } as unknown as ConfigService;
}

describe('MailService', () => {
  const sendMail = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
  });

  describe('without SMTP configuration', () => {
    it('logs emails instead of sending them', async () => {
      const service = new MailService(buildConfig({}));

      expect(service.isEnabled).toBe(false);
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
      await expect(
        service.sendMail({ to: 'a@b.com', subject: 'Hello', html: '<p>Hi</p>' }),
      ).resolves.toBe(true);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('does not send in the test environment even if SMTP_HOST is set', () => {
      const service = new MailService(buildConfig({ SMTP_HOST: 'smtp.example.com', NODE_ENV: 'test' }));
      expect(service.isEnabled).toBe(false);
    });
  });

  describe('with SMTP configuration', () => {
    const config = {
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'pass',
      SMTP_FROM_EMAIL: 'noreply@ofm.test',
      SMTP_FROM_NAME: 'OFM',
      WEB_URL: 'https://app.ofm.test/',
      NODE_ENV: 'production',
    };

    it('creates a transporter from env', () => {
      const service = new MailService(buildConfig(config));
      expect(service.isEnabled).toBe(true);
      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        auth: { user: 'user', pass: 'pass' },
      });
    });

    it('sends the verification email with a link to the web app', async () => {
      sendMail.mockResolvedValue({});
      const service = new MailService(buildConfig(config));

      await expect(service.sendVerificationEmail('a@b.com', 'alice', 'tok123')).resolves.toBe(true);

      const mail = sendMail.mock.calls[0][0];
      expect(mail.to).toBe('a@b.com');
      expect(mail.from).toBe('"OFM" <noreply@ofm.test>');
      expect(mail.subject).toBe('Confirmez votre adresse e-mail');
      expect(mail.html).toContain('https://app.ofm.test/verify-email?token=tok123');
      expect(mail.text).toContain('https://app.ofm.test/verify-email?token=tok123');
    });

    it('sends the password reset email', async () => {
      sendMail.mockResolvedValue({});
      const service = new MailService(buildConfig(config));

      await service.sendPasswordResetEmail('a@b.com', 'alice', 'reset456');

      const mail = sendMail.mock.calls[0][0];
      expect(mail.subject).toBe('Réinitialisation de votre mot de passe');
      expect(mail.html).toContain('https://app.ofm.test/reset-password?token=reset456');
    });

    it('escapes user-provided values in templates', async () => {
      sendMail.mockResolvedValue({});
      const service = new MailService(buildConfig(config));

      await service.sendPasswordChangedEmail('a@b.com', '<script>x</script>');

      expect(sendMail.mock.calls[0][0].html).not.toContain('<script>');
      expect(sendMail.mock.calls[0][0].html).toContain('&lt;script&gt;');
    });

    it('returns false instead of throwing when SMTP fails', async () => {
      sendMail.mockRejectedValue(new Error('connection refused'));
      const service = new MailService(buildConfig(config));

      await expect(
        service.sendMail({ to: ['a@b.com', 'c@d.com'], subject: 'S', html: 'H' }),
      ).resolves.toBe(false);
      expect(sendMail.mock.calls[0][0].to).toBe('a@b.com, c@d.com');
    });

    it('renders the daily moderation report', async () => {
      sendMail.mockResolvedValue({});
      const service = new MailService(buildConfig(config));

      await service.sendDailyModerationReport('admin@ofm.test', {
        date: '2026-10-18',
        newReports: 4,
        resolvedReports: 2,
        bannedUsers: 1,
        suspendedUsers: 0,
        pendingReports: 7,
      });

      const mail = sendMail.mock.calls[0][0];
      expect(mail.subject).toContain('2026-10-18');
      expect(mail.text).toContain('Signalements en attente : 7');
      expect(mail.html).toContain('https://app.ofm.test/admin/moderation');
    });
  });

  it('escapeHtml escapes special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});
