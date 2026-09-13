# Academy Manager — Padel Class Scheduling for Zoho Catalyst

A mobile-first web app that lets padel academies plan classes with minimal friction: manage clubs, coaches, players and classes, see everything on a filterable calendar, and let the system recommend or queue up new players automatically.

The platform is **multi-tenant**: any number of independent padel academies can sign up and run on the same deployment, each with its own private clubs, coaches, players and classes. See [§2](#2-multi-tenancy) below.

The platform is built to run entirely on **Zoho Catalyst**:

| Catalyst service | What it hosts |
|---|---|
| **Client (Web Client)** | The React SPA in `client/` |
| **Functions (Advanced I/O)** | The REST API in `functions/academy-api/` |
| **Data Store** | Relational tables described in `data-model/schema.md` |
| **Authentication** | Admin/coach login (Zoho or email/password IAM) |
| **Cache / Cron (optional)** | Background waitlist-matching sweep (see `functions/waitlist-sweeper`) |

---

## 1. Domain model

**Actors:** Administrators (manage everything), Clubs, Coaches, Players, Classes.

```
Club (1) ──< ClubCoaches >── (1) Coach
Club (1) ──────────────────< Class
Coach (1) ─────────────────< Class
Class (1) ──< ClassEnrollments >── (1) Player
Player (1) ─────────────────< Request  (waitlist / pending 2nd session)
Club+Level+TimeSlot ────────< ClassOpeningAlert  (2+ matching pending Requests)
```

- A **Club** has a name and a number of physical padel fields — that number caps how many classes can run in the same time slot at that club.
- A **Coach** belongs to one or more clubs (`ClubCoaches` junction) and has a skill **Level 1–3**.
- A **Player** has a **Level 0–10** (0.5 increments allowed) and a preferred club.
- A **Class** belongs to one club + one coach, runs on a field, for 60/90/120 minutes, targets a **Level 0–10**, and has a capacity (default 4, standard padel doubles class).
- Matching rule: a player fits a class when `abs(class.level - player.level) <= 1` ("same level, ±1 flexibility").

Full column-level schema: [`data-model/schema.md`](data-model/schema.md).

---

## 2. Multi-tenancy

An **Academy** is the tenant boundary sitting above everything else in §1 — a single Catalyst project and Data Store host **N** of them side by side, each with its own Clubs, Coaches, Players, Classes, waitlist Requests and Alerts, invisible to every other academy.

- **Signup is self-serve.** Any Catalyst-authenticated user can open a new academy via `POST /academies` (the client's onboarding screen when a login has no academy yet) and becomes its first `ADMIN`.
- **Membership, not a single role.** `AppUsers` is keyed by `(ZUID, AcademyId)`, not `ZUID` alone — the same Catalyst login can belong to several academies (e.g. a coach who freelances across two clubs' worth of academies) with a different role in each. The client shows an academy switcher when it detects more than one.
- **Isolation is enforced in the API, not the database.** Catalyst Data Store has no row-level security, so every tenant-owned table carries an `AcademyId` column and every query the API issues filters and stamps it — see `resolveAcademy` in `functions/academy-api/src/middleware/auth.js` and `assertOwned`/`withAcademy` in `src/utils/tenant.js`. A request first resolves which academy it's acting as (from the `X-Academy-Id` header, defaulting when the caller only belongs to one), then every route filters by it and 404s on any row whose `AcademyId` doesn't match — so an admin from Academy A can never reach Academy B's data, even by guessing a `ROWID`.
- **The waitlist sweeper crosses tenants by design** (it's the one exception): the cron safety-net in `functions/waitlist-sweeper` re-scans every academy's every club, since it's an internal system job rather than a tenant-facing request.

---

## 3. System intelligence

Implemented in `functions/academy-api/src/services/`:

1. **`matching.js` — best-fit recommendation.** When a prospective player submits club + level + desired schedule, `recommendClasses()` scores every open class at that club within the level-flexibility window against day/time overlap and remaining capacity, and returns a ranked shortlist ready to enroll into.
2. **`waitlist.js` — group-forming alerts.** If nothing fits, the player is stored as a `Request` (status `PENDING`). Every time a request is created, cancelled, or a class changes capacity, `scanForClassOpenings()` regroups all `PENDING`/`PARTIAL` requests by club + level bucket + overlapping time window; once **2 or more** compatible players stack up, it opens/updates a `ClassOpeningAlert` an admin can act on (create the class with one click from the Alerts screen, which auto-enrolls the matched players).
3. **Partial fulfillment for 2×/week players.** A `Request.sessionsPerWeek` of 2 that only matches one class is marked `PARTIAL` (`fulfilledSessions = 1`) instead of closed. It keeps participating in matching/alerts for the *remaining* session until `fulfilledSessions === sessionsPerWeek`, at which point it's `FULFILLED`.

---

## 4. API surface (functions/academy-api)

Base path once deployed: `https://<project>.catalystserverless.com/server/academy-api/api/v1`

Every request needs a Catalyst-authenticated session; everything except `/academies` also needs an `X-Academy-Id` header (or a login that belongs to exactly one academy) — see [§2](#2-multi-tenancy).

| Resource | Endpoints |
|---|---|
| Academies (tenants) | `GET /academies/mine` (list the caller's memberships), `POST /academies` (create one, caller becomes its ADMIN) |
| Clubs | `GET/POST /clubs`, `GET/PUT/DELETE /clubs/:id` |
| Coaches | `GET/POST /coaches`, `GET/PUT/DELETE /coaches/:id`, `POST/DELETE /clubs/:clubId/coaches/:coachId` |
| Players | `GET/POST /players`, `GET/PUT/DELETE /players/:id` |
| Classes | `GET/POST /classes` (filter by `clubId,coachId,level,from,to`), `GET/PUT/DELETE /classes/:id` |
| Enrollments | `POST /classes/:id/enroll`, `DELETE /classes/:id/enroll/:playerId` |
| Requests (waitlist) | `GET/POST /requests`, `PATCH /requests/:id` |
| Alerts | `GET /alerts`, `POST /alerts/:id/convert` (creates the class + enrolls matches), `PATCH /alerts/:id` (dismiss) |
| Intake wizard | `POST /recommendations` → `{ classes: [...], request?: {...}, alert?: {...} }` |

All endpoints return `{ data, error }` JSON and validate input in `src/utils/validation.js`.

---

## 5. Frontend (client/)

React 18 + Vite + Tailwind CSS, mobile-first, calendar-centric.

- **Academy onboarding/switching** (`components/AcademyGate.jsx`) sits above everything else: a login with no academy yet sees a one-field "create your academy" form; a login with several sees a picker; the resolved academy is sent as `X-Academy-Id` on every API call (`api/client.js`) and shown/switchable from the nav (`AcademySwitcher.jsx`).
- **Calendar** is the landing screen. Club is the primary (and mandatory) filter; Level, Coach, and Duration are secondary filters layered on top. Desktop shows a week grid; phones show a single-day agenda with a day-picker strip and bottom sheet class details — this is the "mobile optimized" surface, not a shrunk grid.
- **Intake wizard** (`/intake`) walks through the 3 user stories: try to book straight in, fall back to waitlist, or queue a 2nd weekly session.
- **Alerts** screen surfaces `ClassOpeningAlert`s so an admin can open a new class in one tap once 2+ players are waiting on the same slot.
- Simple CRUD screens for Clubs / Coaches / Players / Classes (table + slide-over form), shared through a generic `CrudTable` component.

Run locally: `cd client && npm install && npm run dev` (proxies `/server` to `http://localhost:3000` where the function runs via `catalyst serve`).

---

## 6. Deploying to Zoho Catalyst

Local development against a real Catalyst project needs the Catalyst CLI and an authenticated Zoho account, which this environment doesn't have — the steps below are what you run once you do:

```bash
npm install -g zcatalyst-cli
catalyst login
catalyst init          # link this repo to your Catalyst project, keep existing functions/client folders
```

1. **Data Store** — create the tables/columns in `data-model/schema.md` via Console → Data Store (or `catalyst datastore` if your CLI version supports table definitions). Table & column names in the schema doc match exactly what the API code expects.
2. **Functions** — `cd functions/academy-api && npm install`, then from the project root `catalyst deploy --only functions`.
3. **Authentication** — enable Catalyst Authentication (Zoho IAM is fastest). No manual `AppUsers` seeding is needed: the first person to log in creates their academy via the onboarding screen (`POST /academies`) and is automatically its `ADMIN` — see [§2](#2-multi-tenancy).
4. **Client** — `cd client && npm install && npm run build`, then `catalyst deploy --only client`.
5. (Optional but recommended) **Cron/Cache** — schedule `functions/waitlist-sweeper` hourly via Catalyst Job Scheduler as a safety net, in case a client-triggered rescan is missed. It sweeps every academy in one run, so one schedule covers all tenants.

---

## 7. Recommended next features

Not built yet, worth prioritizing next:

- **Payments** — Zoho Books/Invoice integration for class packages and per-session billing.
- **Attendance & no-show tracking** feeding into player level review.
- **Automated reminders** (WhatsApp/SMS/email) before each class, via Zoho Cliq or a messaging provider.
- **Coach availability calendar** so classes can't be scheduled outside a coach's working hours.
- **Post-class ratings** from players to refine level over time instead of a static admin-set number.
- **Multi-language UI** (PT/EN) given the target market.
- **Utilization analytics** per club (field occupancy %, revenue per field-hour) for the admin dashboard.
- **Per-academy billing** — `Academies.PlanStatus` exists as a placeholder; wire it to Zoho Billing/Subscriptions and gate write access when an academy lapses past `TRIAL`.
- **Academy-branded subdomains** — `Academies.Slug` is reserved for a `<slug>.yourapp.com` style URL per academy, so each one can bookmark a "home" address instead of always landing on the switcher.
