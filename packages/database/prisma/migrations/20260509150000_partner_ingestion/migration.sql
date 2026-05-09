-- Partner ingestion: external agents source properties via WhatsApp /property
-- and earn 50% of the commission once the deal closes.

-- 1. User.isPartner — flag for numbers that route to IngestionService.
ALTER TABLE "User"
  ADD COLUMN "isPartner" BOOLEAN NOT NULL DEFAULT false;

-- 2. Property — track who sourced it + which field-agent runs viewings.
ALTER TABLE "Property"
  ADD COLUMN "submittedByUserId" TEXT,
  ADD COLUMN "assignedFieldAgentId" TEXT;

ALTER TABLE "Property"
  ADD CONSTRAINT "Property_submittedByUserId_fkey"
  FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Property"
  ADD CONSTRAINT "Property_assignedFieldAgentId_fkey"
  FOREIGN KEY ("assignedFieldAgentId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Property_submittedByUserId_idx" ON "Property"("submittedByUserId");
CREATE INDEX "Property_assignedFieldAgentId_idx" ON "Property"("assignedFieldAgentId");

-- 3. Deal — accounts-receivable from partner.
ALTER TABLE "Deal"
  ADD COLUMN "partnerUserId" TEXT,
  ADD COLUMN "partnerOwesUsAed" DECIMAL(12, 2),
  ADD COLUMN "partnerSettledAt" TIMESTAMP(3);

ALTER TABLE "Deal"
  ADD CONSTRAINT "Deal_partnerUserId_fkey"
  FOREIGN KEY ("partnerUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Deal_partnerUserId_partnerSettledAt_idx" ON "Deal"("partnerUserId", "partnerSettledAt");
