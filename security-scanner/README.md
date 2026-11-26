# SiteGuard — website security auditor on Zoho Catalyst

SiteGuard scans a public URL for well-known web security issues and lists them from most to least severe (critical → high → medium → low → info), with an A–F grade.

- **Free plan:** a severity-ranked list of issues, for up to 3 sites.
- **Pro plan:** detailed reports (why each issue matters, evidence, how to fix it, CWE/OWASP mapping), scheduled audits (daily, weekly or monthly) with the report sent by e-mail, and JSON export.
- **Every plan:** a full log of every audit for each site. An **issue log** records when each issue was first detected, which audit found it fixed, and whether it came back later.

SiteGuard is its own **Catalyst project**, separate from the academy app in the rest of this repository. A Catalyst project has a single Data Store, user base and domain, so the two apps don't share one.

## How it runs on Catalyst

```
 Slate (client/)                    Functions                                  Data Store
 ┌──────────────────┐  auth token  ┌───────────────────────────┐   ZCQL     ┌──────────────┐
 │ static web app   │─────────────▶│ siteguard_api (Adv. I/O)  │──────────▶│ AppUsers     │
 │ Catalyst login   │              │  REST API, plan checks    │           │ Targets      │
 └──────────────────┘              └────────────┬──────────────┘           │ Audits       │
                                     submitJob  │                          │ Issues       │
 Job Scheduling cron (every 15 min)             ▼                          │ IssueEvents  │
 ┌──────────────────┐  submitJob   ┌───────────────────────────┐           │ Findings     │
 │ audit_scheduler  │─────────────▶│ audit_runner (Job, 15 min)│──────────▶│ Schedules    │
 │ (Job)            │              │  scan + issue log + mail  │──┐        │ EmailLog     │
 └──────────────────┘              └───────────────────────────┘  │        └──────────────┘
 Stripe ──webhook──▶ billing_webhook (Adv. I/O, public, signed)   └──▶ Catalyst Mail
```

| Piece | Catalyst service | Why |
|---|---|---|
| `client/` | **Slate** (static) | The web app. Login and sign-up use **Catalyst Authentication** (embedded widget). |
| `functions/siteguard_api` | Advanced I/O function (Express) | The REST API. It only creates audit rows and queues jobs, so it stays well within the 30-second function limit. |
| `functions/audit_runner` | **Job** function | Runs one scan (up to 15 minutes), updates the issue log, and e-mails scheduled reports through **Catalyst Mail**. |
| `functions/audit_scheduler` | **Job** function on a Job Scheduling cron | Every 15 minutes it queues audits for due Pro schedules and marks audits whose job died as failed. |
| `functions/billing_webhook` | Advanced I/O function (public) | Receives Stripe subscription events. Each one is verified with the Stripe signature. |
| `shared/` | — | Scanner, audit logic, reports, e-mail template and Data Store access, used by all functions. |

Catalyst deploys each function folder on its own. Shared code is therefore copied into `functions/*/lib/` by `npm run sync`. **Edit `shared/`, never `lib/`.** `npm test` fails if a copy is out of date.

## One-time setup in Catalyst

You need the Catalyst CLI (`npm i -g zcatalyst-cli`, then `catalyst login`) and a new Catalyst project. Create the project in the console, e.g. named **SiteGuard**.

1. **Link this folder to the project**
   ```bash
   cd security-scanner
   catalyst init --org <orgId> -p <projectId> -ni
   ```
   Keep the existing `functions/` folder and `catalyst.json` if the CLI asks.
2. **Data Store:** create the 8 tables in [`data-model/schema.md`](data-model/schema.md). The same definitions are in machine-readable form in `data-model/tables.json`. Table and column names are case-sensitive and must match exactly. All data access runs with admin scope, and ownership is checked in code, so App User table permissions can stay read-only.
3. **Authentication:** enable **Embedded** authentication with public sign-up. Under *Whitelisting → Authorized Domains*, add the Slate domain with **CORS enabled**.
4. **Mail:** verify a sender address (Console → Mail). It becomes `FROM_EMAIL`.
5. **Job Scheduling:**
   - Create a **Function** job pool named `siteguard_audits`.
   - Create a **Periodic** cron (every 15 minutes) whose job targets the `audit_scheduler` function in that pool.
6. **Function settings** (Console → Functions):
   - Security Rules: `siteguard_api` → authentication **required**. `billing_webhook` → **optional** (Stripe can't log in; requests are verified by signature).
   - Environment variables for all four functions:

     | Variable | Value |
     |---|---|
     | `APP_URL` | your Slate URL, used in e-mail links and Stripe redirects |
     | `JOB_POOL_NAME` | `siteguard_audits` |
     | `FROM_EMAIL` | the verified sender |
     | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | from Stripe; leave empty to disable payments |
     | `BILLING_DEV_MODE` | `false` in production (`true` lets anyone switch plans without paying) |

     Put secrets in the console, not in `catalyst-config.json`, which is committed.
7. **Web app:** in `client/config.js`, set `apiBase` to the `siteguard_api` URL (`https://<project-domain>.catalystserverless.com/server/siteguard_api`) and `zaid` (Console → Settings → Environments). Both differ between Development and Production.
8. **Stripe** (optional): create a recurring price. Point a webhook at `https://<project-domain>.catalystserverless.com/server/billing_webhook/execute` with the events `checkout.session.completed`, `customer.subscription.updated` and `customer.subscription.deleted`.

## Deploy

```bash
npm install
npm run sync && npm test
catalyst deploy --only functions -ni
catalyst slate:link --source "$(pwd)/client" --name siteguard-web --framework static -ni   # first time only
catalyst deploy slate siteguard-web -ni
```

Test on Development first, then promote to Production (`--production`), using the Production `zaid` and function URL in `client/config.js`.

## Local development

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # 21 tests
npm run scan -- https://example.com   # one-off scan in the terminal
```

`npm run dev` runs the real API and web app with an in-memory store, a dev login (any e-mail) and e-mails printed to the console, so you can work without a Catalyst account. To run against your real Catalyst project, use `catalyst serve`.

## What gets checked

All checks are **passive and non-intrusive**. SiteGuard sends ordinary GET requests, plus one `TRACE` request and one request with a foreign `Origin` header. It never sends attack payloads.

| Area | Issues (default severity) |
|---|---|
| Sensitive files | exposed `.git` (critical), `.env` (critical), config backups (critical), SQL dumps (critical), `.svn` (high), phpinfo (medium), `server-status` (medium), directory listing (medium), `.DS_Store` (low), missing `security.txt` (info) |
| TLS | expired certificate (critical), untrusted/wrong-host certificate (high), expires within 14 days (medium), TLS 1.0/1.1 enabled (medium) |
| Transport | no HTTPS (high), password form over HTTP (high), form posting to http:// (high), active mixed content (high), no HTTP→HTTPS redirect (medium), passive mixed content (low) |
| CORS | origin reflected with credentials (high), origin reflected (medium), `*` (info) |
| Headers | CSP missing (medium), clickjacking (medium), HSTS missing (medium) / short (low), unsafe CSP (low), `X-Content-Type-Options`, `Referrer-Policy`, version banners (low), `Permissions-Policy` (info) |
| Cookies | missing `Secure` / `HttpOnly` / `SameSite` (medium for session cookies) |
| Components | JS libraries with known CVEs: jQuery, jQuery UI, Bootstrap, AngularJS, lodash, moment, Handlebars; third-party scripts without SRI; CMS version disclosure |
| Other | HTTP TRACE enabled, missing SPF / DMARC |

To keep false positives down:
- Each sensitive-file probe has to match a content signature.
- A baseline request to a random path filters out "soft-404" sites that answer 200 to every URL.
- Exposed secrets are masked before they are stored.

The scanner refuses private, loopback, link-local (cloud metadata) and reserved addresses on every connection and every redirect hop.

## How the issue log works

Each finding has a fingerprint (`checkId|key`, e.g. `cookies.no_secure|phpsessid`). After every *completed* audit:

- a fingerprint seen for the first time → new issue, event **detected**
- an open issue that is no longer found → **resolved**, linked to the audit that confirmed the fix
- a resolved issue that is found again → **reopened**

A **failed** audit (site down, timeout) leaves the log untouched. Each report and e-mail lists what is new, what came back and what was fixed since the previous audit.

## Notes and limits

- The Data Store has no transactions. If an `audit_runner` job dies partway through recording results, the audit stays "running" and `audit_scheduler` marks it failed after 30 minutes. Audit jobs are not retried.
- Catalyst runs at most 10 concurrent executions per function by default. Contact Catalyst support to raise this if many scans run at once.
- Plan limits and prices are in `shared/core/plans.js`.
