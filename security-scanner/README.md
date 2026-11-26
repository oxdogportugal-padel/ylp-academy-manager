# SiteGuard — website security auditor

SiteGuard scans a public URL for well-known web security issues and lists them from most to least severe (critical → high → medium → low → info), with an A–F grade.

- **Free plan:** a severity-ranked list of issues, for up to 3 sites.
- **Pro plan:** detailed reports (why each issue matters, evidence, how to fix it, CWE/OWASP mapping), scheduled audits (daily, weekly or monthly) with the report sent by e-mail, and JSON export.
- **Every plan:** a full log of every audit for each site. An **issue log** records when each issue was first detected, which audit found it fixed, and whether it came back later.

This is a standalone Node.js app. It is separate from the Catalyst academy app in the rest of this repository.

## Quick start

```bash
cd security-scanner
npm install
npm run dev          # http://localhost:3000, with BILLING_DEV_MODE=true so you can switch to Pro without paying
npm test             # 11 tests: scanner, issue lifecycle, plans, scheduler + e-mail, SSRF guard, auth
npm run scan -- https://example.com   # one-off scan in the terminal
```

Requires Node ≥ 22.13. It uses the built-in `node:sqlite`, so there are no native dependencies. Copy `.env.example` to `.env` (or export the variables) to configure SMTP, Stripe and the other settings.

## What gets checked

All checks are **passive and non-intrusive**. SiteGuard sends ordinary GET requests (plus one `TRACE` request and one request with a foreign `Origin` header). It never sends attack payloads.

| Area | Issues (default severity) |
|---|---|
| Sensitive files | exposed `.git` (critical), `.env` (critical), config backups such as `wp-config.php.bak` (critical), SQL dumps (critical), `.svn` (high), phpinfo (medium), Apache `server-status` (medium), directory listing (medium), `.DS_Store` (low), missing `security.txt` (info) |
| TLS | expired certificate (critical), untrusted/self-signed/wrong-host certificate (high), expires within 14 days (medium), TLS 1.0/1.1 enabled (medium) |
| Transport | no HTTPS (high), password form over HTTP (high), form posting to http:// (high), active mixed content (high), HTTP not redirecting to HTTPS (medium), passive mixed content (low) |
| CORS | arbitrary origin reflected with credentials (high), arbitrary origin reflected (medium), `*` (info) |
| Headers | CSP missing (medium), clickjacking protection missing (medium), HSTS missing (medium) or too short (low), unsafe CSP (low), `X-Content-Type-Options` (low), `Referrer-Policy` (low), `Permissions-Policy` (info), Server/X-Powered-By version leaks (low) |
| Cookies | missing `Secure`, `HttpOnly`, `SameSite` (raised to medium for session-like cookies) |
| Components | JS libraries with known CVEs: jQuery, jQuery UI, Bootstrap, AngularJS, lodash, moment, Handlebars (medium/high); third-party scripts without SRI (low); CMS version in a `generator` meta tag (low) |
| Other | HTTP TRACE enabled (low), missing SPF / DMARC records (low) |

To keep false positives down, each sensitive-file probe has to match a content signature. A baseline request to a random path also filters out "soft-404" sites that answer 200 to every URL. When an exposed file is found, its contents are masked before they are stored, so leaked secrets never end up in SiteGuard's own database.

To add a check, write a module in `src/scanner/checks/`, call `ctx.add(checkId, key, evidence)`, and describe the issue in `src/scanner/catalog.js`.

## How the issue log works

Each finding has a **fingerprint** (`checkId|key`, e.g. `cookies.no_secure|phpsessid`). After every *completed* audit of a site:

- a fingerprint seen for the first time → new issue, event **detected**
- an open issue that is no longer found → **resolved**, linked to the audit that confirmed the fix, with a timestamp
- a resolved issue that shows up again → **reopened** (with a reopen counter)

A **failed** audit (site down, timeout) leaves the log untouched, so an outage is never read as "everything fixed". Each report also shows what is new, what came back and what was fixed since the previous audit. Scheduled e-mails show the same changes.

Tables are defined in `src/db.js`: `targets`, `audits`, `findings` (per-audit snapshot with evidence), `issues` (lifecycle state), `issue_events` (full history), `schedules`, `email_log`.

## Scheduled audits and e-mail

Pro users can set a daily, weekly or monthly schedule per site, with up to 10 recipients. The first audit runs within a minute of creating the schedule. An in-process scheduler (every 60 s) runs due audits and e-mails an HTML report. It moves `next_run_at` forward before running, so a crash cannot run the same slot twice. If a user drops back to Free, their schedules are kept but paused.

- Set `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` to send real mail.
- Without SMTP, every e-mail is written to `data/outbox/*.eml` (useful in development).

## Payments

Pro is sold through **Stripe Checkout** using its REST API (no SDK). Set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` (a recurring price) and `STRIPE_WEBHOOK_SECRET`. Then point a Stripe webhook at `POST /api/billing/webhook` with the events `checkout.session.completed`, `customer.subscription.updated` and `customer.subscription.deleted`. Subscribers manage or cancel their plan in the Stripe customer portal. Plan limits and prices are in `src/plans.js`.

## Security of SiteGuard itself

- **SSRF protection:** every connection, including each redirect hop and the TLS handshakes, goes through a DNS guard. The guard refuses loopback, private, link-local (cloud metadata), CGNAT and reserved addresses, and `.internal`/`.local` hosts. Never set `SCANNER_ALLOW_PRIVATE=true` in production.
- Passwords are hashed with scrypt. Session tokens are random, stored only as hashes, and sent in `HttpOnly; SameSite=Lax` cookies (`Secure` when `NODE_ENV=production`).
- State-changing API calls must be JSON (CSRF guard). Every query is scoped to the logged-in user.
- The app sends a strict CSP, HSTS (in production), nosniff, frame-deny, Referrer-Policy and Permissions-Policy.
- Rate limits: 3 sites / 10 manual audits per day on Free, 50 / 200 on Pro.

## Layout

```
src/
  server.js          entry point (HTTP server + scheduler)
  app.js             REST API (Express)
  scanner/           http-client (with SSRF guard), checks/, catalog of issues, scoring
  audits.js          audit queue + issue-lifecycle bookkeeping
  report.js          plan-aware report + issue log
  scheduler.js       recurring audits
  email-report.js    HTML/text e-mail rendering
  mailer.js          SMTP or outbox
  billing.js         Stripe Checkout, portal, webhook, dev plan switch
public/              single-page web app (vanilla JS, no build step)
test/                node:test suites + a deliberately insecure fixture site
```

## Production notes

- Run behind HTTPS (a reverse proxy or the platform's load balancer) with `NODE_ENV=production` and `APP_URL` set to the public URL.
- The scheduler runs inside the web process and uses SQLite. Run a **single instance**. To scale out, move the queue and scheduler to a worker and the database to Postgres.
- Only scan sites you own or are authorised to test. The footer and terms should say this.
