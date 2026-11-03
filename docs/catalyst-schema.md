# Catalyst — YLP-Academy-Manager

Live reference for the Data Store schema. Created 23 Oct 2026 via the Zoho MCP
connector; no CLI involved.

## Context

| | |
|---|---|
| Org | `20105401867` (Luis Castro), **EU data center** (`console.catalyst.zoho.eu`) |
| Project | `YLP-Academy-Manager` — id `5361000000043001` |
| Environment | Development only (no Production environment yet) |
| Project domain | `https://ylp-academy-manager-20105401867.development.catalystserverless.eu` |
| Timezone | Europe/Lisbon |

## Table IDs

| Table | Table ID |
|---|---|
| Academies | `5361000000046005` |
| Clubs | `5361000000044039` |
| Coaches | `5361000000045009` |
| ClubCoaches | `5361000000046364` |
| Players | `5361000000044398` |
| Classes | `5361000000048001` |
| ClassEnrollments | `5361000000044757` |
| Requests | `5361000000048360` |
| RequestWindows | `5361000000048719` |
| CourtAllocations | `5361000000049116` |

Every table also carries the four Catalyst system columns: `ROWID` (primary
key), `CREATORID`, `CREATEDTIME`, `MODIFIEDTIME`.

## Columns

**Academies** — Name varchar(255) req · Slug varchar(100) req unique indexed ·
Settings text(10000) · Timezone varchar(64) default `Europe/Lisbon` ·
PlanStatus varchar(20) req default `TRIAL`

`Settings` holds the matching rules as JSON. Empty means the app's defaults.
Two keys in it are platform state, not rules, and only the server writes them:
`language` (`pt`/`es`/`fr`/`en`, default `pt`, set by the operator) and
`tutorialDone` (emails of people who finished the first-login tour). The API
strips both before sending rules to the browser and carries them over on every
rules save, so an owner cannot change or erase them.
This is the column the September project was missing, and it's what keeps level
scale, tolerance, class size, durations and coach caps out of the code.

**Clubs** — AcademyId bigint req indexed · Name varchar(255) req ·
Courts int req default 2 · Status varchar(20) req default `active`

**Coaches** — AcademyId bigint req indexed · Name varchar(255) req ·
CertLevel int req default 1 · Status varchar(20) req default `active`

CertLevel means nothing on its own — `Academies.Settings.coachCertification`
maps each level to the highest player level it may teach.

**ClubCoaches** — AcademyId bigint req indexed · ClubId bigint req indexed ·
CoachId bigint req indexed

**Players** — AcademyId bigint req indexed · Name varchar(255) req indexed ·
Level double(1dp) req · Contact varchar(255) · Notes text · Status varchar(20)
req default `active`

**Classes** — AcademyId bigint req indexed · ClubId bigint req indexed ·
CoachId bigint req indexed · FieldNumber int · DayOfWeek int req (0 = Monday) ·
StartTime varchar(5) req (`"19:00"`) · DurationMinutes int req ·
Level double(1dp) req · Capacity int (null = academy default) ·
Status varchar(20) req default `active` · EffectiveFrom varchar(20) ·
EffectiveTo varchar(20)

**ClassEnrollments** — AcademyId bigint req indexed · ClassId bigint req
indexed · PlayerId bigint req indexed · Status varchar(20) req default `active`

**Requests** — AcademyId bigint req indexed · PlayerName varchar(255) req
indexed · PlayerId bigint (null until the player record exists) ·
Level double(1dp) req · ClubId bigint req indexed · SessionsPerWeek int req
default 1 · PlacedCount int req default 0 · Status varchar(20) req default
`waiting`

`SessionsPerWeek` minus `PlacedCount` is the outstanding remainder — what makes
the waiting-list alerts work. Never let a partial placement drop it.

**RequestWindows** — AcademyId bigint req indexed · RequestId bigint req
indexed · DayOfWeek int req · FromTime varchar(5) req · ToTime varchar(5) req

**CourtAllocations** — AcademyId bigint req indexed · ClubId bigint req indexed
· DayOfWeek int req · FromTime varchar(5) req · ToTime varchar(5) req ·
Courts int req

Court time as a contract, not a building. No rows for a club means the whole
club is available all week.

## Seeded

One Academies row: **The Hyve**, slug `hyve`, ROWID `5361000000046783`,
PlanStatus `TRIAL`, with the default rules JSON in Settings.

## Verified behaviour — read this before writing the client

All three of these were confirmed by probing the live project, not inferred.

**1. ZCQL wraps every row under the table name.**
```json
{"Players": {"Level": 6.5, "ROWID": "...", "Name": "..."}}
```
Unwrap `row.<TableName>` before using it. A JOIN returns one key per table.

**2. Numbers come back inconsistently between the two read paths.**
The row API (`Get_Rows` / `Insert_Rows` responses) returns `Level` as the
*string* `"6.5"`. ZCQL returns it as the *number* `6.5`. Coerce with `Number()`
on every numeric read regardless of path.

**3. IDs are always strings.** `ROWID`, `AcademyId`, `ClubId`, `CoachId`,
`PlayerId` all return as strings even though the columns are bigint.

That third one is the dangerous one. The matching engine compares ids with
`!==` (`cls.venueId !== request.venueId`). If one side arrives as a string and
the other as a number, the comparison silently fails and the engine returns no
matches while looking perfectly healthy. Normalise every id to a string at the
repository boundary — once, in the mapping layer, not scattered through the
app.

Also: Data Store has no JSON column type. `Settings` is `text`, capped at
10,000 characters, parsed on read.

## No foreign keys — deliberate

Relations are plain `bigint`, matching the choice already made in the September
project. Data Store does support a `foreign key` column type, but the client
writes rows without awaiting each other, so a class can reach the server before
its club does and a real constraint would reject it. Referential integrity
lives in the app, as it already does for deletes.

## Not done yet

- **App User permissions.** Only `Select` is on by default. For browser-direct
  writes, each table needs Insert/Update/Delete ticked under
  Console → Data Store → *table* → Scopes and Permissions → App User.
- **Slate** needs its one-time activation: Console → project → Slate →
  Start Exploring.
- **Authorized Domains** needs the Slate origin added with CORS on.
- **The client port** — the planner's four storage functions (`put`, `drop`,
  `saveAcademy`, `loadAll`) against the Web SDK, plus the flat-to-normalised
  mapping for `playerIds` → ClassEnrollments and `windows` → RequestWindows.
