import { Injectable, Logger } from '@nestjs/common';
import { CreatorTaxProfile, Prisma } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { decryptValue } from '../common/utils/crypto';
import { SALE_TYPES, PAID_SALE_STATUSES, SELF_BILLING_DOCUMENT, TAX_INFORMATION_LINKS, TAX_INFORMATION_TEXT } from './tax.constants';
import { TaxDataService } from './tax-data.service';
import { isMandateAccepted, toProfileFields } from './tax-profile.service';
import { PeriodTotals, aggregateByQuarter, yearRange } from './tax-reports';
import { computeMissingFields } from './tax-validation';
import { SelfBillingService, creatorIdentity } from './self-billing.service';

const QUARTER_LABELS = ['1er trimestre (janv. – mars)', '2e trimestre (avr. – juin)', '3e trimestre (juil. – sept.)', '4e trimestre (oct. – déc.)'];

export interface Dac7Quarter {
  quarter: number;
  /** Consideration paid or credited: creator shares, net of the fees and taxes withheld by the platform */
  consideration: number;
  /** Number of relevant activities (paid sales) */
  activities: number;
  /** Fees, commissions and taxes withheld or charged by the platform */
  fees: number;
  /** Creator shares taken back by refunds / chargebacks during the quarter (information) */
  refunded: number;
}

export interface Dac7Record {
  creatorId: string;
  username: string;
  email: string;
  entityType: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  dateOfBirth: string | null;
  placeOfBirth: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  tin: string | null;
  tinCountry: string | null;
  tinNotIssued: boolean;
  vatNumber: string | null;
  companyRegistrationNumber: string | null;
  accountHolderName: string | null;
  /** Full IBAN (admin export only, audit-logged) */
  iban: string | null;
  bic: string | null;
  quarters: Dac7Quarter[];
  total: Omit<Dac7Quarter, 'quarter'>;
  profileComplete: boolean;
  missingFields: string[];
}

const toDac7Quarter = (quarter: number, totals: PeriodTotals): Dac7Quarter => ({
  quarter,
  consideration: totals.consideration,
  activities: totals.transactions,
  fees: totals.platformFee,
  refunded: totals.refundedAmount,
});

/** DAC7 record of a creator (pure, unit-tested) */
export function buildDac7Record(params: {
  user: { id: string; username: string; email: string };
  profile: CreatorTaxProfile | null;
  mandateAccepted: boolean;
  iban: string | null;
  totals: ReturnType<typeof aggregateByQuarter>;
}): Dac7Record {
  const { user, profile, totals } = params;
  const missingFields = profile ? computeMissingFields(toProfileFields(profile, params.mandateAccepted)) : ['profile'];
  const year = toDac7Quarter(0, totals.year);
  const total = { consideration: year.consideration, activities: year.activities, fees: year.fees, refunded: year.refunded };
  return {
    creatorId: user.id,
    username: user.username,
    email: user.email,
    entityType: profile?.entityType ?? 'individual',
    firstName: profile?.firstName ?? null,
    lastName: profile?.lastName ?? null,
    companyName: profile?.companyName ?? null,
    dateOfBirth: profile?.dateOfBirth ? profile.dateOfBirth.toISOString().slice(0, 10) : null,
    placeOfBirth: profile?.placeOfBirth ?? null,
    addressLine1: profile?.addressLine1 ?? null,
    addressLine2: profile?.addressLine2 ?? null,
    postalCode: profile?.postalCode ?? null,
    city: profile?.city ?? null,
    country: profile?.country ?? null,
    tin: profile?.taxIdentificationNumber ?? null,
    tinCountry: profile?.tinCountry ?? null,
    tinNotIssued: profile?.tinNotIssued ?? false,
    vatNumber: profile?.vatNumber ?? null,
    companyRegistrationNumber: profile?.companyRegistrationNumber ?? null,
    accountHolderName: profile?.accountHolderName ?? null,
    iban: params.iban,
    bic: profile?.bic ?? null,
    quarters: totals.quarters.map((q, index) => toDac7Quarter(index + 1, q)),
    total,
    profileComplete: missingFields.length === 0,
    missingFields,
  };
}

const CSV_SEPARATOR = ';';

/** Text cell: quoted, and neutralized against spreadsheet formula injection */
function csvText(value: string | null | undefined): string {
  let text = value ?? '';
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Amount with a decimal comma (French spreadsheets, `;` separated) */
const csvAmount = (value: number) => value.toFixed(2).replace('.', ',');

export function dac7ToCsv(records: Dac7Record[]): string {
  const header = [
    'id_createur', 'pseudo', 'email', 'type_vendeur', 'nom', 'prenom', 'raison_sociale', 'date_naissance',
    'lieu_naissance', 'adresse_ligne1', 'adresse_ligne2', 'code_postal', 'ville', 'pays_residence', 'nif',
    'pays_emetteur_nif', 'nif_non_delivre', 'numero_tva', 'siren_immatriculation', 'titulaire_compte', 'iban', 'bic',
    ...[1, 2, 3, 4].flatMap((q) => [`T${q}_contrepartie`, `T${q}_nb_activites`, `T${q}_commissions`, `T${q}_rembourse`]),
    'total_contrepartie', 'total_nb_activites', 'total_commissions', 'total_rembourse', 'profil_complet', 'champs_manquants',
  ];
  const rows = records.map((r) =>
    [
      csvText(r.creatorId), csvText(r.username), csvText(r.email), csvText(r.entityType === 'company' ? 'entite' : 'personne_physique'),
      csvText(r.lastName), csvText(r.firstName), csvText(r.companyName), csvText(r.dateOfBirth), csvText(r.placeOfBirth),
      csvText(r.addressLine1), csvText(r.addressLine2), csvText(r.postalCode), csvText(r.city), csvText(r.country),
      csvText(r.tin), csvText(r.tinCountry), r.tinNotIssued ? 'oui' : 'non', csvText(r.vatNumber),
      csvText(r.companyRegistrationNumber), csvText(r.accountHolderName), csvText(r.iban), csvText(r.bic),
      ...r.quarters.flatMap((q) => [csvAmount(q.consideration), String(q.activities), csvAmount(q.fees), csvAmount(q.refunded)]),
      csvAmount(r.total.consideration), String(r.total.activities), csvAmount(r.total.fees), csvAmount(r.total.refunded),
      r.profileComplete ? 'oui' : 'non', csvText(r.missingFields.join(',')),
    ].join(CSV_SEPARATOR),
  );
  // BOM: accents are read correctly when the file is opened in Excel
  return '﻿' + [header.join(CSV_SEPARATOR), ...rows].join('\r\n') + '\r\n';
}

/**
 * Yearly documents built from the sales: the annual statement owed to each
 * creator (art. 242 bis CGI) and the DAC7 report of the platform.
 */
@Injectable()
export class TaxStatementsService {
  private readonly logger = new Logger(TaxStatementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly data: TaxDataService,
    private readonly selfBilling: SelfBillingService,
  ) {}

  /** Years in which the creator had paid sales (most recent first) */
  async listStatementYears(creatorId: string): Promise<number[]> {
    const rows = await this.prisma.$queryRaw<{ year: number }[]>`
      SELECT DISTINCT EXTRACT(YEAR FROM "processedAt")::int AS "year"
      FROM "Transaction"
      WHERE "toUserId" = ${creatorId}
        AND "processedAt" IS NOT NULL
        AND "type"::text IN (${Prisma.join([...SALE_TYPES])})
        AND "status"::text IN (${Prisma.join([...PAID_SALE_STATUSES])})
      ORDER BY "year" DESC`;
    return rows.map((row) => Number(row.year));
  }

  /**
   * Annual statement of a creator (art. 242 bis CGI): to be made available by
   * 31 January for the previous year. The current year is provisional.
   */
  async getAnnualStatement(creatorId: string, year: number, now = new Date()) {
    const { start, end } = yearRange(year);
    const [sales, adjustments, profile, user] = await Promise.all([
      this.data.loadSales(start, end, creatorId),
      this.data.loadAdjustments(start, end, creatorId),
      this.prisma.creatorTaxProfile.findUnique({ where: { userId: creatorId } }),
      this.prisma.user.findUnique({ where: { id: creatorId }, select: { displayName: true, username: true } }),
    ]);
    const totals = aggregateByQuarter(sales.get(creatorId) ?? [], adjustments.get(creatorId) ?? []);
    const identity = creatorIdentity(profile, user ?? { displayName: null, username: '' });

    return {
      year,
      provisional: end > now,
      generatedAt: now.toISOString(),
      legalBasis: 'Article 242 bis du Code général des impôts — directive (UE) 2021/514 (DAC7)',
      seller: {
        ...identity,
        taxIdentificationNumber: profile?.taxIdentificationNumber ?? null,
        tinCountry: profile?.tinCountry ?? null,
      },
      platform: this.selfBilling.platformIdentity(),
      quarters: totals.quarters.map((q, index) => ({ quarter: index + 1, label: QUARTER_LABELS[index], ...q })),
      totals: totals.year,
      information: { text: TAX_INFORMATION_TEXT, links: TAX_INFORMATION_LINKS },
    };
  }

  /**
   * DAC7 export: one record per reportable seller (at least one paid sale in
   * the year), with its identity, bank account and quarterly totals.
   *
   * The official declaration is filed with the DGFiP in its XML format
   * (DPI-DAC7 schema, derived from the EU DAC7 XSD) through the professional
   * space / EDI channel, by 31 January of the following year. This export is
   * the source data for it (or for the accountant who files it); generating
   * the XML file itself is the next step.
   */
  async exportDac7(year: number, adminId: string, context: { ipAddress?: string | null; userAgent?: string | null } = {}) {
    const { start, end } = yearRange(year);
    const [salesByCreator, adjustmentsByCreator] = await Promise.all([
      this.data.loadSales(start, end),
      this.data.loadAdjustments(start, end),
    ]);
    const creatorIds = [...salesByCreator.keys()];

    const [users, profiles, acceptances] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, username: true, email: true } }),
      this.prisma.creatorTaxProfile.findMany({ where: { userId: { in: creatorIds } } }),
      this.prisma.legalAcceptance.findMany({
        where: { userId: { in: creatorIds }, document: SELF_BILLING_DOCUMENT },
        orderBy: { acceptedAt: 'asc' },
        select: { userId: true, version: true },
      }),
    ]);
    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));
    const versionByUser = new Map<string, string>();
    acceptances.forEach((a) => versionByUser.set(a.userId, a.version));

    const records = users
      .map((user) => {
        const profile = profileByUser.get(user.id) ?? null;
        let iban: string | null = null;
        if (profile?.ibanEncrypted) {
          try {
            iban = decryptValue(profile.ibanEncrypted);
          } catch (error) {
            this.logger.error(`Cannot decrypt the IBAN of creator ${user.id}: ${(error as Error).message}`);
          }
        }
        return buildDac7Record({
          user,
          profile,
          mandateAccepted: isMandateAccepted(profile, versionByUser.get(user.id) ?? null),
          iban,
          totals: aggregateByQuarter(salesByCreator.get(user.id) ?? [], adjustmentsByCreator.get(user.id) ?? []),
        });
      })
      .sort((a, b) => a.username.localeCompare(b.username));

    // The export contains full IBANs and tax identifiers: keep a trace of who downloaded it
    await this.prisma.auditLog
      .create({
        data: {
          userId: adminId,
          action: 'DAC7_EXPORT',
          resource: 'CreatorTaxProfile',
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent?.slice(0, 500) ?? null,
          metadata: {
            year,
            sellers: records.length,
            incompleteProfiles: records.filter((r) => !r.profileComplete).length,
            includesBankAccounts: true,
          },
        },
      })
      .catch((error) => this.logger.error(`Failed to write audit log: ${error.message}`));

    return {
      year,
      generatedAt: new Date().toISOString(),
      sellers: records.length,
      incompleteProfiles: records.filter((r) => !r.profileComplete).length,
      records,
    };
  }
}
