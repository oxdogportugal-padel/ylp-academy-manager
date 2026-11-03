# Bandeja · by YLP Solutions

Class planner for padel academies, running on Zoho Catalyst (Slate client,
Advanced I/O function, Data Store).

- `client/` — `index.html` (academy app) and `admin.html` (platform admin), no build step
- `functions/api/` — the Advanced I/O function (`/server/api/execute`)
- `docs/` — Data Store schema and Slate notes
- `tests/` — `node tests/run-all.js` (unit tests against a fake SDK, plus Playwright browser tests)
- `manual/` — user guide PDF and its generator

Start with [`HANDOVER.md`](HANDOVER.md), then [`CLAUDE.md`](CLAUDE.md) for the standing rules.
`catalyst.json` is intentionally absent: run `catalyst init` to generate it.
