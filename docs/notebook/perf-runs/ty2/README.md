# TY2 -- typing budget (clause 4d), 2026-09-30

Branch `feat/notebook-w10-ty2`, based at `e4af130f4`. Raw evidence commits, in order:
`cad06c02d` (attribution, before any fix) · `9e7aeaf19` (the fix) ·
`67da0455e` (A1/B1/A2, B2 blocked) · `502646dc9c` (B2 + a second set A3/B3/A4/B4).
This file is the interpretation; every number below is cited to a committed raw file.

## What was attributed

`tools/notebook_perf_harness.py --boot --sizes 1000,2000 --opens 5 --chars 60 --attribute`
at `e4af130f4` (`ty2-attr-before.json`/`.log`, sandbox integrity CLEAN). Uninstrumented
typing_per_char at 2,000 paragraphs: p50 14.1 ms, p95 20.7 ms (line 16 ms). Top attributed
rows at 2,000 paragraphs:

| row | ms/key |
|---|---:|
| dispatch (total) | 2.792 |
| tiptap emit update | 1.658 |
| view.updateState (DOM, decorations, plugin views) | 0.502 |
| React scheduler tasks (render + commit), 1.18 commits/key | 0.212 |
| appendTransaction autolink | 0.103 |

`tiptap emit update`'s only synchronous listener is `scheduleAutosave` ->
`captureLocalState`. Its dominant cost is `editor.getJSON()` == ProseMirror's
`Node.prototype.toJSON()`, which re-walks every node on every call even though a
ProseMirror doc is immutable and structurally shared (confirmed against
`prosemirror-model`'s own source: `findDiffStart`/`findDiffEnd` compare children by
`==`) -- so 1,999 of 2,000 paragraphs are re-serialized on every keystroke though their
object reference never changed.

## What changed

`app/src/pages/journal-2-0/lib/memoDocJSON.js` -- a WeakMap-keyed memoized drop-in for
`Node.prototype.toJSON()`, reimplemented directly from `prosemirror-model`'s source
(not guessed) so its output is byte-identical: same shape, same key order, same
`attrs`-by-reference aliasing. Wired into **only** `captureLocalState`
(`NoteEditorPage.jsx`) -- the exact function this program named as the remaining,
protected cost. It is a speed-only change: every keystroke still produces one
complete, correct, synchronous snapshot; nothing about what is captured, how often,
or where it is written changed. No new dependency; `docs/notebook/perf-budgets.json`
untouched.

`memoDocJSON.test.js` proves byte-identical output against a real editor across every
node/mark family `buildExtensions()` registers (marks, tables, task lists, columns,
Ask-inserted citations), through a run of edits, and at the 2,000-paragraph scale the
budget itself measures -- plus a structural (non-timing) proof that an untouched
sibling paragraph's JSON object is the SAME object reference after an edit elsewhere
in the document (the actual mechanism the speedup rests on).

Scoped vitest, run from `app/`: 29 files / 250 tests, 0 failures
(`memoDocJSON.test.js`, `typingWholeDocWalks.test.js`, and every `NoteEditorPage`
test touching `captureLocalState` / the local draft / the durable copy / conflict /
toolbar re-render). `tools/check_repo_hygiene.py --staged` clean on every commit.

## The A/B method, and why there are two sets

Interleaved A (`cad06c02d`'s `NoteEditorPage.jsx`, pre-fix) / B (`HEAD`, post-fix),
same harness invocation each time (`--boot --sizes 1000,2000 --opens 20 --chars 60`,
no `--attribute`), a fresh scratchpad data dir and port per run, a full `npm run
build` between every swap. The source was swapped by overwriting
`NoteEditorPage.jsx` with bytes extracted via `git show <sha>:<path>` (A) or an exact
pre-swap backup (B) -- never committed in the swapped state; `git status`/`git diff`
confirmed clean against `HEAD` after every restore.

Set 1 (A1, B1, A2, B2) ran first; a controller note observed the box lock had freed
and asked for a second set (A3, B3, A4, B4) "because the box is much quieter now."
**That premise did not hold.** `tools/gate_box_lock.py status`, read immediately
before every single run in both sets, reported `lock: FREE` and `load: BUSY` every
time, with the marked-process count swinging from 11 to 50 across the session
(`ty2-box-status-at-each-run.md` for set 2's readings; set 1's are in `67da0455e`'s
commit message). **No run in either set is a quiet-box reading**, and the two sets
are reported separately below rather than pretending otherwise.

## Set 1 -- A1, B1, A2, B2 (`ty2-ab-a1/b1/a2/b2.json`)

| size | A p50 (median of 2) | B p50 (median of 2) | A p95 (median) | B p95 (median) | B/A p50 | B/A p95 |
|---|---:|---:|---:|---:|---:|---:|
| 1,000 ¶ | 12.9 ms | 13.0 ms | 19.9 ms | 18.8 ms | 1.01 | 0.95 |
| 2,000 ¶ | 17.5 ms | 15.8 ms | 22.3 ms | 20.1 ms | 0.90 | 0.90 |

At 2,000 ¶, B read ~10% faster on both p50 and p95. At 1,000 ¶ it is within noise.

## Set 2 -- A3, B3, A4, B4 (`ty2-ab-a3/b3/a4/b4.json`)

| size | A p50 (median of 2) | B p50 (median of 2) | A p95 (median) | B p95 (median) | B/A p50 | B/A p95 |
|---|---:|---:|---:|---:|---:|---:|
| 1,000 ¶ | 10.7 ms | 15.2 ms | 16.65 ms | 20.0 ms | 1.42 | 1.20 |
| 2,000 ¶ | 15.85 ms | 18.2 ms | 20.65 ms | 23.65 ms | 1.15 | 1.15 |

Here B read 15-42% *slower* than A at both sizes -- the opposite direction from set 1.
A4 (14.2/19.0 ms at 2,000 ¶) was the single fastest `typing_per_char` reading of the
whole session on EITHER source, and B4 (18.8/24.4 ms) the single slowest. This is the
shape of box-load noise dominating the measurement, not a product regression: the two
sets used the identical built artifacts as set 1 (same `git show`-extracted A, same
exact-byte B), so the only thing that changed between sets was how busy the box was
while each ran.

## All 8 runs combined

| size | A p50 (median of 4) | B p50 (median of 4) | A p95 (median) | B p95 (median) | B/A p50 | B/A p95 |
|---|---:|---:|---:|---:|---:|---:|
| 1,000 ¶ | 12.2 ms | 14.0 ms | 18.4 ms | 19.7 ms | 1.15 | 1.07 |
| 2,000 ¶ | 17.2 ms | 16.85 ms | 21.3 ms | 22.15 ms | 0.98 | 1.04 |

## Verdict

Every one of the 8 runs breached the 16 ms/char line, on both A and B, at both sizes
(harness exit 1, BUDGET BREACH, every time) -- clause 4d is not met, and this session
does not claim otherwise. The box was BUSY (never QUIET) for every run in both sets,
so **this is not a quiet-box reading and settles nothing about the budget line
itself** -- it is explicitly the kind of reading `l13-typing/README.md` already
flagged: it "neither confirms nor overturns" a quiet-box verdict.

Combined across all 8 interleaved runs, B is roughly a wash against A (ratios 0.98-1.15
across size/percentile combinations) rather than a clear win: set 1 favored B by ~10%
at 2,000 ¶, set 2 favored A by 15-42% at both sizes, and the combined ratios sit close
to 1.0 in three of four cells. The fix is correct and safe (proven by the equivalence
and cache-reuse tests, independent of any timing run) and attribution independently
named its target as a real, size-scaling cost -- but **this A/B, run entirely on a busy
box, cannot distinguish "the fix is a wash" from "the fix helps by an amount this box's
noise floor swallows."** A quiet-box reading (no `vitest`/`pytest`/`gate_shards.py`
process, per `tools/gate_box_lock.py status` reading `load: QUIET`) is needed before
any stronger claim is made either way, and none was obtained this session.

### What remains, if a quiet reading still breaches

If a future quiet-box reading still shows typing over the line, the remaining named
costs (ProseMirror's own dispatch/`view.updateState`, the browser's editing/layout/
paint of a large contenteditable) are core editor and browser machinery, not an
application-level redundancy this lane found a safe lever for. The one other
protected cost -- taking the local-draft snapshot less often, or less completely --
is explicitly out of scope for an agent to implement per this lane's brief and would
need an owner ruling, not a code change.
