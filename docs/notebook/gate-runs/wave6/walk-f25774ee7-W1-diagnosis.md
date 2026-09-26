# W1 (lock/unlock) on the landing tree `f25774ee7` — INSTRUMENT, not product

Controller, 2026-09-25. Raw evidence is committed beside this file, before this interpretation.

## What the walk reported

`walk-f25774ee7.json` and `walk-f25774ee7-run2.json` (two full runs, same sandbox): **W1 FAIL 2/2**,
every other check identical to the accepted run (`walk-70426b0a8.json`: W1 PASS). Both failures were
`editable_while_locked: "true"` with `lock_patch_status: 200` and the lock answer carrying the note.

## Why that pointed away from the product

- The notebook code is byte-identical between the accepted run and this tree:
  `git diff c0219c7e8 f25774ee7 -- app/src/pages/journal-2-0` touches only two TEST files
  (`PositionDetailPage.test.jsx`, `TradeDetailPage.test.jsx`).
- The walk script itself is byte-identical over the same range.
- No backend change since then touches the lock route (`api/` diff: flow, bars, desk, RS warmer,
  preference keys).

## What was measured (`w1-probe-f25774ee7.py` -> `w1-probe-f25774ee7.json`)

One note, opened in the real editor on the same sandbox, Lock clicked, `contenteditable` sampled every
50 ms and every request timed from the click:

| t after click | event |
|---|---|
| 42 ms | `PATCH /lock` sent |
| 58 ms | `PATCH /lock` -> 200 |
| 66–69 ms | ~20 GETs fire at once (the note twice, lists, counts, tags, backlinks, ...) |
| 148 ms | first `GET /notes/{id}` -> 200 |
| 337 ms | second `GET /notes/{id}` -> 200 |
| **352 ms** | **`contenteditable` -> `"false"`** |

Server copy after: `locked: true`. So the product DOES lock the editor — about **290 ms after the PATCH
answers**, once the refetched note lands. W1 read the attribute ONCE, a fixed **300 ms** after the PATCH
answered: a coin flip on box load, and this box had two agents running suites during both runs.

## The fix (instrument only — `tools/notebook_wave6_walk.py`)

Both W1 reads are now **waiters** (`page.wait_for_function` on the attribute, **5 s** ceiling) instead of
fixed-delay samples, and the latency is recorded (`lock_latency_ms_after_patch`,
`unlock_latency_ms_after_patch`). Nothing that used to fail can now pass: a note that never locks still
reads `"true"` and FAILS.

**Control that the waiter can fail** (`w1-waiter-control.py`): on a note that is never locked, the same
waiter timed out at 1,514 ms and the attribute read `"true"` — the FAIL path is live.

## Also corrected in the same file

The walk stamped `CRITICAL_FINDING_editor_view_throwing_getter` into every run unconditionally. That
defect was fixed by wave 6 fix round 5, R5-1 (`e580b900e`); both runs above measured **0** occurrences
(`crash_stats.count: 0`). The key now follows the measurement: `CRITICAL_FINDING_…` only when this run
saw the crash, otherwise `HISTORY_…_fixed_R5_1` with the original report kept as history.
