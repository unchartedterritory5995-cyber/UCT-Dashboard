# Options Flow cold-paint rig — how a run is performed and what it must report

The instrument is `tools/flow_cold_paint_rig.py`. **It owns its own mechanics; do not
restate them here** — a second copy of the detector's rules is a second authority over
one value, which is the defect this repo names more than any other. This file owns the
*operating* requirements: which paths a session measures, and what every run must print
whether or not anyone asks for it.

---

## ⛔⛔ TWO PATHS, MEASURED AND REPORTED SEPARATELY

**A session that reports one number has not measured the page.** There are two ways a
member arrives at Options Flow and they differ by roughly nine seconds of wall clock
that has nothing to do with the product:

| path | how it is reached | the intro | what the number means |
|---|---|---|---|
| **A — direct load** | typed URL, bookmark, refresh, post-deploy reload | **PLAYS** (~9.3 s) | what a member sees on a cold entry into the app |
| **B — in-app navigation** | clicking Options Flow in the nav from another page | **does not play** | the page's own cost, with the app already warm |

`IntroAnimation` is mounted at the `App.jsx` root inside `<AuthProvider>`, so a route
change does not remount it. That is the whole mechanism, and it is why the two numbers
are not comparable and must never be averaged, medianed together, or quoted as one.

⛔ **Report both, labelled, every session.** A path-B number quoted as "the cold paint"
flatters by ~9 s; a path-A number quoted as "the page cost" indicts the intro for the
page's work.

⛔ **Do NOT press Escape to skip the intro on path A.** Tried 2026-09-12: dismissing it
that way dropped the rendered body from 4,402 chars to 540 and produced a duplicated
aggregate+data round. It disturbs the app; it does not skip an overlay. The intro is
excluded by the **detector** instead, which costs up to ~9 s of wall time per run and
measures the right thing.

---

## ⛔⛔ EVERY RUN REPORTS ITS TRANSPORT: WHOLE-D vs PARTS

**A run that reports only a duration cannot tell a fast page from a fast page fetching
the wrong thing.** Beside the timing, each run prints which requests actually went out:
the `part=` values served, the `X-Flow-Version` seen at paint, and the flow URLs.

⚰️ **THIS LINE EXISTS BECAUSE THE REGRESSION IT CATCHES HAD ALREADY SHIPPED AND NOTHING
SAW IT.** On 2026-09-12 a member session was measured fetching **whole-day aggregate plus
a 5.5 MB tape** where it should have fetched `part=bootstrap` + `part=TOP_PICKS`. Root
cause: `Dockerfile.web` carried **zero `ARG` declarations**, so every `VITE_*` was
undefined during `npm run build`, `USE_PARTS` folded to `false`, and the whole parts path
was tree-shaken out of the bundle — since `af80e0b91`, 2026-09-08 21:53 ET.

⭐ **Nothing failed.** The suite was green, `/api/health` was 200, flow-worker was
building the parts cache correctly and serving it correctly. **No browser was asking for
it.** A timing-only rig on a quiet tape would have reported a perfectly healthy number
for a page on the wrong transport — which is exactly what "a regression hiding behind a
fast-looking number" means.

**So the transport line is not diagnostics. It is the measurement.** If `parts_served`
is empty on a build that is supposed to use parts, the run is a **FAILURE**, whatever the
milliseconds say.

---

## The label rule

Every row and the summary carry a label, and `--certifying` is the only thing that drops
it. Without that flag the run prints **"QUIET TAPE — NOT A MEASUREMENT"**, because on a
quiet tape the parts are already warm and the version never rolls: the run measures a
best case no member hits during RTH. `--certifying` is for RTH only.

⚠️ An unlabelled number quoted out of a non-certifying run is the instrument lying on the
operator's behalf. The label rides on the row so it survives copy-paste.

---

## Account

`MEMBER_SMOKE_EMAIL` / `MEMBER_SMOKE_PASSWORD` from the operator's environment — a
`role=member` account, which is the point: an admin session may render more regions than
a member's, so **an admin number is not a member number**. Run the admin account only as
an explicitly labelled secondary comparison.

⛔ Credentials live where the smoke account's credentials already live. Never in a
commit, never in a log, never printed.

---

## What the tool does today, and what it does not

Stated plainly so nobody reads this file as a description of shipped behaviour:

- ✅ Path A (direct load, intro-gated) — implemented, with the intro excluded by the
  detector.
- ✅ Transport reporting — implemented: `parts_served`, `part_versions`,
  `current_version_after`, `wire_bytes_flow` and the full `flow_urls` list print on every
  run.
- ✅ The label, the fresh context per run, the visible-tab assertion, the streaming
  response capture and the pinned ≥1025 px viewport — all implemented.
- ⛔ **Path B (in-app navigation) is NOT implemented yet.** It needs a run mode that
  lands on another route, waits for the app to settle, then CLICKS the Options Flow nav
  entry and measures from the click. **This is required before the Monday RTH session
  can report a complete result**, and a session that cannot run it must say so rather
  than report path A alone as "the" number.

⛔ **CLICK, never `goto`, for path B.** A full page load rebuilds the world and replays
the intro — that is path A wearing path B's label, and it is the same mistake that hid
the 2026-09-10 navigation freeze from every instrument that looked.

---

## Running it

    python tools/flow_cold_paint_rig.py --runs 5                # labelled, any time
    python tools/flow_cold_paint_rig.py --runs 5 --certifying   # RTH only

Three outcomes, three different facts — do not collapse them:

| | |
|---|---|
| a completed run with its label | a measurement of what it says it measured |
| `INCONCLUSIVE` (no credentials, login non-200) | **not a pass** — nothing was measured |
| parts expected and `parts_served` empty | a **FAILURE**, regardless of the timing |
