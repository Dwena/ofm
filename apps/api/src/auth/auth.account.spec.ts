import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';

import { AuthService, PASSWORD_CHANGED_KEY } from './auth.service';
import { PrismaService } from '../common/database/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../common/mail/mail.service';
import { SettingsService } from '../settings/settings.service';
import { LegalService } from '../legal/legal.service';

// bcrypt hashing is CPU bound: leave room on a busy machine
jest.setTimeout(30000);

describe('AuthService (account: change password, logout all, delete)', () => {
  let service: AuthService;
  let passwordHash: string;

  const mockPrismaService = {
    user: { findUnique: jest.fn(), update: jest.fn((args) => ({ op: 'user.update', args })) },
    refreshToken: {
      create: jest.fn(),
      updateMany: jest.fn((args) => ({ op: 'refreshToken.updateMany', args })),
    },
    session: { deleteMany: jest.fn((args) => ({ op: 'session.deleteMany', args })) },
    subscription: {
      findMany: jest.fn(),
      updateMany: jest.fn((args) => ({ op: 'subscription.updateMany', args })),
    },
    paymentCard: { updateMany: jest.fn((args) => ({ op: 'paymentCard.updateMany', args })) },
    subscriptionTier: { updateMany: jest.fn((args) => ({ op: 'subscriptionTier.updateMany', args })) },
    content: { updateMany: jest.fn((args) => ({ op: 'content.updateMany', args })) },
    follow: { deleteMany: jest.fn((args) => ({ op: 'follow.deleteMany', args })) },
    pushSubscription: { deleteMany: jest.fn((args) => ({ op: 'pushSubscription.deleteMany', args })) },
    notification: { deleteMany: jest.fn((args) => ({ op: 'notification.deleteMany', args })) },
    $transaction: jest.fn(async (ops) => ops),
  };

  const mockRedisService = { get: jest.fn(), set: jest.fn(), del: jest.fn(), exists: jest.fn() };
  const mockMailService = { sendPasswordChangedEmail: jest.fn().mockResolvedValue(true) };
  const mockJwtService = { sign: jest.fn(() => 'signed-token'), verify: jest.fn(), decode: jest.fn() };
  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => (key === 'BCRYPT_ROUNDS' ? '4' : defaultValue)),
  };

  const baseUser = () => ({
    id: 'user-1',
    email: 'alice@example.com',
    username: 'alice',
    role: 'SUBSCRIBER',
    password: passwordHash,
    twoFactorEnabled: false,
    twoFactorSecret: null,
    deletedAt: null,
  });

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('OldPass1!', 4);
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: UsersService, useValue: {} },
        { provide: MailService, useValue: mockMailService },
        { provide: SettingsService, useValue: {} },
        LegalService,
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  describe('changePassword', () => {
    it('rejects a wrong current password with a 400 (not 401)', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(baseUser());

      await expect(
        service.changePassword('user-1', { currentPassword: 'Wrong1!', newPassword: 'NewPass1!' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a new password identical to the current one', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(baseUser());

      await expect(
        service.changePassword('user-1', { currentPassword: 'OldPass1!', newPassword: 'OldPass1!' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates the hash, revokes other sessions and returns fresh tokens', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(baseUser());

      const result = await service.changePassword('user-1', {
        currentPassword: 'OldPass1!',
        newPassword: 'NewPass1!',
      });

      const updateArgs = mockPrismaService.user.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: 'user-1' });
      expect(await bcrypt.compare('NewPass1!', updateArgs.data.password)).toBe(true);
      expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', isRevoked: false } }),
      );
      expect(mockPrismaService.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      expect(mockRedisService.set).toHaveBeenCalledWith(
        PASSWORD_CHANGED_KEY('user-1'),
        expect.any(String),
        expect.any(Number),
      );
      expect(mockPrismaService.refreshToken.create).toHaveBeenCalled();
      expect(mockMailService.sendPasswordChangedEmail).toHaveBeenCalledWith('alice@example.com', 'alice');
      expect(result).toEqual(
        expect.objectContaining({ accessToken: 'signed-token', refreshToken: 'signed-token' }),
      );
    });
  });

  describe('logoutAll', () => {
    it('revokes every refresh token and every access token issued until now', async () => {
      const before = Math.floor(Date.now() / 1000);

      await service.logoutAll('user-1');

      expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', isRevoked: false } }),
      );
      const [key, value] = mockRedisService.set.mock.calls[0];
      expect(key).toBe(PASSWORD_CHANGED_KEY('user-1'));
      expect(parseInt(value, 10)).toBeGreaterThan(before);
    });
  });

  describe('deleteAccount', () => {
    it('requires the right password', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(baseUser());

      await expect(service.deleteAccount('user-1', { password: 'Wrong1!' })).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('requires the 2FA code when 2FA is enabled', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ ...baseUser(), twoFactorEnabled: true });

      await expect(service.deleteAccount('user-1', { password: 'OldPass1!' })).rejects.toThrow(
        'Code 2FA requis',
      );
    });

    it('refuses to delete an admin account', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ ...baseUser(), role: 'ADMIN' });

      await expect(service.deleteAccount('user-1', { password: 'OldPass1!' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('anonymizes the user, stops billing and revokes every session', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ ...baseUser(), role: 'CREATOR' });
      mockPrismaService.subscription.findMany.mockResolvedValue([
        { id: 'sub-1' },
        { id: 'sub-2' },
      ]);

      await expect(service.deleteAccount('user-1', { password: 'OldPass1!' })).resolves.toEqual({
        message: 'Account deleted',
      });

      const userUpdate = mockPrismaService.user.update.mock.calls[0][0];
      expect(userUpdate.data).toEqual(
        expect.objectContaining({
          email: 'deleted-user-1@deleted.invalid',
          username: expect.stringMatching(/^deleted_/),
          displayName: 'Compte supprimé',
          avatar: null,
          bio: null,
          twoFactorEnabled: false,
          deletedAt: expect.any(Date),
        }),
      );
      expect(await bcrypt.compare('OldPass1!', userUpdate.data.password)).toBe(false);
      expect(mockPrismaService.subscription.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['sub-1', 'sub-2'] } },
        data: { cancelAtPeriodEnd: true },
      });
      expect(mockPrismaService.paymentCard.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', deletedAt: null },
        data: { deletedAt: expect.any(Date), isDefault: false },
      });
      expect(mockPrismaService.subscriptionTier.updateMany).toHaveBeenCalledWith({
        where: { creatorId: 'user-1' },
        data: { isActive: false },
      });
      expect(mockPrismaService.content.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { creatorId: 'user-1', deletedAt: null } }),
      );
      expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalled();
      expect(mockRedisService.set).toHaveBeenCalledWith(
        PASSWORD_CHANGED_KEY('user-1'),
        expect.any(String),
        expect.any(Number),
      );
    });
  });
});
