# SiteGuard Data Store schema

Generated from `shared/repo/schema.js` by `npm run gen-schema` — edit that file, not this one.

Every table also has the system columns `ROWID`, `CREATORID`, `CREATEDTIME`, `MODIFIEDTIME` (do not create them).
Timestamps are ISO-8601 UTC strings. `bigint` id columns hold the `ROWID` of the referenced row.

## AppUsers

| Column | Type | Max length |
|---|---|---|
| CatalystUserId | varchar | 50 |
| Email | varchar | 255 |
| Plan | varchar | 10 |
| StripeCustomerId | varchar | 100 |
| StripeSubscriptionId | varchar | 100 |
| CreatedAt | varchar | 30 |

## Targets

| Column | Type | Max length |
|---|---|---|
| OwnerId | bigint |  |
| Url | varchar | 255 |
| CreatedAt | varchar | 30 |

## Audits

| Column | Type | Max length |
|---|---|---|
| TargetId | bigint |  |
| OwnerId | bigint |  |
| TriggerType | varchar | 20 |
| Status | varchar | 20 |
| FinalUrl | text |  |
| Score | int |  |
| Grade | varchar | 2 |
| Counts | text |  |
| Meta | text |  |
| ErrorMessage | text |  |
| CreatedAt | varchar | 30 |
| StartedAt | varchar | 30 |
| FinishedAt | varchar | 30 |

## Issues

| Column | Type | Max length |
|---|---|---|
| TargetId | bigint |  |
| Fingerprint | varchar | 255 |
| CheckId | varchar | 60 |
| IssueKey | varchar | 255 |
| Severity | varchar | 10 |
| Title | varchar | 255 |
| Status | varchar | 10 |
| FirstDetectedAuditId | bigint |  |
| FirstDetectedAt | varchar | 30 |
| LastSeenAuditId | bigint |  |
| LastSeenAt | varchar | 30 |
| ResolvedAuditId | bigint |  |
| ResolvedAt | varchar | 30 |
| TimesReopened | int |  |

## IssueEvents

| Column | Type | Max length |
|---|---|---|
| IssueId | bigint |  |
| TargetId | bigint |  |
| AuditId | bigint |  |
| EventType | varchar | 10 |
| EventAt | varchar | 30 |

## Findings

| Column | Type | Max length |
|---|---|---|
| AuditId | bigint |  |
| TargetId | bigint |  |
| IssueId | bigint |  |
| CheckId | varchar | 60 |
| IssueKey | varchar | 255 |
| Severity | varchar | 10 |
| Evidence | text |  |

## Schedules

| Column | Type | Max length |
|---|---|---|
| TargetId | bigint |  |
| OwnerId | bigint |  |
| Frequency | varchar | 10 |
| Recipients | text |  |
| Enabled | boolean |  |
| NextRunAt | varchar | 30 |
| LastRunAt | varchar | 30 |
| CreatedAt | varchar | 30 |

## EmailLog

| Column | Type | Max length |
|---|---|---|
| AuditId | bigint |  |
| Recipients | text |  |
| Subject | varchar | 255 |
| Status | varchar | 10 |
| ErrorMessage | text |  |
| SentAt | varchar | 30 |
