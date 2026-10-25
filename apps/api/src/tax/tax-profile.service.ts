import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CreatorTaxProfile, Prisma } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { MailService } from '../common/mail/mail.service';
import { escapeHtml } from '../common/mail/mail.templates';
import { decryptValue, encryptValue } from '../common/utils/crypto';
import { UpdateTaxProfileDto } from './dto/tax.dto';
import {
  SELF_BILLING_DOCUMENT,
  SELF_BILLING_MANDATE_TEXT,
  SELF_BILLING_MANDATE_VERSION,
  TAX_INFORMATION_LINKS,
  TAX_INFORMATION_TEXT,
  TAX_PROFILE_PATH,
} from './tax.constants';
import {
  TaxProfileFields,
  bicRequiredForIban,
  compact,
  computeMissingFields,
  validateIban,
  validateTaxProfileFields,
} from './tax-validation';

export interface RequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface PayoutBankDetails {
  accountHolderName: string;
  iban: string;
  bic: string | null;
}

/** Text fields of the profile, copied as-is from the form (after normalization) */
const TEXT_FIELDS = [
  'firstName',
  'lastName',
  'placeOfBirth',
  'companyName',
  'companyRegistrationNumber',
  'vatNumber',
  'addressLine1',
  'addressLine2',
  'postalCode',
  'city',
  'country',
  'taxIdentificationNumber',
  'tinCountry',
  'accountHolderName',
  'bic',
] as const;

type TextField = (typeof TEXT_FIELDS)[number];

/** Identifiers stored without spaces / dots / dashes, upper-cased */
const COMPACT_FIELDS: ReadonlySet<TextField> = new Set([
  'companyRegistrationNumber',
  'vatNumber',
  'taxIdentificationNumber',
  'bic',
  'country',
  'tinCountry',
]);

const toIsoDay = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : null);

function normalizeText(field: TextField, value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = COMPACT_FIELDS.has(field) ? compact(value) : value.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}

/** Latest acceptance of the self-billing mandate is the current version */
export function isMandateAccepted(
  profile: Pick<CreatorTaxProfile, 'selfBillingAcceptedAt'> | null,
  acceptedVersion: string | null,
): boolean {
  return !!profile?.selfBillingAcceptedAt && acceptedVersion === SELF_BILLING_MANDATE_VERSION;
}

export function toProfileFields(
  profile: Omit<CreatorTaxProfile, 'id' | 'userId' | 'createdAt' | 'updatedAt'>,
  selfBillingAccepted: boolean,
): TaxProfileFields {
  return {
    entityType: profile.entityType,
    firstName: profile.firstName,
    lastName: profile.lastName,
    dateOfBirth: profile.dateOfBirth,
    placeOfBirth: profile.placeOfBirth,
    companyName: profile.companyName,
    companyRegistrationNumber: profile.companyRegistrationNumber,
    vatNumber: profile.vatNumber,
    vatRegime: profile.vatRegime,
    addressLine1: profile.addressLine1,
    addressLine2: profile.addressLine2,
    postalCode: profile.postalCode,
    city: profile.city,
    country: profile.country,
    taxIdentificationNumber: profile.taxIdentificationNumber,
    tinCountry: profile.tinCountry,
    tinNotIssued: profile.tinNotIssued,
    accountHolderName: profile.accountHolderName,
    hasIban: !!profile.ibanEncrypted,
    bic: profile.bic,
    selfBillingAccepted,
  };
}

/**
 * Tax profile of the creators (DAC7 identity, bank account for payouts,
 * self-billing mandate).
 *
 * Used by the payments module: payouts are blocked until `isComplete()`, and
 * the SEPA transfer is made to `getPayoutBankDetails()`.
 */
@Injectable()
export class TaxProfileService {
  private readonly logger = new Logger(TaxProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // ==================== Used by the payments module ====================

  /** Every required tax / bank field is filled in and the current mandate is accepted */
  async isComplete(userId: string): Promise<boolean> {
    const { profile, acceptedVersion } = await this.load(userId);
    if (!profile) return false;
    return computeMissingFields(toProfileFields(profile, isMandateAccepted(profile, acceptedVersion))).length === 0;
  }

  /** Bank account to pay the creator to (IBAN decrypted), or null when not provided */
  async getPayoutBankDetails(userId: string): Promise<PayoutBankDetails | null> {
    const profile = await this.prisma.creatorTaxProfile.findUnique({
      where: { userId },
      select: { accountHolderName: true, ibanEncrypted: true, bic: true },
    });
    if (!profile?.ibanEncrypted || !profile.accountHolderName) return null;
    try {
      return {
        accountHolderName: profile.accountHolderName,
        iban: decryptValue(profile.ibanEncrypted),
        bic: profile.bic ?? null,
      };
    } catch (error) {
      // Wrong / rotated DATA_ENCRYPTION_KEY: the payout cannot be made
      this.logger.error(`Cannot decrypt the IBAN of creator ${userId}: ${(error as Error).message}`);
      return null;
    }
  }

  // ==================== Creator endpoints ====================

  async getProfile(userId: string) {
    const { profile, acceptedVersion } = await this.load(userId);
    if (profile) return this.toView(profile, acceptedVersion);

    // Not saved yet: prefill what the account already knows
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { dateOfBirth: true, billingCountry: true },
    });
    const draft = this.emptyProfile(userId);
    draft.dateOfBirth = user?.dateOfBirth ?? null;
    draft.country = user?.billingCountry ?? 'FR';
    draft.tinCountry = draft.country;
    return { ...this.toView(draft, acceptedVersion), exists: false };
  }

  async updateProfile(userId: string, dto: UpdateTaxProfileDto, context: RequestContext = {}) {
    const { profile: existing, acceptedVersion } = await this.load(userId);
    const current = existing ?? this.emptyProfile(userId);
    const wasAccepted = isMandateAccepted(existing, acceptedVersion);

    // Merge the form into the saved profile
    const next = { ...current };
    const changed = new Set<string>();
    const set = <K extends keyof CreatorTaxProfile>(field: K, value: CreatorTaxProfile[K] | undefined) => {
      if (value === undefined) return;
      const before = current[field];
      const same = before instanceof Date && value instanceof Date ? before.getTime() === value.getTime() : before === value;
      if (!same) changed.add(field);
      next[field] = value;
    };

    if (dto.entityType !== undefined) set('entityType', dto.entityType);
    if (dto.vatRegime !== undefined) set('vatRegime', dto.vatRegime);
    if (dto.tinNotIssued !== undefined) set('tinNotIssued', dto.tinNotIssued);
    for (const field of TEXT_FIELDS) {
      set(field, normalizeText(field, dto[field]));
    }
    if (dto.dateOfBirth !== undefined) {
      set('dateOfBirth', dto.dateOfBirth ? new Date(`${dto.dateOfBirth}T00:00:00.000Z`) : null);
    }

    const errors: Record<string, string> = {};

    // Bank account: the IBAN is encrypted, only its last 4 characters are readable
    let newIban: string | null | undefined;
    if (dto.iban === null) {
      newIban = null;
    } else if (dto.iban && dto.iban.trim()) {
      const result = validateIban(dto.iban);
      if ('error' in result) errors.iban = result.error;
      else newIban = result.iban;
    }

    Object.assign(errors, validateTaxProfileFields(toProfileFields(next, wasAccepted)));

    if (!next.bic && !errors.iban) {
      const iban = newIban ?? (newIban === undefined ? this.tryDecrypt(next.ibanEncrypted) : null);
      if (iban && bicRequiredForIban(iban)) {
        errors.bic = 'Le BIC est obligatoire pour un compte situé hors de l’Espace économique européen';
      }
    }

    if (Object.keys(errors).length > 0) {
      throw new BadRequestException({ message: 'Certaines informations sont invalides', errors });
    }

    let bankDetailsChanged = false;
    if (newIban === null && next.ibanEncrypted) {
      next.ibanEncrypted = null;
      next.ibanLast4 = null;
      bankDetailsChanged = true;
    } else if (newIban) {
      const sameIban = this.tryDecrypt(current.ibanEncrypted) === newIban;
      if (!sameIban) {
        next.ibanEncrypted = encryptValue(newIban);
        next.ibanLast4 = newIban.slice(-4);
        bankDetailsChanged = true;
      }
    }
    if (bankDetailsChanged) changed.add('iban');
    if (changed.has('accountHolderName') || changed.has('bic')) bankDetailsChanged = true;

    // Self-billing mandate
    const now = new Date();
    let accepted = wasAccepted;
    let mandateEvent: 'accepted' | 'revoked' | null = null;
    if (dto.selfBillingAccepted === true && !wasAccepted) {
      next.selfBillingAcceptedAt = now;
      accepted = true;
      mandateEvent = 'accepted';
    } else if (dto.selfBillingAccepted === false && next.selfBillingAcceptedAt) {
      next.selfBillingAcceptedAt = null;
      accepted = false;
      mandateEvent = wasAccepted ? 'revoked' : null;
    }
    if (mandateEvent) changed.add('selfBillingAccepted');

    // Completeness (payouts are blocked while incomplete)
    const missing = computeMissingFields(toProfileFields(next, accepted));
    const complete = missing.length === 0;
    const wasComplete = !!current.completedAt;
    next.completedAt = complete ? current.completedAt ?? now : null;
    if (complete) {
      // A later incompleteness (new mandate version...) starts a new reminder cycle
      next.reminderCount = 0;
      next.lastReminderAt = null;
    }

    const data = this.toData(next);
    const [saved] = await this.prisma.$transaction(async (tx) => {
      const row = await tx.creatorTaxProfile.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
      if (mandateEvent === 'accepted') {
        await tx.legalAcceptance.create({
          data: {
            userId,
            document: SELF_BILLING_DOCUMENT,
            version: SELF_BILLING_MANDATE_VERSION,
            ipAddress: context.ipAddress ?? null,
            userAgent: context.userAgent?.slice(0, 500) ?? null,
          },
        });
      }
      return [row];
    });

    // Audit trail: field names only, never values (no IBAN, TIN... in logs)
    if (changed.size > 0) {
      await this.audit(userId, 'TAX_PROFILE_UPDATED', saved.id, context, {
        changedFields: [...changed].sort(),
        bankDetailsChanged,
        complete,
      });
    }
    if (mandateEvent === 'accepted') {
      await this.audit(userId, 'SELF_BILLING_MANDATE_ACCEPTED', saved.id, context, {
        version: SELF_BILLING_MANDATE_VERSION,
      });
    } else if (mandateEvent === 'revoked') {
      await this.audit(userId, 'SELF_BILLING_MANDATE_REVOKED', saved.id, context, {});
    }
    if (complete !== wasComplete) {
      await this.audit(userId, complete ? 'TAX_PROFILE_COMPLETED' : 'TAX_PROFILE_INCOMPLETE', saved.id, context, {
        missingFields: missing,
      });
    }

    // Changing the payout account is what an account takeover would do: tell the owner
    if (bankDetailsChanged && current.ibanEncrypted) {
      await this.notifyBankDetailsChanged(userId);
    }

    return this.toView(saved, accepted ? SELF_BILLING_MANDATE_VERSION : acceptedVersion);
  }

  // ==================== Helpers ====================

  /** Profile and version of the self-billing mandate last accepted */
  async load(userId: string): Promise<{ profile: CreatorTaxProfile | null; acceptedVersion: string | null }> {
    const [profile, acceptance] = await Promise.all([
      this.prisma.creatorTaxProfile.findUnique({ where: { userId } }),
      this.prisma.legalAcceptance.findFirst({
        where: { userId, document: SELF_BILLING_DOCUMENT },
        orderBy: { acceptedAt: 'desc' },
        select: { version: true },
      }),
    ]);
    return { profile, acceptedVersion: acceptance?.version ?? null };
  }

  private toView(profile: CreatorTaxProfile, acceptedVersion: string | null) {
    const accepted = isMandateAccepted(profile, acceptedVersion);
    const missingFields = computeMissingFields(toProfileFields(profile, accepted));
    return {
      exists: true,
      profile: {
        entityType: profile.entityType,
        firstName: profile.firstName,
        lastName: profile.lastName,
        dateOfBirth: toIsoDay(profile.dateOfBirth),
        placeOfBirth: profile.placeOfBirth,
        companyName: profile.companyName,
        companyRegistrationNumber: profile.companyRegistrationNumber,
        vatNumber: profile.vatNumber,
        vatRegime: profile.vatRegime,
        addressLine1: profile.addressLine1,
        addressLine2: profile.addressLine2,
        postalCode: profile.postalCode,
        city: profile.city,
        country: profile.country,
        taxIdentificationNumber: profile.taxIdentificationNumber,
        tinCountry: profile.tinCountry,
        tinNotIssued: profile.tinNotIssued,
        accountHolderName: profile.accountHolderName,
        // Never the full IBAN
        hasIban: !!profile.ibanEncrypted,
        ibanLast4: profile.ibanLast4,
        bic: profile.bic,
        selfBillingAccepted: accepted,
        selfBillingAcceptedAt: accepted ? profile.selfBillingAcceptedAt : null,
        completedAt: profile.completedAt,
        updatedAt: profile.updatedAt,
      },
      status: {
        complete: missingFields.length === 0,
        payoutsBlocked: missingFields.length > 0,
        missingFields,
      },
      mandate: {
        version: SELF_BILLING_MANDATE_VERSION,
        acceptedVersion,
        text: SELF_BILLING_MANDATE_TEXT,
      },
      information: { text: TAX_INFORMATION_TEXT, links: TAX_INFORMATION_LINKS },
    };
  }

  private emptyProfile(userId: string): CreatorTaxProfile {
    const now = new Date();
    return {
      id: '',
      userId,
      entityType: 'individual',
      firstName: null,
      lastName: null,
      dateOfBirth: null,
      placeOfBirth: null,
      companyName: null,
      companyRegistrationNumber: null,
      vatNumber: null,
      vatRegime: 'franchise',
      addressLine1: null,
      addressLine2: null,
      postalCode: null,
      city: null,
      country: null,
      taxIdentificationNumber: null,
      tinCountry: null,
      tinNotIssued: false,
      accountHolderName: null,
      ibanEncrypted: null,
      ibanLast4: null,
      bic: null,
      selfBillingAcceptedAt: null,
      completedAt: null,
      reminderCount: 0,
      lastReminderAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private toData(profile: CreatorTaxProfile): Omit<Prisma.CreatorTaxProfileUncheckedCreateInput, 'userId'> {
    const data: Partial<CreatorTaxProfile> = { ...profile };
    delete data.id;
    delete data.userId;
    delete data.createdAt;
    delete data.updatedAt;
    return data as Omit<Prisma.CreatorTaxProfileUncheckedCreateInput, 'userId'>;
  }

  private tryDecrypt(payload: string | null | undefined): string | null {
    if (!payload) return null;
    try {
      return decryptValue(payload);
    } catch {
      return null;
    }
  }

  private async audit(
    userId: string,
    action: string,
    resourceId: string,
    context: RequestContext,
    metadata: Record<string, unknown>,
  ) {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          resource: 'CreatorTaxProfile',
          resourceId,
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent?.slice(0, 500) ?? null,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to write audit log for ${action}: ${(error as Error).message}`);
    }
  }

  private async notifyBankDetailsChanged(userId: string) {
    const title = 'Coordonnées bancaires modifiées';
    const message =
      "Le compte bancaire de vos virements vient d'être modifié. Si vous n'êtes pas à l'origine de ce changement, sécurisez votre compte et contactez le support immédiatement.";
    try {
      await this.prisma.notification.create({
        data: { userId, type: 'SYSTEM', title, message, linkUrl: TAX_PROFILE_PATH, metadata: { kind: 'BANK_DETAILS_CHANGED' } },
      });
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (user?.email) {
        await this.mail.sendMail({
          to: user.email,
          subject: `FanVIP — ${title}`,
          html: `<p>${escapeHtml(message)}</p>`,
          text: message,
        });
      }
    } catch (error) {
      this.logger.error(`Failed to notify bank details change of ${userId}: ${(error as Error).message}`);
    }
  }
}
