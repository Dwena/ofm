import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateCoPerformerDto, UpdateCoPerformerDto } from './dto/verification.dto';
import {
  ACCEPTED_DOCUMENT_TYPES,
  ACCEPTED_SELFIE_TYPES,
  EXTENSION_BY_MIME,
  IDENTITY_DOCUMENT_TYPES,
  KYC_STORAGE_PREFIX,
  assertAdult,
  documentSide,
  parseDateOfBirth,
  validateIdentityFile,
} from './identity-documents';

export interface CoPerformerFiles {
  documentFront?: Express.Multer.File[];
  documentBack?: Express.Multer.File[];
  releaseForm?: Express.Multer.File[];
  selfie?: Express.Multer.File[];
}

export const UNDERAGE_CO_PERFORMER_MESSAGE =
  'Toute personne apparaissant dans vos contenus doit avoir au moins 18 ans.';

const PUBLIC_SELECT = {
  id: true,
  legalFirstName: true,
  legalLastName: true,
  stageName: true,
  dateOfBirth: true,
  email: true,
  platformUserId: true,
  status: true,
  consentSignedAt: true,
  rejectionReason: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Co-performers: anyone other than the creator appearing in the creator's
 * content. Each one is declared with legal identity, age (18+), an identity
 * document and a signed release (consent to be filmed and published), then
 * reviewed by a moderator. Only VERIFIED co-performers can be attached to
 * content, stories and lives (see validateCoPerformerIds).
 *
 * Documents are kept when a co-performer is deleted (soft delete): legal
 * retention, see identity-documents.ts.
 */
@Injectable()
export class CoPerformersService {
  private readonly logger = new Logger(CoPerformersService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  async list(creatorId: string, status?: string) {
    const items = await this.prisma.coPerformer.findMany({
      where: {
        creatorId,
        deletedAt: null,
        ...(status && ['PENDING', 'VERIFIED', 'REJECTED'].includes(status) ? { status: status as any } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        ...PUBLIC_SELECT,
        _count: { select: { contents: true, documents: true } },
      },
    });

    return items.map(({ _count, ...item }: any) => ({
      ...item,
      contentCount: _count?.contents ?? 0,
      documentCount: _count?.documents ?? 0,
    }));
  }

  async get(creatorId: string, id: string) {
    const coPerformer = await this.findOwn(creatorId, id);
    const documents = await this.prisma.identityDocument.findMany({
      where: { coPerformerId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, storagePath: true, mimeType: true, createdAt: true },
    });

    const { creatorId: _creatorId, deletedAt: _deletedAt, reviewedBy: _reviewedBy, ...rest } = coPerformer as any;
    return {
      ...rest,
      // Metadata only: the files are only readable by moderators
      documents: documents.map(({ storagePath, ...doc }: any) => ({ ...doc, side: documentSide(storagePath) })),
    };
  }

  async create(creatorId: string, dto: CreateCoPerformerDto, files: CoPerformerFiles = {}) {
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { role: true, deletedAt: true },
    });
    if (!creator || creator.deletedAt || creator.role !== 'CREATOR') {
      throw new ForbiddenException('Réservé aux créateurs');
    }

    const dateOfBirth = parseDateOfBirth(dto.dateOfBirth);
    assertAdult(dateOfBirth, UNDERAGE_CO_PERFORMER_MESSAGE);
    const consentSignedAt = this.parseConsentDate(dto.consentSignedAt);

    if (!IDENTITY_DOCUMENT_TYPES.includes(dto.documentType)) {
      throw new BadRequestException('Type de pièce d’identité non accepté');
    }

    const validated = this.validateFiles(files, true);
    const platformUserId = await this.resolvePlatformUser(dto.platformUsername, creatorId);

    const coPerformer = await this.prisma.coPerformer.create({
      data: {
        creatorId,
        legalFirstName: dto.legalFirstName.trim(),
        legalLastName: dto.legalLastName.trim(),
        stageName: dto.stageName?.trim() || null,
        dateOfBirth,
        email: dto.email?.trim().toLowerCase() || null,
        platformUserId,
        consentSignedAt,
        status: 'PENDING',
      },
      select: PUBLIC_SELECT,
    });

    await this.storeDocuments(creatorId, coPerformer.id, dto.documentType, validated);
    await this.audit(creatorId, 'CO_PERFORMER_SUBMITTED', coPerformer.id);
    await this.notifyModerators(coPerformer.id);

    this.logger.log(`Co-performer ${coPerformer.id} declared by ${creatorId}`);
    return coPerformer;
  }

  /**
   * Correct / resubmit a co-performer. A verified co-performer cannot be
   * changed (create a new one instead); any change sends it back to PENDING.
   */
  async update(creatorId: string, id: string, dto: UpdateCoPerformerDto, files: CoPerformerFiles = {}) {
    const existing = await this.findOwn(creatorId, id);

    if (existing.status === 'VERIFIED') {
      throw new BadRequestException(
        'Un co-participant vérifié ne peut plus être modifié. Déclarez une nouvelle personne si besoin.',
      );
    }

    const data: Record<string, any> = {};
    if (dto.legalFirstName !== undefined) data.legalFirstName = dto.legalFirstName.trim();
    if (dto.legalLastName !== undefined) data.legalLastName = dto.legalLastName.trim();
    if (dto.stageName !== undefined) data.stageName = dto.stageName.trim() || null;
    if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase() || null;
    if (dto.dateOfBirth !== undefined) {
      data.dateOfBirth = parseDateOfBirth(dto.dateOfBirth);
      assertAdult(data.dateOfBirth, UNDERAGE_CO_PERFORMER_MESSAGE);
    }
    if (dto.consentSignedAt !== undefined) data.consentSignedAt = this.parseConsentDate(dto.consentSignedAt);

    const hasFiles = !!(files.documentFront?.length || files.documentBack?.length || files.releaseForm?.length || files.selfie?.length);
    const validated = hasFiles ? this.validateFiles(files, false) : null;
    if ((validated?.front || validated?.back) && !dto.documentType) {
      throw new BadRequestException('Indiquez le type de la nouvelle pièce d’identité');
    }

    const updated = await this.prisma.coPerformer.update({
      where: { id },
      data: {
        ...data,
        status: 'PENDING',
        rejectionReason: null,
        reviewedAt: null,
        reviewedBy: null,
      },
      select: PUBLIC_SELECT,
    });

    if (validated) {
      await this.storeDocuments(creatorId, id, dto.documentType ?? 'ID_CARD', validated);
    }
    await this.audit(creatorId, 'CO_PERFORMER_RESUBMITTED', id);
    await this.notifyModerators(id);

    return updated;
  }

  /**
   * Soft delete. Documents and links to already published content are kept
   * (legal retention); the co-performer can no longer be attached.
   */
  async remove(creatorId: string, id: string) {
    await this.findOwn(creatorId, id);
    await this.prisma.coPerformer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit(creatorId, 'CO_PERFORMER_DELETED', id);
    return { success: true };
  }

  private async findOwn(creatorId: string, id: string) {
    const coPerformer = await this.prisma.coPerformer.findUnique({ where: { id } });
    if (!coPerformer || coPerformer.deletedAt) {
      throw new NotFoundException('Co-participant introuvable');
    }
    if (coPerformer.creatorId !== creatorId) {
      throw new ForbiddenException('Ce co-participant ne vous appartient pas');
    }
    return coPerformer;
  }

  private parseConsentDate(value: string): Date {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      throw new BadRequestException('Date de signature de l’autorisation invalide');
    }
    // A release signed in the future is not a release
    if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      throw new BadRequestException('La date de signature de l’autorisation ne peut pas être dans le futur');
    }
    return date;
  }

  private validateFiles(files: CoPerformerFiles, required: boolean) {
    const front = files.documentFront?.[0];
    const back = files.documentBack?.[0];
    const release = files.releaseForm?.[0];
    const selfie = files.selfie?.[0];

    if (required && !front) {
      throw new BadRequestException('Pièce d’identité du co-participant : fichier manquant');
    }
    if (required && !release) {
      throw new BadRequestException('Autorisation signée (release) : fichier manquant');
    }

    return {
      front: front ? { file: front, mime: validateIdentityFile(front, 'Pièce d’identité (recto)') } : null,
      back: back ? { file: back, mime: validateIdentityFile(back, 'Pièce d’identité (verso)') } : null,
      release: release
        ? { file: release, mime: validateIdentityFile(release, 'Autorisation signée', ACCEPTED_DOCUMENT_TYPES) }
        : null,
      selfie: selfie ? { file: selfie, mime: validateIdentityFile(selfie, 'Selfie', ACCEPTED_SELFIE_TYPES) } : null,
    };
  }

  private async storeDocuments(
    creatorId: string,
    coPerformerId: string,
    documentType: string,
    validated: ReturnType<CoPerformersService['validateFiles']>,
  ) {
    // kyc/<creatorId>/co-performers/<coPerformerId>/<timestamp>/<side>/<random>.<ext>
    const folder = `${KYC_STORAGE_PREFIX}/${creatorId}/co-performers/${coPerformerId}/${Date.now()}`;
    const entries = [
      validated.front && { ...validated.front, side: 'front', type: documentType },
      validated.back && { ...validated.back, side: 'back', type: documentType },
      validated.selfie && { ...validated.selfie, side: 'selfie', type: 'SELFIE' },
      validated.release && { ...validated.release, side: 'release', type: 'RELEASE_FORM' },
    ].filter(Boolean) as { file: Express.Multer.File; mime: string; side: string; type: string }[];

    for (const entry of entries) {
      const { key } = await this.storage.uploadFile(
        entry.file.buffer,
        `${entry.side}${EXTENSION_BY_MIME[entry.mime] ?? ''}`,
        entry.mime,
        `${folder}/${entry.side}`,
        { cacheControl: 'private, no-store' },
      );
      await this.prisma.identityDocument.create({
        data: {
          userId: creatorId,
          coPerformerId,
          type: entry.type as any,
          storagePath: key,
          mimeType: entry.mime,
          size: entry.file.size,
        },
      });
    }
  }

  private async resolvePlatformUser(username: string | undefined, creatorId: string): Promise<string | null> {
    const clean = username?.trim().replace(/^@/, '');
    if (!clean) return null;
    const user = await this.prisma.user.findUnique({
      where: { username: clean },
      select: { id: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      throw new BadRequestException(`Aucun compte FanVIP ne correspond à @${clean}`);
    }
    if (user.id === creatorId) {
      throw new BadRequestException('Vous ne pouvez pas vous déclarer comme co-participant');
    }
    return user.id;
  }

  private async audit(userId: string, action: string, coPerformerId: string) {
    try {
      await this.prisma.auditLog.create({
        data: { userId, action, resource: 'CO_PERFORMER', resourceId: coPerformerId },
      });
    } catch (error) {
      this.logger.error(`Failed to write audit log ${action}: ${error.message}`);
    }
  }

  private async notifyModerators(coPerformerId: string) {
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
          title: 'Co-participant à vérifier',
          message: 'Un créateur a déclaré un co-participant (pièce d’identité et autorisation signée).',
          linkUrl: `/admin/moderation/co-performers?id=${coPerformerId}`,
        })),
      });
    } catch (error) {
      this.logger.error(`Failed to notify moderators of co-performer ${coPerformerId}: ${error.message}`);
    }
  }
}
