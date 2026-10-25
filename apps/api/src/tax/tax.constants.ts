/**
 * Self-billing mandate (art. 289 I-2 of the CGI, art. 224 of directive
 * 2006/112/EC): the creator allows the platform to issue its invoices.
 * Bump the version whenever the text changes: creators must accept it again
 * (their profile becomes incomplete and payouts are blocked meanwhile).
 */
export const SELF_BILLING_MANDATE_VERSION = '2026-10-25';

/** LegalAcceptance.document of the mandate */
export const SELF_BILLING_DOCUMENT = 'self_billing';

export const SELF_BILLING_MANDATE_TEXT = [
  "Je donne mandat à la plateforme de facturation : j'autorise l'éditeur de FanVIP à émettre en mon nom et pour mon compte les factures relatives aux prestations de création de contenus numériques que je lui fournis (abonnements, pourboires et contenus à l'unité vendus aux fans par la plateforme), conformément à l'article 289 I-2 du Code général des impôts.",
  "Les factures sont établies chaque mois à partir des ventes réalisées, sous la mention « Autofacturation », numérotées dans une séquence chronologique continue propre à la plateforme, et mises à ma disposition dans mon espace « Documents ».",
  "Je reste seul(e) responsable des obligations fiscales et sociales liées à ces factures, notamment la déclaration de mes revenus et, le cas échéant, le reversement de la TVA facturée en mon nom.",
  "Je m'engage à signaler sans délai tout changement de ma situation au regard de la TVA (franchise en base, assujettissement, numéro de TVA) ou de mon identité, en mettant à jour mon profil fiscal.",
  "Je dispose d'un délai de 30 jours à compter de la mise à disposition de chaque facture pour la contester par écrit auprès du support ; passé ce délai, elle est réputée acceptée.",
  "Ce mandat est conclu pour une durée indéterminée. Je peux le révoquer à tout moment depuis mon profil fiscal ; la plateforme ne peut alors plus me verser mes revenus tant qu'un nouveau mode de facturation n'a pas été convenu.",
];

/** Notification metadata.kind of the DAC7 reminders */
export const TAX_PROFILE_REMINDER_KIND = 'TAX_PROFILE_REMINDER';
export const TAX_PROFILE_PATH = '/creator/tax-profile';

/** DAC7: reminders sent before payments are withheld, and their spacing */
export const MAX_TAX_PROFILE_REMINDERS = 2;
export const TAX_PROFILE_REMINDER_INTERVAL_DAYS = 30;

/** Transaction types that are sales of the creator (the rest are refunds, payouts, fees) */
export const SALE_TYPES = ['SUBSCRIPTION', 'TIP', 'PPV_UNLOCK'] as const;

/**
 * Statuses of a sale that was paid: refunded / disputed sales were paid
 * first, the money taken back is a separate ledger entry (REFUND, CHARGEBACK)
 */
export const PAID_SALE_STATUSES = ['COMPLETED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED'] as const;

/** Counter of invoice numbers of a year, in PlatformSetting */
export const invoiceCounterKey = (year: number) => `selfBillingInvoiceCounter:${year}`;

/** AF-2026-000001 */
export const formatInvoiceNumber = (year: number, sequence: number) =>
  `AF-${year}-${String(sequence).padStart(6, '0')}`;

/** Where creators learn about their tax and social obligations (art. 242 bis CGI) */
export const TAX_INFORMATION_LINKS = [
  {
    label: 'impots.gouv.fr — Je vends des biens ou je fournis des services par l’intermédiaire d’une plateforme',
    url: 'https://www.impots.gouv.fr/particulier/questions/je-vends-des-biens-ou-je-fournis-des-services-par-lintermediaire-dune-plateforme',
  },
  { label: 'urssaf.fr — cotisations sociales', url: 'https://www.urssaf.fr' },
  { label: 'autoentrepreneur.urssaf.fr — micro-entrepreneurs', url: 'https://www.autoentrepreneur.urssaf.fr' },
];

export const TAX_INFORMATION_TEXT = [
  'Les sommes que vous percevez via FanVIP sont des revenus imposables : vous devez les déclarer chaque année à l’administration fiscale, et les cotisations sociales correspondantes sont dues dès le premier euro lorsque l’activité est exercée de manière régulière.',
  'En tant que créateur de contenus, vous relevez en général des bénéfices non commerciaux (BNC). Si vous exercez sous le statut de micro-entrepreneur, déclarez votre chiffre d’affaires (votre part des ventes) à l’URSSAF chaque mois ou chaque trimestre, et reportez-le sur votre déclaration de revenus.',
  'En application de l’article 242 bis du Code général des impôts et de la directive (UE) 2021/514 (DAC7), FanVIP transmet chaque année à l’administration fiscale les montants qui vous ont été versés ainsi que les informations de votre profil fiscal. Ce récapitulatif vous est adressé au plus tard le 31 janvier.',
];
