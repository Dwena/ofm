import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/database/prisma.service';
import { StorageService } from '../../storage/storage.service';
import {
  HttpMediaScanProvider,
  MediaScanProvider,
  NoneMediaScanProvider,
} from './media-scan.provider';

export type MediaScanOutcome = 'CLEAN' | 'FLAGGED' | 'SKIPPED' | 'PENDING';

export interface ScanTarget {
  /** Uploader (creator) */
  userId: string;
  /** Storage key of the original file */
  key: string;
  mimeType: string;
  /** ContentFile of the media, when there is one */
  contentFileId?: string | null;
  /** Content the media belongs to, when known */
  contentId?: string | null;
  /** Story showing the media, when known */
  storyId?: string | null;
}

const SKIPPED_WARNING_INTERVAL_MS = 10 * 60 * 1000;

/**
 * A real scanning provider is configured (same rule as MediaScanService):
 * media still PENDING then cannot be approved for publication.
 */
export const isMediaScanConfigured = (config: { get: (key: string, defaultValue?: any) => any } | undefined) =>
  String(config?.get('MEDIA_SCAN_PROVIDER', 'none') || 'none').toLowerCase() !== 'none' &&
  !!config?.get('MEDIA_SCAN_API_URL');

/** Only images and videos are matched against known-illegal-media hash lists */
export const isScannableMimeType = (mimeType?: string | null) =>
  !!mimeType && (mimeType.startsWith('image/') || mimeType.startsWith('video/'));

/**
 * Hook scanning every uploaded image / video against known illegal media
 * (CSAM hash lists), called from the media pipeline (image / video
 * processors) and when a story is published.
 *
 * Configuration:
 * - MEDIA_SCAN_PROVIDER: none (default) | http | thorn-safer | photodna
 * - MEDIA_SCAN_API_URL / MEDIA_SCAN_API_KEY: endpoint and key of the provider
 * - MEDIA_SCAN_SEND_BYTES=true: send the file bytes, not only its hashes
 * - MEDIA_SCAN_TIMEOUT_MS (default 15000)
 *
 * A match (FLAGGED):
 * - the media is blocked: its content is REJECTED, its story hidden, and it
 *   can no longer be published nor deleted by the creator;
 * - the creator's account is SUSPENDED pending review (no end date);
 * - every admin is alerted (notification) and an AuditLog entry is written.
 * The file is NEVER deleted automatically: it is evidence. French law
 * requires reporting it to PHAROS (https://www.internet-signalement.gouv.fr)
 * and preserving the evidence for the investigators (LCEN art. 6); the
 * provider may also report to NCMEC. See docs/COMPLIANCE_CONTENT.md.
 */
@Injectable()
export class MediaScanService implements OnModuleInit {
  private readonly logger = new Logger(MediaScanService.name);
  private readonly provider: MediaScanProvider;
  private lastSkippedWarning = 0;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private storage: StorageService,
  ) {
    this.provider = this.createProvider();
  }

  onModuleInit() {
    if (!this.isEnabled && this.isProduction) {
      this.logger.warn(
        'MEDIA_SCAN_PROVIDER=none: uploaded media are NOT scanned against known illegal content. ' +
          'Configure a hash-matching provider before going live.',
      );
    }
  }

  get providerName(): string {
    return this.provider.name;
  }

  /** A real provider is configured (media are not just SKIPPED) */
  get isEnabled(): boolean {
    return this.provider.name !== 'none';
  }

  private get isProduction(): boolean {
    return (this.configService.get('NODE_ENV') ?? process.env.NODE_ENV) === 'production';
  }

  private createProvider(): MediaScanProvider {
    const name = String(this.configService.get('MEDIA_SCAN_PROVIDER', 'none') || 'none').toLowerCase();
    if (name === 'none') {
      return new NoneMediaScanProvider();
    }

    const apiUrl = this.configService.get<string>('MEDIA_SCAN_API_URL');
    if (!apiUrl) {
      this.logger.error(`MEDIA_SCAN_PROVIDER=${name} but MEDIA_SCAN_API_URL is not set: scanning disabled`);
      return new NoneMediaScanProvider();
    }

    if (!['http', 'thorn-safer', 'photodna'].includes(name)) {
      this.logger.warn(`Unknown MEDIA_SCAN_PROVIDER "${name}": using the generic HTTP provider`);
    } else if (name !== 'http') {
      this.logger.warn(
        `MEDIA_SCAN_PROVIDER=${name} uses the generic HTTP stub: adapt it to the real API contract`,
      );
    }

    return new HttpMediaScanProvider({
      name,
      apiUrl,
      apiKey: this.configService.get<string>('MEDIA_SCAN_API_KEY'),
      sendBytes: this.configService.get('MEDIA_SCAN_SEND_BYTES') === 'true',
      timeoutMs: Number(this.configService.get('MEDIA_SCAN_TIMEOUT_MS', 15000)) || 15000,
    });
  }

  /**
   * Scan bytes. CLEAN / FLAGGED from the provider, SKIPPED when no provider is
   * configured or the type is not scannable, PENDING when the provider failed
   * (to retry: the media cannot be approved meanwhile).
   */
  async scanBuffer(buffer: Buffer, mimeType: string): Promise<{ outcome: MediaScanOutcome; sha256: string; reference?: string | null }> {
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    if (!isScannableMimeType(mimeType)) {
      return { outcome: 'SKIPPED', sha256 };
    }

    if (!this.isEnabled) {
      this.warnSkipped();
      return { outcome: 'SKIPPED', sha256 };
    }

    try {
      const result = await this.provider.scan({
        sha256,
        md5: createHash('md5').update(buffer).digest('hex'),
        mimeType,
        size: buffer.length,
        bytes: buffer,
      });
      return { outcome: result.match ? 'FLAGGED' : 'CLEAN', sha256, reference: result.reference };
    } catch (error) {
      this.logger.error(`Media scan failed (${this.provider.name}): ${error.message}`);
      return { outcome: 'PENDING', sha256 };
    }
  }

  /**
   * Scan an uploaded media and record the result (ContentFile / Story scan
   * status). On a match, block it, suspend the uploader and alert the admins.
   */
  async scanAndRecord(buffer: Buffer, target: ScanTarget): Promise<MediaScanOutcome> {
    const { outcome, sha256, reference } = await this.scanBuffer(buffer, target.mimeType);
    await this.recordOutcome(target, outcome);

    if (outcome === 'FLAGGED') {
      await this.handleMatch(target, sha256, reference);
    }

    return outcome;
  }

  /** Same as scanAndRecord for a file already in storage */
  async scanStoredFile(target: ScanTarget): Promise<MediaScanOutcome> {
    if (!isScannableMimeType(target.mimeType) || /^https?:\/\//i.test(target.key)) {
      await this.recordOutcome(target, 'SKIPPED');
      return 'SKIPPED';
    }
    if (!this.isEnabled) {
      this.warnSkipped();
      await this.recordOutcome(target, 'SKIPPED');
      return 'SKIPPED';
    }

    let buffer: Buffer;
    try {
      buffer = await this.storage.getFile(target.key);
    } catch (error) {
      this.logger.error(`Media scan: cannot read ${target.key}: ${error.message}`);
      return 'PENDING';
    }
    return this.scanAndRecord(buffer, target);
  }

  /**
   * Scan again the media of a content still PENDING (provider down, queue
   * not running...). Returns the scan status of every file.
   */
  async rescanContent(contentId: string) {
    const content = await this.prisma.content.findUnique({
      where: { id: contentId },
      select: {
        id: true,
        creatorId: true,
        files: { select: { id: true, storagePath: true, mimeType: true, scanStatus: true } },
      },
    });
    if (!content) {
      return null;
    }

    const results: { id: string; scanStatus: string }[] = [];
    for (const file of content.files) {
      if (file.scanStatus !== 'PENDING') {
        results.push({ id: file.id, scanStatus: file.scanStatus });
        continue;
      }
      const outcome = await this.scanStoredFile({
        userId: content.creatorId,
        key: file.storagePath,
        mimeType: file.mimeType,
        contentFileId: file.id,
        contentId: content.id,
      });
      results.push({ id: file.id, scanStatus: outcome });
    }
    return { contentId, provider: this.providerName, files: results };
  }

  private async recordOutcome(target: ScanTarget, outcome: MediaScanOutcome) {
    if (outcome === 'PENDING') return;
    const data = { scanStatus: outcome, scannedAt: new Date() } as const;

    try {
      if (target.contentFileId) {
        await this.prisma.contentFile.updateMany({ where: { id: target.contentFileId }, data });
      } else {
        // ContentFile created by POST /media/upload before processing
        await this.prisma.contentFile.updateMany({ where: { storagePath: target.key }, data });
      }
      if (target.storyId) {
        await this.prisma.story.updateMany({ where: { id: target.storyId }, data: { scanStatus: outcome } });
      }
    } catch (error) {
      this.logger.error(`Failed to record media scan result for ${target.key}: ${error.message}`);
    }
  }

  /**
   * Known illegal media detected. Nothing here deletes the file: it is
   * evidence for PHAROS / the investigators.
   */
  private async handleMatch(target: ScanTarget, sha256: string, reference?: string | null) {
    this.logger.error(
      `KNOWN ILLEGAL MEDIA MATCH: user ${target.userId}, key ${target.key}, provider ${this.provider.name}`,
    );
    const now = new Date();
    const blockNote =
      'Bloqué automatiquement : correspondance avec une base de contenus illégaux connus. Fichier conservé comme preuve.';

    // 1. Block the media wherever it is used
    try {
      const contentIds = new Set<string>();
      if (target.contentId) contentIds.add(target.contentId);
      const files = await this.prisma.contentFile.findMany({
        where: target.contentFileId ? { id: target.contentFileId } : { storagePath: target.key },
        select: { contentId: true },
      });
      files.forEach((file: { contentId: string | null }) => file.contentId && contentIds.add(file.contentId));

      if (contentIds.size > 0) {
        await this.prisma.content.updateMany({
          where: { id: { in: [...contentIds] } },
          data: {
            status: 'REJECTED',
            isModerated: true,
            moderatedAt: now,
            moderationNotes: blockNote,
          },
        });
      }

      await this.prisma.story.updateMany({
        where: {
          OR: [
            ...(target.storyId ? [{ id: target.storyId }] : []),
            { mediaUrl: target.key },
          ],
        },
        data: { scanStatus: 'FLAGGED', deletedAt: now },
      });
    } catch (error) {
      this.logger.error(`Failed to block flagged media ${target.key}: ${error.message}`);
    }

    // 2. Suspend the uploader pending review (no end date: lifted by an admin)
    try {
      await this.prisma.user.updateMany({
        where: { id: target.userId, role: { not: 'ADMIN' } },
        data: {
          status: 'SUSPENDED',
          suspendedUntil: null,
          suspensionReason: 'Compte suspendu en attente de vérification par l’équipe de modération',
        },
      });
    } catch (error) {
      this.logger.error(`Failed to suspend user ${target.userId}: ${error.message}`);
    }

    // 3. Evidence trail + admin alert
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: null,
          action: 'ILLEGAL_MEDIA_MATCH',
          resource: 'MEDIA',
          resourceId: target.contentFileId ?? target.storyId ?? target.key,
          metadata: {
            creatorId: target.userId,
            storageKey: target.key,
            contentId: target.contentId ?? null,
            storyId: target.storyId ?? null,
            sha256,
            provider: this.provider.name,
            providerReference: reference ?? null,
            actions: ['MEDIA_BLOCKED', 'ACCOUNT_SUSPENDED', 'FILE_PRESERVED'],
          },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to write audit log for flagged media ${target.key}: ${error.message}`);
    }

    try {
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN', deletedAt: null },
        select: { id: true },
      });
      if (admins.length > 0) {
        await this.prisma.notification.createMany({
          data: admins.map((admin: { id: string }) => ({
            userId: admin.id,
            type: 'SYSTEM' as const,
            title: 'ALERTE : média illégal connu détecté',
            message:
              'Un média correspond à une base de contenus illégaux connus. Le compte a été suspendu et le média bloqué. ' +
              'Signalez-le sur PHAROS (internet-signalement.gouv.fr) et conservez les preuves : ne supprimez pas le fichier.',
            linkUrl: `/admin/users?user=${target.userId}`,
            metadata: { kind: 'ILLEGAL_MEDIA_MATCH', creatorId: target.userId, sha256 },
          })),
        });
      }
    } catch (error) {
      this.logger.error(`Failed to alert admins of flagged media ${target.key}: ${error.message}`);
    }
  }

  private warnSkipped() {
    if (!this.isProduction) return;
    const now = Date.now();
    if (now - this.lastSkippedWarning < SKIPPED_WARNING_INTERVAL_MS) return;
    this.lastSkippedWarning = now;
    this.logger.warn('Media not scanned against known illegal content: no MEDIA_SCAN_PROVIDER configured');
  }
}
