-- Multi-step donation goals of the live streams: several milestones
-- (LiveTipGoal) on the live's cumulative tip total, instead of the single
-- goal stored on LiveStream

-- CreateTable
CREATE TABLE "LiveTipGoal" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "reachedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveTipGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveTipGoal_streamId_idx" ON "LiveTipGoal"("streamId");

-- AddForeignKey
ALTER TABLE "LiveTipGoal" ADD CONSTRAINT "LiveTipGoal_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration: the single goal of each stream becomes its first milestone,
-- already reached when the total got there (the old goal label was optional)
INSERT INTO "LiveTipGoal" ("id", "streamId", "amount", "label", "position", "reachedAt", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    s."id",
    s."tipGoalAmount",
    COALESCE(NULLIF(BTRIM(s."tipGoalLabel"), ''), 'Objectif du live'),
    0,
    CASE WHEN s."tipTotal" >= s."tipGoalAmount" THEN CURRENT_TIMESTAMP ELSE NULL END,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "LiveStream" AS s
WHERE s."tipGoalAmount" IS NOT NULL;

-- AlterTable
ALTER TABLE "LiveStream" DROP COLUMN "tipGoalAmount",
DROP COLUMN "tipGoalLabel";
