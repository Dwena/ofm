import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PayoutStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/database/prisma.service';
import { roundMoney } from '../common/utils/money';
import { SettingsService } from '../settings/settings.service';
import { TaxProfileService } from '../tax/tax-profile.service';
import { CreatorBalanceService } from './creator-balance.service';
import { buildSepaCreditTransfer } from './sepa';

export interface PayoutEligibility {
  eligible: boolean;
  identityVerified: boolean;
  taxProfileComplete: boolean;
}

/**
 * Creator payouts. The available balance (CreatorBalanceService) is paid by
 * SEPA credit transfer from the platform's bank account: payouts are created
 * on request or every week, exported by an admin as a SEPA file (pain.001)
 * uploaded to the bank, then marked as paid (or failed: the amount goes back
 * to the balance).
 *
 * A payout requires a verified identity (KYC) and a complete tax profile
 * (DAC7: identity, address, TIN, bank account).
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private prisma: PrismaService,
    private balance: CreatorBalanceService,
    private settingsService: SettingsService,
    private taxProfiles: TaxProfileService,
    private configService: ConfigService,
  ) {}

  async getEligibility(creatorId: string): Promise<PayoutEligibility> {
    const [user, taxProfileComplete] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: creatorId }, select: { kycStatus: true, status: true } }),
      this.taxProfiles.isComplete(creatorId),
    ]);
    const identityVerified = user?.kycStatus === 'VERIFIED';
    return {
      eligible: identityVerified && taxProfileComplete && user?.status === 'ACTIVE',
      identityVerified,
      taxProfileComplete,
    };
  }

  /**
   * Creator asks for a payout of (part of) the available balance
   * @param amount Euros, the whole available balance when omitted
   */
  async requestPayout(creatorId: string, amount?: number) {
    const eligibility = await this.getEligibility(creatorId);
    if (!eligibility.identityVerified) {
      throw new ForbiddenException({ code: 'IDENTITY_NOT_VERIFIED', message: 'Vérifiez votre identité pour recevoir vos virements' });
    }
    if (!eligibility.taxProfileComplete) {
      throw new ForbiddenException({ code: 'TAX_PROFILE_INCOMPLETE', message: 'Complétez votre profil fiscal et bancaire pour recevoir vos virements' });
    }
    if (!eligibility.eligible) {
      throw new ForbiddenException('Votre compte ne permet pas de recevoir de virement');
    }

    const payout = await this.createPayout(creatorId, amount, false);
    this.logger.log(`Payout requested: ${payout.id} (${Number(payout.amount).toFixed(2)} €)`);
    return { payout: this.serialize(payout) };
  }

  async getPayouts(creatorId: string) {
    const payouts = await this.prisma.payout.findMany({
      where: { creatorId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return payouts.map((payout) => this.serialize(payout));
  }

  /**
   * Weekly payout of every eligible creator's available balance (Monday 6 AM)
   */
  @Cron('0 6 * * 1')
  async processAutomatedPayouts() {
    const minimum = await this.settingsService.getMinimumPayoutAmount();
    const creators = await this.prisma.user.findMany({
      where: { role: 'CREATOR', status: 'ACTIVE', kycStatus: 'VERIFIED', deletedAt: null, taxProfile: { completedAt: { not: null } } },
      select: { id: true },
    });

    let created = 0;
    for (const creator of creators) {
      try {
        const { available } = await this.balance.getBalance(creator.id);
        if (available < minimum || !(await this.taxProfiles.isComplete(creator.id))) continue;
        await this.createPayout(creator.id, undefined, true);
        created++;
      } catch (error) {
        this.logger.error(`Automated payout failed for ${creator.id}: ${(error as Error).message}`);
      }
    }
    this.logger.log(`Automated payouts: ${created} created`);
    return { created };
  }

  // ==================== Back-office ====================

  async listPayouts(status?: PayoutStatus) {
    const payouts = await this.prisma.payout.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        creator: { select: { id: true, username: true, displayName: true, email: true } },
        batch: { select: { id: true, reference: true } },
      },
    });
    return payouts.map((payout) => ({ ...this.serialize(payout), creator: payout.creator, batch: payout.batch }));
  }

  /**
   * Export pending payouts as a SEPA credit transfer file. The payouts move to
   * PROCESSING; the admin uploads the file to the bank, then marks them paid.
   */
  async createBatch(adminId: string, payoutIds?: string[]) {
    const debtor = this.getDebtorAccount();
    const payouts = await this.prisma.payout.findMany({
      where: { status: 'PENDING', ...(payoutIds?.length && { id: { in: payoutIds } }) },
      orderBy: { createdAt: 'asc' },
    });

    const transfers: { payoutId: string; endToEndId: string; amount: number; creditor: { name: string; iban: string; bic: string | null } }[] = [];
    const skipped: { payoutId: string; reason: string }[] = [];

    for (const payout of payouts) {
      const bank = await this.taxProfiles.getPayoutBankDetails(payout.creatorId);
      if (!bank) {
        skipped.push({ payoutId: payout.id, reason: 'Coordonnées bancaires manquantes ou illisibles' });
        continue;
      }
      transfers.push({
        payoutId: payout.id,
        endToEndId: payout.reference ?? `PO-${payout.id.replace(/-/g, '').slice(0, 24).toUpperCase()}`,
        amount: Number(payout.amount),
        creditor: { name: bank.accountHolderName, iban: bank.iban, bic: bank.bic },
      });
    }

    if (transfers.length === 0) {
      throw new BadRequestException(skipped.length ? 'Aucun virement exportable (coordonnées bancaires manquantes)' : 'Aucun virement en attente');
    }

    const createdAt = new Date();
    const reference = `FV-${createdAt.toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(4).toString('hex').toUpperCase()}`;
    const totalAmount = roundMoney(transfers.reduce((sum, transfer) => sum + transfer.amount, 0));

    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payoutBatch.create({
        data: { reference, createdBy: adminId, totalAmount, payoutCount: transfers.length },
      });
      for (const transfer of transfers) {
        const updated = await tx.payout.updateMany({
          where: { id: transfer.payoutId, status: 'PENDING' },
          data: { status: 'PROCESSING', batchId: created.id, reference: transfer.endToEndId, processedAt: createdAt },
        });
        if (updated.count === 0) {
          throw new BadRequestException('Un virement a changé pendant l’export, réessayez');
        }
      }
      return created;
    });

    const xml = buildSepaCreditTransfer({
      messageId: reference,
      createdAt,
      executionDate: createdAt.toISOString().slice(0, 10),
      debtor,
      transfers: transfers.map((transfer) => ({
        endToEndId: transfer.endToEndId,
        amount: transfer.amount,
        creditor: transfer.creditor,
        remittanceInformation: `${this.configService.get('COMPANY_NAME', 'FanVIP')} reversement createur ${transfer.endToEndId}`,
      })),
    });

    await this.audit(adminId, 'PAYOUT_BATCH_CREATED', batch.id, { reference, totalAmount, payouts: transfers.length, skipped });
    this.logger.log(`SEPA batch ${reference}: ${transfers.length} transfers, ${totalAmount.toFixed(2)} €`);

    return {
      batch: { ...batch, totalAmount: Number(batch.totalAmount) },
      fileName: `${reference}.xml`,
      xml,
      skipped,
    };
  }

  /** The bank executed the transfer */
  async markPaid(adminId: string, payoutId: string) {
    const payout = await this.prisma.payout.findUnique({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status !== 'PROCESSING' && payout.status !== 'PENDING') {
      throw new BadRequestException('Ce virement ne peut pas être marqué comme payé');
    }

    const updated = await this.prisma.payout.update({
      where: { id: payoutId },
      data: { status: 'COMPLETED', paidAt: new Date() },
    });

    await this.notify(payout.creatorId, 'Virement effectué', `Votre virement de ${Number(payout.amount).toFixed(2)}€ a été envoyé sur votre compte bancaire.`, 'PAYOUT_COMPLETED');
    await this.audit(adminId, 'PAYOUT_PAID', payoutId, { amount: Number(payout.amount) });
    return this.serialize(updated);
  }

  /** Transfer rejected by the bank (or cancelled before export): the amount goes back to the balance */
  async markFailed(adminId: string, payoutId: string, reason: string, cancelled = false) {
    const payout = await this.prisma.payout.findUnique({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException('Payout not found');
    if (cancelled ? payout.status !== 'PENDING' : payout.status !== 'PROCESSING' && payout.status !== 'COMPLETED') {
      throw new BadRequestException(cancelled ? 'Seul un virement en attente peut être annulé' : 'Ce virement ne peut pas être marqué en échec');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payout.update({
        where: { id: payoutId },
        data: cancelled
          ? { status: 'CANCELLED', failureReason: reason }
          : { status: 'FAILED', failedAt: new Date(), failureReason: reason },
      });
      await this.balance.reversePayout(tx, {
        creatorId: payout.creatorId,
        payoutId,
        amount: Number(payout.amount),
        currency: payout.currency,
        reason: cancelled ? 'Virement annulé' : `Virement rejeté : ${reason}`,
      });
      return result;
    });

    await this.notify(
      payout.creatorId,
      cancelled ? 'Virement annulé' : 'Échec du virement',
      `Votre virement de ${Number(payout.amount).toFixed(2)}€ n'a pas pu être effectué (${reason}). Le montant est revenu sur votre solde.`,
      'PAYOUT_FAILED',
    );
    await this.audit(adminId, cancelled ? 'PAYOUT_CANCELLED' : 'PAYOUT_FAILED', payoutId, { reason });
    return this.serialize(updated);
  }

  /** Creates the payout and its balance debit atomically, against the available balance */
  private async createPayout(creatorId: string, requested: number | undefined, automated: boolean) {
    const minimum = await this.settingsService.getMinimumPayoutAmount();
    const taxProfile = await this.prisma.creatorTaxProfile.findUnique({ where: { userId: creatorId }, select: { ibanLast4: true } });

    return this.prisma.$transaction(async (tx) => {
      await this.balance.lock(tx, creatorId);
      const { available } = await this.balance.getBalance(creatorId, tx);
      const amount = roundMoney(requested ?? available);

      if (amount < minimum) {
        throw new BadRequestException(`Le virement minimum est de ${minimum.toFixed(2)}€`);
      }
      if (amount > available) {
        throw new BadRequestException(`Solde disponible insuffisant : ${available.toFixed(2)}€`);
      }

      const payout = await tx.payout.create({
        data: {
          creatorId,
          amount,
          currency: 'EUR',
          status: 'PENDING',
          destinationType: 'bank_account',
          destination: taxProfile?.ibanLast4 ?? null,
        },
      });
      await this.balance.debitPayout(tx, { creatorId, payoutId: payout.id, amount, currency: 'EUR' });

      await tx.notification.create({
        data: {
          userId: creatorId,
          type: 'SYSTEM',
          title: 'Virement programmé',
          message: `Un virement de ${amount.toFixed(2)}€ vers votre compte ${taxProfile?.ibanLast4 ? `•••• ${taxProfile.ibanLast4}` : 'bancaire'} est en préparation${automated ? ' (virement hebdomadaire)' : ''}.`,
          metadata: { kind: 'PAYOUT_PROCESSING', payoutId: payout.id },
        },
      });
      return payout;
    });
  }

  private getDebtorAccount() {
    const name = this.configService.get<string>('PAYOUT_DEBTOR_NAME') || this.configService.get<string>('COMPANY_NAME');
    const iban = this.configService.get<string>('PAYOUT_DEBTOR_IBAN');
    if (!name || !iban) {
      throw new ServiceUnavailableException('Compte bancaire de la plateforme non configuré (PAYOUT_DEBTOR_NAME, PAYOUT_DEBTOR_IBAN)');
    }
    return { name, iban, bic: this.configService.get<string>('PAYOUT_DEBTOR_BIC') || null };
  }

  private serialize<T extends { amount: Prisma.Decimal }>(payout: T) {
    return { ...payout, amount: Number(payout.amount) };
  }

  private async notify(userId: string, title: string, message: string, kind: string) {
    try {
      await this.prisma.notification.create({
        data: {
          userId,
          type: kind === 'PAYOUT_COMPLETED' ? 'PAYOUT_COMPLETED' : 'SYSTEM',
          title,
          message,
          linkUrl: '/creator/earnings',
          metadata: { kind },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create notification: ${(error as Error).message}`);
    }
  }

  private async audit(adminId: string, action: string, resourceId: string, metadata: Record<string, unknown>) {
    try {
      await this.prisma.auditLog.create({
        data: { userId: adminId, action, resource: 'PAYOUT', resourceId, metadata: metadata as Prisma.InputJsonValue },
      });
    } catch (error) {
      this.logger.error(`Failed to write audit log ${action}: ${(error as Error).message}`);
    }
  }
}
