# Situational Awareness — Live New High / New Low Scanner (Plan)

**Date:** 2026-08-25
**Owner:** Blake
**Status:** Plan — awaiting build go-ahead

## Goal

Add a new **"Situational Awareness"** section to the `/charts` toolbar (a WIDGETS
submenu grouping future intraday-awareness tools), whose first feature is a
**live New Highs / New Lows scanner** inspired by Trade Ideas — but rebuilt in our
own UCT thematic style, not a visual clone. Same *function*, our *look*.

Twin panel: **New Highs (left) / New Lows (right)**, event-stream style, live
updating in real time across our cap universe, working in pre/post market too.

## What we're replicating (and what we're deliberately NOT)

Decoded from Trade Ideas' docs + the reference screenshot:

- A **"new high" fires on every print above the session's running high-of-day**
  (HOD). Not a 52-week high — a *today* high. Lows are symmetric (LOD).
- The **"#" column is a running per-symbol count** of how many times that symbol
  has printed a new HOD (or LOD) today. High number = relentless one-directional
  momentum. Same symbol repeats in the stream as its count climbs
  (`RL 103→104→105`; `MNST` grinding lows `154→168`).
- **Event-stream layout**: newest event on top, one row per new-HOD/LOD event.
- Highs/lows **reset once per day** at the session open.

**Decision (locked):** we build the **intraday HOD/LOD count**, scoped to the
**cap universe (3,742 symbols)**, presented as an **event stream**.

**NOT copying:** Trade Ideas' exact colors/layout/grid chrome. We use UCT tokens
(`tokens.css`), our greys/accent, our card + table styling. Same columns and
behavior, our skin.

### Important distinction from existing breadth

`breadth_live.py` already computes `members["new_52w_highs"]` / `new_20d_highs` —
but those are **positional levels** (at a multi-month high *right now*), derived
from one snapshot. They are NOT the HOD/LOD *count*. The count is inherently
**stateful**: it must be accumulated across the whole session by watching each
symbol's day-high/day-low evolve. This is the one genuinely new backend piece.

## Architecture

### Backend — session accumulator (the core new component)

- New service `api/services/nhnl_live.py` (mirrors the `scan_volume.py` shape but
  **stateful across the session**, not stateless-cached).
- A single **env-gated, single-writer background task** (APScheduler in
  `api/main.py`, like the existing scan sweep) ticks every ~3s and calls
  `massive.get_full_market_snapshot()` (one call, whole market).
- Per symbol we hold session state:
  - `hod`, `lod` (running high-water marks for today),
  - `nh_count`, `nl_count`,
  - `last_event_ts`, `last_price`.
- On each tick, for symbols in the cap universe: if snapshot `day.h` > stored
  `hod` → emit a **new-high event**, `nh_count += 1`, update `hod`. Symmetric for
  `day.l` < `lod` → new-low event. (Filter: price > $1, min avg $-vol, reuse the
  shared scan tradability floors.)
- Maintain a **rolling event ring buffer** (newest-first, ~500 cap) for the stream
  view, plus a live **top-list** dict (symbol → count) — both fall out of the same
  state for free (top-list toggle is a cheap future add).
- **Daily reset** at session open (04:00 ET boundary handling; RTH counters reset
  at the RTH open, ext counters tracked separately — see pre/post below).

**Fidelity note:** poll-diffing `day.h/day.l` at 3s counts *"intervals in which a
new HOD occurred,"* not literally every print like TI's full tape. Faithful proxy
for v1. A Massive trade-stream ingest can make it print-exact later (Phase 5).

**Pod placement:** run on the **web pod** for v1 as a bounded background task
(state is a few hundred KB; only added cost is one full-market pull per tick).
Respects the [pod OOM lesson](../../.claude/.../uct-railway-pod-memory-limits) —
no per-request heavy work, single writer, hard size caps. If load is a concern,
migrate the accumulator to the **worker pod** and publish the compact state
(top-list + ring, a few KB) to web — noted as the scaling path, not v1.

### Backend — API

- `GET /api/nhnl/live?session=auto|rth|ext&limit=N&min_price=&min_count=`
  → `{ session, asof, highs: [Row], lows: [Row] }`
  where `Row = { sym, price, count, ts, dir }`.
- `require_paid` per the existing scans router convention.
- v1 transport: **poll at ~2–3s** via `useMobileSWR`. Phase 4 adds a dedicated
  SSE endpoint (`/api/stream/nhnl`) reusing the `api/routers/stream.py` pattern
  for push-based updates.

### Frontend — new twin-panel widget

- `app/src/pages/charts/widgets/NewHighsLowsWidget.jsx` (+ `.module.css`,
  `.test.jsx`) — **custom** component (NOT the watchlist-table reuse; we need the
  bespoke count-histogram rows).
- Layout: two columns, **New Highs (left) / New Lows (right)**. Row =
  `Symbol · ▲/▼ · price · time · #` with a **UCT-styled count bar** (accent-tinted
  histogram, our greens/reds from tokens.css, not TI's neon).
- Live rows animate in at the top (subtle FLIP/slide, matching our Breadth widget
  tile animation); row click routes the symbol into the widget's chart color group
  via `useWorkspace().setGroupSym(color, sym)`.
- Filters: price range, min-count, session (Auto / RTH / Pre / Post toggle).
- Registration (kept in sync, enforced by `registry.test.js`):
  - `app/src/widgets/registry.js` → `WIDGET_REGISTRY.nhnl` (labels, defaults
    ~`{w:8,h:12,minW:3,minH:5}`, menus, `liveCapable:true`).
  - `app/src/pages/charts/WidgetHost.jsx` → `WORKSPACE_WIDGETS.nhnl`.
- Group it under a new **"Situational Awareness"** subsection in the WIDGETS menu
  so future tools land beside it.

### Pre/post market

- Snapshot `day.h/day.l` is RTH-official and freezes after hours. For ext sessions
  we track our **own** session high/low per symbol from `massive._ext_price_for()`
  / minute data, gated on `massive._detect_session()`.
- Separate ext counters from RTH counters; the `session` API param selects which.
- This is the fiddliest part → its own phase (Phase 3).

## Phasing

1. **Backend accumulator + `/api/nhnl/live`** (RTH only). The engine. Unit-test
   the count/reset logic with synthetic snapshot sequences.
2. **Twin-panel widget** wired to the endpoint (poll). The visible feature.
3. **Pre/post-market** session tracking + session toggle.
4. **Polish**: dedup top-list toggle, richer filters, SSE push, milestone
   flash/sound, per-symbol sparkline on hover.
5. **(Later)** Massive trade-stream ingest for print-exact counts.

## Key files to touch / model on

- New: `api/services/nhnl_live.py`, `api/routers/nhnl.py`
- New: `app/src/pages/charts/widgets/NewHighsLowsWidget.jsx` (+ css, test)
- Edit: `api/main.py` (register router + APScheduler task, env-gated),
  `app/src/widgets/registry.js`, `app/src/pages/charts/WidgetHost.jsx`
- Model on: `api/services/scan_volume.py` (service+reference pattern),
  `api/services/breadth_live.py` (full-market snapshot usage, universe),
  `app/src/pages/charts/widgets/ScannerWidget.jsx` (widget shape),
  `app/src/pages/charts/widgets/Breadth.jsx` (twin/tile animation feel)
- Reuse: `massive.get_full_market_snapshot`, `_detect_session`, `_ext_price_for`;
  `api/data/cap_universe.json` (universe); shared scan tradability floors.

## Risks / watch-items

- **Web-pod load** — one extra full-market pull every 3s + numpy diff. Bounded, but
  watch memory/CPU; worker-migration is the escape hatch. Test locally first
  ([test-locally-before-master]).
- **State loss on deploy** — a mid-session web-pod restart resets counts. Acceptable
  for v1; optional SQLite persistence of counters later.
- **Concurrent-clone hazard** — this repo clone is shared by other sessions; verify
  branch + `git status` before any commit, prefer an isolated worktree for the
  build ([uct-repo-never-bare-git-stash], smart-widget-placement precedent).
- **Session-boundary correctness** — daily reset + RTH/ext counter split is the most
  bug-prone logic; cover with tests.
