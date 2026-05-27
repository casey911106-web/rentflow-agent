-- Owner sweeps — per-owner conversation that replaces the per-property
-- availability + FAQ flows. Two new tables, two new enums.
--
-- This migration also normalizes 16 foreign-key constraints whose
-- ON DELETE / ON UPDATE behavior in the production database had drifted
-- from what the Prisma schema declares. The drift was introduced by FKs
-- created before the schema explicitly declared onDelete/onUpdate
-- semantics; Prisma defaults the relation behavior based on whether the
-- column is optional (SET NULL) or required (RESTRICT/CASCADE), but the
-- existing DB rows were created with NO ACTION (postgres default) or
-- with explicit CASCADE in a few cases.
--
-- Effect of normalizing each diverging FK:
--   PostPackage.propertyId        RESTRICT → SET NULL  (column is nullable;
--                                                       safe: nobody hard-deletes Property)
--   ScheduledChannelPost.postPackageId  CASCADE → RESTRICT
--                                                      (safe: nobody hard-deletes PostPackage)
--   CommissionSplit.dealId        CASCADE → RESTRICT  (safe: replaceSplits()
--                                                       in deals.service explicitly
--                                                       deleteMany before mutation)
--   13 others (no explicit clause → RESTRICT/CASCADE): behavior identical
--                                                      under all current code paths;
--                                                      makes the contract explicit.

-- =============================================================================
-- 1. New enums for owner sweeps.
-- =============================================================================

CREATE TYPE "OwnerSweepStatus" AS ENUM ('pending', 'in_progress', 'closed');

CREATE TYPE "OwnerSweepItemAvailability" AS ENUM ('available', 'rented', 'price_changed', 'no_answer');

-- =============================================================================
-- 2. Drop the 16 drifted FKs so we can re-add them with explicit clauses.
-- =============================================================================

ALTER TABLE "CommissionSplit" DROP CONSTRAINT "CommissionSplit_dealId_fkey";
ALTER TABLE "CostEntry" DROP CONSTRAINT "CostEntry_companyId_fkey";
ALTER TABLE "CostEntry" DROP CONSTRAINT "CostEntry_subscriptionId_fkey";
ALTER TABLE "CostSubscription" DROP CONSTRAINT "CostSubscription_companyId_fkey";
ALTER TABLE "PostAssignment" DROP CONSTRAINT "PostAssignment_assigneeUserId_fkey";
ALTER TABLE "PostAssignment" DROP CONSTRAINT "PostAssignment_companyId_fkey";
ALTER TABLE "PostAssignment" DROP CONSTRAINT "PostAssignment_postPackageId_fkey";
ALTER TABLE "PostPackage" DROP CONSTRAINT "PostPackage_propertyId_fkey";
ALTER TABLE "PostPlacement" DROP CONSTRAINT "PostPlacement_companyId_fkey";
ALTER TABLE "PostPlacement" DROP CONSTRAINT "PostPlacement_postPackageId_fkey";
ALTER TABLE "PostPlacement" DROP CONSTRAINT "PostPlacement_publisherUserId_fkey";
ALTER TABLE "ScheduledChannelPost" DROP CONSTRAINT "ScheduledChannelPost_postPackageId_fkey";
ALTER TABLE "ViewingScheduleToken" DROP CONSTRAINT "ViewingScheduleToken_companyId_fkey";
ALTER TABLE "ViewingScheduleToken" DROP CONSTRAINT "ViewingScheduleToken_leadId_fkey";
ALTER TABLE "ViewingScheduleToken" DROP CONSTRAINT "ViewingScheduleToken_propertyId_fkey";
ALTER TABLE "ViewingScheduleToken" DROP CONSTRAINT "ViewingScheduleToken_viewingId_fkey";

-- =============================================================================
-- 3. Create the owner-sweep tables (with their own FKs declared explicitly).
-- =============================================================================

CREATE TABLE "OwnerSweep" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "OwnerSweepStatus" NOT NULL DEFAULT 'pending',
    "assigneeUserId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerSweep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OwnerSweepItem" (
    "id" TEXT NOT NULL,
    "sweepId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "availability" "OwnerSweepItemAvailability",
    "rentedUntil" TIMESTAMP(3),
    "newPriceAed" DECIMAL(12,2),
    "faqAnswers" JSONB,
    "faqAllRequired" BOOLEAN NOT NULL DEFAULT false,
    "sharedAt" TIMESTAMP(3),
    "shareLinkUsed" TEXT,
    "notes" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "OwnerSweepItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OwnerSweep_companyId_ownerId_status_idx" ON "OwnerSweep"("companyId", "ownerId", "status");
CREATE INDEX "OwnerSweep_companyId_assigneeUserId_status_idx" ON "OwnerSweep"("companyId", "assigneeUserId", "status");
CREATE INDEX "OwnerSweepItem_propertyId_idx" ON "OwnerSweepItem"("propertyId");
CREATE UNIQUE INDEX "OwnerSweepItem_sweepId_propertyId_key" ON "OwnerSweepItem"("sweepId", "propertyId");

-- =============================================================================
-- 4. Re-add the 16 normalized FKs (now explicit + matching the schema).
-- =============================================================================

ALTER TABLE "PostPackage" ADD CONSTRAINT "PostPackage_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScheduledChannelPost" ADD CONSTRAINT "ScheduledChannelPost_postPackageId_fkey" FOREIGN KEY ("postPackageId") REFERENCES "PostPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostPlacement" ADD CONSTRAINT "PostPlacement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostPlacement" ADD CONSTRAINT "PostPlacement_postPackageId_fkey" FOREIGN KEY ("postPackageId") REFERENCES "PostPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostPlacement" ADD CONSTRAINT "PostPlacement_publisherUserId_fkey" FOREIGN KEY ("publisherUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "CostSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CostSubscription" ADD CONSTRAINT "CostSubscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ViewingScheduleToken" ADD CONSTRAINT "ViewingScheduleToken_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ViewingScheduleToken" ADD CONSTRAINT "ViewingScheduleToken_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ViewingScheduleToken" ADD CONSTRAINT "ViewingScheduleToken_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ViewingScheduleToken" ADD CONSTRAINT "ViewingScheduleToken_viewingId_fkey" FOREIGN KEY ("viewingId") REFERENCES "Viewing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PostAssignment" ADD CONSTRAINT "PostAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostAssignment" ADD CONSTRAINT "PostAssignment_postPackageId_fkey" FOREIGN KEY ("postPackageId") REFERENCES "PostPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PostAssignment" ADD CONSTRAINT "PostAssignment_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionSplit" ADD CONSTRAINT "CommissionSplit_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- 5. FKs for the new owner-sweep tables.
-- =============================================================================

ALTER TABLE "OwnerSweep" ADD CONSTRAINT "OwnerSweep_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OwnerSweep" ADD CONSTRAINT "OwnerSweep_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OwnerSweep" ADD CONSTRAINT "OwnerSweep_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OwnerSweepItem" ADD CONSTRAINT "OwnerSweepItem_sweepId_fkey" FOREIGN KEY ("sweepId") REFERENCES "OwnerSweep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OwnerSweepItem" ADD CONSTRAINT "OwnerSweepItem_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
