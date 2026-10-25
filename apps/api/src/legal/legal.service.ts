import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../common/database/prisma.service';
import { LEGAL_VERSIONS, LegalDocument, requiredDocumentsForRole } from './legal-versions';

/** Where an acceptance was made from (kept as evidence) */
export interface AcceptanceContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** IP and user agent are stored truncated to the column-friendly sizes */
const MAX_IP_LENGTH = 64;
const MAX_USER_AGENT_LENGTH = 512;

@Injectable()
export class LegalService {
  constructor(private readonly prisma: PrismaService) {}

  /** Current version of every legal document */
  getVersions() {
    return { versions: { ...LEGAL_VERSIONS } };
  }

  /**
   * LegalAcceptance rows (without userId) for the given documents at their current version.
   * Used as a nested `legalAcceptances: { create }` write so that the acceptance is
   * stored atomically with the account (see AuthService.register).
   */
  buildAcceptances(documents: LegalDocument[], context: AcceptanceContext = {}) {
    const unique = Array.from(new Set(documents));
    return unique.map((document) => ({
      document,
      version: LEGAL_VERSIONS[document],
      ipAddress: context.ipAddress ? context.ipAddress.slice(0, MAX_IP_LENGTH) : null,
      userAgent: context.userAgent ? context.userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
    }));
  }

  /** Records the acceptance of the current version of each document */
  async recordAcceptances(userId: string, documents: LegalDocument[], context: AcceptanceContext = {}) {
    const data = this.buildAcceptances(documents, context).map((row) => ({ userId, ...row }));
    if (data.length === 0) return { count: 0 };
    return this.prisma.legalAcceptance.createMany({ data });
  }

  /** POST /legal/accept: (re-)acceptance of one document by a logged-in user */
  async accept(userId: string, document: LegalDocument, context: AcceptanceContext = {}) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found');

    await this.recordAcceptances(userId, [document], context);
    return { document, version: LEGAL_VERSIONS[document], acceptedAt: new Date().toISOString() };
  }

  /**
   * GET /legal/status: for each document the user's role requires, the last accepted
   * version and whether the current version still has to be accepted.
   */
  async getStatus(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) throw new NotFoundException('User not found');

    const required = requiredDocumentsForRole(user.role);
    const acceptances = await this.prisma.legalAcceptance.findMany({
      where: { userId, document: { in: required } },
      orderBy: { acceptedAt: 'desc' },
      select: { document: true, version: true, acceptedAt: true },
    });

    const documents = required.map((document) => {
      const current = LEGAL_VERSIONS[document];
      const accepted = acceptances.filter((a) => a.document === document);
      const latest = accepted[0] ?? null;
      const hasCurrent = accepted.some((a) => a.version === current);
      return {
        document,
        currentVersion: current,
        acceptedVersion: latest?.version ?? null,
        acceptedAt: latest?.acceptedAt ?? null,
        needsAcceptance: !hasCurrent,
      };
    });

    return {
      documents,
      pending: documents.filter((d) => d.needsAcceptance).map((d) => d.document),
    };
  }
}
