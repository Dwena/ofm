-- OBS overlay widgets: secret overlay URL token and per-widget settings of each creator

-- CreateEnum
CREATE TYPE "OverlayWidgetType" AS ENUM ('ALERTS', 'GOALS', 'TIP_MENU', 'CHAT', 'REQUESTS');

-- CreateTable
CREATE TABLE "OverlayToken" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "OverlayToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OverlayWidgetSettings" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "widget" "OverlayWidgetType" NOT NULL,
    "settings" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OverlayWidgetSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OverlayToken_creatorId_key" ON "OverlayToken"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "OverlayToken_token_key" ON "OverlayToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "OverlayWidgetSettings_creatorId_widget_key" ON "OverlayWidgetSettings"("creatorId", "widget");

-- AddForeignKey
ALTER TABLE "OverlayToken" ADD CONSTRAINT "OverlayToken_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverlayWidgetSettings" ADD CONSTRAINT "OverlayWidgetSettings_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

