# Flow-worker strand — the materialised reconstructed side (§3)

**Classification: ADDITIVE, OFF THE STRAND ENTIRELY. No redeploy. No marker bump.**

## The strand, unchanged and re-quoted rather than remembered

```
api.flow_worker_main → api.flow_gap_autofill → api.services.liveflow_monitor
  → api.services.bars_fetch : 2467   latest = _bm.get_latest()
  → api.services.breadth_monitor : 961   def get_latest(): return get_history(1)[0]
```

⭐ **`get_history(1)` is a ONE-DAY window, and one day is inside the collector
range by construction** — the collector floor is 2026-01-02 and `get_latest()`
asks for the newest session there is. `get_history` is the PLAIN reader: it never
calls `get_history_deep`, never consults `breadth_reconstructed_daily`, and never
reaches `closes_for_dates`. The materialised reconstructed side is on the deep
path only, which this strand does not enter.

## What this change set touches, and why none of it reaches the strand

| file | change | on the strand? |
|---|---|---|
| `breadth_daily_ohlc.py` | new table, builder, watermark, four writer hooks | **the module is in the closure; none of the changed symbols are called by it.** `get_history` does not read the OHLC store at all |
| `breadth_monitor.py` | `_history_deep_uncached` reads the materialised table | **No** — `get_history_deep` is not on this strand |
| `breadth_sentiment_history.py` | `upsert_many` rebuilds stale rows | **No** — a writer, and flow-worker does not write sentiment |
| `breadth_numeric_migration.py` | the backfill | **No** — boot-time, web only |
| `api/main.py` | boot hook | **No** — flow-worker has its own entry point |

## Both directions

- **flow-worker on OLD code** — `get_history(1)` behaves exactly as it does today.
  It never creates the new table and never looks for it.
- **flow-worker on NEW code** — `_ensure_init()` creates an empty table in ITS OWN
  OHLC database (separate volume), and nothing on its path reads it. If it ever
  writes a trusted OHLC row, the hook materialises that date locally, which is
  correct work in the wrong process and costs one small row.

⚠️ **The one thing that would change this answer**, recorded so it does not have to
be re-derived: if `get_latest()` ever grew a span that reached below the collector
floor, it would enter the deep path and this classification would need re-doing.
`get_history(1)` cannot.

## Why no redeploy

A forced flow-worker restart drops the Massive OPRA socket and the gap is permanent
until the T+1 flat file. There is no behavioural difference to buy here at all —
the changed symbols are not reachable from its path.
