# Padel Academy Planner — Catalyst client

The planner as a single HTML page, talking to Catalyst Data Store from the
browser through the Web SDK. No build step, no framework, no function, no CLI.

Project: `YLP-Academy-Manager` (`5361000000043001`), EU data center.
Schema and table IDs: see `catalyst-schema.md`.

## How it reaches the data

There are no keys in this page. Catalyst injects `/__catalyst/sdk/init.js` and
a session cookie when the page is served from Slate, and every read and write
goes out as the signed-in App User. That is also why **this page only works
served from Catalyst** — opening the file locally gets you the interface with
nothing behind it, and the status note in Manage → Academy says so.

Reads go through ZCQL, scoped to one academy and paged at 300 rows. Writes go
through the table API. The academy comes from `?a=<slug>` in the URL, falling
back to the first row in Academies — so one deploy can serve several academies
by link.

## Before it will work — four console steps

1. **Slate activation.** Console → project → Slate → Start Exploring. One-time,
   five seconds.
2. **App User permissions.** Only `Select` is on by default, so writes return
   403 until you fix it. Console → Data Store → *each table* → Scopes and
   Permissions → App User → tick Insert, Update, Delete. All nine tables the
   client touches: Clubs, Coaches, ClubCoaches, Players, Classes,
   ClassEnrollments, Requests, RequestWindows, and Academies.
3. **Authentication type must be Embedded**, not Hosted, or the sign-in widget
   renders nothing. The page shows a hint in that case rather than failing
   silently.
4. **Authorized Domains.** Add the Slate origin with the CORS toggle on.

Then add an App User for each coordinator who should get in. Project
collaborators and admins are *not* app users — `getCurrentUser()` returns null
for them, so signing in with your own Zoho admin account will not work until
you register yourself as an app user too.

## Deploying without the CLI

Slate takes a GitHub or GitLab repo and auto-builds on push, and it supports
plain static HTML. Put this folder in a private repo, connect it in the Slate
console once, and pushes deploy themselves. Private, because the page is for
your academies rather than the public.

## What the port had to absorb

The three Data Store behaviours in `catalyst-schema.md`, all verified against
the live project rather than assumed:

- ZCQL nests every row under its table name, so `zcql()` unwraps it, merging
  the keys when a query spans tables.
- Numbers arrive as strings on the table API and as numbers through ZCQL.
- ROWIDs and every `*Id` column arrive as strings.

That last one is why **every id is normalised to a string once**, in the
mapping layer. The matching engine compares ids with `!==`; a string on one
side and a number on the other makes it silently return no matches while
looking perfectly healthy.

Two further consequences of the real schema:

**Server-assigned ids.** Rows get their ROWID from Catalyst, not the client,
so a create has to finish before anything can reference it. The four storage
functions all return promises, and the three places that chain creates —
seeding the sample week, opening a class off a waiting-list alert, and booking
a player into a class — await them.

**Normalised children.** The flat shape the interface works in is stitched
together on read and diffed on write. A class's `playerIds` is a diff against
ClassEnrollments, so two coordinators editing different classes never clobber
each other. A coach's `venueIds` is a diff against ClubCoaches. A request's
`windows` are small and always edited as a set, so those are replaced
wholesale.

## Verified

Run against an in-memory stand-in for the Web SDK that reproduces all three
quirks above. Seeding the sample week produced 2 clubs, 3 coaches, 5
club-coach links, 12 players, 9 classes, 17 enrollments, 3 requests and 4
request windows; rosters and windows hydrated back to the right shape; every
id came through as a string; the engine still found 3 matching classes for a
level-3 player; booking added exactly one player and one enrollment; opening a
class off an alert added exactly one class; removing a player deleted exactly
one enrollment; and renaming the academy persisted both the name and the
changed tolerance into the Academies row.

Not yet verified against the live project — that needs the console steps above.

## Still a POC

Data Store permissions are per-table, not per-row. Every signed-in App User can
therefore read every academy's rows, whatever `?a=` says. Real isolation needs
the tenant scoping to move server-side into a function, which is the one piece
that genuinely needs the CLI. Fine while the data is invented; not fine with
real rosters.
