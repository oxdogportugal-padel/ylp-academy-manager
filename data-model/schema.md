# Data Store schema

Catalyst Data Store tables. Every table has the implicit `ROWID` (bigint) primary key and `CREATEDTIME`/`MODIFIEDTIME` columns — only the columns you must add are listed.

## Multi-tenancy

The platform hosts **N independent padel academies** (tenants) on one shared Catalyst project. An **Academy** is the tenant boundary — everything else (Clubs, Coaches, Players, Classes, waitlist Requests, Alerts) belongs to exactly one Academy and is only ever visible to that Academy's staff.

Catalyst Data Store has no native row-level security, so isolation is enforced in the API layer:

- Every tenant-owned table carries an `AcademyId` column, stamped on insert and required in every `WHERE` clause the API issues (see `functions/academy-api/src/middleware/auth.js`'s `resolveAcademy`). This is deliberately denormalized onto every table (not just `Clubs`) so a single filter is enough — no joins required to enforce isolation, and no query path can accidentally leak across tenants by skipping a join.
- Every request that touches tenant data must resolve an `AcademyId` from the caller's membership (`AppUsers`) before it can run — there is no "global" query mode in the API.
- Row lookups by id (`GET/PUT/DELETE /clubs/:id` etc.) additionally re-check the fetched row's `AcademyId` against the caller's resolved academy and 404 on mismatch, so an admin of Academy A can't reach Academy B's data by guessing a `ROWID` even if IDs are sequential and global to the table.

### Academies
| Column | Type | Notes |
|---|---|---|
| Name | Varchar(255) | required |
| Slug | Varchar(100) | unique, URL/subdomain-friendly identifier |
| CreatedByZUID | Varchar(50) | Catalyst user id of the founding admin |
| PlanStatus | Varchar(20) | `TRIAL` \| `ACTIVE` \| `SUSPENDED` |

### AppUsers (tenant membership)
Maps a Catalyst Authentication identity (ZUID) to a role **within one Academy**. A single Zoho/Catalyst login can be a member of several academies (e.g. a coach who freelances across two academies, or a consultant admin), so the natural key is `(ZUID, AcademyId)`, not `ZUID` alone.

| Column | Type | Notes |
|---|---|---|
| ZUID | Varchar(50) | Catalyst user id |
| AcademyId | BigInt | FK → Academies.ROWID |
| Name | Varchar(255) | |
| Role | Varchar(20) | `ADMIN` \| `COACH` |
| CoachId | BigInt | optional FK → Coaches.ROWID, when Role = COACH |

Unique index on `(ZUID, AcademyId)`.

### Clubs
| Column | Type | Notes |
|---|---|---|
| AcademyId | BigInt | FK → Academies.ROWID, required |
| Name | Varchar(255) | required |
| NumberOfFields | Integer | required, > 0 |
| Address | Varchar(255) | optional |
| Phone | Varchar(50) | optional |

### Coaches
| Column | Type | Notes |
|---|---|---|
| AcademyId | BigInt | FK → Academies.ROWID, required |
| Name | Varchar(255) | required |
| Level | Integer | 1–3 |
| Phone | Varchar(50) | optional |
| Email | Varchar(255) | optional |

### ClubCoaches (junction, many-to-many)
| Column | Type | Notes |
|---|---|---|
| AcademyId | BigInt | FK → Academies.ROWID, required (both sides always share it) |
| ClubId | BigInt | FK → Clubs.ROWID |
| CoachId | BigInt | FK → Coaches.ROWID |

### Players
| Column | Type | Notes |
|---|---|---|
| AcademyId | BigInt | FK → Academies.ROWID, required |
| Name | Varchar(255) | required |
| Level | Decimal(3,1) | 0–10, 0.5 increments |
| Email | Varchar(255) | optional |
| Phone | Varchar(50) | optional |
| PreferredClubId | BigInt | FK → Clubs.ROWID |
| Status | Varchar(20) | `ACTIVE` \| `WAITLISTED` |

### Classes
| Column | Type | Notes |
|---|---|---|
| AcademyId | BigInt | FK → Academies.ROWID, required |
| ClubId | BigInt | FK → Clubs.ROWID, required |
| CoachId | BigInt | FK → Coaches.ROWID, required |
| FieldNumber | Integer | 1..Club.NumberOfFields |
| DayOfWeek | Integer | 0 (Sun) – 6 (Sat) |
| StartTime | Varchar(5) | `"HH:MM"`, 24h |
| DurationMinutes | Integer | 60 \| 90 \| 120 |
| Level | Decimal(3,1) | 0–10, target level |
| Capacity | Integer | default 4 |
| Status | Varchar(20) | `OPEN` \| `FULL` \| `CANCELLED` |
| EffectiveFrom | Date | first occurrence date |
| EffectiveTo | Date | optional recurrence end |

Classes are weekly-recurring (`DayOfWeek` + `StartTime`) between `EffectiveFrom` and `EffectiveTo`; the calendar expands occurrences client/server-side rather than storing one row per week.

### ClassEnrollments (junction)
| Column | Type | Notes |
|---|---|---|
| AcademyId | BigInt | FK → Academies.ROWID, required |
| ClassId | BigInt | FK → Classes.ROWID |
| PlayerId | BigInt | FK → Players.ROWID |
| Status | Varchar(20) | `CONFIRMED` \| `CANCELLED` |
| RequestId | BigInt | optional FK → Requests.ROWID, when the enrollment fulfilled a waitlist request |

### Requests (waitlist / pending sessions)
Represents both "no class fit yet" and "player wants a 2nd weekly session and only 1 fits so far".

| Column | Type | Notes |
|---|---|---|
| AcademyId | BigInt | FK → Academies.ROWID, required |
| PlayerId | BigInt | FK → Players.ROWID |
| ClubId | BigInt | FK → Clubs.ROWID |
| Level | Decimal(3,1) | copied from player at request time |
| PreferredDurations | Varchar(20) | CSV of `60,90,120` |
| PreferredDays | Varchar(20) | CSV of 0–6 |
| PreferredTimeStart | Varchar(5) | `"HH:MM"`, window start |
| PreferredTimeEnd | Varchar(5) | `"HH:MM"`, window end |
| SessionsPerWeek | Integer | 1 or 2 |
| FulfilledSessions | Integer | 0, 1, or `SessionsPerWeek` |
| Status | Varchar(20) | `PENDING` \| `PARTIAL` \| `FULFILLED` \| `CANCELLED` |

### ClassOpeningAlerts
| Column | Type | Notes |
|---|---|---|
| AcademyId | BigInt | FK → Academies.ROWID, required |
| ClubId | BigInt | FK → Clubs.ROWID |
| Level | Decimal(3,1) | matched level bucket |
| SuggestedDayOfWeek | Integer | most common day among matches |
| SuggestedTimeStart | Varchar(5) | most common window start among matches |
| SuggestedDurationMinutes | Integer | most common duration requested |
| MatchingRequestIds | Varchar(500) | CSV of `Requests.ROWID` |
| Status | Varchar(20) | `OPEN` \| `RESOLVED` \| `DISMISSED` |

---

## Indexing notes

- `AppUsers`: unique index on `(ZUID, AcademyId)` — the tenant-resolution hot path on every authenticated request.
- `Clubs`, `Coaches`, `Players`: index on `AcademyId` — the "list everything for my academy" query.
- `Classes`: composite index on `(AcademyId, ClubId, DayOfWeek, Status)` — the calendar's hottest query path.
- `Requests`: composite index on `(AcademyId, ClubId, Status)` — the alert scanner's hottest query path.
- `ClassEnrollments`: index on `ClassId` and on `PlayerId`.
