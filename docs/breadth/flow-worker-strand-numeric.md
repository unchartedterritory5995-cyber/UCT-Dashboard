# Flow-worker strand — the breadth numeric projection (§3)

**Classification: ADDITIVE and BACKWARD-COMPATIBLE IN BOTH DIRECTIONS. No redeploy.
No marker bump.**

`tools/flow_worker_watch_coverage.py` goes RED on `api/services/breadth_monitor.py`.
Per `docs/runbooks/deploy-windows.md` that is a REVIEW GATE requiring a written
classification, never a block. This is that.

⚠️ **This one is stricter than §2b's and deserved more work.** §2b changed
`get_history_deep`, which flow-worker never calls. **§3 changes `get_history`,
which is exactly the function flow-worker runs.**

## The strand

```
api.flow_worker_main → api.flow_gap_autofill → api.services.liveflow_monitor
  → api.services.bars_fetch : 2467   latest = _bm.get_latest()
  → api.services.breadth_monitor : 961   def get_latest(): return get_history(1)[0]
```

One hop, one symbol, and this time the symbol is changed.

## The question that actually matters: can the two versions corrupt each other?

A mixed fleet is only dangerous if one version WRITES something the other version
MISREADS. So the write paths were enumerated from source rather than remembered:

| writer | in flow-worker's closure? |
|---|---|
| `api/routers/breadth_monitor.py` (`/push`, `/heal`) | **No** |
| `api/services/breadth_self_heal.py` | **No** |
| `api/services/breadth_history_recon.py` | **No** |
| `breadth_monitor.store_snapshot` / `patch_fields` | present in the module, **called by none of flow-worker's path** — `get_latest()` is a read |

⭐ **flow-worker never writes a breadth snapshot.** Every write arrives through the
web pod (the collector on the operator's PC pushes to `POST /api/breadth-monitor/push`),
and web always runs the newest code. So there is no version of this deploy in which
an old writer produces rows a new reader misreads.

## Both directions, stated separately

- **flow-worker on OLD code** — runs the previous `_history_uncached`: selects the
  blob, parses it, strips `*_list`. Correct, and merely slower on a 1-row read that
  costs nothing either way. It never creates the projection table and never looks
  for it.
- **flow-worker on NEW code, projection absent** — `init_db()` creates an empty
  table and `_metrics_for_dates` takes its counted blob fallback, which is the old
  expression verbatim. ⭐ **That fallback is not a courtesy; it is what makes the
  read path and the backfill shippable in one deploy**, and it is exercised by
  `test_the_reader_returns_the_same_row_with_and_without_a_projection`.

## Why no redeploy

A forced flow-worker restart drops the Massive OPRA socket, and Massive does not
replay: the gap is permanent until the T+1 flat file. The behavioural difference
being bought is the parse cost of ONE snapshot row on a background call. That is
the wrong side of the trade by a wide margin.

⚠️ **What would change this answer**, recorded so the next person does not have to
re-derive it: if flow-worker ever begins WRITING breadth snapshots, the two tables
must be written by the same version, and this classification becomes a hard
redeploy-or-hold. Nothing in the current closure does.
