import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';

import { AuthService, PASSWORD_CHANGED_KEY } from './auth.service';
import { PrismaService } from '../common/database/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../common/mail/mail.service';
import { SettingsService } from '../settings/settings.service';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('AuthService (email verification & password reset)', () => {
  let service: AuthService;

  const mockPrismaService = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    creatorProfile: { create: jest.fn() },
    subscriberProfile: { create: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
    session: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
  };

  const mockMailService = {
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
    sendPasswordChangedEmail: jest.fn().mockResolvedValue(true),
  };

  const mockSettingsService = {
    isRegistrationOpen: jest.fn(async () => true),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => (key === 'BCRYPT_ROUNDS' ? '4' : defaultValue)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: JwtService, useValue: { sign: jest.fn(), verify: jest.fn(), decode: jest.fn() } },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: UsersService, useValue: {} },
        { provide: MailService, useValue: mockMailService },
        { provide: SettingsService, useValue: mockSettingsService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('stores a hashed verification token and sends the verification email', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
        username: 'alice',
        role: 'SUBSCRIBER',
      });

      await service.register({
        email: 'alice@example.com',
        username: 'alice',
        password: 'Password1!',
        role: 'SUBSCRIBER' as any,
      });

      expect(mockMailService.sendVerificationEmail).toHaveBeenCalledWith(
        'alice@example.com',
        'alice',
        expect.stringMatching(/^[a-f0-9]{64}$/),
      );
      const rawToken = mockMailService.sendVerificationEmail.mock.calls[0][2];
      const updateArgs = mockPrismaService.user.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: 'user-1' });
      expect(updateArgs.data.emailVerificationToken).toBe(sha256(rawToken));
      expect(updateArgs.data.emailVerificationToken).not.toBe(rawToken);
      expect(updateArgs.data.emailVerificationExpires.getTime()).toBeGreaterThan(Date.now());
    });

    it('refuses registration when it is closed in the platform settings', async () => {
      mockSettingsService.isRegistrationOpen.mockResolvedValueOnce(false);

      await expect(
        service.register({
          email: 'bob@example.com',
          username: 'bob',
          password: 'Password1!',
          role: 'SUBSCRIBER' as any,
        }),
      ).rejects.toThrow('Les inscriptions sont actuellement fermées');
      expect(mockPrismaService.user.create).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmail', () => {
    it('marks the email as verified and activates pending accounts', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: 'PENDING_VERIFICATION',
        emailVerificationExpires: new Date(Date.now() + 60_000),
      });

      const result = await service.verifyEmail('a'.repeat(64));

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { emailVerificationToken: sha256('a'.repeat(64)) },
      });
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          emailVerified: true,
          emailVerificationToken: null,
          emailVerificationExpires: null,
          status: 'ACTIVE',
        }),
      });
      expect(result.message).toBeDefined();
    });

    it('does not change the status of non-pending accounts', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        status: 'SUSPENDED',
        emailVerificationExpires: new Date(Date.now() + 60_000),
      });

      await service.verifyEmail('a'.repeat(64));

      expect(mockPrismaService.user.update.mock.calls[0][0].data.status).toBeUndefined();
    });

    it('rejects unknown tokens', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(service.verifyEmail('b'.repeat(64))).rejects.toThrow(BadRequestException);
    });

    it('rejects expired tokens', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        emailVerificationExpires: new Date(Date.now() - 1000),
      });
      await expect(service.verifyEmail('c'.repeat(64))).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.user.update).not.toHaveBeenCalled();
    });
  });

  describe('resendVerification', () => {
    it('sends a new email for unverified accounts', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
        username: 'alice',
        emailVerified: false,
        deletedAt: null,
      });

      await service.resendVerification('alice@example.com');

      expect(mockPrismaService.user.update).toHaveBeenCalled();
      expect(mockMailService.sendVerificationEmail).toHaveBeenCalled();
    });

    it('returns the same response for unknown or verified emails without sending', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(null);
      const unknown = await service.resendVerification('nobody@example.com');

      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        email: 'alice@example.com',
        username: 'alice',
        emailVerified: true,
        deletedAt: null,
      });
      const verified = await service.resendVerification('alice@example.com');

      expect(unknown).toEqual(verified);
      expect(mockMailService.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('stores a hashed reset token and emails the raw token', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
        username: 'alice',
        status: 'ACTIVE',
        deletedAt: null,
      });

      await service.forgotPassword('alice@example.com');

      const rawToken = mockMailService.sendPasswordResetEmail.mock.calls[0][2];
      expect(rawToken).toMatch(/^[a-f0-9]{64}$/);
      const data = mockPrismaService.user.update.mock.calls[0][0].data;
      expect(data.passwordResetToken).toBe(sha256(rawToken));
      expect(data.passwordResetExpires.getTime()).toBeGreaterThan(Date.now());
    });

    it('does not reveal whether the account exists', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword('nobody@example.com');

      expect(result.message).toBeDefined();
      expect(mockPrismaService.user.update).not.toHaveBeenCalled();
      expect(mockMailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const token = 'd'.repeat(64);

    it('updates the password, revokes sessions and refresh tokens', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
        username: 'alice',
        status: 'ACTIVE',
        emailVerified: true,
        passwordResetExpires: new Date(Date.now() + 60_000),
      });
      mockPrismaService.user.update.mockReturnValue('user-update');
      mockPrismaService.refreshToken.updateMany.mockReturnValue('revoke-tokens');
      mockPrismaService.session.deleteMany.mockReturnValue('delete-sessions');
      mockPrismaService.$transaction.mockResolvedValue([]);

      await service.resetPassword({ token, password: 'NewPassword1!' });

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { passwordResetToken: sha256(token) },
      });
      const updateData = mockPrismaService.user.update.mock.calls[0][0].data;
      expect(await bcrypt.compare('NewPassword1!', updateData.password)).toBe(true);
      expect(updateData.passwordResetToken).toBeNull();
      expect(updateData.passwordResetExpires).toBeNull();
      expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRevoked: false },
        data: expect.objectContaining({ isRevoked: true }),
      });
      expect(mockPrismaService.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      expect(mockPrismaService.$transaction).toHaveBeenCalledWith([
        'user-update',
        'revoke-tokens',
        'delete-sessions',
      ]);
      expect(mockRedisService.set).toHaveBeenCalledWith(
        PASSWORD_CHANGED_KEY('user-1'),
        expect.stringMatching(/^\d+$/),
        expect.any(Number),
      );
      expect(mockMailService.sendPasswordChangedEmail).toHaveBeenCalledWith('alice@example.com', 'alice');
    });

    it('rejects expired reset tokens', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        passwordResetExpires: new Date(Date.now() - 1000),
      });

      await expect(service.resetPassword({ token, password: 'NewPassword1!' })).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('rejects unknown reset tokens', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(service.resetPassword({ token, password: 'NewPassword1!' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('isTokenIssuedBeforePasswordChange', () => {
    it('is true only for tokens issued before the last password change', async () => {
      mockRedisService.get.mockResolvedValue('1000');

      await expect(service.isTokenIssuedBeforePasswordChange('user-1', 999)).resolves.toBe(true);
      await expect(service.isTokenIssuedBeforePasswordChange('user-1', 1000)).resolves.toBe(false);
      await expect(service.isTokenIssuedBeforePasswordChange('user-1', 1001)).resolves.toBe(false);
    });

    it('is false when the password was never reset', async () => {
      mockRedisService.get.mockResolvedValue(null);
      await expect(service.isTokenIssuedBeforePasswordChange('user-1', 1)).resolves.toBe(false);
    });
  });
});
