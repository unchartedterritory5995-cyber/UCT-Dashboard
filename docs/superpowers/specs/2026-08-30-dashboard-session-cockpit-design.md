# Dashboard → Session Cockpit — Design Document

**Date:** 2026-08-30
**Status:** Approved
**Route:** `/dashboard` (paid home)
**Supersedes the dashboard section of:** `docs/plans/2026-02-22-dashboard-redesign.md`

---

## Overview

`/dashboard` is the paid member's home, the post-login destination, and the
error-recovery target. It is currently a 15-tile accumulator that renders one
composition regardless of what kind of day it is, and it has no height budget,
so it grew to 5.5–6.9 screens without any single change looking wrong.

This redesign gives the page **one job** — *start my trading day* — and
**one governing rule**: the page knows what session it is in, and it cannot
exceed its height budget.

The mobile layout in this same file already embodies both ideas (2,768 px,
triaged, decision-first). Desktop never adopted them. The direction of this
work is **desktop adopts mobile's discipline**, not the reverse.

### Goals

1. The page fits one viewport at 1050 px tall with no outer scroll.
2. The page renders a deliberate composition in **every** session state,
   including weekends — no blank heroes, no dead columns.
3. Discoverability of the other sections is preserved at ~90 px instead of
   ~4,000 px.
4. A test fails if the page ever exceeds its height budget again.

### Non-goals

- Changing what any tile *computes*. This is composition, not data work.
- Fixing the catalyst engine's single missing weekday (2026-08-27). Logged
  as a separate concern in **Deferred**, below.
- Journal 2.0 internals. Zone C reads existing J2 endpoints only.
- Morning Wire, which is the **free** home and unaffected by this work.

---

## Measured baseline

All figures measured live on production 2026-08-30 against `origin/master`.
They are the acceptance baseline: Phase 3 must beat them.

| Measure | Desktop 2133×1050 | Laptop 1277×1000 | Phone 390 |
|---|---:|---:|---:|
| Total scroll height | 5,783 px | 6,879 px | 2,768 px |
| Screens of scroll | 5.5 | 6.9 | 2.8 |
| Largest single tile | 3,081 px | 3,629 px | — |

**Request fan-out:** 50 API calls across 46 distinct endpoints, 386 KB, to
paint the home page — most of it serving tiles below the fold.

**Test coverage:** `app/src/pages/Dashboard.test.jsx` contains exactly one
test, `renders dashboard page without crashing`. There is no composition
rail and no height rail. This is the mechanism by which 2,714 px of empty
box shipped and stayed.

### The four defects

1. **Sector Rotation void — 2,714 px, 47% of the page.**
   The tile measures 3,081 px; its body 3,037 px; its content is a 323 px
   list (11 rows × 27 px). `TileCard.module.css` sets `height: 100%` on
   `.tile` and `flex: 1` on `.body`. Every other tile is rendered inside a
   grid row (`.rowB` / `.rowC` / `.rowD` / `.rail`) whose track supplies a
   height. **`<SectorRotation />` is the only tile rendered as a bare child
   of `.desktopOnly`**, which is `display: block; height: auto` — so
   `height: 100%` has no track to resolve against and `flex: 1` expands into
   the gap.

2. **Hero / rail imbalance — 849 px dead column.**
   `.rowB` allots the catalysts hero `7fr` and the journal rail `5fr`. The
   hero renders 221 px on a closed session; the rail renders 1,070 px.

3. **The glance row does not glance — 908 px (1,424 px at 1277).**
   `.rowC` uses `align-items: stretch` with no `max-height`, so all four
   tiles inherit the tallest sibling's height (UCT 20's 20 rows).

4. **AI Search orb overlaps content at every width.**
   Fixed and horizontally centred over the content column: it covers the
   IWM index box at 2133 px and the "Quote of the Day" heading at 1277 px.

### Non-canonical breakpoints

`Dashboard.module.css` currently uses `1440`, `1100`, `768` and `640`.
Per CLAUDE.md the canonical literals are **640** and **1024** only. This
file is being rewritten, so all four snap to the canonical set.

---

## Session states

The page resolves exactly one state per render, from existing market-session
logic (`useMarketOpen`). Only **Zone B** varies; A, C and D are constant.

| State | When | Zone B content |
|---|---|---|
| `PREMARKET` | weekday before 09:30 ET | Today's catalysts (as scored overnight) |
| `LIVE` | weekday 09:30–16:00 ET | Today's catalysts, live prices overlaid |
| `CLOSED` | weekday after 16:00 ET | Today's catalysts, marked settled |
| `WEEKEND` | Sat/Sun and market holidays | **The Week** (see below) |

A 24-day production sweep of the catalyst store confirms the split this
design assumes:

```
weekends (8 days)   0 rows — every one
weekdays (17 days)  19–20 rows — 16 of 17
single gap          2026-08-27 (Thu) = 0
```

So catalysts are a sound weekday hero. `WEEKEND` is the state that must be
designed rather than defaulted, and the single weekday gap is handled by the
same empty-state treatment rather than by blocking on the engine.

### The Week (weekend Zone B)

Assembled entirely from endpoints that already exist. No new backends.

| Panel | Source |
|---|---|
| Latest Sunday Scan | `GET /api/desk/articles`, slug prefix `sunday-scans-` |
| Compass Weekly Review | `GET /api/j2/accounts/{id}/coach/weekly-reviews` |
| Next week on deck | `GET /api/calendar` — forward-week earnings |
| From the Desk | `GET /api/desk/articles` — recent articles/videos |

If a panel has nothing, it is omitted and the remaining panels reflow. The
zone never renders an empty frame.

---

## Structure

Four zones, each with a **declared height budget**. Content scrolls inside
its zone; the page itself does not scroll.

```
┌────────────────────────────────────────────────┬──────────┐
│ ZONE A · THE READ                       120px  │          │
│ session pill · UCT exposure · index strip      │  MOVERS  │
├────────────────────────────────────────────────┤  240px   │
│ ZONE B · THE DECISION                   440px  │          │
│ weekday → 20 scored catalysts, ★ yours         │  scrolls │
│ weekend → The Week                             │  inside  │
├────────────────────────────────────────────────┤  its own │
│ ZONE C · YOUR RISK                      300px  │  budget  │
│ today's P&L · open positions · stops · risk    │          │
├────────────────────────────────────────────────┴──────────┤
│ ZONE D · THE DOORS                       90px             │
│ 8 section cards, one live number each                     │
└───────────────────────────────────────────────────────────┘
  120 + 440 + 300 + 90 + 3 gaps ≈ 990 px   ≤ 1050 px budget
```

### Zone A — The Read (120 px)

Always present. Session pill with countdown to the next boundary; the UCT
Exposure Rating as one number plus its one-line note; a compact index strip
(QQQ SPY IWM DIA VIX BTC).

**Quote of the Day** drops from roughly half the top row to a single line.
It is brand, not data, and it currently occupies the most valuable region on
the paid home. It becomes a first-class element of the `WEEKEND` state,
where there is room for it. *Reversible: it is one flag on the Zone A
component.*

### Zone B — The Decision (440 px)

The hero. `CatalystTable` on weekdays; **The Week** on weekends. Scrolls
internally; the zone's height does not change with row count. Empty state
(the one weekday gap, or a cold cache) collapses to a slim bar with a
reason and a link to `/catalysts/history` — it does not leave a hole.

### Zone C — Your Risk (300 px)

Reworked `JournalSnapshotTile`: today's P&L, open positions **with their
stops**, and open risk in dollars and R.

**The 3-month equity curve moves to `/journal`.** It is not a decision
input, and it is currently the first number the page shows. *Reversible:
it is a prop on the Zone C component.*

### Zone D — The Doors (90 px)

Eight section cards, each carrying **one live number** — *Breadth · 65*,
*Options Flow · 1,204 today*, *UCT 20 · +2.3% wk*, *Desk · 3 new*. This is
the load-bearing idea of the redesign: it preserves the discoverability the
previews were added for, at ~90 px instead of ~4,000 px. A signpost is not a
duplicate; it is a link with a number on it.

Numbers come from a single new aggregate endpoint (below), not from eight
tile-sized fetches.

### Movers rail (240 px)

Returns to what `2026-02-22-dashboard-redesign.md` originally specified: a
dedicated narrow right rail, Dashboard only, capped height, scrolling
internally. Absorbs `TapeFeed` as its "On the tape" section — which is
already how `MoversSidebar` renders it on mobile.

---

## Component dispositions

All 15 tile components currently imported by `Dashboard.jsx`.

| Tile | Disposition |
|---|---|
| `FuturesStrip` | **Rework** → Zone A index strip; quote demoted |
| `MarketBreadth` | **Rework** → Zone A exposure number |
| `CatalystTable` | **Keep** → Zone B weekday hero |
| `JournalSnapshotTile` | **Rework** → Zone C; curve removed |
| `MoversSidebar` | **Keep** → dedicated rail; absorbs `TapeFeed` |
| `LeadershipTile` | → door (`/uct-20`) |
| `CatalystFlow` | → door (`/calendar`) |
| `OptionsFlowPreview` | → door (`/options-flow`) |
| `DeskVideoRail` | → door (`/desk`) |
| `CompassTodayTile` | → door (`/journal/compass`) |
| `SectorRotation` | → door (`/breadth`) |
| `IntradayPulse` | → door (`/breadth`) |
| `FlowScoreboardTile` | **Rehome first** — see below |
| `TapeFeed` | **Rehome first** — into the Movers rail |
| `ThemeTracker` | **Rehome first** — fix the broken door |

Components that become doors are **not deleted**. They keep their files and
their own routes; only their dashboard mount is removed. This is the same
idiom used for `LiveFlow.jsx` and `trades.py` — keep as rollback backup,
remove the mount.

### The three rehomings (Phase 2 — prerequisite)

- **`ThemeTracker` — a broken door, not a missing room.** It is reachable
  as the `themes` widget inside `/charts`, but `/theme-tracker` redirects to
  *bare* `/charts` via `LegacyRedirect`, which only shows it if the member's
  saved `charts_workspace_layout` happens to contain that widget. Fix:
  `/theme-tracker` seeds a themes widget into the workspace when the saved
  layout has none.
- **`FlowScoreboardTile`** — `/flow-scoreboard` is a live route with no nav
  entry. Fix: add it to the nav under the Options Flow group.
- **`TapeFeed`** — has no page at all. Fix: it becomes the Movers rail's
  "On the tape" section, matching the existing mobile treatment.

---

## The height budget invariant

**Locked.** Every zone declares `max-height` and `overflow: hidden`; every
tile inside a zone scrolls within it. No dashboard tile may be rendered as a
bare child of a block-level container — every tile sits in a wrapper whose
height is defined by its zone.

This is the invariant that defect #1 violated. It is enforced two ways:

1. A CSS contract: zone heights are `--zone-a-h` … `--zone-d-h` custom
   properties in `Dashboard.module.css`, and the sum is asserted.
2. A test that fails on regression (below).

---

## New backend surface

One endpoint, to keep Zone D from costing eight fetches.

```
GET /api/dashboard/signposts
→ { breadth: {label, value, tone},
    options_flow: {...}, uct20: {...}, desk: {...},
    calendar: {...}, screener: {...}, journal: {...}, community: {...} }
```

Reads existing cached services only; adds no new data sources. Cached 60 s.
This is the only new API in the design.

---

## Testing strategy

The current single smoke test is why this regression was invisible. The new
rails, in order of what they prevent:

1. **Height budget (jsdom-blind, so measured in a real browser).**
   Extend `tools/mobile_audit.py` — which already boots Playwright at phone
   and tablet viewports and flags horizontal overflow — with a desktop
   viewport and a **vertical** budget assertion for `/dashboard`. jsdom
   computes no layout, so this rail *must* live in the Playwright harness,
   not in vitest. Fails if the page's scroll height exceeds its viewport.
2. **Bare-child guard (vitest).** Asserts every dashboard tile is rendered
   inside a zone wrapper. This catches defect #1's exact shape without
   needing layout.
3. **Session-state composition (vitest).** Four tests, one per state,
   asserting Zone B renders the right hero — including that `WEEKEND`
   renders The Week and never an empty frame.
4. **Door integrity (vitest).** Every Zone D card's target resolves against
   the route table. Reuses the idiom in
   `app/src/routes/lostDoors.route.test.jsx` and
   `tests/test_navigation_targets_resolve.py`.
5. **Orphan rehoming (vitest).** `/theme-tracker` lands on a workspace that
   contains a themes widget; `/flow-scoreboard` appears in the nav.

Per repo convention, a rail must be shown to **discriminate** — each of
these is verified to fail when the defect it targets is reintroduced, not
merely to pass today.

---

## Phasing

Each phase ships independently and is separately revertible.

| # | Phase | Scope | Est. |
|---|---|---|---|
| 0 | **Instrument** | In-app route analytics. Runs in parallel; blocks nothing. | ~0.5 d |
| 1 | **Repair** | The 4 defects + height-budget rail. Nothing moves. | ~1 d |
| 2 | **Rehome** | The 3 orphans. Prerequisite for Phase 3. | ~1 d |
| 3 | **Restructure** | Zones A–D, session states, signpost endpoint. | ~3 d |
| 4 | **Nav** | Desktop rail adopts `MobileTabBar`'s four groups. | ~1 d |

Phase 1 is deliberately first and deliberately dumb: it halves the page
without moving anything, so the restructure is designed against a page that
renders as intended.

**Phase 4 rationale.** `MobileTabBar.jsx` already collapses the 16 desktop
nav items into four groups — Home · Markets (`/breadth /options-flow
/dark-pool /post-market /screener /calendar /catalysts`) · Charts (`/charts
/watchlists /theme-tracker`) · Journal. Desktop keeps 16 unlabeled icons.
Phase 4 adopts the existing taxonomy; it does not invent one. It ships
separately from Phase 3 so that member reaction is attributable to one
surface at a time.

---

## Risks

| Risk | Mitigation |
|---|---|
| `/dashboard` is hardcoded in **9 places** (`App.jsx` ×2, `Login`, `VerifyEmail`, `AppErrorFallback`, `StalledLoadFallback`, `MobileTabBar`, `MobileNav`, `NavBar`, `MoreSheet`) | The route and path are unchanged. Only the page's contents change. No redirect work needed. |
| Removing a tile removes a member's only path to a feature | Phase 2 rehomes all three orphans *before* Phase 3 touches the page. Door-integrity test enforces it. |
| Zone D's eight numbers become eight fetches | Single `/api/dashboard/signposts` aggregate, 60 s cache. |
| Height budget passes in vitest and fails in a browser | The budget rail lives in the Playwright harness by design. jsdom computes no layout — a vitest height assertion would be vacuous. |
| Quote / equity-curve calls are wrong | Both are single flags/props, called out as reversible in Zones A and C. |
| Worktree ships to a shared branch | Per repo convention: never `git add -A`; push `origin <branch>:master`; fetch → merge → re-verify → push, never force. |

---

## Deferred

- **Catalyst engine weekday gap (2026-08-27).** One missing weekday in 17.
  Different subsystem (`api/services/catalyst/`), and the empty-state
  treatment in Zone B covers it either way. Worth a separate look at whether
  the daily cost cap or a scheduler miss caused it.
- **Request fan-out.** 50 calls / 386 KB is a symptom of 15 tiles; Phase 3
  should reduce it as a side effect. If it does not, that is its own project.
- **`Dashboard.module.css` legacy breakpoints** are snapped as part of
  Phase 3's rewrite, not as separate work.
