# TY7 A/B -- box status, verbatim from `gate_box_lock.py status`, every checkpoint

The gate lock (`int-w10`'s own six-shard gate, pid 47832, since 14:46:34 CDT) was **HELD** from
before this lane started waiting until ~15:56:47 CDT; every check during that window read HELD
and no run was attempted while it did (recorded via two chained foreground/background
`until ... gate_box_lock.py status ...; do sleep 15; done` waits spanning that whole interval).
Once FREE, `scratchpad/MEASURING.flag` was created, 60 s waited, and deleted immediately after
each of the six runs below (never left behind; one run's wrapper script was interrupted after
the timed run finished but before its own cleanup line ran -- caught and cleaned up by hand
before the next run started, confirmed no flag was left for another session to trip over).

| run | lock (pre-build) | marked (pre-build) | lock (pre-run) | marked (right before the timed run) |
|---|---|---:|---|---:|
| A1 | FREE | 11 | FREE | 11 |
| B1 | FREE | 11 | FREE | 12 |
| A2 | FREE | 11 | FREE | 8 |
| B2 | FREE | 8 | FREE | 13 |
| A3 | FREE | 11 | FREE | 13 |
| B3 | FREE | 12 | FREE | 16 |

**Lock FREE on every one of the 12 checks (6 runs x pre-build + pre-run); never HELD during any
of the six timed runs.** Load was BUSY on every one -- **no run in this set started QUIET.** The
marked-process count drifts upward over the session (11 -> 16, with one dip to 8 at A2), the same
one-directional load-drift shape ty5's own A/B session recorded ("the marked-process count rose
across the session... a monotonic upward trend in unrelated background load over the ~25-minute
span, which interleaving cancels on average but not perfectly"). B3, the LAST run, carried the
HIGHEST load of the six (16) -- its own p95 at 2,000 paragraphs (28.32 ms) is the single highest
reading in the whole dataset, consistent with that drift rather than the fix.

Every one of the six runs' own sandbox integrity read CLEAN (pre-boot, post-boot +15s, shutdown)
-- see `{A,B}{1,2,3}.integrity.md`. Zero page errors on all six (`{A,B}{1,2,3}.json`'s
`page_errors`).
