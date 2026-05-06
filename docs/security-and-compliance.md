# Security and Compliance

## Authentication

- Email + password via `/auth/login` returns short-lived **access JWT (15m)** and longer-lived **refresh JWT (30d)**.
- Refresh JWTs are rotated on every use (one-time-use refresh tokens, family revocation on reuse).
- Passwords hashed with `argon2id` (memory 64MB, iterations 3, parallelism 4).
- 2FA is post-MVP; design today does not preclude it.

## Authorization (RBAC)

Role → permissions matrix:

| Capability                                  | Super Admin | Ops Manager | Field Agent |
| ------------------------------------------- | ----------- | ----------- | ----------- |
| Manage company / users / integrations       | ✓           |             |             |
| Manage properties / owners                  | ✓           | ✓           | view-only   |
| Manage leads / viewings                     | ✓           | ✓           | own-only    |
| Update viewing result + notes               | ✓           | ✓           | own-only    |
| Generate / approve post packages            | ✓           | ✓           |             |
| Mark deal won/lost / commission             | ✓           | ✓           |             |
| View analytics                              | ✓           | ✓           | own-perf    |
| Trigger automation rules                    | ✓           | ✓           |             |
| Read audit log                              | ✓           |             |             |
| Take over WhatsApp conversation             | ✓           | ✓           |             |

Implementation: `@Roles()` and `@Permissions()` decorators with a `RolesGuard` + `PermissionsGuard`.

## Multi-tenancy isolation

- `companyId` is inferred from the authenticated user's JWT claim.
- A NestJS `TenantInterceptor` attaches it to the request.
- A Prisma extension auto-injects `where: { companyId }` on every query for tenant-scoped models.
- Cross-tenant access requires Super Admin + `@CrossTenant()` decorator.
- All listing endpoints test their isolation via integration tests.

## Webhook verification

`POST /webhooks/whatsapp`:

1. Read raw body; compute `hmac-sha256` with `WHATSAPP_APP_SECRET`.
2. Compare to `X-Hub-Signature-256` header (constant-time).
3. On mismatch → `401`. On match → enqueue.

`GET /webhooks/whatsapp` (verification challenge): compare `hub.verify_token` to `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, return `hub.challenge` if matched.

In dev (`WHATSAPP_ADAPTER=mock`) signature verification is skipped.

## Encrypted integration tokens

`IntegrationToken.encryptedValue` is encrypted at write time with envelope encryption:

- Data key derived from KMS-wrapped master key.
- AES-256-GCM with random IV.
- Stored as `kms_key_id|iv|tag|ciphertext` (base64).
- Decrypted only on adapter use.

For local dev, master key is read from `LOCAL_MASTER_KEY` env (32 bytes, base64). For prod, AWS KMS / Cloudflare R2 KMS / GCP KMS.

## Audit logs

Every mutation that touches Lead, Viewing, Deal, Property, Owner, Commission, IntegrationToken writes `AuditLog`:

```
{
  id, companyId, actorUserId, actorRole,
  entityType, entityId, action,
  diffJson, ip, userAgent, createdAt
}
```

Audit log is append-only at the application layer; DB-level INSERT-only role recommended in prod.

## Rate limiting

Applied at the API edge via `@nestjs/throttler`:

| Route family | Limit |
| --- | --- |
| `/auth/*` | 5 / 60s per IP |
| `/webhooks/whatsapp` | 100 / 10s per IP (Cloud API can burst) |
| `/post-packages/generate` | 30 / 60s per user |
| Default | 100 / 60s per user |

## Input validation

All DTOs validated via Zod (preferred) or `class-validator`. Reject unknown keys (`zod.strict()`). Sanitize HTML on any rich-text field.

## File uploads

- Pre-signed S3 PUT URLs from `/properties/:id/media` endpoint.
- Server validates: `image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `video/quicktime` MIME types only.
- Max size: 10MB image, 50MB video.
- After upload, server calls `HEAD` to confirm size + MIME, then registers `FileUpload` row.
- No direct user-supplied URLs accepted.

## Secrets

- `JWT_SECRET`, `LOCAL_MASTER_KEY`, `WHATSAPP_APP_SECRET`, `AI_API_KEY`, `S3_*` come from environment.
- Never logged. Logger has redaction list for these keys.
- `.env` is gitignored. Only `.env.example` is committed.

## Data deletion / personal data

- Soft delete on `Lead`, `Owner`, `User`, `Property`. Hard delete on request via Super Admin → background job that scrubs PII fields and anonymizes references.
- Right-to-be-forgotten flow:
  1. Super Admin runs `POST /admin/forget` with subject ID.
  2. Job replaces phone/email/name with hashes; preserves IDs for referential integrity.
  3. WhatsApp conversation messages are removed; `WhatsAppConversation` keeps shell.
- Operator notice shown for relevant data.

## Posting compliance

- We do not automate Facebook Group or WhatsApp Group posting.
- We do not scrape platforms.
- Approval gate: post packages require human action to be marked published.
- WhatsApp templates respected: outside 24h window, only approved templates.

## Opt-out

`AppSetting.optOutKeywords` configurable. Inbound matches set `Lead.status = opted_out`, set `WhatsAppConversation.mode = closed`, block all outbound to that number.

## Logging

- Structured JSON logs (pino).
- Redaction list: `password`, `token`, `secret`, `Authorization`, `accessToken`, `refreshToken`, `apiKey`, `whatsappAppSecret`.
- External request IDs propagated via `X-Request-Id`.
- Errors → centralized error reporter (Sentry or equivalent) in prod.

## Production checklist

- [ ] `JWT_SECRET` ≥ 32 bytes, rotated quarterly
- [ ] KMS-wrapped master key for token encryption
- [ ] HTTPS only; HSTS preload eligible
- [ ] Rate limiting enabled
- [ ] Webhook signature verification on
- [ ] Audit log retention policy set (≥ 1 year)
- [ ] Backup + restore drilled
- [ ] Access reviews quarterly for Super Admin role
- [ ] Logging redaction tested with synthetic PII
- [ ] CSP set on web app (no inline scripts beyond Next.js requirements)
- [ ] CORS allowlist explicit, no `*`
- [ ] Privacy notice + DPA reviewed with legal
