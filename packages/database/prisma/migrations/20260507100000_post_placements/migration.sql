-- Multi-publisher Fast Posting model: any number of publishers can post the
-- same package on any number of channels, and the round-robin scheduler hands
-- out hourly assignments tracked separately.

CREATE TABLE "PostPlacement" (
    "id"              TEXT PRIMARY KEY,
    "companyId"       TEXT NOT NULL,
    "postPackageId"   TEXT NOT NULL,
    "publisherUserId" TEXT NOT NULL,
    "channelName"     TEXT NOT NULL,
    "channelKind"     TEXT,
    "externalUrl"     TEXT,
    "groupSize"       INTEGER,
    "notes"           TEXT,
    "publishedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt"       TIMESTAMP(3),

    CONSTRAINT "PostPlacement_companyId_fkey"       FOREIGN KEY ("companyId")       REFERENCES "Company"("id"),
    CONSTRAINT "PostPlacement_postPackageId_fkey"   FOREIGN KEY ("postPackageId")   REFERENCES "PostPackage"("id"),
    CONSTRAINT "PostPlacement_publisherUserId_fkey" FOREIGN KEY ("publisherUserId") REFERENCES "User"("id")
);
CREATE INDEX "PostPlacement_companyId_postPackageId_idx" ON "PostPlacement"("companyId", "postPackageId");
CREATE INDEX "PostPlacement_publisherUserId_publishedAt_idx" ON "PostPlacement"("publisherUserId", "publishedAt");

CREATE TABLE "PostAssignment" (
    "id"             TEXT PRIMARY KEY,
    "companyId"      TEXT NOT NULL,
    "postPackageId"  TEXT NOT NULL,
    "assigneeUserId" TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'pending',
    "assignedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt"    TIMESTAMP(3),
    "expiresAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostAssignment_companyId_fkey"      FOREIGN KEY ("companyId")      REFERENCES "Company"("id"),
    CONSTRAINT "PostAssignment_postPackageId_fkey"  FOREIGN KEY ("postPackageId")  REFERENCES "PostPackage"("id"),
    CONSTRAINT "PostAssignment_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id")
);
CREATE INDEX "PostAssignment_companyId_status_idx"      ON "PostAssignment"("companyId", "status");
CREATE INDEX "PostAssignment_assigneeUserId_status_idx" ON "PostAssignment"("assigneeUserId", "status");
CREATE INDEX "PostAssignment_postPackageId_status_idx" ON "PostAssignment"("postPackageId", "status");
