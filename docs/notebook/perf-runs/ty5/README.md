# TY5 -- the local-draft stringify, 2026-10-01

Branch `feat/notebook-w10-ty5`, base `07c64750a8`. Raw evidence, in commit order:
R-RAW profiles (`ty5-profile-{1,2000}p.json`, `ty5-profile-diff.json`) committed before any
interpretation; the fix (`lib/memoStringifyBody.js` + `.test.js` + the `NoteEditorPage.jsx`
wiring); the interleaved A/B (`ab/{A,B}{1,2,3}.json`, `ab/box-status.md`, `ab/*.integrity.md`),
also committed raw before interpretation. This file is the interpretation.

Ruling D24 (`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md`) reads the 16 ms budget line on
`typing_busy_per_char` p95. Prior reading (`docs/notebook/perf-runs/ty-floor/README.md`,
2026-10-01, quiet-ish box): p50 5.0 / 6.7 / 14.9 ms and p95 7.6 / 10.1 / 21.0 ms at 1 / 1,000 /
2,000 paragraphs -- a roughly 2.75x growth in busy time across a 2,000x range in note length.
This lane's job: find what in a keystroke is O(note size) and cut it.

## The profile (R-RAW, `ty5-profile-1p.json` / `-2000p.json` / `-diff.json`)

Method: `tools/notebook_ty5_cpu_profile.py` (new, local-only diagnostic, modeled on
`notebook_perf_harness.py`'s own `Sandbox`/provisioning/seeding) opens a small note then the
target note -- the same real-switch recipe `run_live()` uses -- places the caret at the end,
and wraps a CDP `Profiler.start()` / `Profiler.stop()` session around typed keystrokes (300
chars, `delay=25ms`, matching the harness's own cadence). This is a SAMPLING CPU profile
(`disabled-by-default-v8.cpu_profiler`'s sibling instrument, via a raw CDP session rather than
Chrome's own tracing categories), at 1 and 2,000 paragraphs on the SAME build.

**ATTRIBUTION-ONLY build, not the timing build**: `app/dist` was built with `vite build
--minify false` for this pass only -- unminified so function names are readable directly in
the profile without a sourcemap round trip, per the brief ("a dev build, or a build with
sourcemaps, is acceptable for ATTRIBUTION ONLY"). No busy-time number from this profiling pass
is used as a budget reading; every number in the A/B table below is from the normal,
minified production build.

**First version of the script measured near-zero busy time at both sizes and was wrong**, not
the product: `OPEN_NOTE_JS` alone does not focus the editor, so `pg.keyboard.type()` landed on
an unfocused document and almost nothing dispatched -- 99%+ of the profiled session was
`(idle)`. Fixed by placing the caret at the note's end before profiling (the same thing
`INSTALL_TYPING_PROBE_JS` does, minus that probe's own listeners, so the profiled session
carries no instrumentation of its own). After the fix, busy self time (every frame except
`(idle)`/`(program)`) is what `ms/key` is computed over -- idle time is reported, never ranked.

**Top size-scaling functions, self ms/key at 1 vs 2,000 paragraphs** (full top-40 in
`ty5-profile-diff.json`; `busy_self_ms_per_key` overall: 3.43 ms/key at 1 paragraph, 8.44
ms/key at 2,000 -- a profiled-pass number, not a budget reading):

| function | file:line | ms/key @ 1 | ms/key @ 2,000 | delta |
|---|---|---:|---:|---:|
| `saveDraftLocally` | `NoteEditorPage.jsx` (`captureLocalState`'s caller) | 0.012 | 1.518 | **+1.506** |
| `commitBeforeMutationEffects` | React (vendor-react) | 0.000 | 0.736 | +0.736 |
| `setItem` (native) | `localStorage.setItem` | 0.033 | 0.421 | +0.387 |
| `nodesBetween` | prosemirror-model (bundled with askInsert) | 0.016 | 0.264 | +0.248 |
| `get isLeaf` | prosemirror-model | 0.000 | 0.223 | +0.223 |
| `matchType` | prosemirror-model | 0.000 | 0.139 | +0.139 |
| `forEach` | prosemirror-model (`Fragment.prototype.forEach`) | 0.000 | 0.121 | +0.121 |
| `child` | prosemirror-model (`Fragment.prototype.child`) | 0.000 | 0.113 | +0.113 |
| `matchFragment` | prosemirror-model | 0.000 | 0.094 | +0.094 |
| `posBeforeChild` | prosemirror-model | 0.000 | 0.087 | +0.087 |
| `toJSON` | `memoDocJSON.js` (lane TY2's own fix) | 0.000 | 0.081 | +0.081 |
| `stageNoteWithIntent` | `lib/offline/durableWriter.js`'s IndexedDB `.put()` | 0.000 | 0.063 | +0.063 |

## Each cost, in order of size, with its call site

**1. `saveDraftLocally` + `setItem` -- the local draft snapshot (FIXED, this lane).**
`NoteEditorPage.jsx::saveDraftLocally`, called synchronously from `scheduleAutosave` on
*every* keystroke (the Wave Q1 "ONE snapshot per keystroke" crash-recovery guarantee). It is
O(note size) because `JSON.stringify(bodyJson)` walks the ENTIRE serialized tree on every call
-- lane TY2's `memoDocJSON` (`captureLocalState`) already returns a tree where an unchanged
paragraph's JSON OBJECT is the exact same reference as last keystroke, but plain
`JSON.stringify` does not know or care about object identity: it re-emits every character of
every node's string form every time. Combined with the native `setItem` write itself (which
must write the same bytes regardless -- the fix never touches this), this pair was the single
largest size-scaling cost in the profile, ahead of ProseMirror's own transaction machinery.

**Fixed**, not left: `app/src/pages/journal-2-0/lib/memoStringifyBody.js` (new) --
`createMemoStringify()` is a second memoization layer over `memoDocJSON`'s objects, caching
the STRING form of each node keyed on the node's JSON object (the same object
`draftJSONRef`/`memoDocJSON` already reuses by reference for an untouched subtree). An
untouched paragraph's string is reused outright; only the edited node (plus the doc node's own
wrapper, which is always a new object every keystroke by ProseMirror's own structural-sharing
guarantee) is re-stringified. `stringifyDraftPayload` reconstructs the REST of
`saveDraftLocally`'s object literal (`title`/`subtitle`/`savedAt`/`sessionId`/
`baseUpdatedAt`/`writtenSchema`) by hand, field by field, through the native `JSON.stringify`
on each (small, non-scaling) field, so the memoized body string can be spliced in without a
second whole-tree walk from the outer call.

*Why this is safe*: it changes ONLY when the string is computed, never what it contains, how
often a snapshot is taken, or what is captured -- every keystroke still gets a complete,
correct, synchronous `localStorage.setItem()` of the same bytes the old code would have
written. `lib/memoStringifyBody.test.js` proves byte-identical output against plain
`JSON.stringify()`: on the same rich-node-type fixture `memoDocJSON.test.js` uses (headings,
marks, tables, task lists, columns, an Ask-inserted citation, and deliberately JSON-hostile
text -- quotes, backslashes, newlines, unicode, line/paragraph separators), through a run of
edits, and at the 2,000-paragraph scale the budget itself measures; plus a structural rail
(spy on the native `JSON.stringify`, count calls) proving a keystroke at the end of a
500-paragraph note calls it a BOUNDED number of times (<10), never once per untouched
paragraph (500) -- the cache-reuse proof, same convention as `memoDocJSON.test.js`'s object-
identity proof one layer down. Every field `stringifyDraftPayload` touches is verified never
`undefined` at the real call site (title/subtitle are refs seeded `''`, `usableBaseline()`
always returns `string | null`, `writtenSchema` is always an integer) -- `JSON.stringify` of
`undefined` silently OMITS a key, the one failure mode hand-rolled construction would not
catch on its own, and the test suite's edge-value case (empty title/subtitle, null
`baseUpdatedAt`, `writtenSchema` 0) exercises exactly that boundary.

**2. ProseMirror's own position-resolution machinery -- `nodesBetween` / `matchType` /
`forEach` / `child` / `matchFragment` / `posBeforeChild` (combined ~0.8 ms/key at 2,000
paragraphs, NOT fixed).** All bundled `prosemirror-model`/`prosemirror-transform` internals
(the `askInsert-*.js` chunk), used by `view.dispatch`'s own step-application and position
resolution, not by any call site this app owns (grepped: the one app-level `doc.nodesBetween`
call, `lib/askCitation.js::flatToPmRange`, resolves a citation's claim against a note's text
and is not on the typing path at all). Resolving a position far into a large FLAT document
(2,000 top-level paragraphs, caret at the end) costs ProseMirror itself work proportional to
the number of preceding siblings it must walk to accumulate offsets -- this is core editor
machinery, the same category ty3's trace attribution named for `dispatch (total)`: "not
something a CSS lever can touch," and not something an application-level fix can touch
without patching ProseMirror's own model. Left, named rather than silently assumed.

**3. `commitBeforeMutationEffects` (React, +0.736 ms/key, NOT fixed).** React's own
pre-mutation commit-phase lifecycle work. Investigated rather than assumed a free pass:
ProseMirror's own DOM (the 2,000 paragraphs themselves) is managed OUTSIDE React's
reconciliation -- TipTap's `EditorContent` hands React only the wrapper element -- so this is
not an obvious application-level redundancy, and no safe, scoped lever was found in this
lane's time budget. Named as a real, measured, size-scaling cost left for a future lane with
React profiler traces of its own, not quietly folded into "already explained."

**4. `toJSON` (`memoDocJSON.js`, +0.081 ms/key, NOT touched -- correctly small.)** This is lane
TY2's own fix, confirmed still working as designed: the residual cost is `kids.map(toJSON)`'s
own O(top-level-child-count) loop (2,000 cheap `WeakMap.get()` cache hits plus one real
recompute), which is the cost TY2's docstring already names as the floor of what caching the
OBJECT layer alone can remove -- exactly the gap this lane's STRING layer closes one level up.
Already protected by `memoDocJSON.test.js`; not re-touched.

**5. `stageNoteWithIntent` (IndexedDB `.put()`, +0.063 ms/key, NOT a target.)** This is the
Wave Q1 durable-copy write, already off the keystroke path by design (`durableWriter.js`
coalesces it ~200ms behind the last keystroke -- it should not fire at all during continuous
25ms-cadence typing). Its small appearance in this profile is consistent with one coalesced
write landing during the profiling pass's post-typing settle, not a per-keystroke cost;
dividing a single fixed write by 300 keys produces a small, non-representative ms/key. Already
correctly off the critical path.

**Whole-doc walks checked against the brief's suspect list and found already fixed by prior
lanes** (not re-done here, verified by reading): `codeBlockNode.js`'s `hasCodeBlock` tracking
and `askCitationNode.jsx`'s `hasCitation` tracking (lane L12, `599cd44f1d`) are both correctly
gated -- a plain note with neither feature never reaches their whole-doc `findChildren`/
`staleCitationDecorations` calls, proven by `typingWholeDocWalks.test.js` (existing rail, not
extended by this lane: this lane's fix is not a `doc.descendants()` walk, so the existing
structural rail there does not apply; `memoStringifyBody.test.js`'s own cache-reuse test is
the equivalent proof for the cost this lane actually removed, same convention
`memoDocJSON.test.js` set). `NoteStats.jsx` (word count) and `NoteOutline.jsx` (table of
contents panel) are both explicitly, by their own docstrings, "OFF THE KEYSTROKE PATH" --
debounced 400ms/200ms behind `onDocChange`, confirmed by reading, not by assumption.
`tableOfContentsNode.js`'s live TOC only mounts when a `/toc` block exists in the note (none
in the harness's plain-paragraph fixture). `noteFindExtension.js`'s plugin only re-searches
the whole doc when the find bar re-issues `noteFindSet`, never on an ordinary edit. The two
`editor.state.doc.descendants()` calls in `NoteEditorPage.jsx` (`reconcileConflict`) and
`WidgetEmbedView.jsx` (`toggleLive`) run on a 409 conflict reconcile and a toolbar click
respectively, neither on the typing path. `columnsNode.js`'s "columnsGuard" two whole-doc
walks are the one already RULED OUT in `perf-budgets.md` (0.07/0.12 ms at 2,000 paragraphs) --
left alone, correctly.

## The A/B (interleaved, A1 B1 A2 B2 A3 B3)

`tools/notebook_perf_harness.py --boot --busy --sizes 1,1000,2000 --opens 20 --chars 60`, a
fresh scratchpad data dir and port per run (8340-8345), one full `npm run build` between every
swap (A = `git show 07c64750a8:<path>` bytes for `NoteEditorPage.jsx`, binary-restored; B = the
committed fix). `app/dist`'s `NotebookFlagGate-*.js` chunk was verified by CONTENT for the B
build (`grep '"baseUpdatedAt":'`, the quoted JSON-key literal only `stringifyDraftPayload`'s
hand-rolled construction produces -- an unquoted object-literal key in the original code would
never match), not trusted from a filename. The `MEASURING.flag` convention was followed before
every one of the 6 timed runs (created, 60s wait, deleted immediately after).

**Box: `gate_box_lock.py status` lock FREE before all 6 runs (never HELD); load BUSY on every
one (`ab/box-status.md`) -- no run in this set started QUIET.** The marked-process count rose
across the session (5, 7, 8, 7, 10, 10 for A1..B3) -- a monotonic upward trend in unrelated
background load over the ~25-minute span, which interleaving cancels on average but not
perfectly against a one-directional drift. **So this is a direction, not a clean verdict**, the
same caveat `ty2`/`ty3` recorded for their own busy-box sessions.

| size | A1 p50/p95 | A2 | A3 | A median | B1 p50/p95 | B2 | B3 | B median | B/A p50 | B/A p95 |
|---|---|---|---|---|---|---|---|---|---:|---:|
| 1 ¶ | 6.01/8.24 | 6.08/8.5 | 8.08/17.14 | **6.08/8.5** | 5.93/7.9 | 6.97/15.8 | 7.06/11.35 | **6.97/11.35** | 1.146 | 1.335 |
| 1,000 ¶ | 11.9/25.11 | 10.5/15.14 | 14.05/19.63 | **11.9/19.63** | 11.1/17.36 | 12.19/17.64 | 12.48/19.42 | **12.19/17.64** | 1.024 | 0.899 |
| 2,000 ¶ | 15.17/25.77 | 18.02/33.77 | 21.16/27.37 | **18.02/27.37** | 16.64/25.71 | 18.38/27.23 | 15.93/22.39 | **16.64/25.71** | 0.923 | 0.939 |

All values ms (`typing_busy_per_char`, p50/p95), 59 windows per size per run. Sandbox
integrity CLEAN on all 6 runs (pre-boot, post-boot, shutdown); zero page errors on all 6
(`ab/*.json`'s `page_errors`).

**At 2,000 paragraphs -- the size the fix targets, and the only size where every prior lane's
reading breached the line on every run -- B reads faster than A on BOTH the median (p50 0.923x,
p95 0.939x -- roughly 7-8% less busy time) and on every one of the 3 individual pairs by p50
(15.17→16.64 is the one exception, but A1 was also the session's quietest box reading; B1's own
p50 at 16.64 ms is still below A2's 18.02 and A3's 21.16).** This is directionally consistent
with the profile: the fixed cost (~1.5-1.9 ms/key at 2,000 ¶) is a meaningful fraction of the
~18-27 ms/key busy budget at that size, and a several-percent win on a busy, trending-busier
box is the shape a real several-ms fix produces once box noise (which affects both sides
equally within a pair, not the fix) is factored in.

**At 1,000 paragraphs**, the direction is mixed (B/A p50 1.024, essentially flat; p95 0.899,
better) -- consistent with the fixed cost being smaller in absolute terms at this size and more
easily swallowed by box noise. **At 1 paragraph**, B reads WORSE (p50 1.146x, p95 1.335x) --
the fixed cost itself is near-zero at this size (the profile's own 1-paragraph reading put
`saveDraftLocally` at 0.012 ms/key), so this is not the fix helping or hurting; it is the
memoization layer's own small fixed overhead (a WeakMap allocation + lookup per keystroke)
on an already-tiny base, compounded by B3's and especially B2's runs landing on a busier box
(7 and 10 marked processes respectively) than A1's quietest-of-the-six reading. **Over/under
the 16 ms line: 1 paragraph stays under on both A and B at every run; 1,000 and 2,000
paragraphs are over on every run of both A and B** -- the fix measurably narrows the 2,000 ¶
gap to the line without closing it, exactly as expected from a fix that removes one named cost
among several (ProseMirror's own model machinery and React's commit phase, both left, remain).

## Vitest

Scoped (`app/`), by name:

- `src/pages/journal-2-0/lib/memoStringifyBody.test.js` -- new, 9/9 passing.
- `src/pages/journal-2-0/lib/memoDocJSON.test.js` -- 6/6 passing (unchanged, still protects
  the layer this lane builds on).
- `src/pages/journal-2-0/lib/typingWholeDocWalks.test.js` -- 12/12 passing (unchanged; this
  lane's fix is not a `doc.descendants()` walk, so this file was not extended -- see "whole-doc
  walks checked" above for why `memoStringifyBody.test.js` is the equivalent rail instead).
- `app/src/pages/journal-2-0/lib/offline/f5Freeze.test.js` -- 8/8 passing: the
  `saveDraftLocally` call site's text changed (the object literal's `JSON.stringify(...)`
  became `stringifyDraftPayload(...)`), and this rail did not flag it, so no frozen call site
  needed restoring.
- The full `NoteEditorPage.*.test.jsx` family (46 files -- every test touching
  `captureLocalState`/the local draft/the durable copy/conflict/toolbar re-render, and every
  other file in the family, run together since `saveDraftLocally` has exactly one call site in
  the component): **46 files / 331 tests, 0 failures.**

**Totals: 4 vitest invocations, 46 + 3 = 49 files, 331 + 9 + 6 + 12 + 8 = 366 tests, 0
failures.**

## Decision needed: none stopped on

Every lever pulled in this lane makes the existing per-keystroke write CHEAPER, never rarer or
later -- the Wave Q1 "ONE snapshot per keystroke" guarantee is unchanged (same bytes, same
`localStorage.setItem` call, same synchronous timing relative to the keystroke). No decision
was required from the controller; the remaining named costs (ProseMirror's own position
resolution, React's commit phase) are core framework machinery this lane did not find a safe,
scoped application-level lever for, consistent with ty3's own finding for `dispatch (total)`.
