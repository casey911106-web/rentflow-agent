# WhatsApp Integration

The system uses WhatsApp Business Cloud API as the messaging channel for the configured business number.

## Default business number

| Format | Value |
| ------ | ----- |
| Local UAE | `058 506 3316` |
| E.164 | `+971585063316` |
| Click-to-chat base | `https://wa.me/971585063316` |

These are seeded into `AppSetting` on tenant bootstrap and exposed via env vars (`WHATSAPP_BUSINESS_PHONE_*`). The number can be overridden per tenant via the admin Settings UI.

## Adapter pattern

```
packages/integrations/src/whatsapp
├── adapter.interface.ts     // WhatsAppAdapter
├── cloud-api.adapter.ts     // Real (Meta Cloud API)
├── mock.adapter.ts          // Local + tests
└── factory.ts               // Selected by WHATSAPP_ADAPTER env
```

`WhatsAppAdapter` interface:

```ts
export interface WhatsAppAdapter {
  sendText(opts: { to: string; body: string; conversationId: string }): Promise<SendResult>;
  sendTemplate(opts: { to: string; template: TemplateRef; variables: Record<string, string>; conversationId: string }): Promise<SendResult>;
  sendMedia(opts: { to: string; type: 'image' | 'video' | 'document'; mediaUrl: string; caption?: string; conversationId: string }): Promise<SendResult>;
  verifyWebhookSignature(headers: Record<string, string>, rawBody: Buffer): boolean;
  parseInbound(payload: unknown): InboundMessage[];
}
```

## Inbound flow

```
Meta Cloud API ──HTTPS POST──▶ /webhooks/whatsapp
                                       │
                                       ▼
                          1. Verify signature (X-Hub-Signature-256)
                          2. Persist WebhookLog (raw, encrypted at rest)
                          3. Enqueue BullMQ: whatsapp-inbound
                                       │
                                       ▼
                              InboundRouter (worker)
                                       │
              ┌────────────────────────┼─────────────────────────┐
              ▼                        ▼                         ▼
     New conversation?          Existing lead?             Owner number?
     - Parse source_code        - Append message           - Resume OwnerConversation
     - Parse post_code          - Resume LeadConversation
     - Create Lead + Conv
     - Start LeadConversation
```

## Outbound flow

Messages are always sent through the adapter. Two send modes:

1. **Session message** — within 24h of the user's last inbound. Free-form text/media allowed.
2. **Template message** — required outside the 24h window. Templates are pre-approved with Meta.

The adapter enforces the rule: if `lastInboundAt` is older than 24h, plain `sendText` throws and the caller must use `sendTemplate`.

## Required templates

| Name | Category | Variables | Purpose |
|------|----------|-----------|---------|
| `availability_check_v1` | utility | `{{1}}=owner_name, {{2}}=property_name` | Daily owner availability |
| `viewing_reminder_24h_v1` | utility | `{{1}}=property_name, {{2}}=viewing_time` | T-24h reminder |
| `viewing_reminder_2h_v1` | utility | `{{1}}=property_name, {{2}}=viewing_time, {{3}}=agent_name` | T-2h reminder |
| `feedback_request_v1` | utility | `{{1}}=property_name` | T+2h feedback ask |
| `lead_followup_3h_v1` | utility | `{{1}}=property_name` | First follow-up if silent |

Approval flow with Meta is documented in the operator runbook. Templates must be re-submitted when wording changes.

## Webhook verification

`GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...` returns the challenge if `verify_token` matches `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.

`POST /webhooks/whatsapp` validates `X-Hub-Signature-256` against `WHATSAPP_APP_SECRET`. Mismatched signatures → `401`.

In dev (mock adapter), signature checks are disabled.

## Click-to-chat link generation

Every published `PostPackage` produces a click-to-chat URL:

```
{{WA_BASE}}?text={{urlencode(prefilled_text)}}
```

`prefilled_text` template:

```
Hi, I am interested in Property {{property_code}} from Post {{post_code}}
```

The codes are short, opaque IDs (e.g., `RF-001`, `POST-AB12`). When the lead sends the prefilled message, the inbound parser extracts both via regex:

```
/Property\s+(?<property>[A-Z0-9-]+)/i
/Post\s+(?<post>[A-Z0-9-]+)/i
```

If the lead edits the prefilled text away, attribution falls back to `lastPostPublishedFor(propertyId)` with `Lead.attributionConfidence='low'`.

## Opt-out handling

`WhatsAppMessage` content is checked against opt-out keywords on receive. Keywords are configurable per tenant (`AppSetting.optOutKeywords`). Default list: `STOP`, `UNSUBSCRIBE`, `لا تراسلني`. On match:

1. Set `Lead.status = opted_out`.
2. Set `WhatsAppConversation.mode = closed`.
3. Block all future outbound messages to that number until manually re-enabled.

## Local development

The mock adapter is the default. To simulate inbound messages:

```bash
curl -X POST http://localhost:3001/whatsapp/mock/inbound \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+971501234567",
    "text": "Hi, I am interested in Property RF-001 from Post POST-AB12",
    "messageId": "wamid.MOCK_001"
  }'
```

The mock outbound stores sent messages in `WhatsAppMessage` with `direction=outbound, providerStatus=mock_sent` so the UI shows them as if they were sent.

## Production setup checklist

1. Provision the business number `+971585063316` in a Meta Business Account.
2. Create a WhatsApp Business Account (WABA) and link the number.
3. Generate a System User access token with `whatsapp_business_messaging` and `whatsapp_business_management` permissions.
4. Configure webhook URL in Meta App settings → subscribe to `messages`, `message_status`.
5. Set `WHATSAPP_*` env vars in production secret manager.
6. Submit and approve required templates.
7. Confirm signature verification with a test event.
8. Enable production rate limiting on `/webhooks/whatsapp`.
