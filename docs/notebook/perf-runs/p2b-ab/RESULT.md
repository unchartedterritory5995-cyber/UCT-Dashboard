# F-TYPING-AB: does a note with trader blocks type slower than a plain note?

Date: 2026-10-14. One build (`9156620ceb`, origin/master; frontend built once with `npm run build`), one
instrument (`tools/notebook_perf_harness.py`), six runs interleaved **A B A B A B** so machine-load drift
lands on both arms. A = plain notes (`plain-r1..r3`), B = the same note sizes plus one of every trader block
and a market-context stamp (`blocks-r1..r3`, `--with-blocks`).

Command per run (each with its own fresh sandbox data dir `C:\data-typing-ab-r1..r6`, never `C:\data`):

    python tools/notebook_perf_harness.py --boot --busy --data-dir <sandbox> --sizes 1,1000,2000 \
        --opens 20 --chars 60 [--with-blocks] --json ... --md ... --integrity-log ...

`--busy` is required: without it the typing budget has no reading (ruling D24). The reading below is
`typing_busy_per_char` (renderer main-thread busy time per keystroke, from the trace-only pass), 59 windows
per size per run. Raw evidence is committed in `eefd30468f` (this directory: `*.json`, `*.md`,
`*.integrity.md`, `*.console.txt`, `*.sandbox.log`).

## Tables: `typing_busy_per_char`, ms per keystroke

"Spread" is the range (max minus min) of the three runs inside one arm. It is a range of n=3, not a standard
deviation. B minus A is median(B) minus median(A).

### 1 paragraph

| | r1 | r2 | r3 | median | spread |
|---|---:|---:|---:|---:|---:|
| A plain p50 | 3.85 | 3.53 | 5.32 | 3.85 | 1.79 |
| B blocks p50 | 5.12 | 5.13 | 3.64 | 5.12 | 1.49 |
| **B minus A, p50** | | | | **+1.27** | |
| A plain p95 | 6.27 | 5.17 | 6.79 | 6.27 | 1.62 |
| B blocks p95 | 8.06 | 7.22 | 5.50 | 7.22 | 2.56 |
| **B minus A, p95** | | | | **+0.95** | |

### 1,000 paragraphs

| | r1 | r2 | r3 | median | spread |
|---|---:|---:|---:|---:|---:|
| A plain p50 | 5.78 | 6.87 | 9.26 | 6.87 | 3.48 |
| B blocks p50 | 6.83 | 6.16 | 6.12 | 6.16 | 0.71 |
| **B minus A, p50** | | | | **-0.71** | |
| A plain p95 | 8.14 | 10.57 | 15.45 | 10.57 | 7.31 |
| B blocks p95 | 12.76 | 9.38 | 8.61 | 9.38 | 4.15 |
| **B minus A, p95** | | | | **-1.19** | |

### 2,000 paragraphs

| | r1 | r2 | r3 | median | spread |
|---|---:|---:|---:|---:|---:|
| A plain p50 | 11.51 | 12.43 | 10.92 | 11.51 | 1.51 |
| B blocks p50 | 11.54 | 12.18 | 10.96 | 11.54 | 1.22 |
| **B minus A, p50** | | | | **+0.03** | |
| A plain p95 | 15.78 | 19.83 | 12.89 | 15.78 | 6.94 |
| B blocks p95 | 14.74 | 20.68 | 16.20 | 16.20 | 5.94 |
| **B minus A, p95** | | | | **+0.42** | |

## The baseline beside it

The spec (`docs/superpowers/specs/2026-10-11-notebook-journal-styles-design.md`, performance bullet) names
the 2026-10-10 busy-time baseline "p95 4.94 / 7.07 / 9.37 ms" at 1 / 1,000 / 2,000 paragraphs.

**That triple is not a recorded p95.** `docs/notebook/p2-verify-before-building.md` section V2 traced it:
no single run carries those values as `typing_busy_per_char` p95 rows; they are individual raw samples from
`ty-l15-quiet/q1.json` and `ty5/ab/A3.json`. The quiet-box record of the same instrument is
`docs/notebook/perf-runs/ty9-quiet-marker/q1.json` (tree `004059b694`, `--busy`, no blocks):

| paragraphs | spec triple (as quoted) | ty9 q1 p95 (a recorded p95) | ty9 q1 p50 | A median p95 now | B median p95 now |
|---:|---:|---:|---:|---:|---:|
| 1 | 4.94 | 6.85 | 3.43 | 6.27 | 7.22 |
| 1,000 | 7.07 | 6.77 | 4.75 | 10.57 | 9.38 |
| 2,000 | 9.37 | 9.73 | 6.58 | 15.78 | 16.20 |

Against either baseline, the 2,000-paragraph reading today is far higher than the baseline, **in the plain
arm as well as the blocks arm**. This run is not a like-for-like comparison with the old triple (different
tree, different box state), so the gap is reported and not explained; the cause was not investigated here.
The question this run answers is the within-run A versus B one.

## Box readings during the runs

Taken by the runner before and after each run (`Get-Counter`: available memory, and CPU % sampled five
times one second apart; mean and max shown). Initial check before the build: 13,121 MB available, CPU 18 to 22%.

| time | point | available MB | CPU mean | CPU max |
|---|---|---:|---:|---:|
| 13:31:07 | before plain-r1 | 13,244 | 36.5 | 42.6 |
| 13:33:27 | after plain-r1 | 13,301 | 21.3 | 27.6 |
| 13:33:33 | before blocks-r1 | 13,318 | 23.0 | 28.0 |
| 13:35:20 | after blocks-r1 | 13,147 | 33.8 | 35.1 |
| 13:35:26 | before plain-r2 | 13,379 | 23.1 | 33.1 |
| 13:37:11 | after plain-r2 | 13,357 | 15.2 | 17.4 |
| 13:37:17 | before blocks-r2 | 13,219 | 19.8 | 26.6 |
| 13:39:04 | after blocks-r2 | 13,272 | 18.5 | 25.9 |
| 13:39:10 | before plain-r3 | 13,491 | 18.9 | 25.4 |
| 13:40:59 | after plain-r3 | 13,853 | 6.6 | 10.7 |
| 13:41:05 | before blocks-r3 | 13,792 | 13.9 | 24.3 |
| 13:42:45 | after blocks-r3 | 13,854 | 10.5 | 11.9 |

Memory never went under 13 GB (threshold 6,000 MB). CPU never exceeded 50%; the highest single sample was
42.6%, before the first run. The box was not idle: an ambient 6 to 36% CPU mean existed throughout, and the
readings are point samples at the edges of each run, so they say nothing about load inside a run.

## Run exits and integrity

| run | exit | meaning | integrity |
|---|---:|---|---|
| plain-r1 | 0 | within budget | CLEAN (pre-boot, +15 s, shutdown; 62 db files) |
| blocks-r1 | 2 | INCONCLUSIVE: wall-clock typing at 1 paragraph had 59 samples for 60 keys. The budget's `typing_busy_per_char` rows are all present with 59 windows each | CLEAN |
| plain-r2 | 1 | BUDGET BREACH: busy p95 19.83 ms at 2,000 paragraphs | CLEAN |
| blocks-r2 | 1 | BUDGET BREACH: busy p95 20.68 ms at 2,000 paragraphs | CLEAN |
| plain-r3 | 0 | within budget | CLEAN |
| blocks-r3 | 1 | BUDGET BREACH: busy p95 16.20 ms at 2,000 paragraphs | CLEAN |

All six integrity logs have three CLEAN checkpoints and no changed file under `C:\data`. No run recorded a
page error. blocks-r1's exit 2 concerns only the wall-clock row (`typing_per_char`, not the budget's reading,
and missing for that size in that run); I kept the run because its busy rows are complete, and it happened
once, so it was not re-run. Its wall-clock row at 1 paragraph is absent.

## Verdict

**Does B exceed A by more than the run-to-run spread inside each arm?** No. At every size and for both
percentiles, B minus A (+1.27, +0.95, -0.71, -1.19, +0.03, +0.42 ms) is either negative or smaller than the
smaller of the two arms' measured ranges at that size and percentile (1.49, 1.62, 1.22, 5.94 ms in turn
for the four positive cases). At 1,000 paragraphs the difference is negative (blocks was faster). The closest case is 1 paragraph p50, +1.27 against ranges of 1.79 (A) and 1.49 (B): the
three B runs were 5.12, 5.13, 3.64 against A's 3.85, 3.53, 5.32, so the arms overlap. With n=3 per arm this
can rule out a large regression from blocks; it cannot rule out a difference of about a millisecond at small
sizes.

**Is everything under the 16 ms budget?** No, and not because of blocks. At 1 and 1,000 paragraphs every run
in both arms is under 16 ms (worst: 15.45 ms, plain-r3 at 1,000). At 2,000 paragraphs the p95 breached 16 ms
in three of six runs: plain-r2 (19.83), blocks-r2 (20.68), blocks-r3 (16.20). The medians are A 15.78 (under
by 0.22 ms) and B 16.20 (over by 0.20 ms). Two of the three breaches are in the run-2 pair, both arms,
back to back, which looks like a drift episode that hit both arms; the box readings at that time (CPU 15 to
33%) do not show it, so I did not identify it. A plain note breached the budget in this run too, so the
budget breach at 2,000 paragraphs is not attributable to blocks.

**Caveats.** n=3 per arm; spread is a range; one build and one box. The baseline triple in the spec is not a
recorded p95 (see above), so "no regression against it" cannot be judged from this run; the 2,000-paragraph
reading is well above the ty9 quiet-box record for both arms.
