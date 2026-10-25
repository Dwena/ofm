import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { LegalService } from './legal.service';
import { LEGAL_VERSIONS, requiredDocumentsForRole } from './legal-versions';
import { AcceptLegalDto } from './dto/accept-legal.dto';

describe('LegalService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    legalAcceptance: { createMany: jest.fn(), findMany: jest.fn() },
  };
  const service = new LegalService(prisma as any);

  beforeEach(() => jest.clearAllMocks());

  it('exposes the current versions', () => {
    expect(service.getVersions()).toEqual({ versions: LEGAL_VERSIONS });
  });

  it('requires the creator terms only for creators', () => {
    expect(requiredDocumentsForRole('SUBSCRIBER')).toEqual(['terms', 'privacy', 'adult_declaration']);
    expect(requiredDocumentsForRole('CREATOR')).toEqual(['terms', 'privacy', 'adult_declaration', 'creator_terms']);
  });

  it('builds de-duplicated rows at the current version and truncates the user agent', () => {
    const rows = service.buildAcceptances(['terms', 'terms', 'privacy'], {
      ipAddress: '198.51.100.1',
      userAgent: 'x'.repeat(2000),
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ document: 'terms', version: LEGAL_VERSIONS.terms, ipAddress: '198.51.100.1' });
    expect(rows[0].userAgent).toHaveLength(512);
  });

  describe('accept', () => {
    it('records the current version with IP and user agent', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      const result = await service.accept('u1', 'terms', { ipAddress: '203.0.113.9', userAgent: 'UA' });

      expect(prisma.legalAcceptance.createMany).toHaveBeenCalledWith({
        data: [{ userId: 'u1', document: 'terms', version: LEGAL_VERSIONS.terms, ipAddress: '203.0.113.9', userAgent: 'UA' }],
      });
      expect(result).toMatchObject({ document: 'terms', version: LEGAL_VERSIONS.terms });
    });

    it('throws for an unknown user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.accept('nope', 'terms')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.legalAcceptance.createMany).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('lists the documents whose current version has not been accepted', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: 'CREATOR' });
      prisma.legalAcceptance.findMany.mockResolvedValue([
        { document: 'terms', version: '2000-01-01', acceptedAt: new Date('2000-01-01') },
        { document: 'privacy', version: LEGAL_VERSIONS.privacy, acceptedAt: new Date() },
        { document: 'adult_declaration', version: LEGAL_VERSIONS.adult_declaration, acceptedAt: new Date() },
      ]);

      const status = await service.getStatus('u1');

      expect(status.pending).toEqual(['terms', 'creator_terms']);
      const terms = status.documents.find((d) => d.document === 'terms')!;
      expect(terms).toMatchObject({ acceptedVersion: '2000-01-01', currentVersion: LEGAL_VERSIONS.terms, needsAcceptance: true });
    });

    it('returns nothing pending when everything is up to date', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: 'SUBSCRIBER' });
      prisma.legalAcceptance.findMany.mockResolvedValue(
        (['terms', 'privacy', 'adult_declaration'] as const).map((document) => ({
          document,
          version: LEGAL_VERSIONS[document],
          acceptedAt: new Date(),
        })),
      );

      expect((await service.getStatus('u1')).pending).toEqual([]);
    });
  });

  it('AcceptLegalDto rejects unknown documents', async () => {
    expect(await validate(plainToInstance(AcceptLegalDto, { document: 'terms' }))).toHaveLength(0);
    expect(await validate(plainToInstance(AcceptLegalDto, { document: 'whatever' }))).toHaveLength(1);
  });
});
