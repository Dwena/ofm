import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { KycService } from './kyc.service';
import { CoPerformersService } from './co-performers.service';
import { VerificationReviewService } from './verification-review.service';
import { VerificationDecision } from './dto/verification.dto';
import { assertCanPublish, isContentPremoderationEnabled, validateCoPerformerIds } from './publication-gate';
import { detectFileType, isAdult, documentSide } from './identity-documents';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(32)]);

const file = (buffer: Buffer, mimetype = 'image/jpeg', name = 'doc.jpg') =>
  ({ buffer, size: buffer.length, mimetype, originalname: name }) as Express.Multer.File;

const yearsAgo = (years: number, extraDays = 0) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() + extraDays))
    .toISOString()
    .slice(0, 10);
};

describe('identity documents helpers', () => {
  it('computes majority on the 18th birthday', () => {
    const today = new Date(Date.UTC(2026, 9, 25));
    expect(isAdult(new Date(Date.UTC(2008, 9, 25)), today)).toBe(true);
    expect(isAdult(new Date(Date.UTC(2008, 9, 26)), today)).toBe(false);
    // Born on Feb 29: adult on March 1 of non-leap years
    expect(isAdult(new Date(Date.UTC(2008, 1, 29)), new Date(Date.UTC(2026, 1, 28)))).toBe(false);
    expect(isAdult(new Date(Date.UTC(2008, 1, 29)), new Date(Date.UTC(2026, 2, 1)))).toBe(true);
  });

  it('detects the real file type from its content', () => {
    expect(detectFileType(JPEG)).toBe('image/jpeg');
    expect(detectFileType(PNG)).toBe('image/png');
    expect(detectFileType(PDF)).toBe('application/pdf');
    expect(detectFileType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
  });

  it('reads the side of a stored document', () => {
    expect(documentSide('kyc/u1/123/front/abc.jpg')).toBe('front');
    expect(documentSide('kyc/u1/co-performers/c/123/release/abc.pdf')).toBe('release');
  });
});

describe('publication gate', () => {
  it('requires a verified, active creator', () => {
    expect(() => assertCanPublish({ role: 'CREATOR', kycStatus: 'VERIFIED', status: 'ACTIVE' })).not.toThrow();
    expect(() => assertCanPublish({ role: 'CREATOR', kycStatus: 'PENDING', status: 'ACTIVE' })).toThrow(
      'Vérifiez votre identité pour publier',
    );
    expect(() => assertCanPublish({ role: 'CREATOR', kycStatus: 'VERIFIED', status: 'SUSPENDED' })).toThrow(
      ForbiddenException,
    );
    expect(() => assertCanPublish({ role: 'SUBSCRIBER', kycStatus: 'VERIFIED' })).toThrow(ForbiddenException);
  });

  it('keeps pre-moderation on unless disabled outside production', () => {
    const config = (env: Record<string, string>) => ({ get: (key: string, fallback?: any) => env[key] ?? fallback });
    expect(isContentPremoderationEnabled(config({}))).toBe(true);
    expect(isContentPremoderationEnabled(config({ CONTENT_PREMODERATION: 'false', NODE_ENV: 'development' }))).toBe(false);
    expect(isContentPremoderationEnabled(config({ CONTENT_PREMODERATION: 'false', NODE_ENV: 'production' }))).toBe(true);
  });

  it('validates co-performers', async () => {
    const prisma = { coPerformer: { findMany: jest.fn().mockResolvedValue([{ id: 'a', status: 'VERIFIED' }]) } };
    await expect(validateCoPerformerIds(prisma, 'c1', [])).resolves.toEqual([]);
    expect(prisma.coPerformer.findMany).not.toHaveBeenCalled();
    await expect(validateCoPerformerIds(prisma, 'c1', ['a', 'a'])).resolves.toEqual(['a']);
    await expect(validateCoPerformerIds(prisma, 'c1', ['a', 'b'])).rejects.toThrow(BadRequestException);
  });
});

describe('KycService', () => {
  let prisma: any;
  let storage: any;
  let service: KycService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u1', role: 'CREATOR', kycStatus: 'NOT_STARTED', deletedAt: null }),
        update: jest.fn((args: any) => args),
        findMany: jest.fn().mockResolvedValue([{ id: 'mod-1' }]),
      },
      identityDocument: { create: jest.fn((args: any) => args), findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn((args: any) => args) },
      notification: { createMany: jest.fn() },
      $transaction: jest.fn(async (ops: any[]) => ops),
    };
    let n = 0;
    storage = { uploadFile: jest.fn(async (_b: Buffer, _n: string, _m: string, folder: string) => ({ key: `${folder}/f${n++}`, url: 'x' })) };
    service = new KycService(prisma, storage);
  });

  const files = () => ({ documentFront: [file(JPEG)], documentBack: [file(PNG)], selfie: [file(JPEG)] });

  it('stores the documents privately and sets the status to PENDING', async () => {
    await service.submit('u1', { documentType: 'ID_CARD', dateOfBirth: yearsAgo(25) }, files());

    expect(storage.uploadFile).toHaveBeenCalledTimes(3);
    for (const call of storage.uploadFile.mock.calls) {
      expect(call[3]).toMatch(/^kyc\/u1\/\d+\/(front|back|selfie)$/);
      expect(call[4]).toEqual({ cacheControl: 'private, no-store' });
    }
    const types = prisma.identityDocument.create.mock.calls.map((c: any) => c[0].data.type);
    expect(types).toEqual(['ID_CARD', 'ID_CARD', 'SELFIE']);
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({
      kycStatus: 'PENDING',
      kycSubmittedAt: expect.any(Date),
      dateOfBirth: expect.any(Date),
    });
    expect(prisma.notification.createMany).toHaveBeenCalled();
  });

  it('refuses minors with a clear message', async () => {
    await expect(
      service.submit('u1', { documentType: 'PASSPORT', dateOfBirth: yearsAgo(18, 1) }, files()),
    ).rejects.toThrow('au moins 18 ans');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it('requires the back of an ID card and a selfie, images/PDF only', async () => {
    await expect(
      service.submit('u1', { documentType: 'ID_CARD', dateOfBirth: yearsAgo(30) }, { documentFront: [file(JPEG)], selfie: [file(JPEG)] }),
    ).rejects.toThrow(/verso/);
    await expect(
      service.submit('u1', { documentType: 'PASSPORT', dateOfBirth: yearsAgo(30) }, { documentFront: [file(JPEG)] }),
    ).rejects.toThrow(/Selfie/);
    await expect(
      service.submit(
        'u1',
        { documentType: 'PASSPORT', dateOfBirth: yearsAgo(30) },
        { documentFront: [file(Buffer.from('GIF89a-not-accepted-format'), 'image/jpeg')], selfie: [file(JPEG)] },
      ),
    ).rejects.toThrow(/format/);
    // A PDF selfie is not accepted
    await expect(
      service.submit('u1', { documentType: 'PASSPORT', dateOfBirth: yearsAgo(30) }, { documentFront: [file(PDF)], selfie: [file(PDF)] }),
    ).rejects.toThrow(/Selfie/);
  });

  it('allows resubmission after a rejection only', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'CREATOR', kycStatus: 'PENDING', deletedAt: null });
    await expect(
      service.submit('u1', { documentType: 'PASSPORT', dateOfBirth: yearsAgo(30) }, files()),
    ).rejects.toThrow(BadRequestException);

    prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'CREATOR', kycStatus: 'REJECTED', deletedAt: null });
    await service.submit('u1', { documentType: 'PASSPORT', dateOfBirth: yearsAgo(30) }, files());
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({ kycStatus: 'PENDING', kycRejectionReason: null });
  });
});

describe('CoPerformersService', () => {
  let prisma: any;
  let storage: any;
  let service: CoPerformersService;
  const dto = {
    legalFirstName: ' Léa ',
    legalLastName: 'Martin',
    stageName: 'Lea M',
    dateOfBirth: '1996-03-02',
    email: 'Lea@Example.com',
    documentType: 'PASSPORT' as const,
    consentSignedAt: '2026-10-20',
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'CREATOR', deletedAt: null }), findMany: jest.fn().mockResolvedValue([]) },
      coPerformer: {
        create: jest.fn(async ({ data }: any) => ({ id: 'cp-1', ...data })),
        findUnique: jest.fn(),
        update: jest.fn(async ({ data }: any) => ({ id: 'cp-1', ...data })),
      },
      identityDocument: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      notification: { createMany: jest.fn() },
    };
    storage = { uploadFile: jest.fn(async (_b: Buffer, _n: string, _m: string, folder: string) => ({ key: `${folder}/x`, url: 'x' })) };
    service = new CoPerformersService(prisma, storage);
  });

  it('declares a co-performer as PENDING with ID and signed release', async () => {
    const result = await service.create('c1', dto, { documentFront: [file(JPEG)], releaseForm: [file(PDF, 'application/pdf')] });

    expect(result.status).toBe('PENDING');
    expect(prisma.coPerformer.create.mock.calls[0][0].data).toMatchObject({
      creatorId: 'c1',
      legalFirstName: 'Léa',
      email: 'lea@example.com',
      status: 'PENDING',
    });
    const docs = prisma.identityDocument.create.mock.calls.map((c: any) => c[0].data);
    expect(docs.map((d: any) => d.type)).toEqual(['PASSPORT', 'RELEASE_FORM']);
    expect(docs[1]).toMatchObject({ coPerformerId: 'cp-1', userId: 'c1', mimeType: 'application/pdf' });
    expect(storage.uploadFile.mock.calls[1][3]).toMatch(/^kyc\/c1\/co-performers\/cp-1\/\d+\/release$/);
  });

  it('refuses minors and missing release forms', async () => {
    await expect(
      service.create('c1', { ...dto, dateOfBirth: yearsAgo(17) }, { documentFront: [file(JPEG)], releaseForm: [file(PDF)] }),
    ).rejects.toThrow('au moins 18 ans');
    await expect(service.create('c1', dto, { documentFront: [file(JPEG)] })).rejects.toThrow(/release/);
    expect(prisma.coPerformer.create).not.toHaveBeenCalled();
  });

  it('cannot change a verified co-performer; a correction goes back to PENDING', async () => {
    prisma.coPerformer.findUnique.mockResolvedValue({ id: 'cp-1', creatorId: 'c1', status: 'VERIFIED', deletedAt: null });
    await expect(service.update('c1', 'cp-1', { stageName: 'X' })).rejects.toThrow(BadRequestException);

    prisma.coPerformer.findUnique.mockResolvedValue({ id: 'cp-1', creatorId: 'c1', status: 'REJECTED', deletedAt: null });
    await service.update('c1', 'cp-1', { stageName: 'X' });
    expect(prisma.coPerformer.update.mock.calls[0][0].data).toMatchObject({ status: 'PENDING', rejectionReason: null });
  });

  it('only gives access to the creator\'s own co-performers; deletion is soft', async () => {
    prisma.coPerformer.findUnique.mockResolvedValue({ id: 'cp-1', creatorId: 'other', status: 'PENDING', deletedAt: null });
    await expect(service.remove('c1', 'cp-1')).rejects.toThrow(ForbiddenException);

    prisma.coPerformer.findUnique.mockResolvedValue({ id: 'cp-1', creatorId: 'c1', status: 'PENDING', deletedAt: null });
    await service.remove('c1', 'cp-1');
    expect(prisma.coPerformer.update).toHaveBeenCalledWith({ where: { id: 'cp-1' }, data: { deletedAt: expect.any(Date) } });
  });
});

describe('VerificationReviewService', () => {
  let prisma: any;
  let storage: any;
  let service: VerificationReviewService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u1', kycStatus: 'PENDING', dateOfBirth: new Date('1990-01-01'), deletedAt: null }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      identityDocument: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'd1', type: 'ID_CARD', storagePath: 'kyc/u1/1/front/a.jpg', mimeType: 'image/jpeg', size: 10, createdAt: new Date() },
        ]),
      },
      coPerformer: { findUnique: jest.fn(), update: jest.fn(async ({ data }: any) => data), findMany: jest.fn(), count: jest.fn() },
      auditLog: { create: jest.fn() },
      notification: { create: jest.fn() },
    };
    storage = { getSignedUrl: jest.fn(async (key: string, ttl: number) => `signed://${key}?ttl=${ttl}`) };
    service = new VerificationReviewService(prisma, storage);
  });

  it('lists creators waiting for a KYC decision by default', async () => {
    await service.listKyc({});
    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({
      role: 'CREATOR',
      kycStatus: { in: ['PENDING', 'UNDER_REVIEW'] },
    });
  });

  it('gives 5-minute signed URLs and audit-logs every access', async () => {
    const detail = await service.getKycDetail('mod-1', 'u1', '10.0.0.1');

    expect(detail.documents[0]).toMatchObject({ side: 'front', url: 'signed://kyc/u1/1/front/a.jpg?ttl=300' });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'mod-1',
        action: 'IDENTITY_DOCUMENTS_VIEWED',
        resource: 'USER',
        resourceId: 'u1',
        ipAddress: '10.0.0.1',
      }),
    });
  });

  it('never hands out document URLs when the access cannot be logged', async () => {
    prisma.auditLog.create.mockRejectedValue(new Error('db down'));
    await expect(service.getKycDetail('mod-1', 'u1')).rejects.toThrow('db down');
    expect(storage.getSignedUrl).not.toHaveBeenCalled();
  });

  it('approves a co-performer with documents and notifies the creator', async () => {
    prisma.coPerformer.findUnique.mockResolvedValue({
      id: 'cp-1',
      creatorId: 'c1',
      status: 'PENDING',
      deletedAt: null,
      legalFirstName: 'Léa',
      legalLastName: 'Martin',
      dateOfBirth: new Date('1996-03-02'),
      documents: [{ type: 'PASSPORT' }, { type: 'RELEASE_FORM' }],
    });

    await service.reviewCoPerformer('mod-1', 'cp-1', { decision: VerificationDecision.APPROVE });

    expect(prisma.coPerformer.update.mock.calls[0][0].data).toMatchObject({ status: 'VERIFIED', reviewedBy: 'mod-1' });
    expect(prisma.notification.create.mock.calls[0][0].data.userId).toBe('c1');
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('CO_PERFORMER_APPROVED');
  });

  it('refuses to approve without a release form or for a minor; rejection needs a reason', async () => {
    const base = { id: 'cp-1', creatorId: 'c1', status: 'PENDING', deletedAt: null, legalFirstName: 'A', legalLastName: 'B' };
    prisma.coPerformer.findUnique.mockResolvedValue({ ...base, dateOfBirth: new Date('1996-03-02'), documents: [{ type: 'PASSPORT' }] });
    await expect(
      service.reviewCoPerformer('mod-1', 'cp-1', { decision: VerificationDecision.APPROVE }),
    ).rejects.toThrow(/autorisation/);

    prisma.coPerformer.findUnique.mockResolvedValue({
      ...base,
      dateOfBirth: new Date(Date.now() - 10 * 365 * 24 * 3600 * 1000),
      documents: [{ type: 'PASSPORT' }, { type: 'RELEASE_FORM' }],
    });
    await expect(
      service.reviewCoPerformer('mod-1', 'cp-1', { decision: VerificationDecision.APPROVE }),
    ).rejects.toThrow(/moins de 18 ans/);

    await expect(
      service.reviewCoPerformer('mod-1', 'cp-1', { decision: VerificationDecision.REJECT }),
    ).rejects.toThrow(/motif/);
    expect(prisma.coPerformer.update).not.toHaveBeenCalled();
  });
});
