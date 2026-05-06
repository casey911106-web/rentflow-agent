# Scoring System

Four scores, each 0–100, recomputed on triggers and stored as snapshots for trend analysis. MVP uses simple weighted formulas — easy to audit and tune.

| Score | Subject | When recomputed |
| --- | --- | --- |
| Owner Trust Score | `Owner` | After every `OwnerAvailabilityCheck`, deal close, issue report |
| Property Quality Score | `Property` | After viewing complete, deal close, issue report |
| Property Readiness Score | `Property` | On property/media/availability/price changes |
| Agent Performance Score | `FieldAgent` | After viewing status update, feedback received |

Score color bands (UI):

| Range | Label | Color | Token |
| --- | --- | --- | --- |
| 80–100 | Excellent | `#00B894` | `--color-emerald-teal` |
| 60–79 | Good | `#00A7A5` | `--color-primary-teal` |
| 40–59 | Needs attention | `#F59E0B` | `--color-warning` |
| 0–39 | Risky | `#DC2626` | `--color-danger` |

## A. Owner Trust Score

```
ownerTrust = clamp(
  20 * responseRate                     // % of availability checks replied to (last 30d)
+ 15 * onTimeResponseRate               // replied within 24h
+ 15 * accuracyRate                     // 1 - mismatchRate (claimed available but actually rented)
+ 10 * priceStability                   // 1 - countOfPriceChanges/totalChecks
+ 10 * viewingAccessRate                // % of viewings where access wasn't denied
+ 10 * lowIssueRate                     // 1 - issuesPerProperty (capped at 1.0)
+ 10 * proactiveCommunication           // 1 if owner volunteered status changes
+ 10 * flexibility                      //  judgement: price/duration/viewing flexibility 0-1
, 0, 100)
```

Penalties (subtracted after weighted sum, capped at 0 floor):

- −10 per "claimed available but rented" within 30 days
- −5 per viewing cancelled by owner
- −15 per "owner closed directly bypassing process" (manually flagged)
- −5 per repeated unclear response

Persisted to `OwnerScoreSnapshot { ownerId, score, factors_json, createdAt }`.

## B. Property Quality Score

```
quality = clamp(
  20 * priceCompetitiveness    // vs comparable inventory in same area + type
+ 15 * locationDesirability    // tenant-configurable per area
+ 15 * mediaQuality            // # of photos (cap 6) + has video bonus
+ 15 * leadToViewingRate       // last 30d
+ 15 * viewingToDealRate       // last 90d
+ 10 * amenitiesScore          // count of supported amenities normalized
+ 10 * conditionScore          // operator + agent assessments (1-5 → 0-1)
, 0, 100)
```

Penalties:

- −10 if no photos
- −5 if no video
- −5 per "client complaint" issue in last 30d
- −10 if owner imposes restrictions (no viewing without 48h notice, etc.)

Persisted to `PropertyScoreSnapshot { propertyId, kind: 'quality', ... }`.

## C. Property Readiness Score

The "can we post this today?" gate. It blocks generation in Fast Posting Studio below 60.

```
readiness = clamp(
  20 * availabilityFresh          // confirmed within 7d
+ 15 * priceConfirmedFresh        // confirmed within 14d
+ 10 * ownerLinked                // 0/1
+ 15 * hasPhotos                  // ≥1 = 0.5, ≥3 = 1.0
+  5 * hasVideo                   // 0/1
+ 10 * descriptionReady           // longCaption non-empty
+  5 * commissionClear            // commission policy set
+  5 * depositClear               // deposit set
+  5 * moveInDateClear            // moveInDate or 'available now'
+  5 * occupancyRulesClear        // occupancy_max set
+  5 * viewingAccessConfirmed     // viewingAccess set
, 0, 100)
```

Persisted to `PropertyScoreSnapshot { propertyId, kind: 'readiness', ... }`.

## D. Agent Performance Score

```
agentPerformance = clamp(
  15 * acceptanceRate           // % of assignments accepted
+ 15 * completionRate           // % completed (vs no-show / cancelled by agent)
+ 15 * punctualityRate          // arrived on/before scheduled time
+ 20 * conversionRate           // viewings → deals won, last 90d
+ 10 * avgClientRating          // /5 normalized
+  5 * notesUpdatedRate         // % of viewings with notes
+  5 * responseTime             // <30min ack = 1.0, >2h = 0.3
+  5 * professionalismScore     // 1-5 from operator + lead feedback
+ 10 * followUpQualityScore     // 0-1 manual + heuristic
, 0, 100)
```

Penalties:

- −15 per "lost lead due to agent issue"
- −10 per missed viewing without notice
- −5 per missing notes after viewing

Persisted to `AgentPerformanceSnapshot`.

## Recomputation

Triggered by domain events; queued via BullMQ to avoid blocking writes.

| Event | Recomputes |
| --- | --- |
| `OwnerAvailabilityCheckCompleted` | Owner Trust, Property Readiness |
| `ViewingCompleted` | Agent Performance, Property Quality |
| `ViewingFeedbackReceived` | Agent Performance, Property Quality |
| `PropertyMediaAdded` | Property Quality, Property Readiness |
| `PropertyPriceUpdated` | Property Readiness |
| `PropertyAvailabilityUpdated` | Property Readiness |
| `PropertyIssueReported` | Owner Trust, Property Quality |
| `DealClosed` | All four (touching the deal's owner/property/agent) |

A nightly job recomputes everything regardless to catch missed events.

## Display

Score cards (web + mobile) show:

- Current score + label + color band
- Trend (delta vs 30 days ago)
- Top 3 positive factors
- Top 3 negative factors
- "Recommended action" — heuristic from lowest factor

Tooltip explains weighting on hover.

## Tunability

Weights live in `AppSetting.scoring` per company so the rules can be adjusted without code changes. Defaults are the formulas above.
