# Open/Close (Profit-Take) Detector — Design

**Date:** 2026-07-31
**Status:** Phase 1 built (dark, marker-only). Phase 2 designed, not built.
**Files:** `api/live_massive_router.py`, `app/src/pages/LiveFlowMassive.jsx`, `tests/test_flow_classification.py`

## Problem

`_derive_direction` labels direction from the **fill side alone**: a call sold
at/below bid → **Bear**, a put sold at bid → **Bull**. It has no open/close
awareness, so a **profit-take** (someone closing a long they opened earlier the
same session) is stamped as a brand-new directional bet.

The existing sell-side "opening test" (`_derive_direction`, added 2026-07-24)
tries to catch this — it keeps a bid-side label only when `vol > T-1 OI`
("you can't close more than exists"). But it reads **yesterday's OI**, so it is
blind to same-day round-trips:

- 9:45am — buy 10K MSFT 470C at ask (open longs). T-1 OI still 813.
- 2:00pm — sell 10K at bid to take profit. `vol(10K) > T-1 OI(813)` → "opening!"
  → stamped **bearish**. Reality: closed the morning's long. Profit-take,
  mislabeled.

Reference case that motivated this: **MSFT 470C 8/7, $7.69M, SIDE BB**, labeled
"Size Bears." Its next-day OI grew **+24,402** — so *that* print was genuinely
net-short-opening (the label was right by luck of the fill side matching). The
detector must agree with MSFT (not false-demote it) while catching the
afternoon-profit-take case the T-1 OI test cannot see.

## Signal — session net-volume ledger (from the tape, no new data)

Per **(contract, session)**, cumulative **signed net volume**: `ask = +vol,
bid = −vol`, in `id` order (`id` is monotonic with ingest time). For any print,
`net_before` = the contract's cumulative signed volume from all prints with a
**smaller id**.

- `net_before` **strongly positive** (net long accumulated earlier via
  ask-buying) → a following **bid-sell is likely unwinding that long** = close /
  profit-take.
- `net_before` ≤ 0 (net short/flat) → bid-sell is **opening a short** = genuine
  bearish.

**MSFT self-checks correctly:** 68% of its flow hit the bid → `net_before` goes
*negative* → its bid prints read as opening shorts → stays "Size Bears." No
false demote. This is the control case.

## Architecture — an OVERLAY, not baked into the classifier

`incremental_scan` (live) caches each row's classification keyed by
`hash(tuple(row))`, which assumes **row → classification is a pure function of
the row**. Session-net is cross-row / order-dependent, so baking it into
`_derive_alert_name` would break that cache. Instead:

1. **Ledger** — `_build_session_flow_ledger(rows)` builds `net_before[id]` from
   the scan's already-fetched rows in one O(n) pass. Pure function.
2. **Overlay** — `_mark_likely_close(alert, net_before, thresholds)` runs *after*
   the cached per-row classification, in the scan loop, and stamps
   `alert["_likelyClose"]` / `alert["_sessionNetBefore"]`. The expensive
   classification stays cached and pure; the open/close layer is a cheap
   post-step on the output.

## Phase 1 — the interim tell (BUILT, dark, additive)

- `_signed_flow_vol` / `_build_session_flow_ledger` / `_mark_likely_close` in
  `live_massive_router.py`; wired into `_compute_recent`'s scan loop (ledger built
  once before the loop, marker stamped per surviving bid-side alert).
- **Marker only** — `_likelyClose` is stamped when a bid-side print's contract
  has `net_before > 0` AND `net_before >= tradeSize × close_net_frac`.
  **Direction is unchanged.**
- Gated by **`close_detector_enabled`** (default **False**) + tunable
  **`close_net_frac`** (default 1.0). Both in `DEFAULT_THRESHOLDS` and the
  `/thresholds` allowed-keys list (§4). Ships **dark**; flip on in `?tune=1`.
- Frontend: a **"⚠ close?"** badge on the alert row (`LiveFlowMassive.jsx`),
  renders only when `_likelyClose` is present, with a tooltip explaining the
  net-long context. No layout change when off.
- **Tests** (`tests/test_flow_classification.py`, 9 added): sign convention,
  net_before-is-prior-only, per-contract separation, id-ordering, flag on
  bid-into-net-long, **no-flag MSFT-class net-short**, no-flag when net-long <
  print size, ask never flagged, disabled no-op.

### Phase 1 limitations (deliberate, note before trusting)

- **Approximate ledger:** fed only the scan's fetched rows (MAGENTA / YELLOW /
  WHITE ≥ override-floor), so it captures the significant directional flow but
  not sub-floor WHITE churn. Good enough to eyeball; Phase 2 can widen to the
  full tape.
- **Curated feed only:** wired into `_compute_recent` (the feed the user sees),
  not the by-contract rollup or Discord push paths.
- `id` as time proxy (not `ts_ns`) — reliable since ids are assigned in ingest
  order; revisit if out-of-order ingest is ever observed.

## Phase 2 — feed into direction (designed, NOT built)

Once the marker is validated against next-day OI over live sessions:

1. A flagged bid-sell **demotes** from "Bears"/"Bulls" to neutral / Size, or a
   new **"Unwind / Profit-Take"** label.
2. **Session-net replaces T-1 OI** in the sell-side opening test — the actual §7
   goal (kills the same-day round-trip blind spot).
3. Widen the ledger to the full tape; consider a persistent per-contract running
   total in the worker (hydrated from flow.db on boot) if the scan-time rebuild
   is too costly.
4. Same tunable + instant-rollback pattern (`close_detector_enabled`).

## Validation plan

Ground truth = **next-day OI change** (`oi_snapshots.db`). For contracts where
the detector flags bid-sells as closes, next-day OI should **not grow** (closing
holds/shrinks OI). MSFT is the negative control (OI grew +24K → net-short →
correctly *not* flagged). Backtest over recent sessions from `flow.db` before
advancing to Phase 2.

## Rollout

Phase 1 ships dark on the next off-hours flow-worker deploy (backend) + web
deploy (badge). Activate by flipping `close_detector_enabled` on in `?tune=1`;
eyeball the "⚠ close?" markers for a few sessions; tune `close_net_frac`; then
build/validate Phase 2.
