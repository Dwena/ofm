import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common';

/**
 * Rules shared by every place where a creator makes something visible to fans
 * (content, stories, lives). Card-network rules for adult content (Mastercard
 * specialty merchant rules, Visa integrity rules) require that:
 * - every creator's identity and age (18+) is verified before publishing;
 * - every other person appearing in the content (co-performer) is verified
 *   too, with a signed release kept on file;
 * - every piece of content is reviewed before it goes live (pre-moderation,
 *   see isContentPremoderationEnabled).
 */

export const KYC_REQUIRED_MESSAGE = 'Vérifiez votre identité pour publier';
export const KYC_REQUIRED_CODE = 'KYC_REQUIRED';

export interface PublishingUser {
  role?: string | null;
  kycStatus?: string | null;
  status?: string | null;
}

/**
 * The creator can make content visible to fans: verified identity (KYC) and
 * account not suspended / banned. Throws 403 otherwise.
 */
export function assertCanPublish(user: PublishingUser | null | undefined) {
  if (!user || user.role !== 'CREATOR') {
    throw new ForbiddenException('Seuls les créateurs peuvent publier');
  }

  if (user.status === 'SUSPENDED' || user.status === 'BANNED') {
    throw new ForbiddenException('Votre compte est suspendu : publication impossible');
  }

  if (user.kycStatus !== 'VERIFIED') {
    throw new ForbiddenException({ message: KYC_REQUIRED_MESSAGE, code: KYC_REQUIRED_CODE });
  }
}

/** Fields to select on User to call assertCanPublish */
export const PUBLISHING_USER_SELECT = { role: true, kycStatus: true, status: true } as const;

/**
 * Pre-moderation of content (UNDER_REVIEW until a moderator approves it).
 * CONTENT_PREMODERATION=false switches it off, for local development only: it
 * is always on in production whatever the variable says.
 */
export function isContentPremoderationEnabled(
  config: { get: (key: string, defaultValue?: any) => any } | undefined,
  logger?: Logger,
): boolean {
  const raw = String(config?.get('CONTENT_PREMODERATION', 'true') ?? 'true').toLowerCase();
  if (raw !== 'false') return true;

  const env = config?.get('NODE_ENV') ?? process.env.NODE_ENV;
  if (env === 'production') {
    logger?.warn('CONTENT_PREMODERATION=false is ignored in production: content is always reviewed');
    return true;
  }
  return false;
}

/** Minimal Prisma surface used to validate co-performers */
interface CoPerformerReader {
  coPerformer: {
    findMany: (args: any) => Promise<Array<{ id: string; status: string }>>;
  };
}

export const MAX_CO_PERFORMERS = 20;

/**
 * Validate the co-performers declared on a content / story / live: they must
 * belong to the creator, not be deleted and be VERIFIED (identity, age and
 * signed release checked by a moderator). Returns the de-duplicated ids.
 */
export async function validateCoPerformerIds(
  prisma: CoPerformerReader,
  creatorId: string,
  ids: string[] | null | undefined,
): Promise<string[]> {
  const unique = [...new Set((ids ?? []).filter((id) => typeof id === 'string' && id.length > 0))];
  if (unique.length === 0) return [];

  if (unique.length > MAX_CO_PERFORMERS) {
    throw new BadRequestException(`${MAX_CO_PERFORMERS} co-participants maximum`);
  }

  const rows = await prisma.coPerformer.findMany({
    where: { id: { in: unique }, creatorId, deletedAt: null },
    select: { id: true, status: true },
  });

  if (rows.length !== unique.length) {
    throw new BadRequestException('Co-participant introuvable');
  }

  if (rows.some((row) => row.status !== 'VERIFIED')) {
    throw new BadRequestException(
      "Seuls les co-participants dont l'identité a été vérifiée peuvent apparaître dans vos publications",
    );
  }

  return unique;
}

/**
 * Content showing other people (soloContent = false) must list at least one
 * verified co-performer; solo content lists none.
 */
export async function resolveContentCoPerformers(
  prisma: CoPerformerReader,
  creatorId: string,
  soloContent: boolean,
  ids: string[] | null | undefined,
): Promise<string[]> {
  if (soloContent) {
    if (ids && ids.length > 0) {
      throw new BadRequestException(
        'Un contenu "Seulement moi" ne peut pas avoir de co-participants',
      );
    }
    return [];
  }

  if (!ids || ids.length === 0) {
    throw new BadRequestException(
      'Indiquez les personnes qui apparaissent dans ce contenu (co-participants vérifiés)',
    );
  }

  return validateCoPerformerIds(prisma, creatorId, ids);
}
