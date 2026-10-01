# Box status (`tools/gate_box_lock.py status`), read immediately before each run's `--boot`

Captured verbatim (first two lines of the command's output) at the point closest to that
run's harness invocation. `lock` was `FREE` for every run below (never `HELD` once resumed);
`load` was `BUSY` for every single one -- the box was never QUIET for any run in either
A/B set, so no run here can be read as a quiet-box verdict on clause 4d.

| run | lock | load | marked processes (gate/vitest/pytest) |
|---|---|---|---|
| B2 | FREE | BUSY | 50 (1/48/1) |
| A3 | FREE | BUSY | 28 (0/25/3) |
| B3 | FREE | BUSY | 11 (0/10/1) |
| A4 | FREE | BUSY | 35 (0/34/1) |
| B4 | FREE | BUSY | 15 (0/14/1) |

(A1/B1/A2 and the box readings around them are in the previous commit,
`67da0455e`'s message and `ty2-ab-a1/b1/a2.*`; the first reading taken on resuming this
session -- before B2 -- was 50 marked processes, BUSY, which is the B2 row above.)

An intermediate reading of 42 marked processes was taken between the B2 run and the A3
build (after swapping sources, before the A3 boot); it is not a run-start reading for any
run and is noted here only so the record is complete rather than silently dropped.
