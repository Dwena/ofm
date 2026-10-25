import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SubmitKycDto } from './dto/verification.dto';
import {
  ACCEPTED_DOCUMENT_TYPES,
  ACCEPTED_SELFIE_TYPES,
  EXTENSION_BY_MIME,
  IDENTITY_DOCUMENT_TYPES,
  KYC_STORAGE_PREFIX,
  TWO_SIDED_DOCUMENTS,
  assertAdult,
  documentSide,
  parseDateOfBirth,
  validateIdentityFile,
} from './identity-documents';

export interface KycFiles {
  documentFront?: Express.Multer.File[];
  documentBack?: Express.Multer.File[];
  selfie?: Express.Multer.File[];
}

/** A new submission is accepted in these states */
const SUBMITTABLE_STATUSES = ['NOT_STARTED', 'REJECTED', 'RESUBMIT_REQUIRED'];

export const UNDERAGE_CREATOR_MESSAGE =
  'Vous devez avoir au moins 18 ans pour devenir créateur ou créatrice sur FanVIP.';

/**
 * Identity verification (KYC) of creators: the creator uploads an identity
 * document and a selfie holding it, a moderator checks them and approves or
 * rejects (AdminService.reviewKyc). Publishing (content, stories, lives) and
 * selling require kycStatus === 'VERIFIED'.
 */
@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  /** Current verification state of the creator (no document content) */
  async getStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        kycStatus: true,
        kycSubmittedAt: true,
        kycVerifiedAt: true,
        kycRejectedAt: true,
        kycRejectionReason: true,
        dateOfBirth: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    const documents = await this.prisma.identityDocument.findMany({
      where: { userId, coPerformerId: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, storagePath: true, mimeType: true, createdAt: true },
    });

    return {
      kycStatus: user.kycStatus,
      kycSubmittedAt: user.kycSubmittedAt,
      kycVerifiedAt: user.kycVerifiedAt,
      kycRejectedAt: user.kycRejectedAt,
      kycRejectionReason: user.kycRejectionReason,
      dateOfBirth: user.dateOfBirth,
      canPublish: user.kycStatus === 'VERIFIED',
      canSubmit: SUBMITTABLE_STATUSES.includes(user.kycStatus),
      // Only metadata: the files themselves are never sent back to the creator
      documents: documents.map(({ storagePath, ...doc }) => ({ ...doc, side: documentSide(storagePath) })),
      acceptedDocumentTypes: IDENTITY_DOCUMENT_TYPES,
    };
  }

  /**
   * Submit (or resubmit after a rejection) the identity verification.
   * Previous documents are kept on file (legal retention).
   */
  async submit(userId: string, dto: SubmitKycDto, files: KycFiles = {}) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, kycStatus: true, deletedAt: true },
    });

    if (!user || user.deletedAt) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    if (user.role !== 'CREATOR') {
      throw new ForbiddenException("La vérification d'identité est réservée aux créateurs");
    }

    if (user.kycStatus === 'VERIFIED') {
      throw new BadRequestException('Votre identité est déjà vérifiée');
    }

    if (!SUBMITTABLE_STATUSES.includes(user.kycStatus)) {
      throw new BadRequestException('Votre vérification est déjà en cours d’examen');
    }

    if (!IDENTITY_DOCUMENT_TYPES.includes(dto.documentType)) {
      throw new BadRequestException('Type de pièce d’identité non accepté');
    }

    const dateOfBirth = parseDateOfBirth(dto.dateOfBirth);
    assertAdult(dateOfBirth, UNDERAGE_CREATOR_MESSAGE);

    const front = files.documentFront?.[0];
    const back = files.documentBack?.[0];
    const selfie = files.selfie?.[0];

    const frontType = validateIdentityFile(front, 'Pièce d’identité (recto)', ACCEPTED_DOCUMENT_TYPES);
    let backType: string | null = null;
    if (back) {
      backType = validateIdentityFile(back, 'Pièce d’identité (verso)', ACCEPTED_DOCUMENT_TYPES);
    } else if (TWO_SIDED_DOCUMENTS.includes(dto.documentType)) {
      throw new BadRequestException('Pièce d’identité (verso) : fichier manquant');
    }
    const selfieType = validateIdentityFile(selfie, 'Selfie avec la pièce d’identité', ACCEPTED_SELFIE_TYPES);

    // One folder per submission: kyc/<userId>/<timestamp>/<front|back|selfie>/<random>.<ext>
    const submissionFolder = `${KYC_STORAGE_PREFIX}/${userId}/${Date.now()}`;
    const uploads: { file: Express.Multer.File; mime: string; side: string; type: string }[] = [
      { file: front!, mime: frontType, side: 'front', type: dto.documentType },
      ...(back && backType ? [{ file: back, mime: backType, side: 'back', type: dto.documentType }] : []),
      { file: selfie!, mime: selfieType, side: 'selfie', type: 'SELFIE' },
    ];

    const stored: { key: string; mime: string; size: number; type: string }[] = [];
    for (const upload of uploads) {
      const { key } = await this.storage.uploadFile(
        upload.file.buffer,
        `${upload.side}${EXTENSION_BY_MIME[upload.mime] ?? ''}`,
        upload.mime,
        `${submissionFolder}/${upload.side}`,
        { cacheControl: 'private, no-store' },
      );
      stored.push({ key, mime: upload.mime, size: upload.file.size, type: upload.type });
    }

    const now = new Date();
    await this.prisma.$transaction([
      ...stored.map((doc) =>
        this.prisma.identityDocument.create({
          data: {
            userId,
            type: doc.type as any,
            storagePath: doc.key,
            mimeType: doc.mime,
            size: doc.size,
          },
        }),
      ),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          dateOfBirth,
          kycStatus: 'PENDING',
          kycProvider: 'manual',
          kycSubmittedAt: now,
          kycRejectedAt: null,
          kycRejectionReason: null,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'KYC_SUBMITTED',
          resource: 'USER',
          resourceId: userId,
          metadata: { documentType: dto.documentType, files: stored.length, previousStatus: user.kycStatus },
        },
      }),
    ]);

    await this.notifyModerators(userId);

    this.logger.log(`KYC submitted by ${userId} (${dto.documentType})`);
    return this.getStatus(userId);
  }

  private async notifyModerators(userId: string) {
    try {
      const staff = await this.prisma.user.findMany({
        where: { role: { in: ['ADMIN', 'MODERATOR'] }, deletedAt: null },
        select: { id: true },
      });
      if (staff.length === 0) return;
      await this.prisma.notification.createMany({
        data: staff.map((member: { id: string }) => ({
          userId: member.id,
          type: 'SYSTEM' as const,
          title: "Vérification d'identité à examiner",
          message: 'Un créateur a envoyé ses documents d’identité.',
          linkUrl: `/admin/moderation/kyc?user=${userId}`,
        })),
      });
    } catch (error) {
      this.logger.error(`Failed to notify moderators of KYC ${userId}: ${error.message}`);
    }
  }
}
