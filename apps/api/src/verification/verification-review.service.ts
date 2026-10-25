import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  ListCoPerformersReviewDto,
  ListKycDto,
  ReviewCoPerformerDto,
  VerificationDecision,
} from './dto/verification.dto';
import { IDENTITY_DOCUMENT_URL_TTL_SECONDS, documentSide, isAdult } from './identity-documents';

/**
 * Moderator side of identity verification: queues of creators (KYC) and
 * co-performers to check, documents shown through short-lived signed URLs
 * (every access is written to the AuditLog), co-performer decisions. The KYC
 * decision itself is AdminService.reviewKyc (POST /admin/users/:id/kyc).
 */
@Injectable()
export class VerificationReviewService {
  private readonly logger = new Logger(VerificationReviewService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  // ==================== Creators (KYC) ====================

  async listKyc(dto: ListKycDto = {}) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const where: any = {
      role: 'CREATOR',
      deletedAt: null,
      kycStatus: dto.status ? dto.status : { in: ['PENDING', 'UNDER_REVIEW'] },
    };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ kycSubmittedAt: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          username: true,
          displayName: true,
          email: true,
          avatar: true,
          status: true,
          kycStatus: true,
          kycSubmittedAt: true,
          kycVerifiedAt: true,
          kycRejectedAt: true,
          kycRejectionReason: true,
          dateOfBirth: true,
          createdAt: true,
          _count: { select: { identityDocuments: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map(({ _count, ...user }: any) => ({
        ...user,
        documentCount: _count?.identityDocuments ?? 0,
        isAdult: user.dateOfBirth ? isAdult(new Date(user.dateOfBirth)) : null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Creator's verification with signed URLs of the identity documents
   * (latest submission first). Logged in the AuditLog.
   */
  async getKycDetail(moderatorId: string, userId: string, ipAddress?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        avatar: true,
        role: true,
        status: true,
        kycStatus: true,
        kycSubmittedAt: true,
        kycVerifiedAt: true,
        kycRejectedAt: true,
        kycRejectionReason: true,
        dateOfBirth: true,
        createdAt: true,
        deletedAt: true,
      },
    });

    if (!user || user.deletedAt) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    const documents = await this.prisma.identityDocument.findMany({
      where: { userId, coPerformerId: null },
      orderBy: { createdAt: 'desc' },
    });

    // Traced before any URL is handed out
    await this.logDocumentAccess(moderatorId, 'USER', userId, documents, ipAddress);
    const signed = await this.signDocuments(documents);

    const { deletedAt: _deletedAt, ...rest } = user as any;
    return {
      user: { ...rest, isAdult: user.dateOfBirth ? isAdult(new Date(user.dateOfBirth)) : null },
      documents: signed,
      urlExpiresInSeconds: IDENTITY_DOCUMENT_URL_TTL_SECONDS,
    };
  }

  // ==================== Co-performers ====================

  async listCoPerformers(dto: ListCoPerformersReviewDto = {}) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const where: any = {
      deletedAt: null,
      status: dto.status ?? 'PENDING',
      ...(dto.creatorId ? { creatorId: dto.creatorId } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.coPerformer.findMany({
        where,
        orderBy: { updatedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          creator: { select: { id: true, username: true, displayName: true, avatar: true, kycStatus: true } },
          _count: { select: { documents: true, contents: true } },
        },
      }),
      this.prisma.coPerformer.count({ where }),
    ]);

    return {
      items: items.map(({ _count, ...item }: any) => ({
        ...item,
        isAdult: isAdult(new Date(item.dateOfBirth)),
        documentCount: _count?.documents ?? 0,
        contentCount: _count?.contents ?? 0,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getCoPerformerDetail(moderatorId: string, id: string, ipAddress?: string) {
    const coPerformer = await this.prisma.coPerformer.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, username: true, displayName: true, avatar: true, kycStatus: true } },
        documents: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!coPerformer) {
      throw new NotFoundException('Co-participant introuvable');
    }

    const { documents, ...rest } = coPerformer as any;
    await this.logDocumentAccess(moderatorId, 'CO_PERFORMER', id, documents ?? [], ipAddress);
    const signed = await this.signDocuments(documents ?? []);

    return {
      coPerformer: { ...rest, isAdult: isAdult(new Date(rest.dateOfBirth)) },
      documents: signed,
      urlExpiresInSeconds: IDENTITY_DOCUMENT_URL_TTL_SECONDS,
    };
  }

  async reviewCoPerformer(moderatorId: string, id: string, dto: ReviewCoPerformerDto) {
    const reason = dto.reason?.trim();
    const coPerformer = await this.prisma.coPerformer.findUnique({
      where: { id },
      include: { documents: { select: { type: true } } },
    });

    if (!coPerformer || coPerformer.deletedAt) {
      throw new NotFoundException('Co-participant introuvable');
    }

    if (coPerformer.status !== 'PENDING') {
      throw new BadRequestException('Ce co-participant a déjà été examiné');
    }

    const approved = dto.decision === VerificationDecision.APPROVE;
    if (!approved && !reason) {
      throw new BadRequestException('Un motif est requis pour refuser');
    }

    if (approved) {
      // Never approve someone under 18, whatever the documents say
      if (!isAdult(new Date(coPerformer.dateOfBirth))) {
        throw new BadRequestException('Ce co-participant a moins de 18 ans : refus obligatoire');
      }
      const types = new Set((coPerformer as any).documents?.map((doc: { type: string }) => doc.type) ?? []);
      if (!types.has('RELEASE_FORM')) {
        throw new BadRequestException('Aucune autorisation signée (release) au dossier');
      }
      if (![...types].some((type) => type !== 'RELEASE_FORM' && type !== 'SELFIE')) {
        throw new BadRequestException("Aucune pièce d'identité au dossier");
      }
    }

    const now = new Date();
    const updated = await this.prisma.coPerformer.update({
      where: { id },
      data: {
        status: approved ? 'VERIFIED' : 'REJECTED',
        rejectionReason: approved ? null : reason,
        reviewedBy: moderatorId,
        reviewedAt: now,
      },
    });

    try {
      const name = coPerformer.stageName || `${coPerformer.legalFirstName} ${coPerformer.legalLastName}`;
      await this.prisma.notification.create({
        data: {
          userId: coPerformer.creatorId,
          type: 'SYSTEM',
          title: approved ? 'Co-participant vérifié' : 'Co-participant refusé',
          message: approved
            ? `${name} a été vérifié(e) : vous pouvez l'ajouter à vos publications.`
            : `La vérification de ${name} a été refusée. Motif : ${reason}`,
          linkUrl: '/creator/co-performers',
        },
      });
    } catch (error) {
      this.logger.error(`Failed to notify creator of co-performer decision: ${error.message}`);
    }

    await this.audit(moderatorId, approved ? 'CO_PERFORMER_APPROVED' : 'CO_PERFORMER_REJECTED', 'CO_PERFORMER', id, {
      reason,
      creatorId: coPerformer.creatorId,
    });

    return { success: true, coPerformer: updated };
  }

  // ==================== Helpers ====================

  private async signDocuments(documents: any[]) {
    return Promise.all(
      documents.map(async (doc) => ({
        id: doc.id,
        type: doc.type,
        side: documentSide(doc.storagePath),
        mimeType: doc.mimeType,
        size: doc.size,
        createdAt: doc.createdAt,
        url: await this.storage.getSignedUrl(doc.storagePath, IDENTITY_DOCUMENT_URL_TTL_SECONDS),
      })),
    );
  }

  /**
   * Every view of identity documents is traced (who, when, which files).
   * Unlike other audit entries, a failed write fails the request: no
   * untraced access to identity documents.
   */
  private async logDocumentAccess(
    moderatorId: string,
    resource: 'USER' | 'CO_PERFORMER',
    resourceId: string,
    documents: { id: string }[],
    ipAddress?: string,
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId: moderatorId,
        action: 'IDENTITY_DOCUMENTS_VIEWED',
        resource,
        resourceId,
        metadata: { documentIds: documents.map((doc) => doc.id) },
        ipAddress,
      },
    });
  }

  private async audit(
    userId: string,
    action: string,
    resource: string,
    resourceId: string,
    metadata?: Record<string, any>,
    ipAddress?: string,
  ) {
    try {
      await this.prisma.auditLog.create({
        data: { userId, action, resource, resourceId, metadata, ipAddress },
      });
    } catch (error) {
      this.logger.error(`Failed to write audit log ${action}: ${error.message}`);
    }
  }
}
