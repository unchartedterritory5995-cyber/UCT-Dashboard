# Flow-worker strand — per-phase breadth timing (Session 6, W1)

**Classification: ADDITIVE, INERT ON FLOW-WORKER. No redeploy. No marker bump.**

`tools/flow_worker_watch_coverage.py` goes RED on two of the four files this commit
touches — `api/services/breadth_monitor.py` and `api/services/breadth_timing.py`:

```
[watch-coverage] base=origin/master reachable=156 watched=24 changed=4
[watch-coverage] FAIL - flow-worker RUNS these files but will NOT redeploy for them:
    api/services/breadth_monitor.py
    api/services/breadth_timing.py
```

Per `docs/runbooks/deploy-windows.md` a red here is a **REVIEW GATE** requiring a
written classification, never a deploy block. This is that classification.

## The strand, traced with a closure walk rather than recalled

```
api.flow_worker_main -> api.flow_gap_autofill -> api.services.liveflow_monitor
  -> api.services.bars_fetch : 2466   from api.services import breadth_monitor as _bm
                             : 2467   latest = _bm.get_latest()
  -> api.services.breadth_monitor
  -> api.services.breadth_timing        (module-level import only)
```

`get_latest()` builds a prewarm ticker list out of the newest row's `*_list` keys.
That is flow-worker's **entire** reachable surface into this module, and it is the
same one the Session 2 strand doc traced.

## What this commit changed, symbol by symbol

| file | changed symbol | on flow-worker's strand? |
|---|---|---|
| `breadth_monitor.py` | `_history_deep_uncached` only — nine `with _bt.phase(...)` wrappers | **No.** Every changed hunk is inside that one function (`git diff` hunk headers all read `@@ … def _history_deep_uncached`). `get_latest` and `get_history` are byte-identical. |
| `breadth_timing.py` | `phase()`, `mark()`, `_phase_ms`/`_phase_dur`, `POST_PHASES`/`SEND_PHASES`, the middleware's send hook | **No.** Every one of them records onto a per-request record that only the ASGI middleware opens. flow-worker serves no HTTP and mounts no middleware, so the record is always `None` and every entry point returns immediately. |
| `routers/breadth_monitor.py` | `route_tail` phase + `mark("route_return")` | **No.** Not in the closure at all — flow-worker imports no routers. |
| `tests/test_breadth_timing.py` | new rails | **No.** Not shipped code. |

⛔ **`get_history_deep` / `_history_deep_uncached` has no call site anywhere in
flow-worker's chain** — checked by search across `flow_worker_main.py`,
`flow_gap_autofill.py`, `liveflow_monitor.py` and `bars_fetch.py`, which returns
nothing. The phases therefore cannot execute on that service even in principle.

## Why no redeploy is needed

⭐ **On the old code flow-worker runs the `get_latest()` it ran yesterday; on the
new code it runs the same bytes.** There is no version pairing to get wrong, and
no mixed state to reason about: the four files ship in one commit.

⛔ **And the insurance costs more than the risk.** Forcing a flow-worker restart
drops the Massive OPRA socket, and Massive does not replay — the resulting tape gap
is permanent until the T+1 flat file. Paying a permanent data gap for zero
behavioural difference is the wrong trade in the only direction that matters.

## Status

This commit is on branch `breadth/phase-instrument` and is **not merged**. Nothing
in Session 6 merges to master; the deploy question above is recorded now so it does
not have to be re-derived when the merge is authorised.
