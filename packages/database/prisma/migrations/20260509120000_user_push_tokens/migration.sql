-- Per-user Expo push tokens for mobile push notifications.
-- One user can have multiple devices, so we keep an array.

ALTER TABLE "User"
  ADD COLUMN "expoPushTokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
