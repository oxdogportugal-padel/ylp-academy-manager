# Padel Academy Planner — working notes for Claude Code

A class planner for padel academies. One academy today (The Hyve), built so the
move to many tenants later is a migration rather than a rewrite.

Running on Zoho Catalyst: Slate for the static frontend, an Advanced I/O
function for the API, Data Store for the data.

---

## Ground rules

**Never invent a Catalyst API.** Model training data on Catalyst is thin and
stale. Before writing any call to `zcatalyst-sdk-node`, the CLI, or
`catalyst.json`, read the real docs at https://docs.catalyst.zoho.com or copy
the shape from code in this repo that has already been deployed and proven to
work. A confidently wrong method name costs more than the lookup.

**`catalyst init` owns the platform config.** `catalyst.json` and the function
skeleton come from the CLI, not from us. Don't hand-edit them into a shape you
remember; regenerate, or read the docs.

**The engine stays pure.** `matching-engine.js` imports nothing — no SDK, no
HTTP, no database. It takes plain objects and returns plain objects. This is
deliberate: it is the piece that survives a change of host. Any change that
adds an import to it is wrong. Its tests run with `node --test` and no
dependencies; keep it that way.

**Every query is scoped by academy.** All tables carry `academy_id`. The Data
Store has no row-level security, so the repository layer is the only security
boundary. Build one accessor — `forAcademy(id)` returning pre-scoped finders —
and route every handler through it. Never take an academy id from the client,
never build a query inline in a handler. One place to audit beats discipline
applied endpoint by endpoint.

**The rules are data, not constants.** Level scale, level tolerance, class
capacity, allowed durations, coach certification caps and scoring weights live
in `academies.settings` and are read per request. If you ever find yourself
writing `=== 4` or `<= 1` in the engine, stop — that number belongs in the
settings object. Every academy disagrees with at least one default.

**Constraints the Data Store cannot express** are marked `[app]` in
`schema.sql` and must be enforced in the function layer: CHECK constraints,
partial indexes, and the "one live seat per class" uniqueness. There is no
JSONB either — settings and audit payloads are text, parsed on read.

**Every string on screen goes through `t()`.** `client/index.html` speaks
Portuguese, Spanish, French and English, keyed by the English text. A new
string means a new entry in each of `I18N.pt`, `I18N.es` and `I18N.fr`;
`tests/unit/i18n.js` fails until it has them. Plurals: write `seat(s)` and pass
the count as `{n}` — the bracketed ending is dropped for exactly one.

**Nothing renders before sign-in.** The planner and the operator console stay
behind the gate until the API has answered `session`. There is one sign-in
page, the planner's; the console redirects there with `?next=admin`.

---

## Layout

```
functions/api/        Advanced I/O function — HTTP handlers
  matching-engine.js  pure domain logic (do not add imports)
  repository.js       tenant-scoped Data Store access — the security boundary
  setup.js            applies schema.sql; idempotent, safe to re-run
client/
  index.html          single-file frontend, no build step
schema.sql            source of truth for the schema
```

---

## Domain, in one pass

- **Players** have a level on an academy-defined scale (default 0–10, halves
  allowed). Levels are opinions that change — write to `player_levels` on every
  change, never just overwrite.
- **Classes** are weekly recurring slots: weekday, start time, duration, level,
  seats. Dated occurrences (attendance, cancellations, make-ups) are a later
  layer and not in the POC.
- **A player fits a class** when the level gap is within tolerance and a seat is
  free. Ranking then weighs time-window match, how close the current group's
  average level is, and seats left.
- **Court time is a contract, not a building.** `court_allocations` records how
  many of a venue's courts the academy actually controls and when. An academy
  renting 3 of 8 courts on Tuesday evenings is normal, and ignoring it is the
  usual reason a scheduler proposes impossible classes.
- **Coach certification caps the level they may teach** — the mapping is in
  settings, not hardcoded.
- **Partial placement is a real state.** Someone who wants two sessions a week
  and gets one is placed once and still waiting once. Never silently drop the
  remainder; that outstanding half is what drives the waiting-list alerts.
- **Opening a new class needs four things at once**: enough waiting players
  within tolerance of each other, a shared time window, a court the academy
  controls, and a free certified coach. Three out of four is not a suggestion
  worth showing.

---

## Frontend

`client/index.html` is one file, vanilla JS, no framework and no build. Its
storage layer is four functions — `put`, `drop`, `saveAcademy`, `subscribe` —
and nothing else touches persistence. Porting storage means replacing those
four with `fetch` calls against the API. Don't introduce a framework or a
bundler to the POC; the single file is why it deploys in seconds.

---

## Deploying

- `catalyst serve` to run locally before anything else.
- `catalyst deploy` to ship.
- `catalyst login` is interactive and must be run by a human.
- Promoting development to production is a console action, not a CLI one.
- Test against the development environment. Never point local work at
  production data.

---

## Data care

Padel academies are full of under-18s. `players` carries guardian contact and a
consent timestamp. Do not load real player data into any demo, screenshot or
shared environment before the DPA with the academy exists — invented names test
the interface just as well.
