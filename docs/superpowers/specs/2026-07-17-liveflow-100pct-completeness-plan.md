# Live Flow → 100% completeness & consistency — execution plan (2026-07-17)

Written after the 7/17 all-day incident. The **writer-speed root cause is FIXED**
(this doc is not about latency — that's solved). This is the remaining hardening
to reach same-day 100% completeness. Ordered by value / risk. Everything here is
Monday work because each item needs a live-open test or Ravi's consumer semantics;
none should ship blind mid-session (that pattern caused 7/17).

## Context: what 7/17 fixed (do not redo)
- Writer enrichment cost: OI stage-2 unindexed probes (87s/batch) → idx_flow_contract
  + `_OI_FALLBACK_CACHE`; cumvol full re-aggregation (11-98s/batch) → idx_flow_created_symbol
  + in-memory day counters (`_CUMVOL_STATE`). Result: 377-1070ms/batch, writer outruns feed.
- Replay: `FLOW_TAPE_REPLAY_INTRADAY=0` (16:12-only) — intraday replay CAUSED the gaps.
- Forensics: `faulthandler` + `threading.excepthook`; per-pass `write-profile` INFO line.
- Monitoring: watchdog true-lag pager (`last_trade_ts` vs `last_write_ts`),
  `DISCORD_ALERT_WEBHOOK` set, watch window 9:32, log-flood killed.
- Repair endpoints: `require_flow_admin` (self-serve).

## Remaining gap to same-day 100% (all rare now; each covered T+1 by flat file today)

### 1. Disconnect-window backfill (the ONLY same-day gap source left)
**Problem.** A crash/reconnect loses the WS ~90s. The spool can't capture it (no WS =
no frames). Flat file heals it T+1 (bulletproof) but not same-day.
**Why a naive REST backfill fails.** Options REST trades are per-contract
(`/v3/trades/{optionsTicker}`, Polygon/Massive-compatible, `timestamp.gte/.lte`,
`next_url`). You can't enumerate "which contracts traded in the gap" without the full
OPRA dump = the flat file. So a market-wide same-day REST recovery is not possible.
**Feasible design — Q-pool-scoped partial recovery (needs Ravi).** On reconnect, for
each of the ~950 active Q-pool contracts, pull `/v3/trades/{O:...}` over
`[last_persisted_trade_ts, reconnect_ts]`, run each through the SAME
`TradeAggregator` + `_write_events` path (dedup on the existing `dedup_key`), so the
recovered rows are identical to live ones. Recovers the high-value watched flow;
newly-surfacing contracts still wait for T+1. ~950 calls/gap, gated + rate-limited.
- Model the REST client on `massive_oi_snapshots._fetch_chain_for_ticker` (same base,
  auth header, pagination).
- Ship DARK behind `FLOW_REST_BACKFILL_ENABLED=0`; verify the trades endpoint shape
  with one read-only call Monday AM before enabling.
- Open Qs for Ravi: is the Q-pool the right contract set? dedup key coverage for
  REST-sourced rows? classification (side/color) parity on backfilled rows?

### 2. Move `contract_oi_snapshots` out of flow.db
Own file (`/data/oi_snapshots.db`), own lock — the 5:30 snapshot's 68k-row write can
never touch the tape lock (suspected 11:18 drop on 7/17 when the OI re-kick held it).
Now lower-urgency (market-hours guard already keeps the snapshot off RTH), but
structurally correct. **Migration risk:** 3+ readers (`_load_oi_for_events`,
flatfiles worker, oi_snapshot_router) + move existing rows → needs a Monday-open test,
not a blind ship. Attach both DBs or dual-read during transition.

### 3. Decouple crons from the consumer process
`oi_snapshots`, `dealer_positioning`, `flow_backup`, flatfiles don't need to live in
the WS-owning process. A 4th Railway service (same volume mount) restores the docstring
promise "deploy all day, zero gap". Bigger change; design with the deploy-survival spec.

### 4. `_live_writer_conflicts` INSIDE replay windows
Only if `FLOW_TAPE_REPLAY_INTRADAY` is ever re-enabled: `_replay_window` must re-check
between chunks (flow_tape_spool.py), not just between windows. Until then, moot.

## The one thing only the vendor can do
Massive 2nd concurrent WS connection (email sent 7/17). Blue-green reconnect = the ~90s
live-latency window on restart goes to zero. It's the ONLY thing that zeroes it; item 1
makes even without it the DATA loss zero same-day (partial) / T+1 (full).

## Confidence statement
After 7/17: real-time = achieved & verified; same-day completeness = achieved for all
observed failure modes; residual = rare disconnect windows, zero-loss T+1 today, same-day
after item 1. "100% confidence" is warranted on real-time + T+1 completeness now; on
same-day completeness after item 1 + item 2 land and pass a Monday open.
