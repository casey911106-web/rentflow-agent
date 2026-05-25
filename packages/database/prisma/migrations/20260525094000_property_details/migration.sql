-- Property details system: admin-configurable questions catalogue +
-- per-property JSON answers + per-publish field-agent task to collect them.
-- Powers the WhatsApp AI agent so it can answer guest FAQs ("how many people
-- live there?", "private bathroom?", "daily cleaning?") without escalating.

-- 1) Enums
CREATE TYPE "PropertyDetailQuestionType" AS ENUM ('text', 'number', 'boolean', 'enum', 'multi_enum');
CREATE TYPE "PropertyDetailsCheckStatus" AS ENUM ('pending', 'filled', 'expired', 'cancelled');

-- 2) Property columns — answers blob + completion stamp
ALTER TABLE "Property"
  ADD COLUMN "details"            JSONB,
  ADD COLUMN "detailsCompletedAt" TIMESTAMP(3);

-- 3) Question catalogue (per company so future tenants can customise)
CREATE TABLE "PropertyDetailQuestion" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "helperText"  TEXT,
  "type"        "PropertyDetailQuestionType" NOT NULL,
  "options"     JSONB,
  "isRequired"  BOOLEAN NOT NULL DEFAULT true,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "position"    INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "deletedAt"   TIMESTAMP(3),
  CONSTRAINT "PropertyDetailQuestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PropertyDetailQuestion_companyId_key_key" ON "PropertyDetailQuestion"("companyId", "key");
CREATE INDEX "PropertyDetailQuestion_companyId_isActive_position_idx" ON "PropertyDetailQuestion"("companyId", "isActive", "position");

ALTER TABLE "PropertyDetailQuestion"
  ADD CONSTRAINT "PropertyDetailQuestion_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) Task per property per publish — field agent fills answers via mobile
CREATE TABLE "PropertyDetailsCheck" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "propertyId"       TEXT NOT NULL,
  "status"           "PropertyDetailsCheckStatus" NOT NULL DEFAULT 'pending',
  "assigneeUserId"   TEXT,
  "assignedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"        TIMESTAMP(3) NOT NULL,
  "fulfilledAt"      TIMESTAMP(3),
  "submittedAnswers" JSONB,
  CONSTRAINT "PropertyDetailsCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PropertyDetailsCheck_companyId_status_idx" ON "PropertyDetailsCheck"("companyId", "status");
CREATE INDEX "PropertyDetailsCheck_propertyId_status_idx" ON "PropertyDetailsCheck"("propertyId", "status");
CREATE INDEX "PropertyDetailsCheck_assigneeUserId_status_idx" ON "PropertyDetailsCheck"("assigneeUserId", "status");
CREATE INDEX "PropertyDetailsCheck_status_expiresAt_idx" ON "PropertyDetailsCheck"("status", "expiresAt");

ALTER TABLE "PropertyDetailsCheck"
  ADD CONSTRAINT "PropertyDetailsCheck_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PropertyDetailsCheck_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PropertyDetailsCheck_assigneeUserId_fkey"
  FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
