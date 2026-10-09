# TY9 -- the typing budget read with a background marker, 2026-10-09

Raw files first (R-RAW), committed in `1ae1fcb294` before this reading: `q1.json` (the harness's
record), `q1.run.log` (box status before and after, the harness's own lines), `q1.integrity.md`
and `q1.sandbox.log` (the sandbox launcher's snapshot rail: CLEAN at every checkpoint).

## Why

`../ty8/README.md`, "Tie-break run A4": every row of A4 was 1.5-2x slower than A3 on the same
build while the lock tool read QUIET at both ends, and the record said clause 4d stays as the
scorecard has it "until the quiet marker can see the load that moved A4". The marker counted
gates, vitest workers and pytest runs; a browser, a model session and a 6.9 GB `llama-server.exe`
were invisible to it.

## The instrument

`tools/gate_box_sampler.py` now reads whole-box CPU in the same PowerShell snapshot as the process
list and reports a `background:` line beside `load:`: state LIGHT / LOADED / UNKNOWN, the CPU
figure, and every unmarked process at or above 1 GB grouped by name. Thresholds: 25% CPU or 8 GB
of heavy holders is LOADED; no CPU figure is UNKNOWN (never LIGHT). `gate_box_lock.py status`
prints both lines, so every future run log carries the second fact for free. Controls: the
A4-shaped box, a light box, a no-CPU snapshot, a heavy-only box, a vitest worker above 1 GB (a
marker, never double-counted), an unreadable probe (no background at all). Mutation: pinning the
LOADED branch off reds 2 pytest rails and 3 self-check lines; restored byte-identical.

## The reading

| run | box before | box after | 1 p | 1,000 p | 2,000 p |
|---|---|---|---|---|---|
| q1, 01:35-01:37 CT | QUIET, background LIGHT (cpu 18%) | QUIET, background LIGHT (cpu 0%) | 6.85 ms | 6.77 ms | 9.73 ms |

`typing_busy_per_char` p95, the budget's reading under ruling D24; 59 windows per size; VERDICT
PASS; note open p95 31.2 / 72.3 / 76.2 ms. Tree `fffb6dba3a` plus the sampler change.

Reading for clause 4d: under the 16 ms line at every size, on a box whose background was measured
LIGHT at both ends by the instrument the TY8 record asked for. Recorded in `perf-budgets.md`,
"Quiet re-read with the background marker, 2026-10-09".
