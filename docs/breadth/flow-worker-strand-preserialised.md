# Flow-worker strand — the pre-serialised history response (Session 7, W-C)

**Classification: ADDITIVE, INERT ON FLOW-WORKER. No redeploy. No marker bump.**

Per `docs/runbooks/deploy-windows.md` a red from `tools/flow_worker_watch_coverage.py`
is a **REVIEW GATE**, never a deploy block. This is that review, traced rather than
assumed.

## What this change touches, and whether flow-worker can reach it

| file | change | in flow-worker's import closure? |
|---|---|---|
| `api/routers/breadth_monitor.py` | the route returns a pre-rendered `Response`; adds `_render_json`, `_body_cache_key`, `_BODY_CACHE_TTL` | ⭐ **NO — not in the closure at all.** flow-worker imports no routers. Verified by an AST closure walk from `api.flow_worker_main`. |
| `api/services/breadth_timing.py` | `POST_PHASES` gains `"serialise"` | **Yes, reachable** — see below |
| `tests/test_breadth_preserialised.py` | new rails | No. Not shipped code. |

## Why the one reachable change is inert

flow-worker reaches `breadth_timing` by exactly one path, and only as a side effect of
importing the breadth reader:

```
api.flow_worker_main -> api.flow_gap_autofill -> api.services.liveflow_monitor
  -> api.services.bars_fetch : 2467   latest = _bm.get_latest()
  -> api.services.breadth_monitor
  -> api.services.breadth_timing        (module-level import only)
```

`POST_PHASES` is a module-level tuple read by exactly three functions — `finish()`,
`server_timing()` and `phase_residual()`. **All three run only from the ASGI
middleware**, which opens the per-request record. flow-worker serves no HTTP and
mounts no middleware, so the record is always `None`, every timing entry point returns
immediately, and the tuple is never read.

⭐ **The route's own cache key is also outside flow-worker's reach.** `_body_cache_key`
returns `breadth_history_body_…`, deliberately under the **existing
`breadth_history_` prefix**, so every writer that already calls
`cache.delete_prefix("breadth_history_")` — `store_snapshot`, `patch_field`,
`delete_snapshot` — drops it without a new invalidation site. And flow-worker never
writes a breadth snapshot: every write arrives through web.

## Why no redeploy is needed

On the old code flow-worker runs the `get_latest()` it ran yesterday; on the new code
it runs the same bytes. There is no version pairing to get wrong.

⛔ Forcing a flow-worker restart drops the Massive OPRA socket, and Massive does not
replay — the tape gap is permanent until the T+1 flat file. That is a real cost paid
for zero behavioural difference.

## Status

Branch `breadth/preserialised-response`. Whether it merges is the M4 gate's decision,
not this document's.
