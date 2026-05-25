-- Add the "sourced by" field-agent slot on Property — the field agent who
-- found this listing direct with the owner (not via partner ingestion, which
-- is submittedByUserId). Drives the 10% sourcing bonus in the monthly
-- commission split starting June 2026.

ALTER TABLE "Property"
  ADD COLUMN "sourcedByFieldAgentId" TEXT;

ALTER TABLE "Property"
  ADD CONSTRAINT "Property_sourcedByFieldAgentId_fkey"
  FOREIGN KEY ("sourcedByFieldAgentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Query lookup: "give me every property this agent sourced in a given window"
-- powers both the property card filter and the monthly sourcing leaderboard.
CREATE INDEX "Property_sourcedByFieldAgentId_idx" ON "Property"("sourcedByFieldAgentId");
