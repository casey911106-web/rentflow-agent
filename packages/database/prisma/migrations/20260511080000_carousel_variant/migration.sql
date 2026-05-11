-- Per-placement IG carousel variant index (0..3). Lets us rotate hook
-- styles across auto-publishes so consecutive posts for the same
-- property don't look identical. Null on non-IG placements.
ALTER TABLE "PostPlacement" ADD COLUMN "carouselVariant" INTEGER;
