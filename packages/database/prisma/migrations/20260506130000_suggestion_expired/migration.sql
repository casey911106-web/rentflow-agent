-- Add 'expired' to SuggestionStatus so the auto-expiry cron can mark
-- pending suggestions older than 24h without overloading 'cancelled'
-- (which means an operator deliberately rejected the reply).

ALTER TYPE "SuggestionStatus" ADD VALUE 'expired';
