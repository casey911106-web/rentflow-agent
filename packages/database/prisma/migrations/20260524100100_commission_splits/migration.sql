-- CommissionSplit: per-recipient split of a Deal's commission. Platform share
-- is one row with recipientUserId = NULL + label = 'Platform'. Sum of percents
-- per deal is enforced at write-time in the service to equal exactly 100.

CREATE TABLE "CommissionSplit" (
  "id"              TEXT          PRIMARY KEY,
  "companyId"       TEXT          NOT NULL,
  "dealId"          TEXT          NOT NULL,
  "recipientUserId" TEXT,
  "label"           TEXT          NOT NULL,
  "percent"         DECIMAL(5, 2) NOT NULL,
  "paidAt"          TIMESTAMP(3),
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "CommissionSplit_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommissionSplit_dealId_fkey"
    FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommissionSplit_recipientUserId_fkey"
    FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "CommissionSplit_dealId_idx"          ON "CommissionSplit"("dealId");
CREATE INDEX "CommissionSplit_companyId_idx"       ON "CommissionSplit"("companyId");
CREATE INDEX "CommissionSplit_recipientUserId_idx" ON "CommissionSplit"("recipientUserId");
