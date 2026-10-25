import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PrismaService } from '../common/database/prisma.service';
import { AdminContentFilter, KycDecision, ReportStatus, UserAction } from './dto/admin.dto';

describe('AdminService', () => {
  let service: AdminService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    content: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    comment: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    message: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    report: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
    identityDocument: {
      count: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdminService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<AdminService>(AdminService);
    jest.clearAllMocks();
  });

  describe('getUserDetails', () => {
    beforeEach(() => {
      mockPrismaService.content.count.mockResolvedValue(3);
      mockPrismaService.content.findMany.mockResolvedValue([{ id: 'c1' }]);
      mockPrismaService.report.findMany.mockReset();
      mockPrismaService.report.findMany
        .mockResolvedValueOnce([{ reportedId: 'm1' }]) // comment/message reports
        .mockResolvedValueOnce([{ id: 'r1', reportedType: 'content', status: 'pending', reportedId: 'c1' }]);
      (mockPrismaService as any).comment.findMany = jest.fn().mockResolvedValue([]);
      (mockPrismaService as any).message.findMany = jest.fn().mockResolvedValue([{ id: 'm1' }]);
      (mockPrismaService as any).subscription = {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([{ id: 's1', tier: { id: 't1', name: 'VIP', price: '9.99' } }]),
      };
      (mockPrismaService as any).transaction = {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 12 } }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'tx1', amount: '10', platformFee: '2', netAmount: '8', fromUserId: 'u1', toUserId: 'c9' },
        ]),
      };
      mockPrismaService.report.count.mockResolvedValue(1);
      mockPrismaService.auditLog.findMany.mockResolvedValue([{ id: 'l1', userId: 'admin-1', action: 'USER_WARN' }]);
      mockPrismaService.user.findMany.mockResolvedValue([{ id: 'admin-1', username: 'admin' }]);
    });

    afterEach(() => mockPrismaService.report.findMany.mockReset());

    it('never returns password, 2FA secret or one-time tokens', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'u1',
        username: 'alice',
        password: 'hash',
        twoFactorSecret: 'secret',
        emailVerificationToken: 'tok',
        passwordResetToken: 'reset',
      });

      const result = await service.getUserDetails('u1');

      expect(result.user).toEqual({ id: 'u1', username: 'alice' });
      expect(result.stats.contentCount).toBe(3);
    });

    it('returns subscriptions, transactions, reports against the user and audit history', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'u1', username: 'alice' });

      const result = await service.getUserDetails('u1');

      // Reports on the account, its contents and the messages it sent
      expect(mockPrismaService.report.count).toHaveBeenCalledWith({
        where: { reportedId: { in: ['u1', 'c1', 'm1'] } },
      });
      expect(result.reports[0]).toEqual(expect.objectContaining({ reportedType: 'CONTENT', status: 'PENDING' }));
      expect(result.subscriptions[0].tier!.price).toBe(9.99);
      expect(result.transactions[0]).toEqual(
        expect.objectContaining({ amount: 10, platformFee: 2, netAmount: 8, direction: 'OUT' }),
      );
      expect(result.auditLogs[0].actor).toEqual({ id: 'admin-1', username: 'admin' });
      expect(mockPrismaService.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { resourceId: 'u1' } }),
      );
    });

    it('throws when the user does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(service.getUserDetails('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getUsers', () => {
    it('filters on KYC status and moderator role', async () => {
      mockPrismaService.user.findMany.mockResolvedValue([]);
      mockPrismaService.user.count.mockResolvedValue(0);

      await service.getUsers({ kycStatus: 'PENDING', role: 'MODERATOR', page: 1, limit: 20 });

      expect(mockPrismaService.user.findMany.mock.calls[0][0].where).toEqual(
        expect.objectContaining({ kycStatus: 'PENDING', role: 'MODERATOR', deletedAt: null }),
      );
    });
  });

  describe('reviewKyc', () => {
    it('approves a pending verification, notifies and audits', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'u1',
        kycStatus: 'PENDING',
        deletedAt: null,
        dateOfBirth: new Date('1995-04-12'),
      });
      mockPrismaService.identityDocument.count.mockResolvedValue(3);
      mockPrismaService.user.update.mockResolvedValue({ id: 'u1', kycStatus: 'VERIFIED' });

      const result = await service.reviewKyc('admin-1', 'u1', { decision: KycDecision.APPROVE });

      const data = mockPrismaService.user.update.mock.calls[0][0].data;
      expect(data.kycStatus).toBe('VERIFIED');
      expect(data.kycVerifiedAt).toBeInstanceOf(Date);
      expect(data.kycRejectionReason).toBeNull();
      expect(result.user.kycStatus).toBe('VERIFIED');
      expect(mockPrismaService.notification.create).toHaveBeenCalled();
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'KYC_APPROVED', resource: 'USER', resourceId: 'u1' }),
      });
    });

    it('never approves a minor or an account without documents', async () => {
      const today = new Date();
      const seventeen = new Date(Date.UTC(today.getUTCFullYear() - 17, today.getUTCMonth(), today.getUTCDate()));
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'u1', kycStatus: 'PENDING', deletedAt: null, dateOfBirth: seventeen });
      await expect(service.reviewKyc('admin-1', 'u1', { decision: KycDecision.APPROVE })).rejects.toThrow(
        BadRequestException,
      );

      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'u1', kycStatus: 'PENDING', deletedAt: null, dateOfBirth: null });
      await expect(service.reviewKyc('admin-1', 'u1', { decision: KycDecision.APPROVE })).rejects.toThrow(
        BadRequestException,
      );

      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'u1',
        kycStatus: 'PENDING',
        deletedAt: null,
        dateOfBirth: new Date('1990-01-01'),
      });
      mockPrismaService.identityDocument.count.mockResolvedValue(0);
      await expect(service.reviewKyc('admin-1', 'u1', { decision: KycDecision.APPROVE })).rejects.toThrow(
        "Aucune pièce d'identité",
      );
      expect(mockPrismaService.user.update).not.toHaveBeenCalled();
    });

    it('rejects with a reason', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'u1', kycStatus: 'PENDING', deletedAt: null });
      mockPrismaService.user.update.mockResolvedValue({ id: 'u1', kycStatus: 'REJECTED' });

      await service.reviewKyc('admin-1', 'u1', { decision: KycDecision.REJECT, reason: ' Document illisible ' });

      expect(mockPrismaService.user.update.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ kycStatus: 'REJECTED', kycRejectionReason: 'Document illisible' }),
      );
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'KYC_REJECTED' }),
      });
    });

    it('requires a reason to reject', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'u1', kycStatus: 'PENDING', deletedAt: null });

      await expect(
        service.reviewKyc('admin-1', 'u1', { decision: KycDecision.REJECT, reason: '  ' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.user.update).not.toHaveBeenCalled();
    });

    it('refuses when no verification is pending', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'u1', kycStatus: 'VERIFIED', deletedAt: null });

      await expect(
        service.reviewKyc('admin-1', 'u1', { decision: KycDecision.APPROVE }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when the user does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.reviewKyc('admin-1', 'nope', { decision: KycDecision.APPROVE }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('moderateUser', () => {
    it('suspends with an expiry and writes an audit log', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'u1', role: 'CREATOR', status: 'ACTIVE' });
      mockPrismaService.user.update.mockResolvedValue({ id: 'u1', status: 'SUSPENDED' });

      const result = await service.moderateUser('admin-1', {
        userId: 'u1',
        action: UserAction.SUSPEND,
        reason: 'spam',
        durationDays: 7,
      });

      const updateArgs = mockPrismaService.user.update.mock.calls[0][0];
      expect(updateArgs.data.status).toBe('SUSPENDED');
      expect(updateArgs.data.suspensionReason).toBe('spam');
      expect(updateArgs.data.suspendedUntil).toBeInstanceOf(Date);
      expect(updateArgs.select.password).toBeUndefined();
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'admin-1', action: 'USER_SUSPEND', resource: 'USER', resourceId: 'u1' }),
      });
    });

    it('clears moderation fields on activate', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'u1', role: 'SUBSCRIBER', status: 'BANNED' });
      mockPrismaService.user.update.mockResolvedValue({ id: 'u1', status: 'ACTIVE' });

      await service.moderateUser('admin-1', { userId: 'u1', action: UserAction.ACTIVATE });

      expect(mockPrismaService.user.update.mock.calls[0][0].data).toEqual({
        status: 'ACTIVE',
        bannedAt: null,
        banReason: null,
        suspendedUntil: null,
        suspensionReason: null,
      });
    });

    it('refuses to moderate admins', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'a2', role: 'ADMIN' });

      await expect(
        service.moderateUser('admin-1', { userId: 'a2', action: UserAction.BAN }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('does not fail when the audit log cannot be written', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'u1', role: 'CREATOR', status: 'ACTIVE' });
      mockPrismaService.user.update.mockResolvedValue({ id: 'u1', status: 'BANNED' });
      mockPrismaService.auditLog.create.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.moderateUser('admin-1', { userId: 'u1', action: UserAction.BAN, reason: 'fraud' }),
      ).resolves.toEqual(expect.objectContaining({ success: true }));
    });
  });

  describe('getReports', () => {
    it('filters on reportedType and lowercase statuses and enriches the target', async () => {
      mockPrismaService.report.findMany.mockResolvedValue([
        { id: 'r1', reportedType: 'CONTENT', reportedId: 'c1', status: 'pending', reason: 'SPAM' },
      ]);
      mockPrismaService.report.count.mockResolvedValue(1);
      mockPrismaService.content.findUnique.mockResolvedValue({
        id: 'c1',
        title: 'Post',
        creator: { id: 'u1', username: 'alice' },
      });

      const result = await service.getReports({ status: ReportStatus.PENDING, type: 'CONTENT' as any });

      const where = mockPrismaService.report.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({ in: ['pending', 'PENDING'] });
      expect(where.reportedType).toEqual({ in: ['CONTENT', 'content'] });
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          status: ReportStatus.PENDING,
          reportedUser: { id: 'u1', username: 'alice' },
          reportedEntity: expect.objectContaining({ id: 'c1' }),
        }),
      );
      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    });
  });

  describe('handleReport', () => {
    it('throws when report is missing', async () => {
      mockPrismaService.report.findUnique.mockResolvedValue(null);

      await expect(
        service.handleReport('admin-1', { reportId: 'nope', status: ReportStatus.REJECTED }),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses sanctions from moderators', async () => {
      await expect(
        service.handleReport(
          'mod-1',
          { reportId: 'r1', status: ReportStatus.RESOLVED, action: UserAction.BAN },
          'MODERATOR',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.report.update).not.toHaveBeenCalled();
    });

    it('notifies the reporter of the final decision', async () => {
      mockPrismaService.report.findUnique.mockResolvedValue({
        id: 'r1',
        reporterId: 'reporter-1',
        reportedType: 'USER',
        reportedId: 'u1',
      });
      mockPrismaService.report.update.mockResolvedValue({ id: 'r1', status: 'dismissed' });

      await service.handleReport('mod-1', { reportId: 'r1', status: ReportStatus.REJECTED }, 'MODERATOR');

      expect(mockPrismaService.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'reporter-1', type: 'SYSTEM' }),
      });
    });

    it('stores the DB status and does not take action when rejected', async () => {
      mockPrismaService.report.findUnique.mockResolvedValue({ id: 'r1', reportedType: 'USER', reportedId: 'u1' });
      mockPrismaService.report.update.mockResolvedValue({ id: 'r1', status: 'dismissed' });

      const result = await service.handleReport('admin-1', {
        reportId: 'r1',
        status: ReportStatus.REJECTED,
        action: UserAction.BAN,
      });

      expect(mockPrismaService.report.update.mock.calls[0][0].data.status).toBe('dismissed');
      expect(mockPrismaService.user.update).not.toHaveBeenCalled();
      expect(result.status).toBe(ReportStatus.REJECTED);
    });

    it('refuses to sanction an admin without resolving the report', async () => {
      mockPrismaService.report.findUnique.mockResolvedValue({ id: 'r1', reportedType: 'USER', reportedId: 'a1' });
      mockPrismaService.user.findUnique
        // resolveReportTarget
        .mockResolvedValueOnce({ id: 'a1', username: 'boss' })
        // sanction check
        .mockResolvedValueOnce({ role: 'ADMIN' });

      await expect(
        service.handleReport('admin-1', { reportId: 'r1', status: ReportStatus.RESOLVED, action: UserAction.BAN }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.report.update).not.toHaveBeenCalled();
    });

    it('removes content and moderates its creator when resolved', async () => {
      mockPrismaService.report.findUnique.mockResolvedValue({
        id: 'r1',
        reportedType: 'CONTENT',
        reportedId: 'c1',
        reason: 'NUDITY',
      });
      mockPrismaService.report.update.mockResolvedValue({ id: 'r1', status: 'resolved' });
      mockPrismaService.content.findUnique
        // resolveReportTarget
        .mockResolvedValueOnce({ id: 'c1', creator: { id: 'u1', username: 'alice' } })
        // removeContent
        .mockResolvedValueOnce({ id: 'c1', creatorId: 'u1', title: 'Post', deletedAt: null });
      mockPrismaService.content.update.mockResolvedValue({ id: 'c1', status: 'REJECTED' });
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'u1', role: 'CREATOR', status: 'ACTIVE' });
      mockPrismaService.user.update.mockResolvedValue({ id: 'u1', status: 'SUSPENDED' });

      await service.handleReport('admin-1', {
        reportId: 'r1',
        status: ReportStatus.RESOLVED,
        action: UserAction.SUSPEND,
        durationDays: 3,
        removeContent: true,
      });

      expect(mockPrismaService.content.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1' }, data: expect.objectContaining({ status: 'REJECTED' }) }),
      );
      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u1' }, data: expect.objectContaining({ status: 'SUSPENDED' }) }),
      );
    });
  });

  describe('getContent', () => {
    it('lists flagged content with pending report counts', async () => {
      mockPrismaService.report.findMany.mockResolvedValue([{ reportedId: 'c1' }, { reportedId: 'c1' }]);
      mockPrismaService.content.findMany.mockResolvedValue([
        { id: 'c1', title: 'Post', ppvPrice: '9.99' },
      ]);
      mockPrismaService.content.count.mockResolvedValue(1);
      mockPrismaService.report.groupBy.mockResolvedValue([{ reportedId: 'c1', _count: { id: 2 } }]);

      const result = await service.getContent({ filter: AdminContentFilter.FLAGGED, page: 1, limit: 20 });

      const where = mockPrismaService.content.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
      expect(where.OR).toEqual([{ status: 'UNDER_REVIEW' }, { id: { in: ['c1'] } }]);
      expect(result.items[0]).toEqual(expect.objectContaining({ id: 'c1', pendingReports: 2, ppvPrice: 9.99 }));
      expect(result.pagination.total).toBe(1);
    });

    it('lists removed content', async () => {
      mockPrismaService.content.findMany.mockResolvedValue([]);
      mockPrismaService.content.count.mockResolvedValue(0);

      const result = await service.getContent({ filter: AdminContentFilter.REMOVED, query: 'abc' });

      const where = mockPrismaService.content.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toEqual({ not: null });
      expect(where.AND).toHaveLength(1);
      expect(mockPrismaService.report.groupBy).not.toHaveBeenCalled();
      expect(result.items).toEqual([]);
    });
  });

  describe('removeContent / restoreContent', () => {
    it('soft deletes content, notifies the creator and audits', async () => {
      mockPrismaService.content.findUnique.mockResolvedValue({
        id: 'c1',
        creatorId: 'u1',
        title: 'Post',
        deletedAt: null,
      });
      mockPrismaService.content.update.mockResolvedValue({ id: 'c1', status: 'REJECTED' });

      const result = await service.removeContent('admin-1', 'c1', 'illegal');

      const data = mockPrismaService.content.update.mock.calls[0][0].data;
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.moderatedBy).toBe('admin-1');
      expect(data.moderationNotes).toBe('illegal');
      expect(mockPrismaService.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'u1', type: 'CONTENT_REJECTED' }),
      });
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'CONTENT_REMOVED', resourceId: 'c1' }),
      });
      expect(result.success).toBe(true);
    });

    it('refuses to remove already removed content', async () => {
      mockPrismaService.content.findUnique.mockResolvedValue({ id: 'c1', deletedAt: new Date() });

      await expect(service.removeContent('admin-1', 'c1')).rejects.toThrow(BadRequestException);
    });

    it('throws when content does not exist', async () => {
      mockPrismaService.content.findUnique.mockResolvedValue(null);

      await expect(service.removeContent('admin-1', 'missing')).rejects.toThrow(NotFoundException);
      await expect(service.restoreContent('admin-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('restores published content', async () => {
      mockPrismaService.content.findUnique.mockResolvedValue({
        id: 'c1',
        creatorId: 'u1',
        title: 'Post',
        deletedAt: new Date(),
        status: 'REJECTED',
        publishedAt: new Date(),
      });
      mockPrismaService.content.update.mockResolvedValue({ id: 'c1', status: 'PUBLISHED' });

      await service.restoreContent('admin-1', 'c1');

      expect(mockPrismaService.content.update.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ status: 'PUBLISHED', deletedAt: null }),
      );
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'CONTENT_RESTORED' }),
      });
    });

    it('refuses to restore content that was not removed', async () => {
      mockPrismaService.content.findUnique.mockResolvedValue({
        id: 'c1',
        deletedAt: null,
        status: 'PUBLISHED',
      });

      await expect(service.restoreContent('admin-1', 'c1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAuditLogs', () => {
    it('paginates logs and attaches actors', async () => {
      mockPrismaService.auditLog.findMany.mockResolvedValue([
        { id: 'l1', userId: 'admin-1', action: 'USER_BAN' },
        { id: 'l2', userId: null, action: 'SYSTEM' },
      ]);
      mockPrismaService.auditLog.count.mockResolvedValue(2);
      mockPrismaService.user.findMany.mockResolvedValue([{ id: 'admin-1', username: 'root' }]);

      const result = await service.getAuditLogs({ action: 'ban', page: 1, limit: 50 });

      expect(mockPrismaService.auditLog.findMany.mock.calls[0][0].where).toEqual({
        action: { contains: 'ban', mode: 'insensitive' },
      });
      expect(result.items[0].actor).toEqual({ id: 'admin-1', username: 'root' });
      expect(result.items[1].actor).toBeNull();
      expect(result.pagination).toEqual({ page: 1, limit: 50, total: 2, totalPages: 1 });
    });
  });
});
