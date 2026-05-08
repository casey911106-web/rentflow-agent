-- Cost-tracking ledger for the MVP. CostSubscription is recurring fixed
-- spend; CostEntry is one row per actual incurred cost (auto from Anthropic
-- + WhatsApp usage daily, plus pro-rata from subscriptions, plus manual).

CREATE TABLE "CostSubscription" (
    "id"         TEXT PRIMARY KEY,
    "companyId"  TEXT NOT NULL,
    "label"      TEXT NOT NULL,
    "kind"       TEXT NOT NULL,
    "amountAed"  DECIMAL(12,2) NOT NULL,
    "cadence"    TEXT NOT NULL,
    "startsAt"   TIMESTAMP(3) NOT NULL,
    "endsAt"     TIMESTAMP(3),
    "active"     BOOLEAN NOT NULL DEFAULT true,
    "notes"      TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostSubscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id")
);
CREATE INDEX "CostSubscription_companyId_active_idx" ON "CostSubscription"("companyId","active");

CREATE TABLE "CostEntry" (
    "id"             TEXT PRIMARY KEY,
    "companyId"      TEXT NOT NULL,
    "kind"           TEXT NOT NULL,
    "label"          TEXT NOT NULL,
    "amountAed"      DECIMAL(12,2) NOT NULL,
    "amountUsd"      DECIMAL(12,2),
    "subscriptionId" TEXT,
    "sourceType"     TEXT,
    "metadata"       JSONB,
    "incurredAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostEntry_companyId_fkey"      FOREIGN KEY ("companyId")      REFERENCES "Company"("id"),
    CONSTRAINT "CostEntry_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "CostSubscription"("id")
);
CREATE INDEX "CostEntry_companyId_kind_incurredAt_idx" ON "CostEntry"("companyId","kind","incurredAt");
CREATE INDEX "CostEntry_subscriptionId_idx" ON "CostEntry"("subscriptionId");
