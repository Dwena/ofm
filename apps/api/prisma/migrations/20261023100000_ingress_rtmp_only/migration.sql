-- "Diffuser avec OBS" is RTMP only: WHIP ingresses are removed (a new RTMP
-- ingress and key are created on the next visit of the OBS page / OBS live)
DELETE FROM "LiveIngress" WHERE "inputType" = 'WHIP';

-- AlterTable
ALTER TABLE "LiveIngress" DROP COLUMN "inputType";

-- DropEnum
DROP TYPE "LiveIngressInput";
