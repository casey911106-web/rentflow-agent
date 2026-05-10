-- Queue table for ops-scheduled auto-publish jobs to owned channels.
-- A 1-min cron picks up rows where status='pending' AND scheduledFor <= now()
-- and fires the same auto-publish path the "Publish now" button uses.

CREATE TABLE "ScheduledChannelPost" (
  "id"            TEXT         NOT NULL,
  "companyId"     TEXT         NOT NULL,
  "postPackageId" TEXT         NOT NULL,
  "channelId"     TEXT         NOT NULL,
  "caption"       TEXT         NOT NULL,
  "scheduledFor"  TIMESTAMP(3) NOT NULL,
  "status"        TEXT         NOT NULL DEFAULT 'pending',
  "attemptedAt"   TIMESTAMP(3),
  "placementId"   TEXT,
  "errorMessage"  TEXT,
  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduledChannelPost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduledChannelPost_companyId_status_scheduledFor_idx"
  ON "ScheduledChannelPost"("companyId", "status", "scheduledFor");

CREATE INDEX "ScheduledChannelPost_postPackageId_idx"
  ON "ScheduledChannelPost"("postPackageId");

ALTER TABLE "ScheduledChannelPost"
  ADD CONSTRAINT "ScheduledChannelPost_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScheduledChannelPost"
  ADD CONSTRAINT "ScheduledChannelPost_postPackageId_fkey"
  FOREIGN KEY ("postPackageId") REFERENCES "PostPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScheduledChannelPost"
  ADD CONSTRAINT "ScheduledChannelPost_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "PostChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScheduledChannelPost"
  ADD CONSTRAINT "ScheduledChannelPost_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
