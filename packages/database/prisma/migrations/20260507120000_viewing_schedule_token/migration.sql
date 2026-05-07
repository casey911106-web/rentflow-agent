-- One-shot tokens issued by the AI agent / operator so the lead can book or
-- reschedule a viewing through the public scheduler page without leaving
-- WhatsApp (the link round-trips through the browser back to a confirmation
-- WA message).

CREATE TABLE "ViewingScheduleToken" (
    "id"          TEXT PRIMARY KEY,
    "companyId"   TEXT NOT NULL,
    "leadId"      TEXT NOT NULL,
    "propertyId"  TEXT NOT NULL,
    "viewingId"   TEXT,
    "expiresAt"   TIMESTAMP(3) NOT NULL,
    "usedAt"      TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewingScheduleToken_companyId_fkey"  FOREIGN KEY ("companyId")  REFERENCES "Company"("id"),
    CONSTRAINT "ViewingScheduleToken_leadId_fkey"     FOREIGN KEY ("leadId")     REFERENCES "Lead"("id"),
    CONSTRAINT "ViewingScheduleToken_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id"),
    CONSTRAINT "ViewingScheduleToken_viewingId_fkey"  FOREIGN KEY ("viewingId")  REFERENCES "Viewing"("id")
);
CREATE INDEX "ViewingScheduleToken_companyId_leadId_idx" ON "ViewingScheduleToken"("companyId", "leadId");
CREATE INDEX "ViewingScheduleToken_viewingId_idx"        ON "ViewingScheduleToken"("viewingId");
