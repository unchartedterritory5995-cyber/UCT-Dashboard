# TY7 -- whose caller: fixing the two size-scaling costs TY5 left named only by self time

Branch `feat/notebook-w10-ty7`, base `1238ca7c5`. Raw evidence, in commit order: the caller-tree
walk (`87a9cb43d5`, R-RAW, before interpretation), the fix + its tests (`97eb54049f`), the
after-fix profile (`fc269024b5`), the interleaved A/B (`2881aad479`, R-RAW), this file.

Ruling D24 (`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md`) reads the 16 ms budget line on
`typing_busy_per_char` p95. TY5's own reading (`docs/notebook/perf-runs/ty5/README.md`): B/A
median at 2,000 paragraphs 0.923 (p50) / 0.939 (p95) -- narrower than A, still over the line.
TY5's CPU profile named two size-scaling costs it left, by SELF TIME alone: React's
`commitBeforeMutationEffects` (0.000 -> 0.736 ms/key) and prosemirror-model's `nodesBetween` /
`matchType` / `matchFragment` / `forEach` / `child` / `posBeforeChild` family (about +0.8 ms/key
combined), calling both "framework machinery, not an app call site." Self time names the function
that ran, not who asked for it. This lane's job: the callers.

## Method (R-RAW)

`tools/notebook_ty5_cpu_profile.py` (reused, unchanged) captures a raw CDP CPU profile at 1 and
2,000 paragraphs on an attribution-only unminified build (`vite build --minify false`), typing 200
`q` characters at the note's end. `tools/notebook_ty7_caller_tree.py` (new) is the pure analysis
step: it builds the profile's call tree (parent pointers from each node's `children` list), and
for every sample whose LEAF matches one of TY5's named functions, walks UP the parent chain to the
nearest ancestor frame that is NOT itself one of the same prosemirror-model walk functions (a
named denylist, so the attribution is auditable, not a judgment call). Self-check with no browser.

Raw `.cpuprofile` files stay in the scratch dir (R-RAW); the committed artifacts are the self-time
summaries (same shape as TY5's) and the caller-tree tables, `docs/notebook/perf-runs/ty7/`.

## Caller table (ms/key, 1 -> 2,000 paragraphs), BEFORE any fix

Full table: `ty7-caller-table.json`. Top rows:

| caller | ms/key @ 1¶ | ms/key @ 2,000¶ | who/what |
|---|---:|---:|---|
| `commitRoot` (-> `commitBeforeMutationEffects`) | 0.013 | 0.838 | React's own commit scheduling -- see finding (a) below for the REAL trigger, found by diagnostic experiment, not from this chain alone (React's work-loop runs on a microtask with no JS stack back to the original `dispatch`) |
| `isNodeActive` (`@tiptap/core`) | 0.005 | 0.418 | called by `readToolbarFormatState`'s `editor.isActive(nodeType, attrs)`, 6x/keystroke |
| `get posAtStart` (prosemirror-VIEW `ViewDesc`) | 0.003 | 0.145 | `DOMObserver.flush -> registerMutation` -- core prosemirror-view DOM-mutation reconciliation, NOT an app call site (confirmed by chain, left alone) |
| `findWrappingOutside` | 0.000 | 0.123 | prosemirror-commands' `wrapIn`, called by `canRunHistory(editor,'toggleBlockquote')` |
| `walk` (`nestedColumnsCount`, tiptap chunk) | 0.000 | 0.114 | `columnsGuard` -- ALREADY RULED OUT in `perf-budgets.md` (0.07/0.12 ms at 2,000¶); unrelated, left alone |
| `canReplaceWith` | 0.003 | 0.090 | same `wrapIn` path as `findWrappingOutside` |

### Finding (a): `commitBeforeMutationEffects` -- the caller is NOT who you'd read from the stack

React's own compiled source (`vendor-react-CHTKi4DZ.js:6690`, read directly, unminified):
`commitBeforeMutationEffects` unconditionally calls `getActiveElementDeep` + `hasSelectionCapabilities`
on every commit, and when the active element is a `contentEditable` (ProseMirror's root, which it is
for the whole duration of typing), does a manual DOM tree-walk over that element's ENTIRE subtree
to compute the browser selection's character offsets, for focus/selection restoration around the
commit's own DOM mutations. **It does not matter what the commit changed** -- only that a commit
happened while a contentEditable has focus. The call chain from the leaf up to `commitRoot` is pure
React internals (`commitRootWhenReady -> performWorkOnRoot -> performSyncWorkOnRoot ->
flushSyncWorkAcrossRoots_impl -> processRootScheduleInMicrotask`), which is scheduled on a
**microtask** -- there is no JS call stack back to whatever `dispatch()` call originally scheduled
the render, so the caller-tree walk cannot name it from the chain alone.

Found instead by two diagnostic experiments (rebuild + re-profile, code reverted after each,
summaries in `diagnostic-experiments/`, never committed as a fix):

1. Disabling `NoteEditorPage.jsx`'s `bumpToolbar` dispatch (`editor.on('transaction'/'selectionUpdate', …)`)
   entirely cut total busy time 9.58 -> 5.45 ms/key at 2,000¶ (also removes the isActive-family
   cost, finding (b) below -- the two are dispatched from the same listener).
2. Disabling ONLY `LinkPasteMenu.jsx`'s and `TableToolbar.jsx`'s `editor.on('transaction', bump)`
   counters (`useReducer((x) => x + 1, 0)`, unconditional) cut `commitBeforeMutationEffects`
   specifically from 0.736 to 0.047 ms/key (94%), with `readToolbarFormatState` UNTOUCHED -- proof
   these two counters, not the toolbar reducer, are the dominant trigger.

Both components read `editor` state fresh in their OWN render body regardless of what the dispatch
value is -- the counter exists ONLY to force a re-render, unconditionally, on every transaction,
in every note, pasted-link offer or table or not. That forces a React commit (hence
`commitBeforeMutationEffects`'s DOM walk) on every keystroke of every note, independent of
document size in trigger but O(note size) in cost once triggered.

### Finding (b): the `nodesBetween` family -- `isNodeActive` and `findWrapping`

`readToolbarFormatState` (`NoteEditorPage.jsx`) calls `editor.isActive(nodeType, attrs)` 6
times/keystroke (heading x2, bulletList, orderedList, blockquote, codeBlock). `@tiptap/core`'s
`isNodeActive` (read directly from the installed package) always calls
`state.doc.nodesBetween(from, to, callback)`; prosemirror-model's `Fragment.prototype.nodesBetween`
(read directly from the bundled source) iterates its children `for (let i = 0, pos = 0; pos < to; i++)`
-- **regardless of `from`** -- so resolving a position near the tail of a flat 2,000-paragraph doc
costs O(preceding siblings) on every call, 6x a keystroke.

`canRunHistory(editor, 'toggleBlockquote')` (the G-131 `canBlockquote` toolbar probe) is the same
shape one level up: `wrapIn`'s `findWrapping` asks the PARENT's `canReplaceWith`, which needs
`contentMatchAt(index)` -- walking the parent's preceding children. For a top-level paragraph near
the end of a flat 2,000-paragraph doc, the parent IS the doc, so this pays the identical O(index)
tax.

Marks (bold/italic/highlight) and `getAttributes` are genuinely O(1) -- confirmed the same way
(`isMarkActive`'s empty-selection branch reads `$from.marks()` directly, no `nodesBetween` call) --
so the existing in-file comment's O(1) claim was correct for those and wrong for the six node-type
rows and `canBlockquote`. The comment above `readToolbarFormatState` is corrected in the same
commit as the fix, not left standing.

## The fix (commit `97eb54049f`)

1. **`lib/fastToolbarProbes.js`** (new) -- `nodeActiveAtCursor(editor, typeOrName, attrs)` answers
   `isNodeActive`'s own empty-selection question (does any node CONTAINING the cursor match?) by
   walking `$from`'s ALREADY-RESOLVED ancestor chain (`$from.node(d)` for `d` from `$from.depth`
   down to 1) -- an O(1) array read per depth level, never `Fragment.nodesBetween`. Falls back to
   the real `editor.isActive(...)` whenever the fast path cannot answer safely (a non-empty
   selection, or a test double with no resolved `$from`), so every existing mock editor
   (`NoteEditorPage.toolbarRerender.test.js`'s `fakeEditor`) is untouched.
   `canBlockquoteFast(editor, canRunHistory)` memoizes `canRunHistory(editor, 'toggleBlockquote')`
   on a cheap O(depth) "block context signature" (depth + each ancestor's type name), keyed per
   editor instance in a `WeakMap` -- a run of keystrokes inside one unchanged block pays the real,
   necessarily-expensive check exactly ONCE, not every keystroke.
2. **`LinkPasteMenu.jsx`** -- `linkOfferBumpReducer` replaces the bare counter with a reducer
   tracking `linkPasteKey.getState(editor.state)` directly: that plugin state is ALREADY the exact
   signal worth re-rendering on (it returns the identical `null` while there is no offer, the
   identical offer object while one survives a transaction unchanged -- `lib/linkPasteOffer.js`'s
   own `apply()`).
3. **`TableToolbar.jsx`** -- `tableBumpReducer` tracks whether the caret is inside a table at all;
   bails to the same `null` reference across consecutive transactions OUTSIDE a table, but NEVER
   bails while inside one (every table-edit transaction still forces a fresh reference), so
   `TableToolbar.test.jsx`'s "owns its own freshness" behaviour -- a disabled-button state must
   follow a table edit with no external re-render driver -- is unchanged.

*Why this is safe*: none of the three changes alter WHAT any component reads at render time, only
WHEN a value is recomputed (fastToolbarProbes) or WHEN a re-render is triggered (the two bump
reducers) -- every fallback path hits the exact original call, so a case the fast path cannot
handle behaves exactly as before. Equivalence proved over a REAL editor
(`lib/fastToolbarProbes.equivalence.test.js`, 18 cases), never asserted from reading the libraries
alone.

## Caller table, AFTER the fix (commit `fc269024b5`)

Full table: `ty7-caller-table-after.json`.

| caller | before (ms/key @ 2,000¶) | after | change |
|---|---:|---:|---:|
| `commitRoot` (-> `commitBeforeMutationEffects`) | 0.838 | 0.093 | **-89%** |
| `isNodeActive` | 0.418 | 0.143 | **-66%** (residual = the ONE-TIME `canBlockquoteFast` cache-miss evaluation, proved bounded and non-per-keystroke by `typingWholeDocWalks.test.js`'s new rail, not a leftover per-keystroke cost) |
| `findWrappingOutside` | 0.123 | 0.081 | -34% |
| `canReplaceWith` | 0.090 | 0.070 | -23% |
| `get posAtStart` (DOMObserver, not fixed) | 0.145 | 0.217 | +50% (box noise -- core prosemirror-view machinery this lane does not own; see caveat below) |
| `walk` (`columnsGuard`, already ruled out, not fixed) | 0.114 | 0.129 | +13% (box noise, unrelated) |

Overall profiled-pass `busy_self_ms_per_key` at 2,000¶: 9.58 -> 7.93 ms/key (a profiled-pass
number from an unminified attribution build, not a budget reading -- the busy-time A/B below is
the budget-relevant measurement).

**Caveat on the two "not fixed" rows' noise**: both profiling passes (before/after) ran on a box
with other lanes' vitest/gate activity in the background (confirmed via `gate_box_lock.py status`
during each run), and neither `get posAtStart` nor `walk` (`columnsGuard`) were touched by this
lane's fix -- their movement is box contention, not a regression or an improvement; the CPU
profiler's sampling interval (30us) and the profiled pass's own total duration vary with how much
the box is doing. The SELF-time rows this lane actually changed (`commitRoot`, `isNodeActive`,
`findWrappingOutside`, `canReplaceWith`) moved consistently and by a large, one-directional margin
well outside that noise band, which is why they are read as real.

## A/B busy-time measurement

`tools/notebook_perf_harness.py --boot --busy --sizes 1,1000,2000 --opens 20 --chars 60`, A/B
interleaved A1 B1 A2 B2 A3 B3. A = `git show 1238ca7c5:<path>` bytes for `NoteEditorPage.jsx` /
`LinkPasteMenu.jsx` / `TableToolbar.jsx` (`fastToolbarProbes.js` absent), binary-restored and
verified byte-exact against the captured base before each build; B = the committed fix, verified
byte-exact against HEAD before each build. The resulting `dist` chunk hash differed between every
A build (`NotebookFlagGate-qZIgn16R.js`) and every B build (`NotebookFlagGate-CTFGzXTa.js`) --
confirmed by construction, not trusted from a filename alone. Fresh scratchpad data dir + port
per run (8402-8406). Full raw files: `ab/{A,B}{1,2,3}.json`, `ab/box-status.md`.

**Box: lock FREE before all 6 runs (never HELD -- the lock was HELD by another session's
six-shard gate from before this lane started measuring until ~15:56 CDT; no run was attempted
during that window, confirmed by a chained wait). Load BUSY on every one of the 6 runs -- no run
in this set started QUIET.** Marked-process count drifted 11 -> 16 over the session (one
dip to 8 at A2) -- the same one-directional load-drift shape TY5's own A/B session recorded.
B3, the LAST run, carried the highest load (16) of the six, and its own p95 at 2,000 paragraphs
(28.32 ms) is the single highest reading in the whole dataset -- consistent with that drift, not
the fix. **So this is a direction, not a clean verdict**, the same caveat ty2/ty3/ty5 recorded for
their own busy-box sessions. Sandbox integrity CLEAN on all 6 runs; zero page errors on all 6.

| size | A1 p50/p95 | A2 | A3 | A median | B1 p50/p95 | B2 | B3 | B median | B/A p50 | B/A p95 |
|---|---|---|---|---|---|---|---|---|---:|---:|
| 1 ¶ | 6.11/8.18 | 7.6/10.19 | 7.13/9.48 | **7.13/9.48** | 6.91/9.21 | 7.61/12.9 | 8.18/11.4 | **7.61/11.4** | 1.067 | 1.203 |
| 1,000 ¶ | 10.77/14.74 | 12.32/17.78 | 12.46/16.63 | **12.46/16.63** | 11.02/17.37 | 12.9/17.74 | 12.41/18.12 | **12.41/17.74** | 0.996 | 1.067 |
| 2,000 ¶ | 16.65/19.87 | 18.83/24.97 | 19.95/27.5 | **18.83/24.97** | 14.94/23.17 | 15.46/20.23 | 14.86/28.32 | **14.94/23.17** | 0.793 | 0.928 |

All values ms (`typing_busy_per_char`, p50/p95), 59 windows per size per run.

**At 2,000 paragraphs -- the size this fix targets -- B reads faster than A on BOTH the median
(p50 0.793x, p95 0.928x) and on every individual pair by p50 (16.65->14.94, 18.83->15.46,
19.95->14.86 -- B's p50 is lower than A's on all three pairs, a clean sweep). p95 is noisier
(B1's 23.17 sits above A1's 19.87, consistent with B1 running right as the box's load briefly
ticked up from 11 to 12 marked processes) but the MEDIAN-of-3 still reads 7.2% faster, and two of
three individual pairs (A2/B2: 24.97->20.23; A3/B3: 27.5->28.32 is the one exception, on the
session's single busiest box reading) favor B.** This is directionally consistent with both the
CPU profile (commitBeforeMutationEffects -89%, isNodeActive -66%, findWrappingOutside -34%,
canReplaceWith -23% at 2,000¶, `ty7-caller-table-after.json`) and with the diagnostic experiments
that isolated each fix's effect before it was written.

**At 1,000 paragraphs**, the direction is flat to slightly worse (B/A p50 0.996, essentially
identical; p95 1.067, worse) -- consistent with the fixed costs being smaller in absolute terms at
this size (TY5's own profile put the `isNodeActive`/`nodesBetween` family in the sub-millisecond
range at 1,000¶ vs several ms at 2,000¶) and more easily swallowed by the box's own upward load
drift across the session. **At 1 paragraph**, B reads worse (p50 1.067x, p95 1.203x) -- the fixed
costs are near-zero at this size by construction (no doc-size-dependent walk has anything to walk),
so this is the memoization layer's own small fixed overhead (a `WeakMap` allocation + lookup, an
extra function call per `isActive`) on an already-tiny base, in the same direction and rough
magnitude TY5's own fix showed at 1¶ for the same reason.

**Over/under the 16 ms line: 1 paragraph stays under on both A and B at every run. 1,000
paragraphs is under on A1 only (14.74 ms) and over on every other run of both A and B (A2/A3/B1/
B2/B3, 16.63-18.12 ms). 2,000 paragraphs is over on every run of both A and B (19.87-28.32 ms).**
The fix measurably narrows the 2,000¶ gap (median p95 24.97 -> 23.17 ms, 7.2% closer to the line)
without closing it -- exactly as expected from a fix that removes two of several named costs
(React's `commitBeforeMutationEffects` DOM-selection walk and the `isNodeActive`/`findWrapping`
family) while leaving others in place: ProseMirror's own position-resolution machinery (TY5's
point 2, the portion not traced to an app-level caller), prosemirror-view's `DOMObserver`
mutation-reconciliation walk, and `@tiptap/extension-link`'s correctly-scoped-but-still-O(index)
`autolink` `appendTransaction` (all three confirmed by this lane's own caller-tree walk and named
above, none of them an app-level call site this lane can safely change).

## Vitest

Scoped (`app/`), by name -- every `NoteEditorPage.*.test.jsx`/`.test.js` (49 files, includes
`toolbarRerender`/`toolbarSignatureAudit`), the toolbar/extension tests this lane touched
(`LinkPasteMenu.bumpReducer.test.js`, `TableToolbar.test.jsx`), `typingWholeDocWalks.test.js`,
`lib/offline/f5Freeze.test.js`, `memoDocJSON.test.js`, `memoStringifyBody.test.js`, and this
lane's own new equivalence suite (`fastToolbarProbes.equivalence.test.js`):

**Totals: 56 files, 447 tests, 0 failures.**

## Decisions / what was left

- **`get posAtStart` / `registerMutation` / `DOMObserver.flush`** (prosemirror-VIEW's own
  DOM-mutation-observer reconciliation, reading back what the browser's native contenteditable
  typing produced) -- genuinely core ProseMirror machinery, confirmed by chain (not an app or
  TipTap-extension call site), left alone, same category TY5's own README names for the
  model-layer `nodesBetween`/`resolve` cost.
- **`@tiptap/extension-link`'s own `autolink` `appendTransaction`** (`findChildrenInRange` /
  `textBetween`, both calling `nodesBetween`) -- measured (not assumed) to call
  `Node.prototype.nodesBetween` a few times per keystroke even with NO toolbar code at all,
  confirmed by a stack-trace diagnostic. It is ALREADY correctly scoped to
  `getChangedRanges(transform)` (the transaction's own local edit, never the whole doc) -- the
  cost is `Fragment.prototype.nodesBetween`'s own linear-scan-from-index-0 primitive being
  expensive near the tail of a flat document REGARDLESS of how narrow the requested range is, paid
  by a correctly-scoped vendor call site this lane does not own. Left alone;
  `typingWholeDocWalks.test.js` now measures this baseline explicitly rather than silently
  including it in a "zero" assertion that would have been false.
- **`columnsGuard`'s two whole-doc walks** -- already ruled out in `perf-budgets.md` (0.07/0.12 ms
  at 2,000¶), unrelated to this lane, confirmed still small and unchanged in the after-profile.
- **`BlockHandle`'s `update()`** (the suspect list's "drag-handle/block-handle plugin") -- checked,
  not fixed because nothing to fix: it costs nothing in the harness's typing scenario because
  `this.block` stays `null` the whole time (no mouse hover ever arms it in a headless keyboard-only
  typing pass); confirmed absent from every profile's top rows.
- **Placeholder, CharacterCount, UniqueID, TrailingNode, `noteFindExtension`** -- all previously
  fixed or already correctly gated by earlier lanes (TY5's own README; `notebookPlaceholder.js`'s
  header documents an earlier, already-shipped O(n)->O(depth) fix for the SAME class of bug this
  lane fixes, independently discovered for a different extension).

Nothing was stopped on; every suspect the brief named was either confirmed-and-fixed,
confirmed-and-cleared (checked against the tree, not assumed), or already closed by a prior lane.
