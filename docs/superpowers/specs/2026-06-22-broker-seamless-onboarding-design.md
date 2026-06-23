# Broker Seamless Onboarding — Design

**Date:** 2026-06-22
**Status:** Approved (design), pending implementation plan
**Area:** Journal 2.0 broker sync (SnapTrade) — first-connect experience

## Problem

When a member connects (or reconnects) a brokerage via SnapTrade, the first-connect
experience feels broken even though the system is working as designed:

1. **Trades don't appear for minutes to hours.** SnapTrade backfills the broker's
   transaction *activities* (fills) asynchronously after connect. The frontend fires
   one immediate full backfill (`POST /api/j2/broker/sync?full=1`,
   `BrokerConnectionsCard.jsx:49`), but that sync usually runs *before* the activities
   exist, so it imports **0 trades**. Positions and balance import instantly from the
   holdings endpoint, so the account looks connected but the trade journal is empty.

2. **Incremental syncs can permanently miss late backfill.** The 20-min scheduler
   (`run_due_sync_blocking`) does **incremental** syncs with a **3-day overlap window**
   (`sync.py:35,69`). If SnapTrade backfills activities with timestamps older than
   `cursor − 3 days`, those activities fall outside the window and are never re-fetched.
   The only existing catch-all is the **nightly full reconcile at 2:30 AM ET**
   (`main.py:1719`) — so a member who connects mid-day may not see complete trades until
   the next morning.

3. **The equity curve renders blank on day one.** The curve is built from
   `j2_broker_equity_snapshots` (one row per sync) and the hero requires **≥2 points**
   (`BrokerAccountHero.jsx:50` — `if (series.length < 2) return null`). A fresh connect
   has exactly 1 snapshot, so the curve hides. The scheduler self-gates to market hours,
   so connecting after close/over a weekend keeps it blank until the next session.

Net: the integration is correct but not **seamless**. A new member's first impression is
an empty journal and a missing curve.

## Goals

- A member who connects sees their trades populate **automatically within minutes**, with
  no manual "Sync now" required.
- Late-backfilled activities are **never permanently missed**.
- The equity curve is **never blank** when a live balance exists.
- Clear in-product feedback during the import ("we're importing your history"), so the
  empty state reads as *in progress*, not *broken*.
- Self-limiting SnapTrade API cost (the 512MB pod + per-call cost is a real constraint).

## Non-goals

- No change to `_OVERLAP_DAYS`, FIFO reconstruction (`fifo.py`/`reconstruct.py`), or the
  snapshot table schema semantics.
- No change to the historical mark-to-market reconstruction path (still gated
  `BROKER_RECON_HISTORY=1`, off).
- Not solving multi-leg option grouping, dust, or any unrelated backlog.

## Design

### Component 1 — Import Warming loop (backend)

A short, self-limiting, server-owned warming window makes post-connect import fast AND
catches late backfill. This subsumes both "auto-retry re-syncs" and "late-backfill
catch-up": warming runs **full** syncs (no cursor, no 3-day window) so nothing is missed.

**State** — three new nullable columns on `j2_broker_accounts` (idempotent ALTERs appended
to `_PHASE_2_ALTERS` in `db.py`):

- `warming_until` TEXT — ISO timestamp; while `now < warming_until`, the account is warming.
- `warming_last_activity_count` INTEGER — activity row count at the previous warming tick.
- `warming_stable_ticks` INTEGER NOT NULL DEFAULT 0 — consecutive ticks with no new
  activities.

**Set warming on connect/reconnect.** When a broker account is first created or its cursor
is NULL (fresh/re-registered), set `warming_until = now + WARMING_WINDOW` (default **2h**),
`warming_stable_ticks = 0`, `warming_last_activity_count = NULL`. Wired in the
`accounts/refresh` path (`broker_sync.py`) / first-connect sync so it covers both connect
and reconnect-under-new-key.

**Warming scheduler job.** Register a new job `run_warming_sync_blocking` on a short
interval (`BROKER_WARMING_INTERVAL_MIN`, default **3 min**), gated on
`BROKER_SYNC_ENABLED=1`, **not** market-hours-gated (backfill lands any time, incl. after
hours/weekends). Mirrors `_nightly_reconcile`'s structure:

- Cheap no-op when no account is warming (one indexed query `list_warming_accounts()`).
- For each warming account (paid/admin only, same `_user_is_paid` gate): run
  `sync_account(..., full=True)`.
- After the sync, read the account's current activity count (via `activities_store`).
  - If count unchanged vs `warming_last_activity_count` → `warming_stable_ticks += 1`.
  - If count grew → `warming_stable_ticks = 0`, update `warming_last_activity_count`.
- **Stop warming** (set `warming_until = NULL`) when `warming_stable_ticks >= 2` (backfill
  settled) **or** `now >= warming_until` (window expired). A hard cap of ~40 syncs/account
  is implied by the 2h / 3-min bound and acts as a backstop.

**Long tail.** Anything that lands *after* warming expires is still swept by the existing
nightly 2:30 AM full reconcile — so coverage is complete; warming only makes the common
case *fast* instead of next-morning.

**Cost.** Window 2h ÷ 3 min ≈ 40 full syncs worst case per connecting account, but it stops
early on stability (typical backfill < 30 min → ~10 syncs then stop). Self-limiting and
bounded to the brief post-connect window only.

### Component 2 — Curve on day one (backend + frontend)

Ensure the performance series always has **≥2 points** whenever a live broker total exists,
so the curve never renders blank — **without** writing synthetic rows into
`j2_broker_equity_snapshots` (render-only).

- In `performance_service` (`portfolio_performance` / `account_performance`): after building
  the real snapshot series, if it has `< 2` points but a current broker net-liq is known,
  **append a live "now" anchor point** = `brokerTotalEquity` for today, flagged
  `estimated: true`. With one real snapshot this yields a flat/near-flat 2-point line —
  honest (we genuinely have one day of data) and not blank.
- Relax the frontend gate in `BrokerAccountHero.jsx` so a 2-point series (snapshot + live
  anchor) renders. The headline balance already shows from `account.brokerTotalEquity`.

### Component 3 — "Importing" state + polling (frontend)

- `/api/j2/broker/status` exposes `warming: true` per account while `warming_until` is in the
  future (add to the account summary in `connections`/`service`).
- While any account is warming, show a branded banner in `BrokerConnectionsCard`, the empty
  `TradeJournalTab`, and the hero: *"Importing your full [broker] history — your trades and
  equity curve fill in over the next few minutes."* Use the on-brand gold SVG treatment, **no
  generic emoji** (per standing brand preference).
- While warming, the frontend polls `/api/j2/broker/status` every ~25s. When `warming`
  flips to false, refresh trades + curve (revalidate the relevant SWR keys) so they appear
  without a manual page refresh.

## Data flow

```
Connect/reconnect (portal return ?broker=connected)
  → POST /accounts/refresh         (creates j2_broker_accounts row, sets warming_until=now+2h)
  → POST /sync?full=1              (immediate first attempt; often 0 trades — backfill not ready)
  → frontend shows "Importing…" banner, polls /status every 25s

Warming job (every 3 min, not market-gated):
  list_warming_accounts() → for each: sync_account(full=True)
    activity count grew?   → reset stable_ticks, keep warming
    unchanged 2 ticks?     → clear warming_until (done)
    past warming_until?    → clear warming_until (expired; nightly reconcile is the backstop)

When warming clears → /status warming:false → frontend revalidates trades + curve

Curve render: performance series < 2 pts AND live balance → append live "now" anchor (estimated)
  → hero renders a 2-point line instead of blank
```

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `db.py` migrations | 3 new warming columns (idempotent ALTERs) | — |
| `connections.py` | `set_warming`, `clear_warming`, `list_warming_accounts`, expose `warming` in summary | `j2_broker_accounts` |
| `sync.py` | `run_warming_sync_blocking` + `_warming_sync` (full sync + stable-tick state machine) | `connections`, `activities_store`, `sync_account` |
| `main.py` | register warming job (3-min, gated on `BROKER_SYNC_ENABLED`) | `sync.py` |
| `broker_sync.py` | set warming on `accounts/refresh`; surface `warming` in `/status` | `connections` |
| `performance_service.py` | live "now" anchor when series < 2 points | `balances` / account total |
| `BrokerAccountHero.jsx` | render 2-point anchored series | `useJ2BrokerPerformance` |
| `BrokerConnectionsCard.jsx` / `TradeJournalTab` | importing banner + 25s poll + revalidate-on-clear | `/status` |

## Error handling

- Warming job never raises into the scheduler (same `try/except` wrapper as
  `run_due_sync_blocking` / `run_nightly_reconcile_blocking`).
- A failing account during warming is isolated (per-account try/except) and does not block
  others; warming still expires on its window so a permanently-broken account can't warm
  forever.
- If the activity-count read fails, treat as "unchanged" (conservative — relies on window
  expiry to stop).
- Curve anchor only added when a real current balance is present; otherwise the series is
  returned as-is (may be blank, but only when there's genuinely no balance).

## Testing

**Backend (unit, network-free with injected deps):**
- Connect sets `warming_until ≈ now + 2h` and resets tick state.
- Warming job runs `full=True` syncs for warming accounts; no-op when none warming.
- Activity count grows → `stable_ticks` resets, warming continues.
- Activity count unchanged for 2 ticks → warming cleared.
- `now >= warming_until` → warming cleared (expiry) even if never stable.
- Curve anchor: 1 real snapshot + live balance → 2-point series; **asserts no synthetic row
  written** to `j2_broker_equity_snapshots`; 0 snapshots + no balance → unchanged.

**Frontend:**
- `warming: true` → importing banner renders (branded, no emoji).
- Poll loop revalidates trades + curve when `warming` flips to false.
- Hero renders a line for a 2-point anchored series.

## Rollout / safety

- All new behavior is gated by the existing `BROKER_SYNC_ENABLED=1` (already set in prod).
- Migrations are additive nullable columns (no backfill, no lock risk).
- `grep -c broker_sync api/main.py` must remain ≥ 7 after the master merge (locked invariant
  — the warming job adds another reference; never let a master merge drop the wiring).
- Ship via isolated worktree → fast-forward `push <branch>:master` (shared-tree lesson).
