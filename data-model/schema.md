# Data Store schema

Catalyst Data Store tables. Every table has the implicit `ROWID` (bigint) primary key and `CREATEDTIME`/`MODIFIEDTIME` columns — only the columns you must add are listed.

### Clubs
| Column | Type | Notes |
|---|---|---|
| Name | Varchar(255) | required |
| NumberOfFields | Integer | required, > 0 |
| Address | Varchar(255) | optional |
| Phone | Varchar(50) | optional |

### Coaches
| Column | Type | Notes |
|---|---|---|
| Name | Varchar(255) | required |
| Level | Integer | 1–3 |
| Phone | Varchar(50) | optional |
| Email | Varchar(255) | optional |

### ClubCoaches (junction, many-to-many)
| Column | Type | Notes |
|---|---|---|
| ClubId | BigInt | FK → Clubs.ROWID |
| CoachId | BigInt | FK → Coaches.ROWID |

### Players
| Column | Type | Notes |
|---|---|---|
| Name | Varchar(255) | required |
| Level | Decimal(3,1) | 0–10, 0.5 increments |
| Email | Varchar(255) | optional |
| Phone | Varchar(50) | optional |
| PreferredClubId | BigInt | FK → Clubs.ROWID |
| Status | Varchar(20) | `ACTIVE` \| `WAITLISTED` |

### Classes
| Column | Type | Notes |
|---|---|---|
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
| ClassId | BigInt | FK → Classes.ROWID |
| PlayerId | BigInt | FK → Players.ROWID |
| Status | Varchar(20) | `CONFIRMED` \| `CANCELLED` |
| RequestId | BigInt | optional FK → Requests.ROWID, when the enrollment fulfilled a waitlist request |

### Requests (waitlist / pending sessions)
Represents both "no class fit yet" and "player wants a 2nd weekly session and only 1 fits so far".

| Column | Type | Notes |
|---|---|---|
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
| ClubId | BigInt | FK → Clubs.ROWID |
| Level | Decimal(3,1) | matched level bucket |
| SuggestedDayOfWeek | Integer | most common day among matches |
| SuggestedTimeStart | Varchar(5) | most common window start among matches |
| SuggestedDurationMinutes | Integer | most common duration requested |
| MatchingRequestIds | Varchar(500) | CSV of `Requests.ROWID` |
| Status | Varchar(20) | `OPEN` \| `RESOLVED` \| `DISMISSED` |

### AppUsers
Maps a Catalyst Authentication identity (ZUID) to an in-app role, since Catalyst IAM itself doesn't model "Administrator vs coach".

| Column | Type | Notes |
|---|---|---|
| ZUID | Varchar(50) | Catalyst user id, unique |
| Name | Varchar(255) | |
| Role | Varchar(20) | `ADMIN` \| `COACH` |
| CoachId | BigInt | optional FK → Coaches.ROWID, when Role = COACH |

---

## Indexing notes

- `Classes`: composite lookup index on `(ClubId, DayOfWeek, Status)` — the calendar's hottest query path.
- `Requests`: index on `(ClubId, Status)` — the alert scanner's hottest query path.
- `ClassEnrollments`: index on `ClassId` and on `PlayerId`.
