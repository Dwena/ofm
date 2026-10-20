-- "Diffuser avec OBS": persistent LiveKit Ingress of each creator (OBS server
-- URL and stream key that stay the same from one live to the next) and the
-- video source of each live (browser camera or OBS)

-- CreateEnum
CREATE TYPE "LiveSource" AS ENUM ('BROWSER', 'OBS');

-- CreateEnum
CREATE TYPE "LiveIngressInput" AS ENUM ('RTMP', 'WHIP');

-- AlterTable
ALTER TABLE "LiveStream" ADD COLUMN     "source" "LiveSource" NOT NULL DEFAULT 'BROWSER';

-- CreateTable
CREATE TABLE "LiveIngress" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "inputType" "LiveIngressInput" NOT NULL DEFAULT 'WHIP',
    "ingressId" TEXT NOT NULL,
    "streamKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveIngress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiveIngress_creatorId_key" ON "LiveIngress"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveIngress_ingressId_key" ON "LiveIngress"("ingressId");

-- AddForeignKey
ALTER TABLE "LiveIngress" ADD CONSTRAINT "LiveIngress_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

