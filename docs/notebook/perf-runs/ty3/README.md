# TY3 -- CSS containment for the typing budget (clause 4d), 2026-10-01

Branch `feat/notebook-w10-ty3`, based at `f314076f7`. Raw evidence commits, in order:
`48dee1028f` (traced attribution at the base, R-RAW) · `39fd60e277` (the lever + the
real-browser checks + `exportNote.test.js`) · `e0bd10c53d` (the interleaved A/B, raw,
R-RAW). This file is the interpretation; every number below is cited to a committed raw
file.

## What was measured first (the attribution), and what it changed about the plan

`tools/notebook_perf_harness.py --boot --sizes 2000 --opens 5 --chars 60 --attribute` at
the base `f314076f7`, quiet box (`gate_box_lock.py status` read QUIET before the run).
Sandbox integrity CLEAN. `docs/notebook/perf-runs/ty3/ty3-attr-before.json`/`.log`.

Uninstrumented `typing_per_char` at 2,000 paragraphs: p50 11 ms, p95 17.4 ms (line
16 ms, BUDGET BREACH). The traced renderer main thread (Chrome's own timeline, not the
wrapped-JS instrumentation, which runs as a *second* pass and is not the budget reading)
read:

| phase | ms/key | count/key |
|---|---:|---:|
| FunctionCall (the editor's own JS -- ProseMirror/TipTap transaction + update work) | 5.546 | 53.22 |
| EventDispatch textInput | 2.198 | 1.00 |
| ThreadControllerImpl::RunTask | 0.941 | 16.88 |
| **Layout** | **0.870** | **1.00** |
| **PrePaint** | **0.539** | **1.08** |
| v8.callFunction | 0.372 | 53.22 |
| **Paint** | **0.357** | **2.15** |
| **Layerize** | **0.337** | **1.08** |
| **Commit** | **0.248** | **1.08** |
| **UpdateLayoutTree (style recalc)** | **0.013** | **0.07** |
| renderer main thread, total busy | 12.462 | -- |

Bolded rows are the containment-eligible phases (style, layout, prepaint, paint,
layerize, commit): **~2.4 ms of the 12.5 ms busy total, ~19%** -- real, but not the
majority, and NOT what the brief's working premise assumed. Measured rather than
guessed: style recalc itself is close to free here (0.013 ms/key, fired on only 7% of
keystrokes) because Blink already does incremental, dirtied-subtree layout instead of
re-laying out all 2,000 paragraphs on every key -- there was less rendering-pipeline fat
to trim than the brief's hypothesis assumed. The dominant cost, FunctionCall at
5.546 ms/key, is the editor's own JavaScript (the attribution's `dispatch (total)`
2.255 ms/key and `tiptap emit update` 1.268 ms/key rows account for much of it) and is
not something a CSS lever can touch.

Lever 2 (isolating the editor's own scroll container) was not pursued as a separate
change: the trace shows exactly **one** `Layout` operation per keystroke, not several
spread across separate formatting-context roots -- not evidence of layout escaping into
the surrounding page chrome. Lever 3: nothing else in the trace names a distinct,
separately-addressable cost that lever 1 does not already reach.

## The lever: CSS containment on the editor's top-level blocks

`.proseEditor > *` (`NoteEditorPage.module.css`, `.proseEditor` IS the ProseMirror root
element) -- `content-visibility: auto` + `contain-intrinsic-size: auto 1.7em`. Scoped to
the editor surface alone (a local CSS-module class, never the shared `noteContent.css`):
SharedNotePage, the version preview and the Charts notebook widget are untouched.

`1.7em`, not a rounder first guess: it is the editor's own line-height
(`.proseEditor { font-size: 17px; line-height: 1.7 }`), and it matches a real rendered
paragraph's measured border-box height (28.9px) almost exactly. A first attempt at
`1.9em` overstated a 2,000-paragraph note's total scroll height by ~6,700px (~7.5%)
before any block had rendered -- `ty3-contain-size-tuning.log`.

Two live-DOM paths read the rendered note directly and would otherwise rasterize/print a
skipped block blank: `window.print()` (already scoped by a `uct-print-note` body class)
and the PNG rasterizer (`exportNoteAsPng`, via `modern-screenshot`'s `domToBlob`, which
gets none of Chromium's own print exemption). Both now force
`content-visibility: visible` for their span -- the print CSS under
`body.uct-print-note`, and `exportNoteAsPng` under its own new `body.uct-exporting-note`
class (`exportNote.js`), verified directly by computed style (checks 8a/8b below).

## Real-browser checks (`tools/notebook_ty3_contentvis_check.py`)

jsdom does no layout and proves nothing here; this reuses the perf harness's own
`Sandbox`/provisioning/seeding against a real Chromium. Every check is against the
committed `B` state. Three genuine TEST-SCRIPT bugs were found and fixed along the way
-- recorded rather than silently, because each one first looked like a product break and
was not: the real scroll container is `#notebook-pane`, not `.main`/`#main-content`; a
stray onboarding coachmark (`FloatingOrb.jsx`'s "Meet Compass", unrelated to this lane)
intercepted a click; a viewport-bounds visibility check didn't account for the app's own
sticky Journal sub-nav overlapping the top of the scroll container.

| # | check | result |
|---|---|---|
| 1 | find-in-note scrolls to and highlights a match far off-screen | **PASS** |
| 2 | clicking a table-of-contents entry scrolls to the right heading | **PASS** |
| 3 | Ctrl+A selects (and would copy) the whole note, start to end | **PASS** |
| 4 | the caret lands where clicked after an instant scroll to the middle; typing inserts there | **PASS** |
| 5a | no scroll jump while typing at the end of a long note | **PASS** |
| 5b | no scrollbar jitter scrolling top-to-bottom | **PASS** (scrollHeight identical at every sample point, spread 0.000) |
| 6 | `window.find()` (the same underlying path Ctrl+F drives) finds off-screen text | **PASS** |
| 7 | table / code block / image / task list render correctly once scrolled into view | **PASS** (all 4) |
| 8a | print CSS forces `content-visibility: visible` | **PASS** |
| 8b | export CSS forces `content-visibility: visible` | **PASS** |
| 8c | the real PNG-export button, end to end | **SKIP** -- see below |

Full output: `ty3-browser-checks.{log,json,sandbox.log}`.

⚠️ Playwright cannot drive the native Ctrl+F browser chrome (it is not part of the
page), so check 6 uses `window.find()` -- the same underlying Chromium find-in-page
implementation -- as the closest in-page proxy, not a literal simulation of a human
pressing Ctrl+F.

### 8c, and why it is SKIP rather than PASS or FAIL

The real PNG-export button (behind the "More note actions" menu) was clicked end to
end, and the download was a **~54-byte, essentially blank PNG** for the 2,000-paragraph
note. Investigated rather than assumed: the SAME probe, against the BASE tree
(`git show f314076f7:...` bytes for both touched files, binary-restored -- no
content-visibility anywhere, no `uct-exporting-note` class at all), produced the
**byte-identical 54-byte result** -- `ty3-png-preexisting-base-confirm.log`. Root cause
(read from `modern-screenshot`'s own source): the output canvas is sized from the
exported root's own `getBoundingClientRect()` at `scale: 2` -- roughly 1,732 x
164,000px for a note this tall -- which exceeds the browser's own maximum 2D canvas
dimension on BOTH builds alike. This is a pre-existing limitation of the PNG export for
a note this long, not caused by this lane and not fixed here (out of scope: the lane's
job is the typing budget, and "fix PNG export for very long notes" is a separate,
unscoped problem). The lever's own correctness claim for this path rests on checks
8a/8b (the CSS override is proven, directly), not on 8c succeeding -- 8c cannot succeed
on EITHER build at this note length.

## The A/B (interleaved, A1 B1 A2 B2 A3 B3 A4 B4)

`tools/notebook_perf_harness.py --boot --sizes 1000,2000 --opens 20 --chars 60`, a
fresh scratchpad data dir and port per run, one `npm run build` between every swap
(A = `git show f314076f7:<path>` bytes for both touched files, binary-restored; B = the
committed `39fd60e27` bytes), verified served by CONTENT (the CSS carrying
`.proseEditor` bundles into `NotebookFlagGate-*.css`, not its own `NoteEditorPage-*`
chunk -- checked once directly before trusting it) rather than trusted from a filename.
Raw: `ab/A1.json` .. `ab/B4.json`, `ab/box-status-and-dist-hash.md`.

**Box: mostly not quiet.** The shared gate-box lock was HELD by another session's
6-shard gate until shortly before A1 (waited, per CLAUDE.md); only ONE of the eight runs
(A3) landed on an actually quiet box. B's four runs carry a higher average marked-process
count (5, 2, 2, 5) than A's (5, 2, 0, 2) across this session, purely because of when each
one happened to land relative to other sessions' work.

| size | A p50 (median of 4) | B p50 (median of 4) | A p95 (median) | B p95 (median) | B/A p50 | B/A p95 |
|---|---:|---:|---:|---:|---:|---:|
| 1,000 ¶ | 7.15 ms | 7.25 ms | 15.95 ms | 17.25 ms | 1.01 | 1.08 |
| 2,000 ¶ | 12.05 ms | 12.65 ms | 17.95 ms | 20.30 ms | 1.05 | 1.13 |

Across all 8 interleaved runs, B reads slightly **slower** than A at both sizes and both
percentiles -- the opposite of what the lever intends.

**A load-matched sub-check, because the medians above mix uneven load:** two pairs
happened to land at IDENTICAL marked-process counts -- A2/B2 (both 2 marked vitest
processes) and A4/B3 (both 2 marked pytest processes, the *same two PIDs*). These are
the closest this session got to an apples-to-apples comparison:

| pair (matched load) | size | A p50 / p95 | B p50 / p95 | B/A p50 | B/A p95 |
|---|---|---:|---:|---:|---:|
| A2 / B2 (2 vitest procs, both sides) | 1,000 ¶ | 5.3 / 15.5 ms | 5.7 / 16.6 ms | 1.08 | 1.07 |
| A2 / B2 | 2,000 ¶ | 8.9 / 16.6 ms | 9.4 / 19.2 ms | 1.06 | 1.16 |
| A4 / B3 (2 pytest procs, same PIDs) | 1,000 ¶ | 8.8 / 16.3 ms | 8.8 / 17.9 ms | 1.00 | 1.10 |
| A4 / B3 | 2,000 ¶ | 12.4 / 18.5 ms | 15.5 / 21.4 ms | 1.25 | 1.16 |

Under matched load, B is at or slower than A in every one of these eight cells too (one,
A4/B3 at 1,000¶ p50, ties exactly) -- the direction holds even once the load-asymmetry
explanation is controlled for, as far as two matched pairs can control for it. This is a
small sample (n=4 per side overall, 2 matched pairs) and not a large-N proof of a
regression, but it is consistent, not noise that cancels: counting the 4 overall-median
cells plus these 8 matched-pair cells (12 size x percentile x comparison-type cells in
total), every one reads B ≥ A; none reads B < A.

**For context, not part of the budget:** `note_open` reads mostly the other direction --
B faster at 3 of 4 size/percentile cells (1,000¶ p50 B/A 0.93; 2,000¶ p50 B/A 0.97;
2,000¶ p95 B/A 0.93), slower only at 1,000¶ p95 (B/A 1.04). Directionally consistent with
containment helping an initial render (skipping paint of off-screen blocks at open) more
than it helps a steady-state keystroke, where Blink's already-incremental layout left
little rendering-pipeline cost for containment to remove (see the attribution above) --
but it is the same small n=4-per-side sample, so this is a secondary observation, not a
second budget finding.

**Reading, tied to the attribution:** this result is not a surprise given what the
attribution found. The containment-eligible phases were already only ~19% of a
keystroke's busy time, because Blink's incremental layout was already close to free
(UpdateLayoutTree 0.013 ms/key) even without containment -- there was little
rendering-pipeline cost left to remove. Adding `content-visibility: auto` to ~2,000
individual elements has its own bookkeeping cost (per-element relevance/intersection
tracking), and on this measurement that bookkeeping cost is not clearly paid back by the
small amount of rendering work it allows Blink to skip during steady-state typing.

**Clause 4d stays NOT MET**, the same reading as TY2 (`docs/notebook/perf-runs/ty2/` and
`ty2-quiet/`): every run on both A and B breaches the 16 ms/char line at 2,000
paragraphs, and most also breach it at 1,000 paragraphs. This A/B does not move the
clause either direction; it answers a narrower question (does this lever help?) with
"no, and on this measurement, slightly the opposite."

## Vitest

Scoped (`app/`): `exportNote.test.js` (new -- 4 cases: the `uct-exporting-note` class is
added before the capture and gone after, on both the success and the throw path; never
added at all on an early return; never clobbers an unrelated body class) +
`NoteExportControls.test.jsx` + `NoteFindBar.test.jsx` + `NoteOutline.test.jsx` --
**82/82 passing**. `NoteExportControls.a11y.test.jsx` could not load: `axe-core` is
absent from this worktree's `app/node_modules` junction target (`notebook-k`) -- a
pre-existing environment gap, unrelated to this change.

## Verdict, and the product decision this leaves open

The lever is **safe and correct** -- every real-browser correctness check passes, the
two live-DOM export paths are explicitly covered, and nothing about it changes what is
captured, how often, or where it is written (no draft-save timing touched;
`perf-budgets.json` untouched). It is **not a demonstrated performance win**: the
interleaved A/B reads B slightly slower than A at both sizes and both percentiles, on
the full set and on the two load-matched pairs alike, though the sample is small (n=4
per side) and no run in this session was a matched QUIET pair. Clause 4d stays NOT MET
on both builds.

**A product decision is needed, and it is not this lane's to make unilaterally:**
whether to (a) keep this lever on the branch anyway, as a correctness-neutral, possibly
small-regression change, on the theory that a larger or quieter-box sample might read
differently or that it still helps the initial-open case; (b) revert it, since its
stated purpose -- the typing budget -- is not met and the measured direction is mildly
against it; or (c) re-measure with more reps / a guaranteed-quiet box before deciding
either way. This lane's job was to measure first rather than assume, implement the
lever cleanly, verify it does not break anything, and report the honest number --
done -- not to decide whether a correctness-neutral, unproven-benefit CSS change ships.
