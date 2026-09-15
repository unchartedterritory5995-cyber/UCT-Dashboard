# Flow-worker strand — the H1 page-cache experiment (Session 9, M8)

**Classification: ADDITIVE, INERT ON FLOW-WORKER, AND DEFAULT OFF. No redeploy.**

A red from `tools/flow_worker_watch_coverage.py` is a **REVIEW GATE**, never a deploy
block (`docs/runbooks/deploy-windows.md`). This is that review, traced.

## What this change touches

| file | change | reachable from flow-worker? |
|---|---|---|
| `api/services/breadth_daily_ohlc.py` | `_pagecache_on()`, `_apply_pagecache()`, two new `_conn()`-path PRAGMAs **behind the flag**, and per-statement counters | **Yes** — `_conn()` is shared |
| `api/services/breadth_timing.py` | `syscr` in `io_counters()`, new counter fields on the log line and header | **Yes**, as a module import |
| `tests/test_breadth_pagecache_flag.py` | new rails | No. Not shipped code. |

## Why it is inert there — three independent reasons

1. ⭐ **The flag is OFF by default and is not set on any service.** `_apply_pagecache`
   returns before touching the connection unless `BREADTH_OHLC_PAGECACHE_ENABLED` is one of
   `1/true/yes/on`. With it unset — which is every service today — the connection is
   opened with exactly the PRAGMAs it has always had. **Proved by reading the pragmas
   back off a real connection, not by asserting the call was skipped**
   (`test_with_the_flag_off_the_connection_is_exactly_as_it_always_was`), because
   `mmap_size` can be capped by the build and a call-site assertion would miss that.
2. **Every counter is a no-op without a request record.** `_bt.note()` and
   `_bt.add_phase()` return immediately when `_ctx.get()` is `None`, and only the ASGI
   middleware opens a record. flow-worker serves no HTTP and mounts no middleware.
3. **`reconstructed_for_dates` is not in flow-worker's closure at all.** Its callers are
   the deep reader and the migration; flow-worker reaches this module only through
   `bars_fetch.py:2467`'s `get_latest()`, which goes to `breadth_monitor`.

⚠️ **`_conn()` IS shared, and that is the one genuinely reachable path.** flow-worker
calls nothing in this module that uses it today — but if it ever did, with the flag OFF
it would get a byte-identical connection, and with the flag ON it would get a mapped one.
That is stated here so the next person does not have to re-derive it when the flag flips.

## When the flag is turned ON (V1)

It is set on the **web** service only, as a Railway variable. flow-worker's variables are
untouched, so its behaviour does not change even while web is running the experiment.

⛔ Forcing a flow-worker restart drops the Massive OPRA socket and Massive does not
replay — a permanent tape gap for zero behavioural difference.
