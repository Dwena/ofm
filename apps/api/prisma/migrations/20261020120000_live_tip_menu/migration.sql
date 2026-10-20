-- Live tip menu ("paliers de dons"), tip goals and persisted tip chat lines

-- CreateEnum
CREATE TYPE "StreamMessageType" AS ENUM ('MESSAGE', 'TIP', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TipActionStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED');

-- AlterTable
ALTER TABLE "LiveStream" ADD COLUMN     "tipGoalAmount" DECIMAL(10,2),
ADD COLUMN     "tipGoalLabel" TEXT,
ADD COLUMN     "tipTotal" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StreamMessage" ADD COLUMN     "tipAmount" DECIMAL(10,2),
ADD COLUMN     "transactionId" TEXT,
ADD COLUMN     "type" "StreamMessageType" NOT NULL DEFAULT 'MESSAGE';

-- CreateTable
CREATE TABLE "LiveTipMenuItem" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "emoji" TEXT,
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveTipMenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveTipAction" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "menuItemId" TEXT,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "status" "TipActionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "LiveTipAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveTipMenuItem_creatorId_idx" ON "LiveTipMenuItem"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveTipAction_transactionId_key" ON "LiveTipAction"("transactionId");

-- CreateIndex
CREATE INDEX "LiveTipAction_streamId_status_idx" ON "LiveTipAction"("streamId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StreamMessage_transactionId_key" ON "StreamMessage"("transactionId");

-- AddForeignKey
ALTER TABLE "LiveTipMenuItem" ADD CONSTRAINT "LiveTipMenuItem_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveTipAction" ADD CONSTRAINT "LiveTipAction_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveTipAction" ADD CONSTRAINT "LiveTipAction_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: running tip total of the existing streams, from the completed
-- tips sent from them (TIP transactions carrying metadata.streamId)
UPDATE "LiveStream" AS s
SET "tipTotal" = t.total
FROM (
    SELECT "metadata"->>'streamId' AS "streamId", SUM("amount") AS total
    FROM "Transaction"
    WHERE "type" = 'TIP' AND "status" = 'COMPLETED' AND "metadata"->>'streamId' IS NOT NULL
    GROUP BY 1
) AS t
WHERE s."id" = t."streamId";

