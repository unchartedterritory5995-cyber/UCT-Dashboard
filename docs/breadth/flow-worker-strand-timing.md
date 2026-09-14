# Flow-worker strand — breadth request timing (§2b)

**Classification: ADDITIVE, INERT ON FLOW-WORKER. No redeploy. No marker bump.**

`tools/flow_worker_watch_coverage.py` goes RED on three files this commit touches:
`api/services/breadth_monitor.py`, `api/services/single_flight.py`, and the new
`api/services/breadth_timing.py`. Per `docs/runbooks/deploy-windows.md` a red here is
a REVIEW GATE requiring a written classification, never a block. This is that.

## The strand, traced with the tool's own closure walk

flow-worker reaches the breadth reader by exactly one hop, for exactly one symbol:

```
api.flow_worker_main → api.flow_gap_autofill → api.services.liveflow_monitor
  → api.services.bars_fetch : 2467   latest = _bm.get_latest()
  → api.services.breadth_monitor : 961   def get_latest(): return get_history(1)[0]
```

**`get_history`. Not `get_history_deep`.** That distinction is the whole
classification, so it is quoted from the source rather than remembered.

## What this commit changed, symbol by symbol

| file | changed symbol | on flow-worker's strand? |
|---|---|---|
| `breadth_monitor.py` | `get_history_deep` only — three timing notes and one kwarg | **No.** `get_history` is byte-identical; the diff does not touch it |
| `single_flight.py` | `run()` gains `on_role=None`, plus the `_tell` helper | **Yes, it runs it** — and the change is a keyword argument with a default, so `get_history`'s existing call site (`single_flight.run(ck, fn)`) is unchanged and behaves identically |
| `breadth_timing.py` | new file | **No.** It is imported *inside* `get_history_deep`, so a process that never calls that function never imports it |

## Why no redeploy is needed

⭐ **The two states are each internally consistent, and the mixed state cannot
arise.** All three files ship in ONE commit, so flow-worker either has all of them
or none of them. On the old code it runs the reader it ran yesterday. On the new
code it runs `single_flight.run` with `on_role` defaulted to `None`, which
`_tell` returns from immediately. There is no version pairing to get wrong —
which is exactly the failure a forced redeploy would be buying insurance against.

⛔ **And the insurance costs more than the risk.** Forcing a flow-worker restart
drops the Massive OPRA socket, and Massive does not replay: the gap is permanent
until the T+1 flat file. Paying a permanent tape gap for zero behavioural
difference is the trade `deploy-windows.md` exists to refuse.

⚠️ **The change was deliberately shaped to make this true.** The role signal could
have been delivered by having `get_history_deep` diff `single_flight.stats()`
around the call, which touches no shared module — but that instrument is wrong
under concurrency (two arrivals on one key each see the other's increment), and an
instrument that misreports under the exact condition it exists to observe is not
an instrument. The additive kwarg is both correct and import-compatible; those are
not in tension here, and where they had been, correctness wins and the restart
gets scheduled after hours.
