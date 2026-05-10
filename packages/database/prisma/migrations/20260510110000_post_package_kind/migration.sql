-- Add channel-growth support to PostPackage. property_listing packages
-- keep working unchanged (default kind, propertyId still set). Future
-- channel_growth packages get propertyId=NULL and the new growth* fields.

CREATE TYPE "PostPackageKind" AS ENUM ('property_listing', 'channel_growth');

ALTER TABLE "PostPackage"
  ADD COLUMN "kind" "PostPackageKind" NOT NULL DEFAULT 'property_listing',
  ADD COLUMN "growthTargetUrl" TEXT,
  ADD COLUMN "growthTargetLabel" TEXT,
  ADD COLUMN "growthTargetKind" TEXT;

ALTER TABLE "PostPackage"
  ALTER COLUMN "propertyId" DROP NOT NULL;
