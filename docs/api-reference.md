# API Reference

REST API served by the NestJS app at `apps/api`. Default base URL `http://localhost:3001`.

OpenAPI / Swagger UI: `http://localhost:3001/docs`.

## Conventions

- All requests authenticated via `Authorization: Bearer <jwt>` except: `POST /auth/login`, `POST /auth/register` (Super Admin only), `POST /webhooks/whatsapp`, `GET /health`.
- All responses are JSON.
- All listing endpoints support `?page`, `?limit`, `?q`, `?sort`, and entity-specific filters.
- All mutations are tenant-scoped; `companyId` is taken from JWT, never from body/path.
- 4xx responses use `{ "statusCode", "error", "message", "details?" }`.

## Auth

| Method | Path                | Body / Query                | Returns                    |
| ------ | ------------------- | --------------------------- | -------------------------- |
| POST   | `/auth/login`       | `{ email, password }`       | `{ accessToken, refreshToken, user }` |
| POST   | `/auth/refresh`     | `{ refreshToken }`          | `{ accessToken, refreshToken }` |
| POST   | `/auth/register`    | (admin) `{ email, password, role }` | `User` |
| GET    | `/auth/me`          | —                           | `User` (with role + permissions) |
| POST   | `/auth/logout`      | —                           | `{ ok: true }`             |

## Properties

| Method | Path                                      | Notes |
| ------ | ----------------------------------------- | ----- |
| POST   | `/properties`                             | Create |
| GET    | `/properties`                             | List, filter by `status`, `type`, `area`, `ownerId` |
| GET    | `/properties/:id`                         | Detail |
| PATCH  | `/properties/:id`                         | Update |
| DELETE | `/properties/:id`                         | Soft delete |
| POST   | `/properties/:id/media`                   | Pre-signed S3 upload + register |
| GET    | `/properties/:id/calendar`                | Calendar events |
| POST   | `/properties/:id/availability-blocks`     | Block dates |
| POST   | `/properties/:id/report-issue`            | Field-agent issue report |
| POST   | `/properties/:id/recalculate-scores`      | Force-refresh quality + readiness |

## Owners

| Method | Path                                       | Notes |
| ------ | ------------------------------------------ | ----- |
| POST   | `/owners`                                  | Create |
| GET    | `/owners`                                  | List |
| GET    | `/owners/:id`                              | Detail (incl. trust score + properties) |
| PATCH  | `/owners/:id`                              | Update |
| POST   | `/owners/:id/check-availability`           | Trigger an ad-hoc availability check |

## Leads

| Method | Path                                  | Notes |
| ------ | ------------------------------------- | ----- |
| POST   | `/leads`                              | Manual creation (rare; usually via webhook) |
| GET    | `/leads`                              | List, filter by `status`, `temperature`, `propertyId`, `postPackageId` |
| GET    | `/leads/:id`                          | Detail (includes conversation, viewings, deal) |
| PATCH  | `/leads/:id`                          | Update fields |
| PATCH  | `/leads/:id/status`                   | Transition status with validation |
| POST   | `/leads/:id/schedule-viewing`         | Create viewing |
| POST   | `/leads/:id/follow-up`                | Manual follow-up |

## WhatsApp

| Method | Path                                                  | Notes |
| ------ | ----------------------------------------------------- | ----- |
| POST   | `/webhooks/whatsapp`                                  | Cloud API webhook (verify + ingest) |
| GET    | `/webhooks/whatsapp`                                  | Verification challenge |
| GET    | `/whatsapp/conversations`                             | List |
| GET    | `/whatsapp/conversations/:id`                         | Detail w/ messages |
| POST   | `/whatsapp/conversations/:id/send`                    | Send message (template or session) |
| POST   | `/whatsapp/conversations/:id/human-takeover`          | Pause AI |
| POST   | `/whatsapp/conversations/:id/release-to-ai`           | Resume AI |
| POST   | `/whatsapp/mock/inbound`                              | (dev only, mock adapter) inject inbound message |

## Posting

| Method | Path                                  | Notes |
| ------ | ------------------------------------- | ----- |
| POST   | `/post-packages/generate`             | Generate captions + tracking link for a property |
| GET    | `/post-packages`                      | List |
| GET    | `/post-packages/:id`                  | Detail |
| PATCH  | `/post-packages/:id`                  | Edit captions |
| POST   | `/post-packages/:id/approve`          | Move to approved |
| POST   | `/post-packages/:id/mark-published`   | `{ channelId, channelName, url? }` |

## Viewings

| Method | Path                                  | Notes |
| ------ | ------------------------------------- | ----- |
| POST   | `/viewings`                           | Create |
| GET    | `/viewings`                           | List, filter by `date`, `status`, `agentId`, `propertyId` |
| GET    | `/viewings/:id`                       | Detail |
| PATCH  | `/viewings/:id/status`                | Transition |
| POST   | `/viewings/:id/assign-agent`          | Manual or suggested |
| POST   | `/viewings/:id/feedback`              | Lead feedback |

## Deals

| Method | Path                                  | Notes |
| ------ | ------------------------------------- | ----- |
| POST   | `/deals`                              | Create from lead/viewing |
| GET    | `/deals`                              | List |
| GET    | `/deals/:id`                          | Detail |
| POST   | `/deals/:id/mark-won`                 | Closes deal won; opens commission |
| POST   | `/deals/:id/mark-lost`                | `{ reason }` |
| POST   | `/deals/:id/commission`               | Update commission status / record payment |

## Analytics

| Method | Path                              | Notes |
| ------ | --------------------------------- | ----- |
| GET    | `/analytics/funnel`               | Posts → leads → viewings → deals (date range filter) |
| GET    | `/analytics/posts`                | Per-post performance |
| GET    | `/analytics/agents`               | Agent leaderboard |
| GET    | `/analytics/owners`               | Owner response/trust |
| GET    | `/analytics/properties`           | Per-property metrics |
| GET    | `/analytics/commissions`          | Commission rollups |

## Health

| Method | Path        | Notes |
| ------ | ----------- | ----- |
| GET    | `/health`   | DB + Redis + AI + WhatsApp adapter status |

## Status code conventions

| Scenario | Code |
| --- | --- |
| Resource created | 201 |
| Resource updated / generic OK | 200 |
| Soft-deleted | 204 |
| Validation failure | 400 |
| Auth failure | 401 |
| RBAC denial | 403 |
| Not found / wrong tenant | 404 |
| Conflict (e.g., status transition not allowed) | 409 |
| Rate limited | 429 |
| Server error | 500 |
