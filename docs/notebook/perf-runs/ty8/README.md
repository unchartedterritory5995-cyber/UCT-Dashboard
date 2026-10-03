# TY8 -- the tail: what runs on the slow keys, 2026-10-01/02

Branch `feat/notebook-w10-ty8`, base `fefbc2bf6`. Raw evidence, in commit order: the
per-window breakdown and slow-vs-median comparison (`0715c8b282`, R-RAW, before
interpretation); the fix (`b498cbdf5f`); the interleaved A/B (committed below); this file.

TY4/TY5/TY7 narrowed `typing_busy_per_char`'s aggregate p50/p95 but left the gap between
them wide: on a quiet box at 2,000 paragraphs (`docs/notebook/perf-runs/ty-l15-quiet/README.md`),
busy p50 11.6 ms / p95 17.1 ms (at 1,000: p50 8.5 / p95 19.6). Most keys are cheap and a
minority are slow -- a tail problem TY5's own CPU profile and TY7's own caller-tree walk
could not see, because both are AGGREGATES over a whole typing burst. This lane's job: find
what runs on the slow keys specifically, by looking at individual keydown-to-keydown
windows rather than a burst-wide average.

## Method (R-RAW)

`tools/notebook_ty8_tail.py` (new) reuses the harness's own trace-only `--busy` pass
(`notebook_perf_harness.py`'s `Sandbox`, provisioning, seeding, note-open and tracing
primitives, unchanged) at 1,000 and 2,000 paragraphs. For every complete keydown-to-keydown
window -- the identical window `H.keystroke_busy_ms` already defines -- it computes the
SELF TIME of every named phase inside that window (the same nested stack algorithm
`summarize_trace` uses for a whole pass, run here per window on events clipped to the
window's own boundaries), cross-checked against `H.keystroke_busy_ms`'s own total (proven to
agree window-for-window, `--self-check`). It then buckets windows into the slowest decile
and a narrow band around the median, and reports, per trace-event label, how often it
appears and what it costs in each bucket.

Exploratory run (`r195210`, 1,000/2,000 paragraphs, 150 chars, box BUSY -- another lane's
six-shard gate was running; `docs/notebook/perf-runs/ty8/box-status-exploratory.md` explains
why a structural, categorical finding like "did this GC phase event fire in this window" does
not depend on a quiet box the way an absolute timing does). Raw per-window data and the
slow/median comparison are committed in this directory (`ty8-windows-*.json`,
`ty8-slow-vs-median-*.json`) before this file was written.

## What runs on the slow keys

At both sizes, the slow decile's mean busy time exceeds the median band's by a wide margin
(1,000¶: 15.08 ms vs 8.57 ms, +6.51 ms; 2,000¶: 27.51 ms vs 13.13 ms, +14.38 ms -- both
measured on the busy box above, so absolute values are directional, not the budget's own
quiet reading). Grouping every trace label that differs between the two buckets by category
and summing its share of that gap:

| category | 1,000¶ share of the gap | 2,000¶ share of the gap |
|---|---:|---:|
| **V8 GC phases** (`V8.GC_MC_INCREMENTAL` and ~90 named siblings) | 19.4% (1.27 ms) | **38.0% (5.46 ms)** |
| task/scheduler overhead (`ThreadControllerImpl::RunTask`, `SimpleWatcher::OnHandleReady`, `BlinkScheduler_PerformMicrotaskCheckpoint`) | 16.5% | 22.8% |
| React internals (`FunctionCall` into the `vendor-react` chunk) | 13.4% | 15.3% |
| paint pipeline (`UpdateLayoutTree`, `Layout`, `Paint`, `PrePaint`, `Commit`, `Layerize`) | 15.5% | 11.6% |
| `FunctionCall` into the editor bundle (a MutationObserver callback, `askInsert-*.js`) | 19.1% | 6.0% |
| `EventDispatch` (keydown/textInput) | 12.3% | 3.5% |
| everything else, incl. `TimerFire` | 3.7% | 2.8% |

**V8 GC is the single largest named category at both sizes, and it is the one that GROWS
with note size** (19.4% -> 38.0% of the gap, consistent with a generational collector's pause
scaling with how much live data it must walk). Looking at individual slow windows at 2,000¶
rather than the aggregate: excluding the first two windows (a one-time note-switch warm-up
cost), GC phase events appear on a roughly ALTERNATING pattern -- windows 25, 50, 74, 98, 123,
148 all carry GC, spaced 24-25 windows apart, remarkably regularly. That spacing is the
signature of a fixed per-keystroke allocation filling a fixed-size young generation and
triggering a scavenge/incremental-mark step on a schedule, not a data-dependent trigger.

Traced to its call site: `memoStringifyBody.js`'s top-level `obj.content.map(stringifyNode)
.join(',')` reruns in full on every keystroke, because the doc-level node object is a FRESH
object every keystroke (ProseMirror's structural sharing reuses unchanged children, never the
parent array listing them), so the WeakMap cache at that level always misses. At 2,000
paragraphs this allocates a ~2,000-element array plus a full byte-copy join of the whole
note's JSON text (~150-300 KB) every ~25 ms, regardless of how small the edit was.

### Candidates confirmed or cleared from the data

- **Debounced whole-document work (NoteStats 400 ms, NoteOutline 200 ms, the durable
  IndexedDB write 200 ms) landing mid-burst: CLEARED.** Read directly
  (`NoteStats.jsx`, `durableWriter.js`): every one is a TRAILING debounce that calls
  `clearTimeout`+`setTimeout` on every keystroke, so at the harness's 25 ms cadence -- far
  under any of these windows -- the timer is cancelled and rescheduled every key and never
  actually fires mid-burst; it only fires once after typing stops. `TimerFire`'s total
  contribution to the slow-vs-median gap is effectively zero (-0.002 ms at 1,000¶, +0.006 ms
  at 2,000¶) and every individual `TimerFire#<id>` in the data is a distinct, never-repeating
  id firing on exactly one window each, each costing ~0.01-0.05 ms -- unrelated internal
  bookkeeping timers, not this app's debounces.
- **The outbox retry interval (`RETRY_INTERVAL_MS = 60000`): CLEARED by construction.** Sixty
  seconds does not fit inside a 1.5-3.75 s typing burst; confirmed absent from the data (no
  outbox-shaped cost; see the TimerFire finding above).
- **`requestIdleCallback`: CLEARED.** Zero `FireIdleCallback` events in either trace.
- **MessagePort handlers: CLEARED.** The only message-shaped label in either trace is
  `Receive mojo message`, a Chromium-internal IPC event, not an application
  `postMessage`/`MessageChannel` handler (and the busy pass installs no listeners of its own
  per the harness's own `--busy` contract).
- **Garbage collection from per-key allocation: CONFIRMED. FIXED, this lane** (see below).
- **Layout thrash from a layout-read-after-write (`getBoundingClientRect`/`offsetHeight`
  after a write): CHECKED, NOT INDEPENDENTLY CONFIRMED as a forced-reflow bug.**
  `blockHandle.js` and `TableToolbar.jsx` are the two call sites in the typing path that read
  layout -- TY7 already traced that neither runs in a plain-paragraph, no-table, no-hover
  scenario (`this.block` stays `null`; the table toolbar's bump reducer bails outside a
  table, confirmed by reading `TableToolbar.jsx` current source). The paint-pipeline category
  above (`UpdateLayoutTree`/`Layout`/...) tracks the SAME windows GC lands on (inspected
  per-window at 2,000¶), consistent with being a knock-on consequence of a GC pause delaying
  and coalescing frame work, not an independent forced-reflow call site.
- **React scheduler tasks: present, not newly explained.** The `FunctionCall` rows into the
  `vendor-react` chunk are React's own commit/scheduler internals, consistent with TY7's own
  finding that `commitBeforeMutationEffects`-class work is core framework machinery; TY7
  already cut the dominant trigger (the two unconditional bump-reducer re-renders) by 89%.
  No new lever found here; left, same category TY5/TY7 name.

## The fix (commit `b498cbdf5f`)

`app/src/pages/journal-2-0/lib/memoStringifyBody.js` -- `createIncrementalJoin()`: keeps the
last joined string plus a per-element offset table, and for the common case (a content array
the SAME LENGTH as last time, differing in a contiguous run of elements -- true for every
ordinary character-insertion keystroke, since exactly one paragraph object changes), reuses
the unchanged PREFIX and SUFFIX of the previous joined string via `String.prototype.slice()`
instead of rebuilding them from an array of ~2,000 already-cached pieces. Only the changed
range is re-stringified and rejoined. A length change (Enter, Backspace at a paragraph
boundary, paste) falls back to the exact same full recompute as before. Wired only into the
doc's own top-level content array (`stringifyBody`, what `createMemoStringify()` now
returns); every nested content array still uses the unchanged recursive `stringifyNode`.

**Why this is safe:** it changes ONLY how the joined string is computed, never what it
contains, how often the snapshot is taken, or what is written to `localStorage` -- the Wave
Q1 "one synchronous snapshot per keystroke, same bytes" guarantee is untouched (confirmed:
no call site in `NoteEditorPage.jsx`'s `saveDraftLocally`/`captureLocalState` changed; the
durable write path and the local draft's frequency/timing are not touched). Every output is
proven byte-identical to the plain `arr.map(stringify).join(',')` it replaces
(`memoStringifyBody.test.js`): a dedicated `createIncrementalJoin` suite (first call,
single-element change at the end and in the middle, a contiguous multi-element change, a
same-reference cache hit, the length-change fallback, and a 200-step property-style run
against mixed edits), plus end-to-end tests at the exact 2,000-paragraph budget size (an edit
at the end, in the middle, and repeated far-apart edits exercising the offset-shift math
under more than one remote edit). All 7 of the new `createIncrementalJoin` tests were run
against a scratch copy of the pre-fix file and FAILED there with `createIncrementalJoin is
not a function` (the function did not exist before this lane), confirming the "fails before
the fix" property; the scratch copy was deleted afterward and never committed.

`typingWholeDocWalks.test.js` was not extended: its rails are specifically about
`Node.prototype.descendants`/`nodesBetween` call counts, and this fix touches neither --
the identical reasoning TY5 recorded for its own, differently-shaped cost.

## A/B busy-time measurement

`tools/notebook_perf_harness.py --boot --busy --sizes 1,1000,2000 --opens 20 --chars 60`, A/B
interleaved A1 B1 A2 B2 A3 B3. A = `git show fefbc2bf6:<path>` bytes for
`memoStringifyBody.js` (the lane's own base, before this fix), binary-restored via the Write
tool and verified byte-exact (sha256) against the captured base before building; B = the
committed fix, verified byte-exact against HEAD before building. The two builds'
`NotebookFlagGate-*.js` chunk hash differed (A: `NotebookFlagGate-B36W-k0F.js`, B:
`NotebookFlagGate-DnSL5TZQ.js`, confirmed reproducible -- rebuilding B's source a second time
reproduced the identical hash) -- confirmed by construction, not trusted from a filename
alone. Each build's `app/dist` was produced once and copied into place before each of the 6
runs rather than rebuilt per run (the source bytes, not the build step, are what each run
measures). Fresh scratchpad data dir + port per run (8481-8486).

Runs taken 2026-10-02 05:08-05:32 local, raw files in `ab/` (committed `ef60c3640b` before this
reading). **Lock FREE and load QUIET at both ends of every run**; shared-data-root integrity
CLEAN at every checkpoint of all six.

Busy time per keystroke (`typing_busy_per_char`, the budget's reading under ruling D24), ms,
p50 / p95:

| run | 1 ¶ | 1,000 ¶ | 2,000 ¶ |
|---|---|---|---|
| A1 (before) | 2.99 / 4.41 | 4.62 / 6.07 | 7.15 / 10.60 |
| B1 (TY8) | 3.15 / 4.49 | 4.63 / 6.49 | 6.75 / 9.89 |
| A2 (before) | 3.08 / 4.42 | 4.68 / 6.22 | 7.08 / 10.93 |
| B2 (TY8) | 3.05 / 4.11 | 4.66 / 6.25 | 7.35 / 12.18 |
| A3 (before) | 3.19 / 4.29 | 4.80 / 6.59 | 7.14 / 10.15 |
| B3 (TY8) | 3.23 / 4.54 | 4.65 / 5.89 | 7.26 / 11.66 |
| **median A** | 3.08 / 4.41 | 4.68 / 6.22 | 7.14 / 10.60 |
| **median B** | 3.15 / 4.49 | 4.65 / 6.25 | 7.26 / 11.66 |

### Reading

- **On a quiet box, every run of BOTH builds is under the 16 ms line at 1, 1,000 and 2,000
  paragraphs** -- the worst p95 of all 18 cells is 12.18 ms (B2 at 2,000 ¶). Clause 4d's bar
  (busy p95 under 16 ms up to 2,000 ¶, ruling D24) is met by both builds on this machine.
- **TY8's own effect is not measurable here.** A and B differ by less than the run-to-run
  spread at every size (2,000 ¶ p95: A 10.15-10.93, B 9.89-12.18; p50 7.1 vs 7.3). The fix
  stays because it is proven byte-equivalent and removes an allocation that scales with note
  size; its benefit is not shown by this instrument.
- **Why this disagrees with the L15 quiet reading** (`../ty-l15-quiet/`, q1: 2,000 ¶ p95
  17.12 ms on the same harness): not established. That run was quiet at both ends too, by the
  same lock tool, at 19:28 on 2026-10-01 while other sessions were active in the evening; these
  ran at 05:00 with nothing else on the box. The difference is consistent with background load
  the lock tool does not mark (browsers, other model sessions) -- a hypothesis, not measured.
  Re-read the clause at another quiet hour before citing it as settled.

## Vitest

`app/src/pages/journal-2-0/lib/memoStringifyBody.test.js` (the byte-equivalence suite,
including the `createIncrementalJoin` cases and the 2,000-paragraph end-to-end edits) passes
on the final landing tree, PR #263 (`feat/notebook-final-landing`), run with L16's other test
files: 35 files, 309 tests, and in both six-shard gates on that tree.

## Decisions / what was left

Nothing was stopped on. Every fix pulled in this lane makes the existing per-keystroke
local-draft write CHEAPER to COMPUTE, never rarer, later, or different in content -- the
Wave Q1 "ONE snapshot per keystroke" guarantee is unchanged. The remaining named costs
(React's own commit/scheduler internals, the paint pipeline as a GC knock-on, general
task/scheduler overhead) are core framework machinery or consequences of a cost this lane
already addresses; no safe, scoped application-level lever was found for them in this lane's
time budget, consistent with TY5/TY7's own findings for the costs they left.

## Tie-break run A4 (2026-10-02, 09:07-09:10 CT)

Raw files first (`90abb032f3`, R-RAW): `ab/A4.json`, `ab/A4.integrity.md`, `ab/A4.sandbox.log`,
`ab/A4.run.log`. Build A (`dist-A`), the same harness and flags as A1-A3.

- **Box:** lock FREE and load QUIET at both ends (`ab/A4.run.log`: 09:07:51 and 09:10:16).
- **Busy p95** at 1 / 1,000 / 2,000 paragraphs: **7.7 / 14.42 / 15.67 ms** (`ab/A4.json`, rows 6-8).
  Under the 16 ms line, by 0.33 ms at 2,000.
- **But every row of A4 is 1.5-2x slower than A3** on the same build (open p95 at 2,000: 177 vs
  77.2 ms; busy p95 at 2,000: 15.67 vs 10.15 ms), while the lock tool marked the box QUIET.
  Whatever slowed it is load the tool does not mark. That supports the earlier hypothesis for
  the L15 q1 disagreement; it still does not measure what that load was.

**Reading for clause 4d:** four quiet build-A runs today are all under 16 ms at 2,000 paragraphs
(10.60, 10.93, 10.15, 15.67). L15 q1 (17.12 ms) is still over the line. A4 does not cleanly break
the tie: its result sits within run-to-run drift of the line. 4d stays as the scorecard records
it (NOT MET, both readings disclosed) until the quiet marker can see the load that moved A4.
