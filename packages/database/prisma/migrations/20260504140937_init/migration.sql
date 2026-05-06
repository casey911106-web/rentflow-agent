-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'invited', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('super_admin', 'ops_manager', 'field_agent');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('bed_space', 'shared_room', 'partition', 'master_room', 'studio', 'one_bedroom', 'two_bedroom', 'three_bedroom', 'villa', 'other');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('draft', 'available', 'pending_owner_confirmation', 'rented', 'blocked', 'unavailable', 'archived', 'needs_media', 'needs_price_confirmation', 'not_ready_to_post');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'contacted', 'qualifying', 'qualified', 'options_sent', 'viewing_requested', 'viewing_scheduled', 'viewing_completed', 'negotiating', 'won', 'lost', 'cold', 'opted_out');

-- CreateEnum
CREATE TYPE "LeadTemperature" AS ENUM ('hot', 'warm', 'cold', 'unqualified');

-- CreateEnum
CREATE TYPE "AttributionConfidence" AS ENUM ('high', 'medium', 'low', 'none');

-- CreateEnum
CREATE TYPE "ViewingStatus" AS ENUM ('requested', 'confirmed', 'assigned', 'rescheduled', 'cancelled', 'no_show', 'completed', 'converted', 'lost');

-- CreateEnum
CREATE TYPE "PostPackageStatus" AS ENUM ('draft', 'generated', 'scheduled', 'pending_approval', 'approved', 'published', 'failed', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "OwnerAvailabilityStatus" AS ENUM ('available', 'unavailable', 'rented', 'blocked_until_date', 'pending_response', 'needs_clarification');

-- CreateEnum
CREATE TYPE "ConversationMode" AS ENUM ('ai', 'human_takeover', 'paused', 'closed');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('open', 'negotiating', 'won', 'lost', 'cancelled');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('expected', 'invoiced', 'partially_collected', 'collected', 'waived', 'lost');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'partially_paid', 'paid', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "AgentAssignmentStatus" AS ENUM ('pending', 'accepted', 'declined', 'completed');

-- CreateEnum
CREATE TYPE "PropertyIssueType" AS ENUM ('unavailable_when_expected', 'dirty', 'access_problem', 'price_changed', 'owner_not_responding', 'wrong_media', 'client_complaint', 'maintenance_issue', 'other');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('text', 'image', 'video', 'document', 'template', 'system');

-- CreateEnum
CREATE TYPE "ChannelPlatform" AS ENUM ('facebook', 'whatsapp', 'instagram', 'telegram', 'referral', 'direct', 'other');

-- CreateEnum
CREATE TYPE "ChannelKind" AS ENUM ('group', 'page', 'channel', 'individual', 'unknown');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('info', 'warning', 'error', 'success', 'action_required');

-- CreateEnum
CREATE TYPE "AutomationTriggerType" AS ENUM ('schedule', 'event', 'manual');

-- CreateEnum
CREATE TYPE "ScoreKind" AS ENUM ('quality', 'readiness');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'AE',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dubai',
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneE164" TEXT,
    "role" "RoleName" NOT NULL DEFAULT 'ops_manager',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationToken" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT,
    "encryptedValue" TEXT NOT NULL,
    "metadata" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "source" TEXT NOT NULL,
    "signatureOk" BOOLEAN NOT NULL,
    "rawBody" JSONB NOT NULL,
    "headers" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" "RoleName",
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "diff" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileUpload" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "bucket" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "originalName" TEXT,
    "ownerEntityType" TEXT,
    "ownerEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "email" TEXT,
    "notes" TEXT,
    "trustScore" INTEGER NOT NULL DEFAULT 50,
    "responseRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastContactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerMessage" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'text',
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerAvailabilityCheck" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "status" "OwnerAvailabilityStatus" NOT NULL DEFAULT 'pending_response',
    "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repliedAt" TIMESTAMP(3),
    "parsedReply" JSONB,
    "rawReply" TEXT,
    "nextCheckAt" TIMESTAMP(3),

    CONSTRAINT "OwnerAvailabilityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerScoreSnapshot" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "factors" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ownerId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PropertyType" NOT NULL,
    "status" "PropertyStatus" NOT NULL DEFAULT 'draft',
    "area" TEXT,
    "addressLine" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "priceAed" DECIMAL(12,2),
    "depositAed" DECIMAL(12,2),
    "commissionPolicy" TEXT,
    "description" TEXT,
    "occupancyMax" INTEGER,
    "rentalMinMonths" INTEGER,
    "amenities" JSONB,
    "viewingAccess" TEXT,
    "moveInDate" TIMESTAMP(3),
    "rentedUntil" TIMESTAMP(3),
    "priceConfirmedAt" TIMESTAMP(3),
    "availabilityConfirmedAt" TIMESTAMP(3),
    "qualityScore" INTEGER NOT NULL DEFAULT 50,
    "readinessScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyMedia" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "fileUploadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "caption" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyAvailabilityBlock" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyAvailabilityBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyCalendarEvent" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyIssue" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reportedById" TEXT,
    "type" "PropertyIssueType" NOT NULL,
    "description" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyScoreSnapshot" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" "ScoreKind" NOT NULL,
    "score" INTEGER NOT NULL,
    "factors" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldAgent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "preferredAreas" JSONB,
    "performanceScore" INTEGER NOT NULL DEFAULT 50,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAvailability" (
    "id" TEXT NOT NULL,
    "fieldAgentId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPerformanceSnapshot" (
    "id" TEXT NOT NULL,
    "fieldAgentId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "factors" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPerformanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "propertyId" TEXT,
    "postPackageId" TEXT,
    "trackingLinkId" TEXT,
    "campaignId" TEXT,
    "sourceId" TEXT,
    "whatsappConversationId" TEXT,
    "fullName" TEXT,
    "phoneE164" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "temperature" "LeadTemperature" NOT NULL DEFAULT 'unqualified',
    "qualificationScore" INTEGER NOT NULL DEFAULT 0,
    "attributionConfidence" "AttributionConfidence" NOT NULL DEFAULT 'none',
    "budgetAed" DECIMAL(12,2),
    "preferredArea" TEXT,
    "peopleCount" INTEGER,
    "moveInDate" TIMESTAMP(3),
    "rentalDurationMonths" INTEGER,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInteractionAt" TIMESTAMP(3),
    "lastFollowUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSource" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channel" "ChannelPlatform" NOT NULL,
    "channelKind" "ChannelKind",
    "channelName" TEXT,
    "campaignName" TEXT,
    "postCode" TEXT,
    "sourceCode" TEXT,
    "groupOrPage" TEXT,
    "publishedById" TEXT,
    "rawText" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "channel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppConversation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadPhoneE164" TEXT NOT NULL,
    "ownerPhoneE164" TEXT,
    "mode" "ConversationMode" NOT NULL DEFAULT 'ai',
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "externalId" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'text',
    "body" TEXT,
    "mediaUrl" TEXT,
    "templateName" TEXT,
    "templateVars" JSONB,
    "providerStatus" TEXT,
    "providerError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAgentSession" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT,
    "conversationId" TEXT,
    "machine" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "contextJson" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "AIAgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIPromptTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "machine" TEXT NOT NULL,
    "state" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "template" TEXT NOT NULL,
    "variables" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIPromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostChannel" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "ChannelPlatform" NOT NULL,
    "kind" "ChannelKind" NOT NULL DEFAULT 'unknown',
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostPackage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "campaignId" TEXT,
    "channelId" TEXT,
    "status" "PostPackageStatus" NOT NULL DEFAULT 'draft',
    "title" TEXT,
    "shortCaption" TEXT,
    "longCaption" TEXT,
    "whatsappCaption" TEXT,
    "facebookCaption" TEXT,
    "priceLine" TEXT,
    "availabilityLine" TEXT,
    "features" JSONB,
    "channelName" TEXT,
    "publishedUrl" TEXT,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PostPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "postPackageId" TEXT NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "postCode" TEXT NOT NULL,
    "shortUrl" TEXT NOT NULL,
    "whatsappUrl" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "lastClickAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Viewing" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "fieldAgentId" TEXT,
    "status" "ViewingStatus" NOT NULL DEFAULT 'requested',
    "assignmentStatus" "AgentAssignmentStatus" NOT NULL DEFAULT 'pending',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "arrivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "outcomeNotes" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Viewing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViewingFeedback" (
    "id" TEXT NOT NULL,
    "viewingId" TEXT NOT NULL,
    "rating" INTEGER,
    "comments" TEXT,
    "bookingIntent" TEXT,
    "raisedIssues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewingFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "fieldAgentId" TEXT,
    "status" "DealStatus" NOT NULL DEFAULT 'open',
    "rentAmount" DECIMAL(12,2),
    "depositAmount" DECIMAL(12,2),
    "commissionAmount" DECIMAL(12,2),
    "commissionPaidBy" TEXT,
    "moveInDate" TIMESTAMP(3),
    "rentalDurationMonths" INTEGER,
    "closedAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'expected',
    "expectedAmount" DECIMAL(12,2) NOT NULL,
    "invoicedAmount" DECIMAL(12,2),
    "collectedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "invoicedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL,
    "commissionId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "method" TEXT,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" "AutomationTriggerType" NOT NULL,
    "triggerKey" TEXT NOT NULL,
    "conditions" JSONB,
    "actions" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationJob" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "runAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "NotificationKind" NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE INDEX "Company_slug_idx" ON "Company"("slug");

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "User_companyId_email_key" ON "User"("companyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "AppSetting_companyId_idx" ON "AppSetting"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_companyId_key_key" ON "AppSetting"("companyId", "key");

-- CreateIndex
CREATE INDEX "IntegrationToken_companyId_idx" ON "IntegrationToken"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationToken_companyId_provider_label_key" ON "IntegrationToken"("companyId", "provider", "label");

-- CreateIndex
CREATE INDEX "WebhookLog_source_receivedAt_idx" ON "WebhookLog"("source", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookLog_companyId_idx" ON "WebhookLog"("companyId");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "FileUpload_companyId_idx" ON "FileUpload"("companyId");

-- CreateIndex
CREATE INDEX "FileUpload_ownerEntityType_ownerEntityId_idx" ON "FileUpload"("ownerEntityType", "ownerEntityId");

-- CreateIndex
CREATE INDEX "Owner_companyId_idx" ON "Owner"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Owner_companyId_phoneE164_key" ON "Owner"("companyId", "phoneE164");

-- CreateIndex
CREATE INDEX "OwnerMessage_ownerId_createdAt_idx" ON "OwnerMessage"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "OwnerAvailabilityCheck_companyId_askedAt_idx" ON "OwnerAvailabilityCheck"("companyId", "askedAt");

-- CreateIndex
CREATE INDEX "OwnerAvailabilityCheck_ownerId_idx" ON "OwnerAvailabilityCheck"("ownerId");

-- CreateIndex
CREATE INDEX "OwnerAvailabilityCheck_propertyId_idx" ON "OwnerAvailabilityCheck"("propertyId");

-- CreateIndex
CREATE INDEX "OwnerScoreSnapshot_ownerId_createdAt_idx" ON "OwnerScoreSnapshot"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Property_companyId_status_idx" ON "Property"("companyId", "status");

-- CreateIndex
CREATE INDEX "Property_ownerId_idx" ON "Property"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Property_companyId_code_key" ON "Property"("companyId", "code");

-- CreateIndex
CREATE INDEX "PropertyMedia_propertyId_idx" ON "PropertyMedia"("propertyId");

-- CreateIndex
CREATE INDEX "PropertyAvailabilityBlock_propertyId_startsAt_idx" ON "PropertyAvailabilityBlock"("propertyId", "startsAt");

-- CreateIndex
CREATE INDEX "PropertyCalendarEvent_propertyId_startsAt_idx" ON "PropertyCalendarEvent"("propertyId", "startsAt");

-- CreateIndex
CREATE INDEX "PropertyIssue_propertyId_createdAt_idx" ON "PropertyIssue"("propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "PropertyScoreSnapshot_propertyId_kind_createdAt_idx" ON "PropertyScoreSnapshot"("propertyId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FieldAgent_userId_key" ON "FieldAgent"("userId");

-- CreateIndex
CREATE INDEX "FieldAgent_companyId_idx" ON "FieldAgent"("companyId");

-- CreateIndex
CREATE INDEX "AgentAvailability_fieldAgentId_startsAt_idx" ON "AgentAvailability"("fieldAgentId", "startsAt");

-- CreateIndex
CREATE INDEX "AgentPerformanceSnapshot_fieldAgentId_createdAt_idx" ON "AgentPerformanceSnapshot"("fieldAgentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_sourceId_key" ON "Lead"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_whatsappConversationId_key" ON "Lead"("whatsappConversationId");

-- CreateIndex
CREATE INDEX "Lead_companyId_status_idx" ON "Lead"("companyId", "status");

-- CreateIndex
CREATE INDEX "Lead_companyId_temperature_idx" ON "Lead"("companyId", "temperature");

-- CreateIndex
CREATE INDEX "Lead_companyId_createdAt_idx" ON "Lead"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_propertyId_idx" ON "Lead"("propertyId");

-- CreateIndex
CREATE INDEX "Lead_postPackageId_idx" ON "Lead"("postPackageId");

-- CreateIndex
CREATE INDEX "Lead_phoneE164_idx" ON "Lead"("phoneE164");

-- CreateIndex
CREATE INDEX "LeadSource_companyId_channel_idx" ON "LeadSource"("companyId", "channel");

-- CreateIndex
CREATE INDEX "LeadMessage_leadId_createdAt_idx" ON "LeadMessage"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_companyId_leadPhoneE164_idx" ON "WhatsAppConversation"("companyId", "leadPhoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_externalId_key" ON "WhatsAppMessage"("externalId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_conversationId_createdAt_idx" ON "WhatsAppMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AIAgentSession_companyId_machine_state_idx" ON "AIAgentSession"("companyId", "machine", "state");

-- CreateIndex
CREATE INDEX "AIAgentSession_leadId_idx" ON "AIAgentSession"("leadId");

-- CreateIndex
CREATE INDEX "AIAgentSession_conversationId_idx" ON "AIAgentSession"("conversationId");

-- CreateIndex
CREATE INDEX "AIPromptTemplate_companyId_machine_idx" ON "AIPromptTemplate"("companyId", "machine");

-- CreateIndex
CREATE UNIQUE INDEX "AIPromptTemplate_companyId_machine_state_version_key" ON "AIPromptTemplate"("companyId", "machine", "state", "version");

-- CreateIndex
CREATE INDEX "Campaign_companyId_idx" ON "Campaign"("companyId");

-- CreateIndex
CREATE INDEX "PostChannel_companyId_idx" ON "PostChannel"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PostChannel_companyId_platform_name_key" ON "PostChannel"("companyId", "platform", "name");

-- CreateIndex
CREATE INDEX "PostPackage_companyId_status_idx" ON "PostPackage"("companyId", "status");

-- CreateIndex
CREATE INDEX "PostPackage_propertyId_idx" ON "PostPackage"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingLink_postPackageId_key" ON "TrackingLink"("postPackageId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingLink_sourceCode_key" ON "TrackingLink"("sourceCode");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingLink_postCode_key" ON "TrackingLink"("postCode");

-- CreateIndex
CREATE INDEX "TrackingLink_companyId_idx" ON "TrackingLink"("companyId");

-- CreateIndex
CREATE INDEX "Viewing_companyId_scheduledAt_idx" ON "Viewing"("companyId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Viewing_companyId_status_idx" ON "Viewing"("companyId", "status");

-- CreateIndex
CREATE INDEX "Viewing_fieldAgentId_scheduledAt_idx" ON "Viewing"("fieldAgentId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Viewing_leadId_idx" ON "Viewing"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "ViewingFeedback_viewingId_key" ON "ViewingFeedback"("viewingId");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_leadId_key" ON "Deal"("leadId");

-- CreateIndex
CREATE INDEX "Deal_companyId_status_idx" ON "Deal"("companyId", "status");

-- CreateIndex
CREATE INDEX "Deal_propertyId_idx" ON "Deal"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_dealId_key" ON "Commission"("dealId");

-- CreateIndex
CREATE INDEX "AutomationRule_companyId_active_idx" ON "AutomationRule"("companyId", "active");

-- CreateIndex
CREATE INDEX "AutomationJob_ruleId_status_idx" ON "AutomationJob"("ruleId", "status");

-- CreateIndex
CREATE INDEX "AutomationJob_runAt_idx" ON "AutomationJob"("runAt");

-- CreateIndex
CREATE INDEX "Notification_companyId_userId_readAt_idx" ON "Notification"("companyId", "userId", "readAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationToken" ADD CONSTRAINT "IntegrationToken_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileUpload" ADD CONSTRAINT "FileUpload_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileUpload" ADD CONSTRAINT "FileUpload_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Owner" ADD CONSTRAINT "Owner_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerMessage" ADD CONSTRAINT "OwnerMessage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerAvailabilityCheck" ADD CONSTRAINT "OwnerAvailabilityCheck_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerAvailabilityCheck" ADD CONSTRAINT "OwnerAvailabilityCheck_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerAvailabilityCheck" ADD CONSTRAINT "OwnerAvailabilityCheck_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerScoreSnapshot" ADD CONSTRAINT "OwnerScoreSnapshot_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyMedia" ADD CONSTRAINT "PropertyMedia_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyMedia" ADD CONSTRAINT "PropertyMedia_fileUploadId_fkey" FOREIGN KEY ("fileUploadId") REFERENCES "FileUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyAvailabilityBlock" ADD CONSTRAINT "PropertyAvailabilityBlock_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyCalendarEvent" ADD CONSTRAINT "PropertyCalendarEvent_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyIssue" ADD CONSTRAINT "PropertyIssue_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyScoreSnapshot" ADD CONSTRAINT "PropertyScoreSnapshot_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldAgent" ADD CONSTRAINT "FieldAgent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldAgent" ADD CONSTRAINT "FieldAgent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAvailability" ADD CONSTRAINT "AgentAvailability_fieldAgentId_fkey" FOREIGN KEY ("fieldAgentId") REFERENCES "FieldAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPerformanceSnapshot" ADD CONSTRAINT "AgentPerformanceSnapshot_fieldAgentId_fkey" FOREIGN KEY ("fieldAgentId") REFERENCES "FieldAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_postPackageId_fkey" FOREIGN KEY ("postPackageId") REFERENCES "PostPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_trackingLinkId_fkey" FOREIGN KEY ("trackingLinkId") REFERENCES "TrackingLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_whatsappConversationId_fkey" FOREIGN KEY ("whatsappConversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSource" ADD CONSTRAINT "LeadSource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMessage" ADD CONSTRAINT "LeadMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMessage" ADD CONSTRAINT "LeadMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAgentSession" ADD CONSTRAINT "AIAgentSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAgentSession" ADD CONSTRAINT "AIAgentSession_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAgentSession" ADD CONSTRAINT "AIAgentSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIPromptTemplate" ADD CONSTRAINT "AIPromptTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostChannel" ADD CONSTRAINT "PostChannel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostPackage" ADD CONSTRAINT "PostPackage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostPackage" ADD CONSTRAINT "PostPackage_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostPackage" ADD CONSTRAINT "PostPackage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostPackage" ADD CONSTRAINT "PostPackage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "PostChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostPackage" ADD CONSTRAINT "PostPackage_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostPackage" ADD CONSTRAINT "PostPackage_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_postPackageId_fkey" FOREIGN KEY ("postPackageId") REFERENCES "PostPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Viewing" ADD CONSTRAINT "Viewing_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Viewing" ADD CONSTRAINT "Viewing_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Viewing" ADD CONSTRAINT "Viewing_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Viewing" ADD CONSTRAINT "Viewing_fieldAgentId_fkey" FOREIGN KEY ("fieldAgentId") REFERENCES "FieldAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewingFeedback" ADD CONSTRAINT "ViewingFeedback_viewingId_fkey" FOREIGN KEY ("viewingId") REFERENCES "Viewing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_fieldAgentId_fkey" FOREIGN KEY ("fieldAgentId") REFERENCES "FieldAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationJob" ADD CONSTRAINT "AutomationJob_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
