# TY4 -- the wall-clock floor, and a busy-time reading that does not have one

Lane TY4, 2026-10-01. Hypothesis under test: `typing_per_char`'s wall-clock sample (keydown to
the editor's own post-`input` MessageChannel task, which the harness's docstring says includes
one rendering frame) is bounded below by the display-frame interval once a keystroke is fast, so
near the 16 ms budget line it can no longer tell a fast editor from a slow one. Branch
`feat/notebook-w10-ty4`, base `dfa326c33b`. Raw files, box status before every run, and this
reading's own sandbox integrity are in this directory; this file is the interpretation, committed
after the raw evidence (`b87efc3f1e`), per R-RAW.

## Box status -- every run, verbatim from `gate_box_lock.py status`

The gate lock (another session's six-shard gate, pid 48216, since 11:59:19) was **HELD** from
before this lane started measuring until ~12:43 local; every check during that window is in
`box-status.txt` and no run was attempted while it read HELD. Once FREE, the coordinator's
`scratchpad/MEASURING.flag` convention held for the whole six-run batch below (flag written
12:44:09, 60 s waited, flag deleted after `busy-3`).

| run | time (CDT) | lock | load | sandbox integrity |
|---|---|---|---|---|
| ctl-1 | 12:45:25 | FREE | **QUIET** -- 0 marked processes | CLEAN |
| ctl-2 | 12:47:18 | FREE | **QUIET** -- 0 marked processes | CLEAN |
| ctl-3 | 12:49:04 | FREE | BUSY -- 3 marked (vitest, worktree `pine-c44`) | CLEAN |
| busy-1 | 12:51:10 | FREE | BUSY -- 6 marked (vitest, `pine-c44`/`pine-c45`) | CLEAN |
| busy-2 | 12:53:23 | FREE | BUSY -- 5 marked (vitest, `pine-c45`) | CLEAN |
| busy-3 | 12:55:20 | FREE | BUSY -- 8 marked (vitest, `pine-c44`/`pine-c45`) | CLEAN |

**Only `ctl-1` and `ctl-2` started QUIET.** `ctl-3` and all three `busy-*` runs started with the
gate lock FREE but the load BUSY from unrelated worktrees' vitest (`gate 0` in every one of those
lines -- not the six-shard gate itself, which never reclaimed the lock during this batch). Every
one of the six runs' own sandbox integrity read CLEAN at pre-boot, post-boot (+15s) and shutdown.
**So: not every run started QUIET, and the `busy-*` table below has zero QUIET runs in it.** Its
absolute numbers are read as directional, not a clean verdict, below -- but see the reading for
why the one finding that matters here does not depend on that.

## Frame interval -- the floor argument's own number

Measured directly (`pw.chromium.launch()`, no args -- the same call `run_live()` makes), twice,
identically:

```
browser.version(): 145.0.7632.6
user_agent: "...HeadlessChrome/145.0.7632.6..."   <- confirms HEADLESS
60 requestAnimationFrame samples over 1000 ms
median interval: 16.7 ms   (p10 16.6, p90 16.7)
implied: 59.88 fps
```

**Headless Chromium, paced to ~16.7 ms/frame -- 1000/60 almost exactly.** Even with no real
monitor attached, headless Chrome's compositor simulates a 60 Hz display. This is the number the
floor hypothesis names: a wall-clock sample that includes "one rendering frame" cannot read below
roughly this value, however fast the editor's own work is.

## Control table -- wall-clock (`typing_per_char`), `--sizes 1,1000,2000 --opens 5 --chars 60`

| run | box | 1 ¶ p50 | 1 ¶ p95 | 1,000 ¶ p50 | 1,000 ¶ p95 | 2,000 ¶ p50 | 2,000 ¶ p95 |
|---|---|---:|---:|---:|---:|---:|---:|
| ctl-1 | QUIET | 2.8 | 14.6 | 5.7 | 16.4 | 6.9 | 16.8 |
| ctl-2 | QUIET | 3.2 | 14.8 | 5.3 | 14.4 | 7.6 | 15.4 |
| ctl-3 | BUSY | 3.1 | 16.1 | 5.9 | 15.5 | 13.0 | 19.3 |
| **median** | | **3.1** | **14.8** | **5.7** | **15.5** | **7.6** | **16.8** |

All values ms, 60 samples per size per run. For context, the previously-committed `control-1`
(1 / 10 / 100 ¶, `--opens 3`, a loaded box): p95 15.6 / 15.1 / 16.3 ms -- the same narrow band.

## Busy-time table -- trace-only (`typing_busy_per_char`), same sizes/opens/chars, `--busy`

| run | box | 1 ¶ p50 | 1 ¶ p95 | 1,000 ¶ p50 | 1,000 ¶ p95 | 2,000 ¶ p50 | 2,000 ¶ p95 |
|---|---|---:|---:|---:|---:|---:|---:|
| busy-1 | BUSY | 4.25 | 7.78 | 6.73 | 10.13 | 13.54 | 20.96 |
| busy-2 | BUSY | 5.02 | 7.62 | 6.74 | 9.75 | 15.04 | 19.47 |
| busy-3 | BUSY | 5.62 | 7.59 | 9.18 | 11.20 | 14.88 | 21.06 |
| **median** | | **5.02** | **7.62** | **6.74** | **10.13** | **14.88** | **20.96** |

All values ms, 59 windows per size per run (one fewer than keys sent: the last keydown in a trace
never closes a window, same rule as the typing probe's own first-open warm-up being dropped). No
budget line is bound to this row (`budget_ms: null` in the JSON) -- it is reported, not gated.

## Plain reading

**Is the wall-clock p95 at 1 paragraph within about 1-2 ms of its p95 at 1,000 and 2,000?**
Mostly yes, and the same pattern as `control-1`'s own three sizes. Median p95: 14.8 ms (1 ¶) ->
15.5 ms (1,000 ¶, +0.7) -> 16.8 ms (2,000 ¶, +2.0) -- at the outer edge of "within 1-2 ms" but not
past it. Per-run the deltas are noisier (ctl-3's 2,000 ¶ run, the one control run that did not
start QUIET, is +3.2 ms over its own 1 ¶ reading -- the single outlier), but five of six
within-run deltas across the three runs sit inside roughly 1-2 ms. Combined with `control-1`'s
1/10/100 ¶ band (15.6/15.1/16.3), the wall-clock p95 now has **five** sizes on record, 1 through
2,000 paragraphs -- a 2,000x range in note length -- and every one of them reads in a 14.4-19.3 ms
band. A sample that barely moves across a 2,000x change in the thing it is supposed to be timing
is the signature the floor hypothesis predicts.

**Does busy time grow with size?** Yes, clearly, monotonically, and on all three runs with no
exception: p95 7.59-7.78 ms (1 ¶) -> 9.75-11.20 ms (1,000 ¶) -> 19.47-21.06 ms (2,000 ¶) -- roughly
a 2.7x increase from 1 to 2,000 paragraphs, against the wall-clock reading's ~1.1x over the same
range (median p95 14.8 -> 16.8 ms). p50 shows the same shape (4.25-5.62 -> 6.73-9.18 ->
13.54-15.04 ms). This holds despite the three runs sitting under three different load levels (5,
6 and 8 marked foreign processes) -- the growth is not a side effect of which run happened to be
busiest; busy-2 (5 processes) and busy-3 (8 processes) land within about 1.5 ms of each other at
every size.

**Where does busy p95 sit against 16 ms?** Split cleanly, the same way on every run:
- 1 paragraph: **under** the line on all three runs (7.59-7.78 ms, well under half the line).
- 1,000 paragraphs: **under** the line on all three runs (9.75-11.20 ms).
- 2,000 paragraphs: **over** the line on all three runs (19.47-21.06 ms, by roughly 3.5-5 ms).

That is a clean, unanimous over/under split by size, with no run disagreeing at any size -- the
busy-time reading distinguishes a 1-paragraph keystroke from a 2,000-paragraph one by a wide
margin (median p95 7.62 ms vs 20.96 ms, a 2.75x gap) exactly where the wall-clock reading could
not (14.8 ms vs 16.8 ms, a 1.1x gap, both sides of that gap sitting within a couple ms of the
line itself).

**One thing worth naming rather than leaving unexplained:** at 2,000 ¶ the busy-time p95 (median
20.96 ms) reads HIGHER than the wall-clock p95 at the same size (median 16.8 ms), even though
busy time is main-thread work alone with no frame wait in it. This is not a contradiction. The
two samples are windowed differently -- `typing_per_char` stops at ONE keystroke's own
post-`input` MessageChannel task, while `typing_busy_per_char`'s window runs until the NEXT
keydown (`--chars`'s `delay=25` apart, wider still once a keystroke's own work exceeds 25 ms, as
2,000 ¶ keystrokes do) and sums every top-level task in that wider window. It can therefore catch
main-thread work -- a deferred React effect, GC, other scheduled work -- that keeps running on the
thread after the wall-clock probe's own signal already fired. None of the three busy-time runs
started QUIET, so some of the absolute level here may also carry ordinary box-contention widening
of the inter-keydown gap itself; the reading above leans on the WITHIN-run, across-size shape
(which three independently-loaded runs agree on), not on the absolute busy-vs-wall-clock gap at
one size.

## Does the floor hypothesis hold

**Yes, on this evidence.** The wall-clock sample (`typing_per_char`) is close to flat across a
2,000x range of note sizes -- p95 moving only about 2 ms from 1 to 2,000 paragraphs, clustering in
a 14.4-19.3 ms band that straddles the 16 ms line regardless of size, on five separately-measured
sizes across two sets of runs. The busy-time sample (`typing_busy_per_char`), measured the same
sizes, the same way, in the same program, moves by roughly 2.7x over that same range and lands
cleanly under the line at 1 and 1,000 paragraphs and cleanly over it at 2,000 -- the exact
discrimination the wall-clock number could not make. That is consistent with the wall-clock
sample's tail being bounded below by something close to the measured ~16.7 ms frame interval
(headless Chromium's own simulated 60 Hz pacing) rather than by the editor's own work, and with
the busy-time sample reading the editor's main-thread cost directly, without that floor.

**What this reading does not settle:** which row (if either) the 16 ms budget line should bind is
a controller decision, not this lane's -- `typing_per_char` is unchanged and still the budget
check's reading; `typing_busy_per_char` is reported only (`tools/notebook_perf_harness.py`,
`summarize_busy()`), never gated, in this lane's commit. Nor does this settle how FAST the editor
should be at 2,000 paragraphs -- only that the two instruments disagree about whether a keystroke
at that size is distinguishable from one at 1 paragraph, and that the busy-time one is the one
that can tell.
