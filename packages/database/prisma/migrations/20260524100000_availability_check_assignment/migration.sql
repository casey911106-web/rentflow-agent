-- Field-agent assignment for OwnerAvailabilityCheck: every 12h the scheduler
-- picks the next eligible field agent and creates a Check row with assignee +
-- 24h TTL. The agent confirms available / unavailable from mobile. If
-- unavailable, the property's PostPackages auto-pause.

ALTER TABLE "OwnerAvailabilityCheck"
  ADD COLUMN "assigneeUserId"        TEXT,
  ADD COLUMN "assignedAt"            TIMESTAMP(3),
  ADD COLUMN "expiresAt"             TIMESTAMP(3),
  ADD COLUMN "fulfilledAt"           TIMESTAMP(3),
  ADD COLUMN "reportedAvailableFrom" TIMESTAMP(3),
  ADD COLUMN "reportedNotes"         TEXT;

ALTER TABLE "OwnerAvailabilityCheck"
  ADD CONSTRAINT "OwnerAvailabilityCheck_assigneeUserId_fkey"
  FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "OwnerAvailabilityCheck_assigneeUserId_status_idx"
  ON "OwnerAvailabilityCheck"("assigneeUserId", "status");

CREATE INDEX "OwnerAvailabilityCheck_status_expiresAt_idx"
  ON "OwnerAvailabilityCheck"("status", "expiresAt");
