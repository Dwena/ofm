-- Compliance release: payment provider abstraction (Stripe removed), VAT on
-- top of creator prices, creator balance ledger, SEPA payouts, DAC7 tax
-- profiles, self-billing invoices, KYC documents, co-performers, media scan,
-- age verification and legal acceptances.

-- CreateEnum
CREATE TYPE "MediaScanStatus" AS ENUM ('PENDING', 'CLEAN', 'FLAGGED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "BalanceEntryType" AS ENUM ('EARNING', 'REFUND', 'CHARGEBACK', 'CHARGEBACK_REVERSAL', 'PAYOUT', 'PAYOUT_REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "IdentityDocumentType" AS ENUM ('ID_CARD', 'PASSPORT', 'DRIVING_LICENSE', 'RESIDENCE_PERMIT', 'SELFIE', 'RELEASE_FORM');

-- CreateEnum
CREATE TYPE "CoPerformerStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- DropIndex
DROP INDEX "User_stripeCustomerId_key";

-- DropIndex
DROP INDEX "User_stripeAccountId_key";

-- DropIndex
DROP INDEX "Subscription_stripeSubscriptionId_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "stripeAccountId",
DROP COLUMN "stripeCustomerId",
DROP COLUMN "stripeOnboarded",
ADD COLUMN     "ageVerificationMethod" TEXT,
ADD COLUMN     "ageVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "billingCountry" TEXT,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SubscriptionTier" DROP COLUMN "stripePriceId",
DROP COLUMN "stripeProductId";

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "stripeSubscriptionId",
ADD COLUMN     "nextRenewalAttemptAt" TIMESTAMP(3),
ADD COLUMN     "paymentCardId" TEXT,
ADD COLUMN     "renewalAttempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Content" ADD COLUMN     "soloContent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "submittedForReviewAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ContentFile" ADD COLUMN     "scanStatus" "MediaScanStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "scannedAt" TIMESTAMP(3);

-- AlterTable
-- Stripe references are kept under the provider-neutral names
ALTER TABLE "Transaction" RENAME COLUMN "stripePaymentIntentId" TO "providerPaymentId";
ALTER TABLE "Transaction" RENAME COLUMN "stripeChargeId" TO "providerTransactionId";
ALTER INDEX "Transaction_stripePaymentIntentId_key" RENAME TO "Transaction_providerPaymentId_key";
ALTER TABLE "Transaction" DROP COLUMN "stripeTransferId",
ADD COLUMN     "paymentCardId" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "taxCountry" TEXT,
ADD COLUMN     "taxEvidence" JSONB,
ADD COLUMN     "totalAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vatAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "withdrawalWaivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Dispute" RENAME COLUMN "stripeDisputeId" TO "providerDisputeId";
ALTER INDEX "Dispute_stripeDisputeId_key" RENAME TO "Dispute_providerDisputeId_key";
-- Stored in cents (Stripe) until now, in euros from now on
ALTER TABLE "Dispute" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(10,2) USING ("amount"::DECIMAL(12,2) / 100);

-- AlterTable
ALTER TABLE "Payout" RENAME COLUMN "stripePayoutId" TO "reference";
ALTER INDEX "Payout_stripePayoutId_key" RENAME TO "Payout_reference_key";
ALTER TABLE "Payout" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "Story" ADD COLUMN     "coPerformerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "scanStatus" "MediaScanStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "LiveStream" ADD COLUMN     "coPerformerIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "PaymentCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerToken" TEXT NOT NULL,
    "brand" TEXT,
    "last4" TEXT,
    "expMonth" INTEGER,
    "expYear" INTEGER,
    "country" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorBalanceEntry" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "type" "BalanceEntryType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "transactionId" TEXT,
    "payoutId" TEXT,
    "description" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorBalanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutBatch" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "payoutCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorTaxProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT 'individual',
    "firstName" TEXT,
    "lastName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "placeOfBirth" TEXT,
    "companyName" TEXT,
    "companyRegistrationNumber" TEXT,
    "vatNumber" TEXT,
    "vatRegime" TEXT NOT NULL DEFAULT 'franchise',
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "country" TEXT,
    "taxIdentificationNumber" TEXT,
    "tinCountry" TEXT,
    "tinNotIssued" BOOLEAN NOT NULL DEFAULT false,
    "accountHolderName" TEXT,
    "ibanEncrypted" TEXT,
    "ibanLast4" TEXT,
    "bic" TEXT,
    "selfBillingAcceptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorTaxProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfBillingInvoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "salesAmount" DECIMAL(12,2) NOT NULL,
    "platformFee" DECIMAL(12,2) NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "data" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfBillingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "coPerformerId" TEXT,
    "type" "IdentityDocumentType" NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoPerformer" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "legalFirstName" TEXT NOT NULL,
    "legalLastName" TEXT NOT NULL,
    "stageName" TEXT,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "email" TEXT,
    "platformUserId" TEXT,
    "status" "CoPerformerStatus" NOT NULL DEFAULT 'PENDING',
    "consentSignedAt" TIMESTAMP(3) NOT NULL,
    "rejectionReason" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CoPerformer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentCoPerformer" (
    "contentId" TEXT NOT NULL,
    "coPerformerId" TEXT NOT NULL,

    CONSTRAINT "ContentCoPerformer_pkey" PRIMARY KEY ("contentId","coPerformerId")
);

-- CreateTable
CREATE TABLE "LegalAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgeVerificationAttempt" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "userId" TEXT,
    "returnTo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgeVerificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentCard_userId_idx" ON "PaymentCard"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCard_provider_providerToken_key" ON "PaymentCard"("provider", "providerToken");

-- CreateIndex
CREATE INDEX "CreatorBalanceEntry_creatorId_availableAt_idx" ON "CreatorBalanceEntry"("creatorId", "availableAt");

-- CreateIndex
CREATE INDEX "CreatorBalanceEntry_transactionId_idx" ON "CreatorBalanceEntry"("transactionId");

-- CreateIndex
CREATE INDEX "CreatorBalanceEntry_payoutId_idx" ON "CreatorBalanceEntry"("payoutId");

-- CreateIndex
CREATE INDEX "CreatorBalanceEntry_type_idx" ON "CreatorBalanceEntry"("type");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutBatch_reference_key" ON "PayoutBatch"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorTaxProfile_userId_key" ON "CreatorTaxProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SelfBillingInvoice_number_key" ON "SelfBillingInvoice"("number");

-- CreateIndex
CREATE INDEX "SelfBillingInvoice_creatorId_idx" ON "SelfBillingInvoice"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "SelfBillingInvoice_creatorId_periodStart_key" ON "SelfBillingInvoice"("creatorId", "periodStart");

-- CreateIndex
CREATE INDEX "IdentityDocument_userId_idx" ON "IdentityDocument"("userId");

-- CreateIndex
CREATE INDEX "IdentityDocument_coPerformerId_idx" ON "IdentityDocument"("coPerformerId");

-- CreateIndex
CREATE INDEX "CoPerformer_creatorId_idx" ON "CoPerformer"("creatorId");

-- CreateIndex
CREATE INDEX "CoPerformer_status_idx" ON "CoPerformer"("status");

-- CreateIndex
CREATE INDEX "ContentCoPerformer_coPerformerId_idx" ON "ContentCoPerformer"("coPerformerId");

-- CreateIndex
CREATE INDEX "LegalAcceptance_userId_document_idx" ON "LegalAcceptance"("userId", "document");

-- CreateIndex
CREATE UNIQUE INDEX "AgeVerificationAttempt_state_key" ON "AgeVerificationAttempt"("state");

-- CreateIndex
CREATE INDEX "AgeVerificationAttempt_createdAt_idx" ON "AgeVerificationAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "Subscription_paymentCardId_idx" ON "Subscription"("paymentCardId");

-- CreateIndex
CREATE INDEX "Transaction_providerTransactionId_idx" ON "Transaction"("providerTransactionId");

-- CreateIndex
CREATE INDEX "Transaction_taxCountry_idx" ON "Transaction"("taxCountry");

-- CreateIndex
CREATE INDEX "Payout_batchId_idx" ON "Payout"("batchId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_paymentCardId_fkey" FOREIGN KEY ("paymentCardId") REFERENCES "PaymentCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_paymentCardId_fkey" FOREIGN KEY ("paymentCardId") REFERENCES "PaymentCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PayoutBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCard" ADD CONSTRAINT "PaymentCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorBalanceEntry" ADD CONSTRAINT "CreatorBalanceEntry_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorBalanceEntry" ADD CONSTRAINT "CreatorBalanceEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorBalanceEntry" ADD CONSTRAINT "CreatorBalanceEntry_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorTaxProfile" ADD CONSTRAINT "CreatorTaxProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfBillingInvoice" ADD CONSTRAINT "SelfBillingInvoice_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityDocument" ADD CONSTRAINT "IdentityDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityDocument" ADD CONSTRAINT "IdentityDocument_coPerformerId_fkey" FOREIGN KEY ("coPerformerId") REFERENCES "CoPerformer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoPerformer" ADD CONSTRAINT "CoPerformer_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCoPerformer" ADD CONSTRAINT "ContentCoPerformer_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCoPerformer" ADD CONSTRAINT "ContentCoPerformer_coPerformerId_fkey" FOREIGN KEY ("coPerformerId") REFERENCES "CoPerformer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing payments: provider and VAT-inclusive total (no VAT was charged)
UPDATE "Transaction" SET "provider" = 'stripe' WHERE "providerPaymentId" IS NOT NULL OR "providerTransactionId" IS NOT NULL;
UPDATE "Transaction" SET "totalAmount" = "amount";

-- Existing creator earnings become the opening balance of the ledger
INSERT INTO "CreatorBalanceEntry" ("id", "creatorId", "type", "amount", "currency", "transactionId", "description", "availableAt", "createdAt")
SELECT gen_random_uuid()::text, t."toUserId", 'EARNING', t."netAmount", t."currency", t."id", 'Reprise de l''historique', t."createdAt", t."createdAt"
FROM "Transaction" t
WHERE t."toUserId" IS NOT NULL
  AND t."type" IN ('SUBSCRIPTION', 'TIP', 'PPV_UNLOCK')
  AND t."status" IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'DISPUTED', 'REFUNDED');

INSERT INTO "CreatorBalanceEntry" ("id", "creatorId", "type", "amount", "currency", "transactionId", "description", "availableAt", "createdAt")
SELECT gen_random_uuid()::text, t."toUserId", 'REFUND', -t."netAmount", t."currency", t."id", 'Reprise de l''historique', t."updatedAt", t."updatedAt"
FROM "Transaction" t
WHERE t."toUserId" IS NOT NULL
  AND t."type" IN ('SUBSCRIPTION', 'TIP', 'PPV_UNLOCK')
  AND t."status" = 'REFUNDED';

INSERT INTO "CreatorBalanceEntry" ("id", "creatorId", "type", "amount", "currency", "payoutId", "description", "availableAt", "createdAt")
SELECT gen_random_uuid()::text, p."creatorId", 'PAYOUT', -p."amount", p."currency", p."id", 'Reprise de l''historique', p."createdAt", p."createdAt"
FROM "Payout" p
WHERE p."status" IN ('PENDING', 'PROCESSING', 'COMPLETED');
