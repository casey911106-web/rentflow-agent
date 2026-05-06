# Database Schema

PostgreSQL 16+ via Prisma ORM. UUID v4 primary keys. UTC timestamps. Soft delete (`deletedAt`) where appropriate.

Source of truth: [`packages/database/prisma/schema.prisma`](../packages/database/prisma/schema.prisma).

## Conventions

- All aggregate roots include `companyId` (tenant scope).
- Every entity has `createdAt`, `updatedAt`.
- Soft-deletable entities have `deletedAt` (nullable).
- Money is stored as `Decimal(12,2)` in AED unless documented otherwise.
- Phone numbers are stored in E.164 format.

## Entity catalog (41)

### Tenancy + identity

| Entity | Purpose |
| --- | --- |
| `Company` | Tenant root. |
| `User` | A real human user — Super Admin / Ops Manager / Field Agent. |
| `Role` | Named role with permission set. |
| `Permission` | Granular permission, attached to roles. |
| `AppSetting` | Per-tenant config (default WhatsApp number, hours, etc.). |
| `IntegrationToken` | Encrypted credentials for WhatsApp / S3 / AI providers. |
| `WebhookLog` | Inbound webhook receipts for replay/debug. |
| `AuditLog` | Append-only mutation trail. |
| `FileUpload` | Uploaded media reference (S3 key, MIME, size, owner entity). |

### Inventory + owners

| Entity | Purpose |
| --- | --- |
| `Owner` | Property owner; communicates via WhatsApp in MVP. |
| `OwnerMessage` | Outbound/inbound messages with the owner. |
| `OwnerAvailabilityCheck` | One scheduled check + parsed reply. |
| `OwnerScoreSnapshot` | Trust score over time. |
| `Property` | Rentable space (bed, room, studio, apartment, villa). |
| `PropertyMedia` | Photos/videos linked to a property. |
| `PropertyAvailabilityBlock` | Date ranges where a property is blocked/rented. |
| `PropertyCalendarEvent` | Calendar entries (rented, blocked, viewing). |
| `PropertyIssue` | Field-agent or operator-reported issue. |
| `PropertyScoreSnapshot` | Quality + readiness scores over time. |

### Field agents

| Entity | Purpose |
| --- | --- |
| `FieldAgent` | Profile attached to a `User` (when role = field_agent). |
| `AgentAvailability` | Availability windows (per day/time). |
| `AgentPerformanceSnapshot` | Performance score over time. |

### Leads + conversations

| Entity | Purpose |
| --- | --- |
| `Lead` | Central conversion entity. |
| `LeadSource` | Origin metadata (channel, post, page/group name). |
| `LeadMessage` | Internal log of lead-related messages (denormalized for CRM). |
| `WhatsAppConversation` | Per-(lead × number) conversation thread. |
| `WhatsAppMessage` | Each WhatsApp message (inbound or outbound). |
| `AIAgentSession` | Active state-machine instance for a conversation. |
| `AIPromptTemplate` | Versioned prompt template, editable in DB. |

### Posting + attribution

| Entity | Purpose |
| --- | --- |
| `Campaign` | A grouping of post packages with a goal. |
| `PostPackage` | Generated content + tracking + status. |
| `PostChannel` | A channel (Facebook group, WhatsApp group, etc.) — labeled, not authenticated. |
| `TrackingLink` | Source code, post code, click counters. |

### Operations: viewings, deals, money

| Entity | Purpose |
| --- | --- |
| `Viewing` | A scheduled viewing of a property by a lead, executed by an agent. |
| `ViewingFeedback` | Post-viewing feedback from the lead. |
| `Deal` | Closed (or attempted) deal tied to a lead + property + agent. |
| `Commission` | Expected/collected commission for a deal. |
| `PaymentRecord` | A single payment toward commission. |

### Automation + notifications

| Entity | Purpose |
| --- | --- |
| `AutomationRule` | Trigger + condition + action. |
| `AutomationJob` | A queued execution of a rule. |
| `Notification` | In-app notification for a user. |

## ER diagram (logical)

```
Company 1───* User
Company 1───* Property *───1 Owner
Property 1───* PropertyMedia
Property 1───* PropertyAvailabilityBlock
Property 1───* PropertyCalendarEvent
Property 1───* PropertyIssue
Property 1───* PropertyScoreSnapshot

Owner 1───* OwnerMessage
Owner 1───* OwnerAvailabilityCheck
Owner 1───* OwnerScoreSnapshot

User 1───0..1 FieldAgent
FieldAgent 1───* AgentAvailability
FieldAgent 1───* AgentPerformanceSnapshot

Property 1───* PostPackage *───1 Campaign
PostPackage 1───1 TrackingLink
PostPackage *───1 PostChannel

TrackingLink 1───* Lead
Property 1───* Lead
Lead 1───1 LeadSource
Lead 1───1 WhatsAppConversation 1───* WhatsAppMessage
Lead 1───* LeadMessage
Lead 1───* AIAgentSession
Lead 1───* Viewing
Viewing *───1 FieldAgent
Viewing 1───0..1 ViewingFeedback
Lead 1───0..1 Deal 1───0..1 Commission 1───* PaymentRecord

Company 1───* AutomationRule 1───* AutomationJob
Company 1───* Notification
Company 1───* AppSetting
Company 1───* IntegrationToken
Company 1───* AuditLog
Company 1───* FileUpload
Company 1───* WebhookLog
Company 1───* AIPromptTemplate
```

## Indexing strategy (highlights)

- `Lead`: `(companyId, status)`, `(companyId, temperature)`, `(companyId, createdAt)`, `(propertyId)`, `(postPackageId)`.
- `Viewing`: `(companyId, scheduledAt)`, `(companyId, status)`, `(fieldAgentId, scheduledAt)`.
- `Property`: `(companyId, status)`, `(ownerId)`.
- `WhatsAppMessage`: `(conversationId, createdAt)`, unique `(externalId)`.
- `TrackingLink`: unique `(sourceCode)`, unique `(postCode)`.
- `AuditLog`: `(companyId, createdAt)`, `(entityType, entityId, createdAt)`.

## Soft delete vs hard delete

| Behavior      | Entities |
| ------------- | -------- |
| Soft delete   | Property, Owner, User, Lead, Deal, PostPackage, FieldAgent |
| Hard delete   | LogPlists / WebhookLog (with TTL retention), AutomationJob, Notification (older than 30d) |

## Money

- AED only in MVP.
- `Decimal(12,2)` for rent_amount, deposit_amount, commission_amount.
- Stored without currency code; UI labels as AED.
- Multi-currency is a Phase 2+ concern.

## Time

- Storage: UTC `timestamptz`.
- API: ISO 8601 UTC.
- UI: Asia/Dubai (UTC+4) display.
