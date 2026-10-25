import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { CreatorTaxProfile, Prisma } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { SELF_BILLING_DOCUMENT, SELF_BILLING_MANDATE_VERSION, formatInvoiceNumber, invoiceCounterKey } from './tax.constants';
import { TaxDataService } from './tax-data.service';
import {
  AdjustmentRecord,
  InvoiceComputation,
  SaleRecord,
  computeInvoiceLines,
  computeInvoiceVat,
  monthRange,
  previousMonth,
} from './tax-reports';

type Tx = Prisma.TransactionClient;

export interface PlatformIdentity {
  name: string;
  address: string;
  siren: string;
  vatNumber: string;
}

export interface CreatorIdentity {
  entityType: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  companyRegistrationNumber: string | null;
  vatNumber: string | null;
  vatRegime: string;
  address: string[];
  country: string | null;
  /** The tax profile was complete when the invoice was issued */
  profileComplete: boolean;
}

const formatPeriod = (start: Date) =>
  new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start);

/** Snapshot of the creator identity, from the tax profile (account names as fallback) */
export function creatorIdentity(
  profile: CreatorTaxProfile | null,
  user: { displayName: string | null; username: string },
): CreatorIdentity {
  const company = profile?.entityType === 'company';
  const personName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
  const name = (company ? profile?.companyName : personName) || personName || user.displayName || user.username;
  const cityLine = [profile?.postalCode, profile?.city].filter(Boolean).join(' ');
  return {
    entityType: profile?.entityType ?? 'individual',
    name,
    firstName: profile?.firstName ?? null,
    lastName: profile?.lastName ?? null,
    companyName: profile?.companyName ?? null,
    companyRegistrationNumber: profile?.companyRegistrationNumber ?? null,
    vatNumber: profile?.vatNumber ?? null,
    vatRegime: profile?.vatRegime ?? 'franchise',
    address: [profile?.addressLine1, profile?.addressLine2, cityLine, profile?.country].filter(
      (line): line is string => !!line,
    ),
    country: profile?.country ?? null,
    profileComplete: !!profile?.completedAt,
  };
}

/**
 * Content of a monthly self-billing invoice (pure, unit-tested): totals, VAT,
 * mandatory mentions and snapshots of both parties.
 */
export function buildInvoice(params: {
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date;
  number: string;
  sales: SaleRecord[];
  adjustments: AdjustmentRecord[];
  creator: CreatorIdentity;
  platform: PlatformIdentity;
  mandate: { acceptedAt: Date | null; version: string | null };
}) {
  const computation: InvoiceComputation = computeInvoiceLines(params.sales, params.adjustments);
  const vat = computeInvoiceVat(computation.netAmount, params.creator);
  const totalAmount = Math.round((computation.netAmount + vat.vatAmount) * 100) / 100;
  const creditNote = computation.netAmount < 0;
  const lastDay = new Date(params.periodEnd.getTime() - 1);

  const mentions = [
    'Autofacturation',
    `Facture émise par ${params.platform.name || 'la plateforme'} au nom et pour le compte de ${params.creator.name}` +
      (params.mandate.acceptedAt
        ? `, en vertu du mandat de facturation accepté le ${params.mandate.acceptedAt.toISOString().slice(0, 10)}.`
        : '.'),
    ...(vat.mention ? [vat.mention] : []),
  ];

  return {
    totals: {
      salesAmount: computation.salesAmount,
      platformFee: computation.platformFee,
      netAmount: computation.netAmount,
      vatRate: vat.vatRate,
      vatAmount: vat.vatAmount,
      totalAmount,
    },
    data: {
      schemaVersion: 1,
      number: params.number,
      documentType: creditNote ? 'credit_note' : 'invoice',
      title: creditNote ? 'Facture d’avoir' : 'Facture',
      issuedAt: params.issuedAt.toISOString(),
      period: {
        start: params.periodStart.toISOString(),
        end: lastDay.toISOString(),
        label: formatPeriod(params.periodStart),
      },
      currency: 'EUR',
      // The creator supplies the service and is the issuer of the invoice (issued by the platform on its behalf)
      seller: params.creator,
      buyer: params.platform,
      description:
        'Prestations de création et de mise à disposition de contenus numériques, vendus aux fans par la plateforme (abonnements, pourboires, contenus à l’unité). ' +
        'Le prix payé par les fans et la commission de la plateforme sont indiqués pour information ; le montant facturé est la part du créateur.',
      lines: computation.lines,
      totals: {
        salesAmount: computation.salesAmount,
        platformFee: computation.platformFee,
        netAmount: computation.netAmount,
        vatRate: vat.vatRate,
        vatAmount: vat.vatAmount,
        totalAmount,
      },
      vat: { mention: vat.mention, reverseCharge: vat.reverseCharge, reviewRequired: vat.reviewRequired },
      mentions,
      mandate: {
        acceptedAt: params.mandate.acceptedAt?.toISOString() ?? null,
        version: params.mandate.version,
      },
      paymentTerms:
        'Montant porté au crédit du solde créateur au fil des ventes et réglé par virement SEPA selon les conditions de la plateforme. Pas d’escompte pour paiement anticipé.',
    },
  };
}

/**
 * Monthly self-billing invoices (art. 289 I-2 CGI): the platform buys the
 * creators' services and issues, in their name, one invoice per creator and
 * per month with activity. Numbers are sequential without gaps per year
 * (AF-YYYY-000001), allocated in the same database transaction as the invoice.
 */
@Injectable()
export class SelfBillingService {
  private readonly logger = new Logger(SelfBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly data: TaxDataService,
  ) {}

  /** On the 1st of each month at 05:10: invoices of the previous month */
  @Cron('10 5 1 * *')
  async handleCron() {
    const { year, month } = previousMonth(new Date());
    try {
      await this.generateForMonth(year, month);
    } catch (error) {
      this.logger.error(`Self-billing invoices of ${year}-${month} failed: ${(error as Error).message}`);
    }
  }

  platformIdentity(): PlatformIdentity {
    return {
      name: this.config.get<string>('COMPANY_NAME', ''),
      address: this.config.get<string>('COMPANY_ADDRESS', ''),
      siren: this.config.get<string>('COMPANY_SIREN', ''),
      vatNumber: this.config.get<string>('COMPANY_VAT_NUMBER', ''),
    };
  }

  /**
   * Generate the missing invoices of a month (idempotent: a creator already
   * invoiced for the period is skipped). Also used by admins to catch up.
   */
  async generateForMonth(year: number, month: number, triggeredBy?: string, now = new Date()) {
    const { start, end } = monthRange(year, month);
    if (end > now) {
      throw new BadRequestException('Le mois doit être terminé avant de générer ses factures');
    }
    const platform = this.platformIdentity();
    if (!platform.name || !platform.siren) {
      this.logger.warn('COMPANY_NAME / COMPANY_SIREN are not configured: invoices miss the platform identity');
    }

    const [salesByCreator, adjustmentsByCreator] = await Promise.all([
      this.data.loadSales(start, end),
      this.data.loadAdjustments(start, end),
    ]);
    const creatorIds = [...new Set([...salesByCreator.keys(), ...adjustmentsByCreator.keys()])];

    const existing = await this.prisma.selfBillingInvoice.findMany({
      where: { periodStart: start, creatorId: { in: creatorIds } },
      select: { creatorId: true },
    });
    const alreadyInvoiced = new Set(existing.map((invoice) => invoice.creatorId));

    const created: string[] = [];
    const failed: string[] = [];
    let skipped = alreadyInvoiced.size;

    for (const creatorId of creatorIds) {
      if (alreadyInvoiced.has(creatorId)) continue;
      try {
        const number = await this.createInvoice(
          creatorId,
          start,
          end,
          salesByCreator.get(creatorId) ?? [],
          adjustmentsByCreator.get(creatorId) ?? [],
          platform,
        );
        if (number) created.push(number);
        else skipped++;
      } catch (error) {
        failed.push(creatorId);
        this.logger.error(`Self-billing invoice of ${creatorId} for ${year}-${month} failed: ${(error as Error).message}`);
      }
    }

    const period = `${year}-${String(month).padStart(2, '0')}`;
    this.logger.log(`Self-billing invoices ${period}: ${created.length} created, ${skipped} skipped, ${failed.length} failed`);
    if (triggeredBy) {
      await this.prisma.auditLog
        .create({
          data: {
            userId: triggeredBy,
            action: 'SELF_BILLING_INVOICES_GENERATED',
            resource: 'SelfBillingInvoice',
            metadata: { period, created: created.length, skipped, failed: failed.length },
          },
        })
        .catch((error) => this.logger.error(`Failed to write audit log: ${error.message}`));
    }
    return { period, created: created.length, skipped, failed: failed.length, numbers: created };
  }

  /** Invoice of one creator (null when the month nets to nothing). Returns its number. */
  private async createInvoice(
    creatorId: string,
    start: Date,
    end: Date,
    sales: SaleRecord[],
    adjustments: AdjustmentRecord[],
    platform: PlatformIdentity,
  ): Promise<string | null> {
    if (sales.length === 0 && adjustments.length === 0) return null;

    const [user, profile, acceptance] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: creatorId }, select: { displayName: true, username: true } }),
      this.prisma.creatorTaxProfile.findUnique({ where: { userId: creatorId } }),
      this.prisma.legalAcceptance.findFirst({
        where: { userId: creatorId, document: SELF_BILLING_DOCUMENT },
        orderBy: { acceptedAt: 'desc' },
        select: { version: true, acceptedAt: true },
      }),
    ]);
    if (!user) return null;

    const issuedAt = new Date();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const year = issuedAt.getUTCFullYear();
        const number = formatInvoiceNumber(year, await this.nextSequence(tx, year));
        const invoice = buildInvoice({
          periodStart: start,
          periodEnd: end,
          issuedAt,
          number,
          sales,
          adjustments,
          creator: creatorIdentity(profile, user),
          platform,
          mandate: {
            acceptedAt: profile?.selfBillingAcceptedAt ?? null,
            version: profile?.selfBillingAcceptedAt ? acceptance?.version ?? SELF_BILLING_MANDATE_VERSION : null,
          },
        });
        await tx.selfBillingInvoice.create({
          data: {
            number,
            creatorId,
            periodStart: start,
            periodEnd: end,
            ...invoice.totals,
            data: invoice.data as unknown as Prisma.InputJsonValue,
            issuedAt,
          },
        });
        return number;
      });
    } catch (error) {
      // Generated concurrently for the same creator / month: the transaction (and the number) was rolled back
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
      throw error;
    }
  }

  /**
   * Next invoice number of the year. The counter row is locked by the update
   * until the transaction commits, and rolled back with it on failure: numbers
   * have no gaps and are never reused.
   */
  async nextSequence(tx: Tx, year: number): Promise<number> {
    const key = invoiceCounterKey(year);
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO "PlatformSetting" ("key", "value", "updatedAt")
      VALUES (${key}, '1'::jsonb, NOW())
      ON CONFLICT ("key") DO UPDATE
        SET "value" = to_jsonb((("PlatformSetting"."value" #>> '{}')::int) + 1), "updatedAt" = NOW()
      RETURNING (("value" #>> '{}')::int) AS "value"`;
    return Number(rows[0].value);
  }

  // ==================== Read ====================

  async listForCreator(creatorId: string) {
    const invoices = await this.prisma.selfBillingInvoice.findMany({
      where: { creatorId },
      orderBy: { periodStart: 'desc' },
      select: {
        id: true,
        number: true,
        periodStart: true,
        periodEnd: true,
        salesAmount: true,
        platformFee: true,
        netAmount: true,
        vatRate: true,
        vatAmount: true,
        totalAmount: true,
        issuedAt: true,
      },
    });
    return invoices.map((invoice) => ({
      ...invoice,
      documentType: Number(invoice.netAmount) < 0 ? 'credit_note' : 'invoice',
    }));
  }

  async getForCreator(creatorId: string, id: string) {
    const invoice = await this.prisma.selfBillingInvoice.findFirst({ where: { id, creatorId } });
    if (!invoice) throw new NotFoundException('Facture introuvable');
    return invoice;
  }

  /** Back-office: invoices of a month */
  async listForMonth(year: number, month: number) {
    const { start } = monthRange(year, month);
    return this.prisma.selfBillingInvoice.findMany({
      where: { periodStart: start },
      orderBy: { number: 'asc' },
      select: {
        id: true,
        number: true,
        creatorId: true,
        creator: { select: { username: true, displayName: true } },
        netAmount: true,
        vatAmount: true,
        totalAmount: true,
        issuedAt: true,
      },
    });
  }
}
