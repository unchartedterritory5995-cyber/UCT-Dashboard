# Tier 2 part A (Task 11): first-open bytes and typing, with the smart chips switch off and on

Date: 2026-10-14/15. Tip `6273205ad0` (the build and every run). Raw evidence, committed before this file:
`docs/notebook/evidence/t2a-perf-20261015T041026Z/` (commits `b3fcfb14d9`, `cd4e80e437`). Every number below
is read from those files.

## Verdict

* **Bytes: OVER THE PLAN'S ALLOWANCE, UNDER THE BUDGET.** 2,257,499 B against the plan's allowance of base +
  4,096 B = 2,249,785 B: **+7,714 B over the allowance**, +11,810 B over the base. It is 3,294 B under
  `notebook_first_open.max` (2,260,793 B), so the checker prints PASS. The lazy-parser fallback was NOT applied:
  the parser is a minority of the overage and moving it would not reach the allowance (details below). No budget moved.
* **Typing: no regression from the switch is measurable above this harness's own run-to-run spread.** Switch on
  versus off, at 1 / 1,000 / 2,000 paragraphs, p95 of `typing_busy_per_char`: see the tables. No product code and
  no budget was changed.
* The 2,000-paragraph p95 is at or over the 16 ms line in **both** arms: in 8 of the 17 runs (switch off 3 of 8,
  on 5 of 9). That is the open F-LONGNOTE-TYPING floor, and it is not new: the p2b-ab record has the plain arm over
  the line in 1 of 3 runs and the blocks arm in 2 of 3.

## Bytes

`python tools/notebook_perf_budgets.py --dist app/dist` on the tip build (`bytes.txt`):

    bytes.notebook_first_open: 2,257,499 B across 62 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
    VERDICT: PASS -- within every budget checked

The base (`4b2e5773c1`, V14 in `docs/notebook/t2a-verify-before-building.md`) was rebuilt here the same way to get
the per-chunk difference (`bytes-base.txt`: 2,245,689 B across 61 chunks, the number V14 recorded).
`bytes-chunk-diff.txt`, the closure walked with the checker's own functions:

| chunk | base | tip | delta |
|---|---:|---:|---:|
| `NotebookFlagGate` (the editor page, the slash menu, `planCreate`, the screenshot label code) | 344,261 | 350,110 | +5,849 |
| `tiptap` (the alert plugin, its parser, the flag read) | 278,961 | 283,353 | +4,392 |
| `alertModel` (NEW in the closure: the parser imports `parseAlertPrice` from `pages/terminal/alertModel`) | 0 | 1,253 | +1,253 |
| `index` | 834,965 | 835,219 | +254 |
| `NotebookSurface`, `journalStylesFlag` | | | +33, +29 |
| **total** | 2,245,689 | 2,257,499 | **+11,810** |

**Does the overage come from the alert parser? Only in part, so the fallback was not applied** (the ruling: apply it
only if the overage comes from the alert parser). Minified module sizes (`bytes-module-sizes.txt`, esbuild one file at
a time, a rough guide and not the budget's number): the parser `lib/alertPhrase.js` 1,841 B plus the `alertModel`
chunk it drags into the closure, 1,253 B in the build, about 3.1 KB, 26 percent of the overage. Moving it behind a
lazy stub would still leave about +8.7 KB over the base, more than twice the +4,096 B allowance. The rest is the
plugin itself (1,979 B), the editor page's wiring for the two chips and `/plan` (the `NotebookFlagGate` chunk, +5.8 KB
that includes `planCreate` 532 B and the screenshot label and alt code 569 + 1,500 B), and the slash item.
Decision for the controller: either raise the allowance (the 15,104 B of headroom V14 measured is 3,294 B now), or
trim the editor page's eager wiring; the parser alone does not close it.

## Typing

Harness: `tools/notebook_perf_harness.py` unchanged, through `runner.py` (this directory), with the p2b-ab arguments
(`--boot --busy --sizes 1,1000,2000 --opens 20 --chars 60 [--with-blocks]`). `--out` is not a flag of this harness; its
files go next to `--json`. The one env difference between "off" and "on" is `NOTEBOOK_SMART_CHIPS_ENABLED`
(read sites `api/routers/auth.py:266` and `api/routers/notebook_smart_chips.py:27`); each run's
`*.flagcheck.json` records the value the server served on `/api/auth/me` for the perf account (`false` for off,
`true` for on), the payload the client latches. All 17 runs: three CLEAN integrity checkpoints, no change under
`C:\data`, 59 windows per size. Reading: `typing_busy_per_char` p95, renderer main-thread busy time per keystroke
(ruling D24), ms.

Run names: `r*` ran first, against another session's ambient load (CPU 35 to 67 percent from five spinning `python -`
processes belonging to a different Claude session, which I did not touch); `q*` and `on-plain-r3` ran afterwards at
10 to 43 percent. The box readings before and after every run are in `*.box.txt`. Free memory never went under 12,000 MB.
**The box was not quiet for the `r` runs**, which the brief required; the `q` runs are the nearer to it, and the
`off-plain-r3` / `on-plain-r3` pair straddles the change (40 versus 11 percent CPU) and is not a like-for-like pair.

### Plain notes, switch off (A) versus on (B)

| paragraphs | A loaded (r1, r2, r3) | A quiet (q1, q2) | B loaded (r1, r2) | B quiet (q1, q2, r3) |
|---:|---|---|---|---|
| 1 | 8.36, 6.82, 8.12 | 5.16, 5.27 | 6.20, 7.67 | 4.79, 6.22, 5.00 |
| 1,000 | 12.70, 18.04, 13.21 | 9.71, 10.05 | 11.38, 12.62 | 9.77, 9.31, 8.21 |
| 2,000 | 15.10, 20.77, 18.29 | 14.66, 13.40 | 16.05, 21.59 | 16.17, 13.57, 13.26 |

Medians of the p95: loaded A 8.12 / 13.21 / 18.29, B 6.94 / 12.00 / 18.82; quiet A 5.21 / 9.88 / 14.03, B 5.00 / 9.31 / 13.57.
B minus A on the quiet runs: -0.21, -0.57, -0.46 ms; on the loaded runs: -1.18, -1.21, +0.53 ms. The spread
inside one arm at 2,000 paragraphs is 5.67 ms loaded (A) and 1.26 ms quiet (A); every B-minus-A difference is inside it.

### With trader blocks (`--with-blocks`)

| paragraphs | A off (r1, q1) | B on (r1, q1) |
|---:|---|---|
| 1 | 9.89, 6.65 | 8.26, 6.66 |
| 1,000 | 14.09, 10.22 | 11.82, 12.12 |
| 2,000 | 20.13, 13.90 | 18.87, 15.35 |

### The alert chip's plugin active: an alert sentence in the caret paragraph (switch on)

`T2A_ALERT_CARET=1` in `runner.py` puts "alert me if NVDA closes below 120 " in front of the marker in the LAST
paragraph of each seeded note, which is the paragraph the harness types at the end of. Every keystroke therefore
runs the plugin's parse of a paragraph that holds a real alert sentence, and the sentence's offer changes text on
each key. **Limit, stated and not faked:** the harness types only at the end of the note, so this is a change to the
seed, not a chosen typing position; the chip itself (which waits for typing to pause) appears after the timed
keystrokes, so what is timed is the plugin and the menu's per-key work, not a chip being clicked. `on-alert-*`
ran this at all three sizes:

| paragraphs | on-alert r1, r2, q1 | median | plain B quiet median | plain A quiet median |
|---:|---|---:|---:|---:|
| 1 | 7.28, 8.82, 5.10 | 7.28 | 5.00 | 5.21 |
| 1,000 | 11.49, 15.72, 9.45 | 11.49 | 9.31 | 9.88 |
| 2,000 | 14.85, 19.95, 14.61 | 14.85 | 13.57 | 14.03 |

The loaded runs (r1, r2) are in the median, so it is higher than the quiet-only comparison; the one quiet run
(q1) reads 5.10 / 9.45 / 14.61, level with the plain quiet runs.

## The baseline and the noise band

The spec's "p95 4.94 / 7.07 / 9.37 ms" is **not a recorded p95** (the p2b-ab record, `8bdf38beb2`, section "The
baseline beside it", traces it to individual raw samples), so a regression cannot be judged against it. Against the
p2b-ab record, which is the same harness with n=3 per arm (`git show 8bdf38beb2:docs/notebook/perf-runs/p2b-ab/RESULT.md`):
plain-arm medians of the p95 6.27 / 10.57 / 15.78 and ranges 5.17 to 6.79, 8.14 to 15.45, 12.89 to 19.83 (blocks arm
5.50 to 8.06, 8.61 to 12.76, 14.74 to 20.68). My quiet runs sit inside those ranges at every size and in both arms
(off 5.16 to 5.27 / 9.71 to 10.05 / 13.40 to 14.66; on 4.79 to 6.22 / 8.21 to 9.77 / 13.26 to 16.17). My loaded runs
(the `r` runs) are wider than that record: up to 9.89 at 1 paragraph, 18.04 at 1,000 and 21.59 at 2,000, and the
highest values are in the arm with the switch OFF as often as the one with it on (off-plain-r2 20.77 at 2,000,
on-plain-r2 21.59). The off arm runs none of the new code and reproduces the 16 ms breach at 2,000 paragraphs, so the
breach is the floor, not the chips.

## What this does and does not show

* It shows no difference between switch off and switch on larger than the spread of the harness itself, at all
  three sizes, plain and with blocks, and with the alert plugin parsing the caret paragraph.
* It does not show that the switch costs nothing. With n=2 or 3 per arm and a spread of 1.3 ms (quiet) to 5.7 ms
  (loaded) at 2,000 paragraphs, a difference of about a millisecond is below what these runs can resolve.
* The 16 ms line is not met at 2,000 paragraphs in most runs of both arms. No budget was moved.
* The screenshot chip's cost is not in these runs: it does nothing until an image is pasted, and the harness pastes none.

## Addendum: the final tree `c57a084a08` (Task 12 re-measure)

Date 2026-10-15. The final fix wave changed the alert plugin's per-keystroke path (the parser now arrives through the
menu's hosting handshake, `offerAt` is wrapped in try/catch, `handleKeyDown` reads a `showing` flag), so typing was
re-measured on the final tree. Raw evidence, committed before this section (`36eff0dfb2`):
`docs/notebook/evidence/t2a-perf-final-20261015T043054/`. The harness, the runner and the arguments are Task 11's
(`--boot --busy --sizes 1,1000,2000 --opens 20 --chars 60 [--with-blocks]`); `app/dist` was rebuilt on `c57a084a08`
before the first run. Each run's `*.flagcheck.json` records what the server served on `/api/auth/me` for the perf account
(`true` for the switch-on runs, `false` for off). All nine runs have three CLEAN integrity checkpoints.

**The box was not quiet.** Free memory was 11,500 to 13,900 MB throughout, but CPU sat at 40 to 46 percent for the whole
session (`*.box.txt`): another session's render job (`uct_clips.idle_render`, about 8 cores) and two spinning
`python -` processes. None is mine and I did not touch them. These runs are therefore comparable to Task 11's LOADED
`r` runs, not its quiet `q` runs. An off-arm control on the final tree ran on the same box for that reason.

Reading: `typing_busy_per_char` p95, ms. Every run exits 1 only because of the 16 ms line at 2,000 paragraphs, in both arms
(the open F-LONGNOTE-TYPING floor).

| arm (final tree) | 1 paragraph | 1,000 | 2,000 |
|---|---|---|---|
| switch ON, plain (f1, f2) | 8.73, 5.54 | 12.84, 12.94 | 16.03, 17.46 |
| switch ON, alert sentence in the caret paragraph (f1, f2) | 5.17, 6.37 | 11.93, 14.59 | 18.11, 20.69 |
| switch OFF, plain (f1, f2), same-box control | 5.62, 15.98 | 11.05, 12.35 | 19.01, 21.64 |
| switch ON, blocks (f1, f2) | 9.07, 6.44 | 13.78, 10.36 | 30.09, 17.29 |
| switch OFF, blocks (f1), same-box control | 12.80 | 19.38 | 29.94 |

Against Task 11's switch-on numbers, same harness and same loaded conditions:

| arm | Task 11 loaded runs | final tree |
|---|---|---|
| ON plain | 6.20, 7.67 / 11.38, 12.62 / 16.05, 21.59 | 8.73, 5.54 / 12.84, 12.94 / 16.03, 17.46 |
| ON alert sentence | 7.28, 8.82 / 11.49, 15.72 / 14.85, 19.95 | 5.17, 6.37 / 11.93, 14.59 / 18.11, 20.69 |
| ON blocks | 8.26 / 11.82 / 18.87 | 9.07, 6.44 / 13.78, 10.36 / 30.09, 17.29 |

* **No regression from the final tree.** Every switch-on value sits inside Task 11's loaded spread at 1 and 1,000
  paragraphs, and at 2,000 paragraphs the plain and alert arms are inside it too (16.03 and 17.46 against 16.05 to 21.59;
  18.11 and 20.69 against 14.85 to 19.95, 0.74 ms above its top in one run of two).
* **The single high reading is the box, shown by the control.** `on-blocks-f1` read 30.09 ms at 2,000 paragraphs, above
  anything Task 11 recorded in its blocks runs (top 20.13, switch off). Its same-box switch-OFF control, `off-blocks-f1`, read 29.94 at 2,000 and 19.38 at
  1,000 (and 12.80 at 1 paragraph). The off arm runs none of the new code, so the spike belongs to the box, and the next
  switch-on blocks run (`on-blocks-f2`) read 17.29.
* **The off arm is as high as the on arm or higher** on this box (plain at 2,000: 19.01 and 21.64 off against 16.03 and
  17.46 on; the 15.98 at 1 paragraph in `off-plain-f2` is one tail outlier), the same pattern as Task 11.
* **What this does not show:** with n=2 per arm and a loaded box, a difference of about a millisecond is not resolved
  here, and the chip itself (which waits for typing to pause) is not in the timed window, as in Task 11. The decision
  rule was "a clear regression against Task 11's switch-on numbers is a STOP"; none is present.
