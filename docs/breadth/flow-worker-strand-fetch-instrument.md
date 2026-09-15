# Flow-worker strand — the cache-label fix + the fetch instrument (Session 8, M6)

**Classification: ADDITIVE, INERT ON FLOW-WORKER. No redeploy. No marker bump.**

A red from `tools/flow_worker_watch_coverage.py` is a **REVIEW GATE**, never a deploy
block (`docs/runbooks/deploy-windows.md`). This is that review, traced rather than
assumed.

## What this change touches

| file | change | in flow-worker's import closure? |
|---|---|---|
| `api/services/breadth_monitor.py` | `get_history` notes `cache="hit", cache_tier="plain"` on its cache hit; the deep reader's two notes gain a tier | **Yes, reachable** — see below |
| `api/services/breadth_daily_ohlc.py` | `reconstructed_for_dates` splits into five timed spans and records row/byte/retry counters | **Yes, reachable** |
| `api/services/breadth_timing.py` | `CACHE_TIERS`, `FETCH_PHASES`, `add_phase()`, `io_counters()`, log-line and header fields | **Yes, reachable** |
| `api/routers/breadth_monitor.py` | the body-cache hit names its tier | ⭐ **NO** — flow-worker imports no routers |
| `tests/test_breadth_cache_label.py` | new rails | No. Not shipped code. |

## Why every reachable change is inert there

flow-worker reaches this family by exactly one hop, for exactly one symbol:

```
api.flow_worker_main -> api.flow_gap_autofill -> api.services.liveflow_monitor
  -> api.services.bars_fetch : 2467   latest = _bm.get_latest()
  -> api.services.breadth_monitor  ->  api.services.breadth_timing
```

Three reasons, each checked rather than inferred:

1. ⭐ **Every timing entry point returns immediately when no record is open.**
   `note()`, `add_phase()`, `phase()` and `mark()` all begin with `_ctx.get()` and do
   nothing when it is `None`. The record is opened **only** by the ASGI middleware.
   flow-worker serves no HTTP and mounts no middleware, so the contextvar is always
   `None` there and none of the new fields is ever written.
2. **`get_latest()` → `get_history(1)`**, and the note added to `get_history` is a
   single `note()` call on that always-`None` record. `numeric_of`, `_metrics_for_dates`
   and the rest of the read are untouched.
3. **`reconstructed_for_dates` is not on flow-worker's path at all.** Its only callers
   are `_history_deep_uncached` (the deep reader) and the migration; neither is in the
   closure. The five new spans cannot execute there.

⚠️ **One behavioural change worth naming rather than glossing:** the fetch now opens
its connection with `sqlite3.connect` directly instead of the module's `_conn()` helper,
so it can time the open and the PRAGMAs separately. **Same path, same timeout, same two
PRAGMAs, in the same order** — verified against `_conn()` line for line — and it closes
in a `finally`. If `_conn()` ever gains a third PRAGMA, this copy must gain it too; that
is a real second-authority risk and it is the price of timing the two halves apart.

## Why no redeploy is needed

On the old code flow-worker runs the `get_latest()` it ran yesterday; on the new code it
runs the same bytes with a no-op `note()` in the cache-hit branch.

⛔ Forcing a flow-worker restart drops the Massive OPRA socket, and Massive does not
replay — the tape gap is permanent until the T+1 flat file. That is a real cost for zero
behavioural difference.
