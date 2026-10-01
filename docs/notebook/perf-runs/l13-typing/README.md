# L13 typing re-read, 2026-09-30 16:55-17:04 local

Tree `b25078ba0` (app bytes identical to `b9009ec43`; `app/dist` built at `b9009ec43`).
Harness: `tools/notebook_perf_harness.py --boot --sizes 1000,2000 --opens 20 --chars 60`,
a fresh scratchpad data dir per run, four sequential runs. Raw: `run1..4-b9009ec43.json`
(+ each run's sandbox log and integrity log; every integrity reading CLEAN).

**Box: NOT quiet.** `tools/gate_box_lock.py status` read QUIET at 16:54, then BUSY at every
run start (another session's vitest/pytest: 3, 2, 8, 8 marked processes). An idle,
scheduler-zeroed walk sandbox of this session was also up on :8107.

| run | typing p95 1,000 ¶ | typing p95 2,000 ¶ |
|---|---:|---:|
| 1 | 17.6 ms | 18.7 ms |
| 2 | 17.4 ms | 18.9 ms |
| 3 | 18.2 ms | 19.8 ms |
| 4 | 15.4 ms | 17.9 ms |
| **median** | **17.5 ms** | **18.8 ms** |

Verdict: over the 16 ms/char line at both sizes (harness exit 1, BUDGET BREACH, on every run).
This is a lightly-loaded reading, so it neither confirms nor overturns the quiet-box A/B
(16.95 / 17.70, `perf-budgets.md` §3); it does not move the line or the clause.
