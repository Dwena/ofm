-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "pendingTierId" TEXT;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_pendingTierId_fkey" FOREIGN KEY ("pendingTierId") REFERENCES "SubscriptionTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
