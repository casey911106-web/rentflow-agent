-- Owned-channel automation support: bot-published placements + lead attribution
-- by placement (so we can tell which Telegram/IG/FB post produced a lead).

-- PostChannel: external provider ID + automated flag
ALTER TABLE "PostChannel"
  ADD COLUMN "externalId" TEXT,
  ADD COLUMN "automated" BOOLEAN NOT NULL DEFAULT false;

-- PostPlacement: caption, automated flag, external post id, tracking slug + clicks
ALTER TABLE "PostPlacement"
  ADD COLUMN "automated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "caption" TEXT,
  ADD COLUMN "externalPostId" TEXT,
  ADD COLUMN "trackingSlug" TEXT,
  ADD COLUMN "clicks" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastClickAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "PostPlacement_trackingSlug_key" ON "PostPlacement"("trackingSlug");

-- Lead: per-placement attribution
ALTER TABLE "Lead"
  ADD COLUMN "attributionPlacementId" TEXT,
  ADD COLUMN "attributionSource" TEXT;

ALTER TABLE "Lead"
  ADD CONSTRAINT "Lead_attributionPlacementId_fkey"
  FOREIGN KEY ("attributionPlacementId") REFERENCES "PostPlacement"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Lead_attributionPlacementId_idx" ON "Lead"("attributionPlacementId");
CREATE INDEX "Lead_companyId_attributionSource_idx" ON "Lead"("companyId", "attributionSource");
