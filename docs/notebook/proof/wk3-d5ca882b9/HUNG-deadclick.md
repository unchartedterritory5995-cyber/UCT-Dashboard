# deadclick sweep hung after 12 of 44 surfaces -- hard-killed, recorded as such

Run: `--boot --data-dir <scratchpad>\wk3-data --port 8319 --tip d5ca882b94c6c73156166cf6198327540497193a
--out-dir docs/notebook/proof/wk3-d5ca882b9`. Started 2026-09-29 20:01 CT.

## What happened

census, geometry (superseded -- see below), axe and silent all completed normally (each wrote
its full JSON; `dump()` after every row/cell/endpoint). deadclick's control check passed
(`[VALID] deadclick control: every planted defect failed the instrument as it must`), then the
per-surface loop measured 12 of 44 surface×mode cells in order (`nb-first-run-clicks`,
`nb-home`, `nb-list` desk+phone, `nb-table`, `nb-board`, `nb-calendar`, `nb-timeline`,
`nb-graph`, `nb-tasks`, `nb-search`, `nb-trash` -- all MEASURED, `deadclick.json`). The NEXT
surface in `SURFACES` order is `nb-bulk`. `deadclick.json` was not touched again for the
following ~50 minutes; the outer walk process's CPU usage over that window measured
essentially zero (0.015 s over a 20 s sample, against ~2 s/20 s while it was genuinely working
a few surfaces earlier) -- a native blocking wait, not a slow-but-working surface. The
sandbox's own FastAPI access log kept serving 200s from other browser tabs (the parallel
geometry-only re-run on port 8329) throughout the stall, so the backend itself was healthy;
the stall was in the walk script's own Playwright-side logic, most plausibly inside
`s_bulk`/the deadclick loop for `nb-bulk`, not diagnosed further than that -- reproducing it
would cost the same wall-clock again for an uncertain payoff.

## What was done about it

Per this repo's own documented convention for exactly this situation
(`tools/notebook_perf_harness.py::Sandbox.stop`'s own docstring: *"A hard kill is the LAST
resort and is recorded as such: a run stopped that way has no shutdown checkpoint, so its
integrity reads INCOMPLETE and its timings are withheld -- the failure direction is silence,
never a clean-looking number"*) -- both the outer walk process (PID 51744) and the sandbox
launcher (PID 28768) were force-terminated after confirming the zero-CPU stall. Verified after:
port 8319 released, no orphaned chrome/node process referencing `wk3-data`.

## Integrity -- INCOMPLETE, not CLEAN, and that is the honest reading

`integrity.md` in this directory (copied from
`docs/plans/joystick/sandbox-runs/2026-09-29T20-01-15.md`) carries three checkpoints, all
CLEAN: pre-boot (baseline), post-boot (+15s), post-prewarm (+120s), 62 db files hashed each
time, `C:\data` untouched. There is no shutdown checkpoint -- the hard kill never let the
launcher reach it. Per R-RAW/the repo's own rule above, this run's integrity is **INCOMPLETE**,
not asserted as full CLEAN; nothing in the three checkpoints taken suggests a shared-root write
occurred, but the shutdown state itself was never measured.

## What this means for clause 2c

`deadclick.json` is real, raw, VALID-controlled data for the 12 surfaces it reached (see the
README's 2c section for the reading). It is not a measurement of the other 32 surfaces, which
remain unmeasured for this lane -- named here as OPEN, not silently rolled into a total.
