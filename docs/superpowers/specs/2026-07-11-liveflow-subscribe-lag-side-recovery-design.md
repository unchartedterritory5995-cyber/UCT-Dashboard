# LiveFlow — Subscribe-Lag Side Recovery

**Date:** 2026-07-11
**Files:** `api/massive_ws_worker.py`, `api/massive_processor.py`, `api/flow_db.py`
**Origin:** Ravi's 7/10 note "Q-pool — side misclassification on a contract's first burst (subscribe-lag)"

## The bug

A brand-new option contract subscribes to Massive's Q (NBBO) feed only *after* it
emits an event, and the subscribe WS message fires on the manager's 5s cadence. So
a new contract's **first burst** — usually the accumulation start, the prints that
matter most — is classified with **no NBBO in `_NBBO_HISTORY`**. `_classify_side`
(Tier-1 NBBO) returns empty, and the print falls to the Tier-2 tick test, which
only knows "printed below the last trade" — not "above the ask" — so it **inverts
in a fast tape**.

Concrete case (7/10): NBIS 220C, 11:43–11:48, ~$2.1M across three sweeps. Bullflow
sided them Bid/Ask/AA from NBBO; we stored empty/A/**B** — the $1.08M print came out
`B` (seller) when it was actually `AA` (aggressive buyer). Corrupts direction
downstream (accumulation rollups, `_derive_direction`).

## Key enabling facts

- `flow.dedup_key` is UNIQUE and built from date/time/symbol/type/volume/price/
  callput/strike/expiry/premium — it **excludes `Side`**. So `UPDATE flow SET
  Side=… WHERE dedup_key=…` is clean and targets exactly one row.
- The live tape **polls the FlowDB-backed endpoint** (`live_massive_router.py`
  reads `FROM flow`). So an in-place DB `UPDATE` propagates to the tape, the
  rollups, and direction on the next poll — **no SSE-correction machinery needed.**
- `_NBBO_HISTORY` + `_nbbo_at()` already do time-aligned NBBO lookup. Recovery
  reuses them; it does not build NBBO storage.

## The two changes (worker-side; `live_massive_router.py` untouched — Ravi owns it)

### 1. Fast-path subscribe
In `_queue_q_subscriptions_for_events`, when an **unsubscribed** contract's print
clears `FAST_PATH_PREMIUM` (env, default $50K), queue it as today **and** set an
`asyncio.Event` that wakes `q_subscription_manager` immediately instead of on its
5s tick. NBBO starts flowing within ~1 tick, so the rest of the burst gets Tier-1
classified. Rides the **same 950-cap eviction path** → adds no pool pressure, only
reduces latency. Counter: `fast_path_subscribes`.

### 2. Post-NBBO reclassification (recovers the lag-window sides)
- `AggEvent.side_method` (`nbbo`|`tick`|`none`) tagged in `_classify_events_side`.
  A mid-market NBBO empty is tagged `nbbo` (ground truth — never re-touched).
- Tick/empty prints are buffered (`_RECLASSIFY_BUFFER`, bounded 5000 + 60s TTL)
  with the exact `dedup_key` (rebuilt via the **same** `event_to_bbs_row` +
  `FlowDB._make_dedup_key` the write path uses → zero drift by construction),
  sym, ts_ns, avg_price, and the recorded side.
- `reclassify_manager` (every 3s) runs `_collect_reclassifications`: for each
  buffered print whose NBBO has since filled in and is fresh (≤5s), re-runs
  `_classify_side` and, if it now yields a different non-empty side, applies
  `FlowDB.update_sides_by_dedup` via the shared single-writer `_WRITE_EXECUTOR`.
  Entries whose NBBO never arrives expire on TTL (best-effort, expected).

### Guardrails (Ravi's, mapped)
- *Only overwrite tick/empty* → buffer eligibility + `UPDATE … WHERE Side=<old>`.
- *Never clobber an NBBO side / idempotent* → rows are write-once (dupes skipped),
  so the guard matches only the recorded tick/empty value; a second pass no-ops.
- *Respect the 950 cap* → fast-path reuses existing eviction; buffer is the only
  new "held" set and it's bounded + TTL'd.
- *Near-real-time, not EOD* → 60s TTL buffer, 3s re-pass; memory-only.

## Telemetry (existing `/status` + new counters)
`reclassified_total`, `last_reclassify_count`, `reclassify_buffer_size`,
`fast_path_subscribes` — plus the existing `last_side_classified_nbbo`/`_tick`.
Success = nbbo-share up, tick/no-signal down on first-burst contracts.

## Kill switches (env, default ON; rollback = set 0 + redeploy off-hours)
`MASSIVE_RECLASSIFY_ENABLED`, `MASSIVE_FAST_PATH_ENABLED`,
`MASSIVE_FAST_PATH_PREMIUM`, `MASSIVE_RECLASSIFY_INTERVAL`,
`MASSIVE_RECLASSIFY_TTL`, `MASSIVE_RECLASSIFY_BUFFER_MAX`.

## Tests
`tests/test_liveflow_side_recovery.py` (9): `_classify_side` inversion, zero-drift
dedup-key match, `update_sides_by_dedup` idempotency + NBBO guard, method tagging +
buffer eligibility, end-to-end blind-`B`→recovered-`AA`, TTL expiry, buffer bound.

## Shipping
Worker runs on the **web** service; deploy restarts the feed and Massive OPRA never
replays. Ship **≥4:20 PM ET or <9:15 AM ET** only.
