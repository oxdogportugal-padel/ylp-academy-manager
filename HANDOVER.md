# Bandeja — handover to Claude Code on your machine

Everything needed to carry on locally, as of 3 November 2026.
Read this first; `CLAUDE.md` holds the standing ground rules.

---

## What you actually gain by moving

The Catalyst MCP connector is **not** the gain — it worked in the cloud session
too, and every table, column, permission grant and log read so far was done
through it. It will keep working locally.

The gain is the **Catalyst CLI**, which cannot run in a cloud sandbox:

| | Cloud session | Your machine |
|---|---|---|
| Catalyst MCP connector (tables, permissions, logs) | ✅ | ✅ |
| `catalyst login` | ❌ interactive, needs a human | ✅ |
| `catalyst serve` — run the whole stack locally | ❌ | ✅ |
| `catalyst deploy` — ship client + function in one command | ❌ | ✅ |
| `npm install` | ❌ registry unreachable | ✅ |
| Tests against the **real** SDK instead of a fake | ❌ | ✅ |

Concretely: today every change ends with me building a zip and you uploading it
twice through the console. After the move that becomes `catalyst deploy`.

---

## Setting up, once

```bash
npm i -g zcatalyst-cli          # the CLI
catalyst login                  # interactive — must be you, not Claude
catalyst init                   # pick the EU DC, project YLP-Academy-Manager
```

**Let `catalyst init` create the project skeleton and `catalyst.json`.** Do not
hand-write them — that is a standing rule in `CLAUDE.md` and it exists because
model knowledge of Catalyst is thin and stale. Then copy the files from this
package into the folders the CLI made:

| From this package | Goes to |
|---|---|
| `client/index.html`, `client/admin.html`, `client/client-package.json` | the Slate/client folder |
| `client/.catalyst/slate-config.toml` | same folder, if the CLI did not make one |
| `functions/api/*` | the Advanced I/O function folder |
| `tests/`, `docs/`, `manual/`, `CLAUDE.md`, `HANDOVER.md` | repo root |

Then `cd` into the function folder and `npm install` — the console zip upload
never installed dependencies, which is why the function had to be created from
the *Default Template with Catalyst SDK*. Locally that constraint disappears.

Put the repo under git before the first deploy. There is no version history of
any of this work right now; that is the single biggest risk in the project.

---

## Running it

```bash
catalyst serve                  # whole stack, local
cd tests && node run-all.js     # 92 tests, ~40s
```

The test suites need Playwright for the browser ones:
`npm i -D playwright && npx playwright install chromium`.
Set `CHROMIUM=/path/to/chrome` to point at a browser you already have.

---

## What is live right now

Development environment only. Nothing has been promoted to Production.

- Org `20105401867`, project `YLP-Academy-Manager` id `5361000000043001`, EU DC
- Development ZAID `30047977891` — **this differs in Production**, and it is
  hardcoded at the top of `functions/api/index.js`. Change it when you promote,
  or the app will authenticate against the wrong environment.
- Function URL ends in `/server/api/execute` — the `/execute` suffix is required
- 13 Data Store tables; IDs and the three non-obvious Data Store behaviours are
  in `docs/catalyst-schema.md`
- App User permissions are **revoked on every table**. The function is the only
  path to data. Do not re-grant them: that is the tenant isolation boundary.
- Seeded: The Hyve `5361000000046783`, Costa Padel Academy `5361000000052258`,
  a PlatformAdmins row for `info@youlovepadel.pt`

**The deployed build is older than this package.** The branding, the mobile
navigation, the setup checklist, the roster paste, player search, feedback,
Move to… and drag-to-reschedule are all in these files and none of them are
deployed. First local `catalyst deploy` ships the lot.

---

## Branding

**Bandeja · by YLP Solutions.** Palette and type are the app's existing ones,
formalised; the full kit (lockups, mark at every size, colour rules, type scale)
is an artifact on claude.ai — search your artifacts for "Bandeja Brand Kit".

The mark is inline SVG in both HTML files and in the favicon data URI. Geometry,
on a `0 0 120 100` viewBox:

```
<circle cx="60" cy="38" r="21"/>
<path d="M14 44 Q60 90 106 44" stroke-width="12" stroke-linecap="round" fill="none"/>
```

At 40px and below the ball and stroke thicken (`r=22/sw=13`, then `r=24/sw=15`)
so it holds together. An earlier, thinner version read as a smiley face; if you
ever redraw it, check it at 16px before anything else.

Two things not yet done: **YLP Solutions should be a registered trade name**
before it appears on an invoice or a contract, and nobody has checked
`bandeja.pt` / `bandeja.app` or the INPI register for the name.

---

## Where the code disagrees with CLAUDE.md

Worth settling early, because `CLAUDE.md` is what steers every future session.

1. **`matching-engine.js` does not exist.** CLAUDE.md describes a pure,
   import-free engine in `functions/api/matching-engine.js` that survives a
   change of host. In reality the matching logic lives inline in
   `client/index.html` (`canSchedule`, `fit`, `formable`, `freeStarts`) and
   partly in the function. The POC folder that held the pure engine was lost
   when a container recycled. Either extract it again and honour the rule, or
   amend CLAUDE.md to describe what is actually there. Leaving the gap is the
   worst of the three.
2. **Layout.** CLAUDE.md says `functions/api/` and `client/`; the working folder
   used `function/` and root-level HTML. This package follows CLAUDE.md.
3. **Rules as data.** Mostly honoured — levels, tolerance, capacity, durations
   and coach caps all read from `academies.settings`. `DAY_START`, `DAY_END`
   and `ROW` in `client/index.html` are still constants (08:00–22:00 grid).
   Fine for now; an academy running 07:00 classes will need them moved.

---

## Done since this handover was written

- **Phone tables.** The waiting list and Classes list render as one card per
  row under 768px (`table.stack`), the table above.
- **Sign-in gate.** `index.html` shows nothing of the planner until the API has
  confirmed who you are and returned an academy: a splash, the sign-in box, or
  a one-sentence refusal (no academy, suspended, cannot connect).
- **One sign-in, for the console too.** `admin.html` has no login of its own.
  Signed out it redirects to `/?next=admin`; after sign-in the planner sends
  operators back to the console. Non-operators who open `/admin.html` are sent
  to the planner. The server's 403 on `admin/*` is still what keeps them out.
- **Four languages, chosen per academy.** Portuguese (default), Spanish,
  French, English. The operator picks it when creating an academy and can
  change it under Edit. Every string goes through `t()` in `index.html`;
  `tests/unit/i18n.js` fails if any string lacks a translation. Before sign-in
  the browser's language is used, with a switcher at the bottom of the page.
  The operator console itself is English only.
- **First-login tour.** Six steps, shown once per person, recorded on the
  server; replay from Manage → Academy → Show the tour again.
- **Manual regenerated with Bandeja branding** — `node manual/shots.js` then
  `python3 manual/build.py` → `manual/Bandeja-Guide.pdf` (English; set
  `LANG_UI=pt` for Portuguese screenshots — the text of the guide is English).

Language and tour progress live in `Academies.Settings` under keys the server
protects (`language`, `tutorialDone`) — no schema change was needed. See
`docs/catalyst-schema.md`.

## Still outstanding

1. **Deploy.** Function and client both changed; they must ship together, the
   client calls the new `session` and `tutorial` paths.
2. **Portuguese edition of the guide** — the screenshots can already be
   Portuguese; the prose in `manual/build.py` is English.
3. **Promote to Production** — a console action, not a CLI one — and change the
   ZAID.

Deferred and agreed as post-trial: calendar auto-fit to the earliest and latest
class, level names instead of numbers, archive and undo on delete (a `Status`
column already exists on every table), full keyboard and ARIA support.

---

## Things that cost real time to rediscover

- Row writes to Data Store want an **array**, not an object. Passing an object
  gives `Required object but 'object' found!`.
- ZCQL `SELECT` is capped at 300 rows and wraps results under the table name;
  `unwrap()` in the function handles both.
- There is no JSON column type. Settings and audit payloads are text, parsed on
  read. Text columns cap at 10000.
- `Create_CORS_Domain` wants a bare hostname — no `https://` — which is the
  opposite of what the console UI asks for.
- The Web SDK needs **two** scripts: the bundle from the Zoho CDN *then*
  `/__catalyst/sdk/init.js`. Missing the first one makes `window.catalyst`
  undefined and the app silently runs local-only. That cost an afternoon.
- A Slate upload can report success in the list while having actually failed —
  check the duration. 20 minutes means failed; ~30 seconds means it worked.
- Data care: `players` carries guardian contact and a consent timestamp. No real
  player data in any demo, screenshot or shared environment before the DPA with
  the academy exists.
