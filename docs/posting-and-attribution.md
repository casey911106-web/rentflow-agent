# Posting and Attribution

## Philosophy

The Fast Posting Studio is **not** a mass-publishing tool. Its purpose is to make it dead simple for a small team (3 internal agents in MVP) to produce a publishable package per property in seconds, then track it manually.

Why manual? Because reliable, compliant automation of arbitrary Facebook Groups and WhatsApp Groups doesn't exist. Pretending otherwise causes account bans and data quality problems. See [assumptions.md](assumptions.md).

## What a post package contains

```
PostPackage {
  id: UUID
  companyId: UUID
  propertyId: UUID
  campaignId: UUID

  // generated content
  shortCaption: string         // <80 chars
  longCaption: string          // 200–500 chars
  whatsappCaption: string      // formatted for WA groups
  facebookCaption: string      // formatted for FB groups
  title: string
  priceLine: string
  availabilityLine: string
  features: string[]           // bullet points
  media: PropertyMedia[]       // photos / videos

  // tracking + attribution
  trackingLink: TrackingLink   // 1-1
  whatsappLink: string         // wa.me + prefilled text
  sourceCode: string           // e.g., RF-001
  postCode: string             // e.g., POST-AB12

  // operational
  status: PostPackageStatus
  channelId: UUID?             // PostChannel (group/page label)
  channelName: string?         // free text
  publishedByUserId: UUID?
  publishedAt: Date?
  publishedUrl: string?        // optional, if available
  approvedAt: Date?
  pausedAt: Date?
  archivedAt: Date?
}
```

## Generation pipeline

```
property_id ──▶ readiness_check ──▶ caption_gen ──▶ tracking_gen ──▶ package
                       │                  │
                       ▼                  ▼
                  block if        AI provider (mock/openai/anthropic)
                  readiness < 60  with prompt template "post_caption_v1"
```

### Readiness check (gates package generation)

A package can be generated only if `Property.readinessScore >= 60`. Below that, the API returns `409 readiness_too_low` with a list of missing items so the operator knows what to fix.

Required for readiness 60+:
- Owner linked
- Price confirmed in last 14 days
- ≥ 1 photo
- Availability confirmed in last 7 days
- Move-in date or "available now" set
- Occupancy rules set

### Caption generation

The AI provider is given a prompt template + property context. The mock provider produces deterministic captions for tests. Templates are stored in `AIPromptTemplate`.

Templates (initial):

- `post_caption_short_v1`
- `post_caption_long_v1`
- `post_caption_whatsapp_v1`
- `post_caption_facebook_v1`

Operators can edit captions before approval.

## Tracking link + click-to-chat link

A single `TrackingLink` record per package:

```
TrackingLink {
  id: UUID
  postPackageId: UUID
  sourceCode: string  // unique, e.g., RF-001
  postCode: string    // unique, e.g., POST-AB12
  shortUrl: string    // https://api/t/abc12   (redirects + records click)
  whatsappUrl: string // wa.me + prefilled
  clicks: int
  lastClickAt: Date?
}
```

The short URL goes through `GET /t/:code`, which:
1. Records a click (timestamp, IP-truncated, UA, referrer if present).
2. 302-redirects to `whatsappUrl`.

The click is **not** the lead. The lead is the inbound WhatsApp message. Clicks are useful for sanity checking funnel volume.

## Source codes

Format: `<SOURCE_CODE_PREFIX>-<n>` (default `RF-`). Generated as zero-padded sequential per company. Properties get a permanent code on creation: `RF-001`, `RF-002`, ….

Format: `<POST_CODE_PREFIX>-<base32>` (default `POST-`). Generated per package: `POST-AB12`, `POST-CD34`, …. Random 4-char Base32, retried on collision.

Both codes appear in the prefilled WhatsApp text and are parsed on the first inbound message.

## Prefilled text

```
Hi, I am interested in Property {{property_code}} from Post {{post_code}}
```

URL-encoded into `wa.me` link.

## Marking as published

After the operator manually posts in a channel, they hit "Mark as Published" with:

- `channelId` (existing `PostChannel` row) or `channelName` (free text → upserts a `PostChannel`)
- `url?` (optional Facebook post URL or screenshot reference)

This sets `PostPackageStatus.published`, stamps `publishedByUserId`, `publishedAt`.

## Attribution on inbound

Inbound parser sequence:

1. Extract `property_code` and `post_code` from message body via regex.
2. If both present and match: `Lead.postPackageId`, `Lead.propertyId`, `Lead.attributionConfidence='high'`.
3. If only `property_code` matches: `Lead.propertyId` set, `attributionConfidence='medium'`.
4. If neither: `attributionConfidence='low'`. Try fallback: `lastPostPublishedFor(any)` heuristic, or leave unattributed for the operator to manually link.

`LeadSource` records the channel/group/page name when known (taken from the PostPackage that produced the link, since the user clicked through it).

## Channel labels (PostChannel)

`PostChannel` is just a label, not an authenticated integration. Examples:

```
[
  { name: "Dubai Rooms FB Group", platform: "facebook", kind: "group" },
  { name: "JVC Bedspaces WhatsApp", platform: "whatsapp", kind: "group" },
  { name: "Marina Studios FB Page", platform: "facebook", kind: "page" }
]
```

Operators reuse channel rows so analytics group correctly.

## Pausing post packages on availability change

If `Property.status` becomes `rented` or `blocked`:

1. All `PostPackage` rows for the property where `status='published'` are auto-set to `paused` (`pausedAt` stamped).
2. A `Notification` is created for the operations manager: "Pause and remove published posts for {property_name}".

The system can't unpublish a post in a Facebook Group automatically — this notification is the cue for a human to delete or edit the live post.

## Analytics

Per post package:

- Clicks (from `TrackingLink`)
- Leads attributed (count of `Lead` with `postPackageId = pkg.id`)
- Qualified leads
- Viewings scheduled
- Deals won
- Commission collected

Per channel:

- Same rollups, grouped by `PostChannel`.

Both feed into `/analytics/posts` and the Funnel Analytics page.
