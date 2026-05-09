-- Pre-generated placement slugs (drafts) so field agents can copy a unique
-- tracking link BEFORE they post in a Facebook group, then come back to
-- confirm the channel name. Until confirmed, drafts don't count toward the
-- 3-placement minimum and don't bump the PostPackage status to 'published'.

-- 1) Allow channelName to be null while a placement is in draft state.
ALTER TABLE "PostPlacement" ALTER COLUMN "channelName" DROP NOT NULL;

-- 2) New column: timestamp of when the agent confirmed where they posted.
--    Null = draft (link copied, not yet confirmed).
--    Backfill existing rows with publishedAt so they keep counting as confirmed.
ALTER TABLE "PostPlacement" ADD COLUMN "confirmedAt" TIMESTAMP(3);
UPDATE "PostPlacement" SET "confirmedAt" = "publishedAt" WHERE "confirmedAt" IS NULL;
