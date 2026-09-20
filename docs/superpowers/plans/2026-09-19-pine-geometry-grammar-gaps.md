# Pine Geometry Grammar Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the geometry-family (line/label/box) parity-set blockers this plan can actually close — a real `loopBlocked` diagnostic false-positive, the missing `last_bar_index` column, and `ta.supertrend`'s mis-worded tuple refusal — while precisely documenting the two causes (RISK-043's guard-opacity mechanism, and a dropped `create:box`) that either cannot or may not yet be closed within this plan's authorized scope.

**Architecture:** Pine source flows through one lexer/parser (`pine.js`), a value-lane resolver that folds expressions into a shared V2 computation graph (read by `interpret.js`), and a structurally separate object-lane walker (`pineObjects.js` → `pine.js::buildObjectProgram` → `objectColumns.js` → `objectRuntime.js`) that reads the same statement tree for drawing-primitive lifecycles without editing it. Both lanes share one clock-column mechanism (`closedTable.json`'s `clock` section, computed in `indicators.js::computeClock` and mirrored in `api/services/indicator_compute.py::compute_clock`). A separate, currently-unwired "runtime IR" lane (`app/src/components/chart/engine/runtime/{ir,lower,lowerIr,program,vm}.js`, entered via `pineRuntimeFrontend.js::buildRuntimeIr`) exists for a different concern (loop/array-bound-depends-on-series handling on the PANE path) and has zero importers outside its own directory and `ast/` — it is not part of the object-rendering pipeline this plan measures against, and no task below touches it.

**Tech Stack:** JavaScript (ES modules, Vitest) for the frontend translation/runtime engine under `app/src/components/chart/engine/`; Python (pytest) for the backend mirror under `api/services/`; Playwright-driven Python harness (`tools/c0_visual_journey.py`) for the real-chart parity measurement.

**Spec:** `docs/superpowers/specs/universal-indicator-ecosystem/C3B_CLOSE_LIVE_VENDOR_AND_PARITY.md` — this plan argues from that document's §5 (the fixed 10-member parity set), §3 (the vendor capture's one divergence, H8), and §6 (the gap register). Read it before touching any task below; this plan does not repeat its evidence tables, only their conclusions — several of which this plan's own research corrects (see "Investigated and ruled out" before Task 1, Task 1's own "What this plan found" section, and the "Explicitly out of scope" list's H7/tuple corrections above).

## ✅ EXECUTION STATUS (2026-09-19) — Tasks 1–4 done; Task 5 partially done

All four numbered tasks below were implemented the same day this plan was
written, each with its own commit on `feat/pine-geometry-grammar`: Task 1
(`pineObjects.js`'s `emitCollection` reorder), Task 2 (the `last_bar_index`
four-file fix this plan found already prototyped — formalized with tests and
re-confirmed against `vendorObjectParity.test.js`'s own H8 case, which now
reads three labels painted, zero drops), Task 3 (`ta.supertrend`'s refusal
wording), Task 4 (the `create:box` drop diagnosed with a script-independent
minimal reproduction, not fixed — see below). Task 5's gap-register close-out
(step 5) was done in both `ENDZONE_GAP_REGISTER.md` and
`C3B_CLOSE_LIVE_VENDOR_AND_PARITY.md`; its live-sandbox visual re-measurement
(steps 1–4) was **not** run — see that document's own §10 addendum for why.

⚠️ **CORRECTION TO TASK 4 AND THIS PLAN'S OWN FRAMING:**
`mid_engagement__01-zeiierman-trend-pressure` — Task 4's named fixture — left
the official parity set on **2026-09-13**, six days before this plan was
written, by an owner ruling neither this plan's own research nor the
concurrent coordinator's caught at the time:
`OOS_2_PARITY_SET.json`'s `_dropped_2026_09_13` entry states the script's
TradingView page renders a 5-line stub against its own claim of 353 lines —
"a member the vendor will not show can never keep [a parity set's] promise."
The set is **nine members, not ten**, as of that ruling. Task 4's diagnosis
(a real, generic, script-independent engine gap: an object-creating statement
inside a called Pine user function does not bind the function's parameters to
the call site's arguments) remains valid and was pinned with a hand-written
minimal reproduction independent of this specific script — but it should not
be read as "parity-set member #7's blocker," since member #7 no longer exists
in the set this plan's own spec document was measuring against. Also:
`mid_engagement__05-supertrend-fibonacci-ote` (relevant to Task 3) was
re-frozen on different bytes the same day, after an author edit —
`pine_oos/MANIFEST.json` is the current authority on its hash, not this plan's
own quoted one or `OOS_2_PARITY_SET.json`'s (both predate the 09-13 refreeze).
Task 3's fix is unaffected (it targets the `ta.supertrend` callee name
generically, not this script's specific bytes).

Both `.pine` files this plan named as needing a re-fetch (Global Constraint 2)
were already present locally, sha256-verified against this plan's own quoted
hashes, in `tools/c0_parity_fixtures/` and `tools/c3a_parity_fixtures/` — no
network fetch was needed for either.

## ⛔⛔ READ BEFORE TOUCHING ANY FILE

### A. Concurrent landing on these same files

As of when this plan was written (2026-09-19, worktree `pine-geometry-grammar` at a commit even with a freshly-fetched `origin/master`), **two branches not yet merged to `origin/master`** — `feat/pine-table-gaps` (pushed to `origin`) and `landing/pine-fixes-2026-09-19` (a local integration branch merging `feat/pine-table-gaps` and `fix/secondary-bars-denial-storm`, tip `a6d8ed409`) — are mid-landing changes to **the exact same files this plan touches**: `app/src/components/chart/engine/ast/pine.js`, `objectProgram.js`, `pineObjects.js`, `objectRuntime.js`, `objectRenderState.js`, `objectTableDom.js`. That landing adds `clearcells`/`cellpatch` object op kinds and a new exported `OP_VALUE_FIELDS` list in `objectProgram.js`, replacing four previously-hand-maintained field-walking functions (`graphNodesReferenced`, `treeRefsReferenced`, `paramsReferenced`, `bindObjectProgram` — as of this writing, each hand-lists which op fields carry value-refs vs. ref-exprs; `OP_VALUE_FIELDS` does not exist anywhere in the current tree, confirmed by `grep -rn "OP_VALUE_FIELDS" app/src` returning nothing).

Verified at plan-writing time (re-run these before trusting anything below):

```bash
git fetch origin master
git merge-base --is-ancestor feat/pine-table-gaps origin/master && echo YES || echo NO   # -> NO
git merge-base --is-ancestor landing/pine-fixes-2026-09-19 origin/master && echo YES || echo NO   # -> NO
```

**Before implementing any task below, whoever executes this plan MUST:**
1. Re-run the two `git merge-base --is-ancestor` checks above against a freshly-fetched `origin/master`.
2. If either has landed, `git log --stat <merge-commit>` for `objectProgram.js`/`pineObjects.js`/`pine.js` and re-derive **every line number this plan cites** against that tree — do not trust a single line number below without re-`grep`ing for the anchoring comment or function name first.
3. If a new object op kind is ever introduced by any task below (none currently needs one), and `OP_VALUE_FIELDS` now exists, add the new kind's value-carrying fields to `OP_VALUE_FIELDS` **only** — never re-open the four hand-maintained functions. This repo has paid for the "hand-maintained list beside the one it describes" defect repeatedly (the writer-index `FOUR`, the COT router's "4 routes", the setup catalog's "24" — all documented in this repo's own `CLAUDE.md`); do not add a fifth instance to a class this repo is actively deleting.

### B. This worktree is shared with a concurrently-active session, right now

This plan was researched in a session running alongside a second agent ("main", the coordinator) actively working in **this same worktree, uncommitted, in real time**. At plan-writing time, `git status --short` shows:

```
 M api/services/indicator_compute.py
 M app/src/components/chart/engine/ast/closedTable.json
 M app/src/components/chart/engine/ast/pine.js
 M app/src/components/chart/indicators.js
```

This is a **working, empirically-verified prototype of Task 2 below** (the `last_bar_index` fix), not noise — this plan's own research independently designed the identical fix and confirmed it works (see Task 2). **Before starting Task 2, check `git status`/`git diff` again**: these four files may already be committed, further changed, or reverted by the time this plan is executed. Task 2's steps below describe the fix in full regardless of which of those is true, so it is actionable either way — but do not blindly re-apply a diff that is already committed, and do not silently discard a diff that is already there and correct without first diffing it against what this plan shows.

## Global Constraints

These bind every task below; a task's own steps do not repeat them.

1. **Never edit `app/src/components/chart/engine/ast/pine.js` via heredoc.** This is stated verbatim in `docs/superpowers/plans/2026-08-25-indicator-endzone-wave1.md:24` ("never edit `pine.js` through a heredoc") and `docs/superpowers/specs/2026-08-25-indicator-ecosystem-endzone-design.md:165` ("`pine.js` heredoc corruption: edits through the Edit tool only."). **Correction to the record:** this rule is **not** stated in `CLAUDE.md` — a full-text search of the current `CLAUDE.md` for `pine.js` and for `heredoc` finds no mention of either in the same context; the rule's only citable sources are the two plan/spec files above. Cite those, not `CLAUDE.md` — this repo has a standing rule that "a citation you cannot quote is struck." Use the `Edit` tool (string-replace) for every change to `pine.js` in every task below; the same discipline applies to `objectProgram.js`/`pineObjects.js`/`indicators.js`/`closedTable.json` even though the rule does not name them by title.
2. **Every fix must be validated against the actual parity-set fixture named for it, wherever the fixture is available, not only a synthetic unit test.** `tests/fixtures/oos2_parity/`'s `.pine` bodies are gitignored by design (six of the ten scripts' licences do not contemplate redistribution). `high_engagement__10-rsi-divergence-faytterro.pine` **is already present, un-gitignored**, in `tests/fixtures/pine_oos/` — used directly in Task 1. `mid_engagement__01-zeiierman-trend-pressure.pine` (Task 4) is **not** present as a `.pine` file in this tree (only its `.json` capture manifest is) — re-fetch from `https://www.tradingview.com/script/SEdUWOIJ-Zeiierman-Trend-Pressure-Zeiierman/` and verify `sha256_source: 5c6d87f8e3c8a29f173a68f3d2081f246a41ec9b33c8d2935d0642c41663c8cb` before use.
3. **No task in this plan touches the `translatePine` save-time door for non-literal window/length arguments (`pine:window` / `bindFoldableWindow` / `isBindFoldableLength`).** This was investigated and explicitly ruled out — see "Investigated and ruled out: widening the save-time window door" below. Do not reopen it as part of any task here; if it is ever revisited, it needs its own separately-scoped plan that engages directly with `bindFoldableAgreement.test.js`'s existing, deliberate regression guard.
4. **Any new object op kind this plan might introduce is added to `OP_VALUE_FIELDS` once it exists post-merge, never to the four hand-maintained field-walking functions.** See Constraint-note A above. None of the tasks below is expected to introduce a new op kind.

**Explicitly out of scope for this plan** (deferred, tracked in `C3B_CLOSE_LIVE_VENDOR_AND_PARITY.md` §6 and its own referenced documents):
- The RVOL dashboard work, the value-model/string-boxing runtime work.
- `str.*` builtins beyond what already exists, `request.security` beyond what already exists.
- General loops/arrays/UDF-frame work beyond the minimal, narrow diagnosis Task 4 requires for its one named script.
- The two `table.cell` bugs (positional-arg-order and merge-vs-replace) — being handled on `feat/pine-table-gaps`/`landing/pine-fixes-2026-09-19`.
- The `pine:state` family (blocking `high_engagement__16-klinger-volume-oscillator-everget` entirely).
- **H9** (a script with no `plot()` cannot translate at all) and **H10** (a dropped object op is silent to the member).
- **`%` (modulo) — gap register H7 — is NOT actually out of scope any more; it is DONE.** `app/src/components/chart/engine/ast/pine.modulo.test.js` exists and is green (confirmed live: `10 tests`, all passing, `npx vitest run` re-run independently at plan-writing time). The spec doc's own H7 entry ("Not implemented during C3B-CLOSE") is stale as of this writing; correct it in the gap register as part of Task 5's close-out, citing the passing suite, rather than leaving H7 open in a document someone will otherwise re-investigate from scratch.
- **General `pine:tuple` destructuring (a tuple-returning user function, `ta.bb`/`ta.dmi`/`ta.kc`/`ta.macd`, and tuple `request.security`) is also DONE, not a gap.** `pine.tuples.test.js` (35 tests) is green, confirmed independently at plan-writing time. This plan's own Task 3 verified empirically (not just read) that a working tuple binding correctly reaches BOTH a plot value and an object coordinate (a line's y-coordinate via `ta.bb`, a box's coordinates via a user-defined tuple function) — there is no separate, narrower "object-coordinate tuple" gap. The one real, remaining, narrow gap is `ta.supertrend` specifically, scoped in Task 3 below.

---

## Investigated and ruled out: widening the save-time window door

The original brief for this plan included a separately-decided owner ruling to widen `translatePine`'s save-time refusal for non-literal window/length arguments (`pine:window`) from the one proven ternary shape (`timeframe.isweekly ? 5 : 20`) to a broader vocabulary, on the reasoning that the bind-time fold (`bind.js::foldScalar`) can already evaluate ordinary arithmetic and the existing vendor-parity CI would catch anything that folds to a wrong number after the fact.

**This plan does not implement that widening, and no task above attempts it — the risk it would reintroduce is not "occasionally folds to a wrong number" (which the fold's own per-binding refuse-by-name safety net already catches harmlessly), it is a real, already-litigated safety property: `app/src/components/chart/engine/ast/bindFoldableAgreement.test.js` is a dedicated, three-gate regression suite (the save door, the bind-time fold, and `lint.js`'s repaint linter) built specifically because a first attempt at exactly this widening was wired and reverted the same day, 2026-09-10.**

Read in full: on that date the save door was wired to `bindFoldableWindow`'s predicate alone. `07-hull-suite.pine` stopped being refused at translate — and immediately became **un-saveable** instead, because `lint.js::resolveDeclaration` still saw the widened shape as an UNKNOWN-bounded window, which brands the whole formula `repaints`, and `canSaveFormula` refuses `repaints` outright. A precise, actionable refusal was traded for a badge that names nothing. The fix that stuck was making the save door, the fold, and the linter's bound computation share **one** predicate (`bindFoldableWindow` in `parse.js`), so none of the three can defer a length another one cannot carry.

The test file's own `FOLD_ONLY` category (five cases, including the simplest possible one — `op('+', input('lenDaily', 20), num(2))`, i.e. `lenDaily + 2` with `lenDaily` a fixed input default, a case with **no sign ambiguity at all**) is a **named, deliberate, currently-green discriminator** asserting that `foldScalar` can settle these values but `bindFoldableWindow`/`lintRepaint` must still decline to bound them — with the explicit reasoning: *"bounding `a + b` needs 'both arms non-negative'... A bound resting on an unstated premise is how an UNDER-stated window ships, and an under-stated window is the one direction a budget cannot absorb."* The concern is not merely "the folded value might be wrong" (which the owner's original ruling explicitly accepts as tolerable, catchable risk) — it is that an unsound **lookback bound** feeds how far back the interpreter is told to read, and an understated bound is a buffer-safety property, not a display-value property. A sound `{min, max}` interval-arithmetic scheme (tracking both bounds, not assuming monotonicity) was considered during this plan's research and would resolve the specific "non-negative arms" objection quoted above — but the test's own `'⛔ …and a FOLD-ONLY length is still branded repainting, by NAME'` case is written to fail on that exact widening regardless of whether the new bound is sound, since it is asserting a policy boundary (the linter's bound computation stays a simple, obviously-correct read of the tree, not a growing evaluator), not merely a soundness bug in the 2026-09-10 attempt. Overriding that policy is a legitimate thing for the repo's owner to decide, but it needs to be decided **with this exact test in hand**, as its own reviewed change to `bindFoldableAgreement.test.js` — not folded into this plan as a side effect of the geometry-family work.

**If the owner still wants this widened after seeing the above, that is a separate, one-task plan:** update `bindFoldableAgreement.test.js`'s `FOLD_ONLY` category and its two discriminator tests to reflect the new, explicitly-accepted policy, alongside whichever bound-computation change (interval arithmetic or otherwise) makes the linter's bound sound for the newly-admitted shapes. That is not scoped here.

---

## Task 1: Fix the `loopBlocked` diagnostic's false-positive, and correct the record on why `high_engagement__10-rsi-divergence-faytterro` still does not paint

### What this plan found, empirically verified against the actual fixture (this corrects the spec doc's own diagnosis)

The C3B-CLOSE doc attributes this script's zero-object outcome to `"C3B LOOP-BOUNDARY — 6 creates dropped, loopBlocked: 6; RISK-043 stands"`, citing one number for what turns out to be **two disjoint facts that coincidentally share a count of 6**. This was confirmed three ways: a structural indentation trace of the real source, a full read of the relevant `pine.js`/`pineObjects.js` code, and — decisively — running the actual fixture through `translatePine` directly:

```
FIXTURE ok: false
FIXTURE objectDiagnostics: {"loopBlocked":6,"loopBlockedCalls":["array.set"],
  "getters":[],"unsupported":[],"outOfScope":[],"unresolvedValues":6,
  "droppedOps":6,"dropReasons":{"guard:create":6}}
FIXTURE ops: []
```

**Fact 1 — a real, fixable, in-scope diagnostic bug.** `array.set(dizi<N>, i, …)` appears six times in the fixture (source lines 31, 53, 81, 100, 138, 160), each genuinely lexically inside its own `for` loop, each writing into a plain `array.new_float(...)`-typed array (`dizi`…`dizi6`) — ordinary least-squares regression scratch arrays, nothing to do with any line/label/box/table object. `pineObjects.js::collectObjectOps`'s statement walker, on any bare `array.<method>(...)` call where `method` is in `COLLECTION_CALLS` (`push`/`set`/`remove`/`clear`/`pop`/`shift`), calls `emitCollection`, whose **first** line is:

```js
function emitCollection(method, toks, guards, inLoop, st, scope) {
  if (inLoop) { diagnostics.loopBlocked.push(`array.${method}`); return }
  const args = argsOf(toks)
  if (!args || !args.length) return
  const collName = args[0] && args[0].value && args[0].value.type === 'name'
    ? args[0].value.name : null
  if (!collName || !decls.has(collName) || decls.get(collName).kind !== 'coll') return
  ops.push({ ... })
}
```

The `inLoop` check runs **before** the check for whether the array is even a declared object-family collection (`decls.get(name).kind === 'coll'`, which only ever happens for `array.new_line()`/`array.new_box()`/`array.new_label()`/`array.new_table()`/`array.new_linefill()` — never `array.new_float()`, since `pineObjects.js`'s assignment handler only registers a collection when `OBJECT_NAMESPACES.includes(fam)`, and `float` is not in `OBJECT_NAMESPACES = ['line','label','box','table','linefill']`). So any collection-method call syntactically inside a loop is counted as a dropped *object* op whether or not the array it targets is one. This is **exactly** where the fixture's `loopBlocked: 6` comes from — confirmed by the empirical run above, whose `ops: []` also proves these six never even became `collected.ops` entries (an early `return`, not a later drop).

**Fact 2 — the real reason the fixture's objects do not paint, and it is unrelated to Fact 1.** The fixture's six real object-creating statements — `line.new(…)` ×4 and `label.new(…)` ×2, at source lines 107, 108, 111, 112, 141, 164 — sit inside top-level `if cg` / `if cr` blocks with **no `for`/`while` ancestor at all** (confirmed by an indentation-based structural trace: every one reports `loopAncestor: False`). They are never touched by `loopBlocked`. Instead, `buildObjectProgram`'s per-op loop drops all six via `guard:create` — confirmed by the empirical `dropReasons: {"guard:create": 6}` above, with `unresolvedValues: 6` matching one failed resolution per op. The mechanism, read directly from `pine.js`:

```js
const guardOf = (guards) => {
  ...
  for (const g of guards) {
    ...
    const ast = canonicalOf(node)
    if (!ast) return undefined
    ...
  }
  ...
}
```

and in `buildObjectProgram`'s main loop: `const g = guardOf(op.guards); if (g === undefined) { dropped('guard:create'); continue }`. `canonicalOf` internally calls the same `try { return makeResolver(...).resolve(node) } catch { diagnostics.unresolvedValues += 1; return null }` that swallows every refusal, including a `PineRefusal`. Each `if cg`/`if cr` guard's condition is exactly `cg` or `cr` — booleans reassigned via `:=` inside a preceding `for i = 0 to len-1` loop (`cg := cg and not cg[i+1]`, `cr := cr and not cr[i+1]`, source lines ~103-105). This is precisely the shape **RISK-043's existing, already-shipped value-lane fix** exists to refuse: a name mutated inside an unfoldable `for`/`while` block is forced OPAQUE (`pine:reassign`) the moment the top-level walker gives up on that block, because the engine has no general loop-execution model and cannot know `cg`'s true bar-by-bar value without one. `canonicalOf(node)` for `cg`/`cr` therefore returns `null` (the opacity refusal swallowed by the same try/catch), `guardOf` returns `undefined`, and every op guarded by `cg` or `cr` — all six real creates — is dropped by name.

**This is RISK-043 working exactly as designed, not a bug.** The spec doc's own conclusion — *"RISK-043 stands"* — is correct; its cited evidence (`loopBlocked: 6`) was simply counting the wrong six statements. Fixing this script's painting outcome would require the same general loop-carried-state execution RISK-043's own registry entry explicitly declines to authorize ("Outcome A... explicitly not authorized"), which is out of scope here exactly as it is out of scope for RISK-043 itself. This task's real, valuable, in-scope deliverable is Fact 1's diagnostic-precision fix, plus correcting the causal record.

### Files

- Modify: `app/src/components/chart/engine/ast/pineObjects.js` (the `emitCollection` function)
- Test: `app/src/components/chart/engine/ast/pineLoopBlockedCollections.test.js` (new file)

### Interfaces

- Consumes: `collectObjectOps(stmts, h)` (unchanged signature), its internal `diagnostics.loopBlocked` array and `decls` map.
- Produces: no new exports. `translatePine(source, opts).objectDiagnostics.loopBlocked`/`.loopBlockedCalls` no longer include `array.<method>` entries for a collection that is not `decls`-registered `kind: 'coll'`.

- [ ] **Step 1: Write the failing tests (this reproduces both Fact 1 and Fact 2 against the real fixture)**

```js
// app/src/components/chart/engine/ast/pineLoopBlockedCollections.test.js
//
// ─── TASK 1 — `emitCollection` MUST NOT COUNT A PLAIN NUMERIC ARRAY AS A
// DROPPED OBJECT OP, AND THE REAL RISK-043 CAUSE MUST BE NAMED CORRECTLY ───
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine'

describe('⭐⭐ a plain numeric array inside a loop is not a dropped OBJECT op', () => {
  it('array.set on a array.new_float() scratch array inside a for loop is NOT loopBlocked', () => {
    const src = `//@version=6
indicator("t1", overlay=true)
len = 3
dizi = array.new_float(len)
for i = 0 to len - 1
    array.set(dizi, i, close[i])
plot(close)
`
    const t = translatePine(src, { strict: true })
    expect(t.objectDiagnostics.loopBlocked).toBe(0)
    expect(t.objectDiagnostics.loopBlockedCalls).toEqual([])
  })

  it('CONTROL: array.push on a declared OBJECT-family collection inside a loop IS STILL loopBlocked — RISK-043 stands', () => {
    const src = `//@version=6
indicator("t1b", overlay=true)
lines = array.new_line()
if barstate.islast
    for i = 0 to 2
        array.push(lines, na)
plot(close)
`
    const t = translatePine(src, { strict: true })
    expect(t.objectDiagnostics.loopBlocked).toBe(1)
    expect(t.objectDiagnostics.loopBlockedCalls).toEqual(['array.push'])
  })

  it('the real parity-set fixture: loopBlocked drops from 6 to 0, and the 6 real creates fail via guard:create (RISK-043), not loopBlocked', () => {
    const fixturePath = path.resolve(
      __dirname, '../../../../../../tests/fixtures/pine_oos/high_engagement__10-rsi-divergence-faytterro.pine',
    )
    const src = fs.readFileSync(fixturePath, 'utf8')
    const t = translatePine(src, { strict: true })
    // ⭐ THE FIX'S WHOLE CLAIM: the diagnostic becomes honest for this script.
    expect(t.objectDiagnostics.loopBlocked).toBe(0)
    expect(t.objectDiagnostics.loopBlockedCalls).toEqual([])
    // ⚠️ NOT A CLAIM THAT OBJECTS NOW PAINT. This is RISK-043 working as
    // designed (cg/cr reassigned inside a for loop, forced opaque, the
    // guard cannot resolve) — correct, standing, out of scope to change here.
    expect(t.objectDiagnostics.droppedOps).toBe(6)
    expect(t.objectDiagnostics.dropReasons).toEqual({ 'guard:create': 6 })
    const ops = (t.objects && t.objects.ops) || []
    expect(ops.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run and confirm the exact current-state failure**

```bash
cd app && npx vitest run src/components/chart/engine/ast/pineLoopBlockedCollections.test.js
```

Expected today: the first and third cases fail on `loopBlocked` reading `1`/`6` respectively (not `0`); the control (second case) already passes.

- [ ] **Step 3: Implement the fix — reorder `emitCollection`'s checks**

In `app/src/components/chart/engine/ast/pineObjects.js`, find:

```js
  function emitCollection(method, toks, guards, inLoop, st, scope) {
    if (inLoop) { diagnostics.loopBlocked.push(`array.${method}`); return }
    const args = argsOf(toks)
    if (!args || !args.length) return
    const collName = args[0] && args[0].value && args[0].value.type === 'name'
      ? args[0].value.name : null
    if (!collName || !decls.has(collName) || decls.get(collName).kind !== 'coll') return
    ops.push({
      k: `coll_${method}`, coll: collName, args: args.slice(1),
      guards, locals: scope, at: toks[0], line: st.header[0].line,
    })
  }
```

Replace with:

```js
  /** ⭐⭐ TASK 1 (2026-09) — RELEVANCE BEFORE THE LOOP BOUNDARY, NOT AFTER.
   *
   *  `array` is Pine's one generic namespace for every element type — a plain
   *  `array.new_float()` regression scratch array and an `array.new_line()`
   *  collection call the identical method spellings. Flagging `inLoop` before
   *  asking whether THIS array was ever registered as an object-family
   *  collection (`decls.get(name).kind === 'coll'`) counted an ordinary numeric
   *  loop body as a dropped OBJECT op. Measured on
   *  `high_engagement__10-rsi-divergence-faytterro.pine`: its reported
   *  `loopBlocked: 6` was entirely six `array.set(dizi<N>, i, …)` calls on
   *  `array.new_float()` scratch arrays — its six real (and separately, and
   *  correctly, blocked by RISK-043's guard mechanism) `line.new`/`label.new`
   *  creates were never in this count at all.
   *
   *  ⛔ RISK-043 STILL STANDS FOR THE CASE IT PROTECTS: an object-family
   *  collection op (`decls.get(name).kind === 'coll'`) inside a loop is still
   *  refused and still counted — this reorders WHEN irrelevance is detected, it
   *  does not touch what happens once relevance is established.
   */
  function emitCollection(method, toks, guards, inLoop, st, scope) {
    const args = argsOf(toks)
    if (!args || !args.length) return
    const collName = args[0] && args[0].value && args[0].value.type === 'name'
      ? args[0].value.name : null
    if (!collName || !decls.has(collName) || decls.get(collName).kind !== 'coll') return
    if (inLoop) { diagnostics.loopBlocked.push(`array.${method}`); return }
    ops.push({
      k: `coll_${method}`, coll: collName, args: args.slice(1),
      guards, locals: scope, at: toks[0], line: st.header[0].line,
    })
  }
```

Also add one sentence to the file's header comment (the block starting `// IT KNOWS WHAT IT CANNOT DO`), immediately after the existing loop-boundary bullet, so a future reader does not "simplify" the two checks back together:

```js
//   * an object operation inside a `for`/`while` body — RISK-043 stands, the
//     loop is not executed, and drawing the first iteration would be a lie.
//     ⛔ THIS APPLIES ONLY ONCE AN OP IS KNOWN TO BE AN OBJECT OP. For a
//     collection call (`array.<method>`) that means the target array must
//     already be `decls`-registered `kind: 'coll'` — checked BEFORE `inLoop`,
//     never after, or an ordinary numeric array inside a loop is misreported
//     as a dropped drawing (Task 1, 2026-09-19);
```

- [ ] **Step 4: Run and verify all three pass**

```bash
cd app && npx vitest run src/components/chart/engine/ast/pineLoopBlockedCollections.test.js
```

Expected: `3 passed`.

- [ ] **Step 5: Run the wider object-model suite for regressions**

```bash
cd app && npx vitest run src/components/chart/engine/ast/objectCorpus.test.js src/components/chart/engine/ast/objectDemandCensus.test.js src/components/chart/engine/ast/doorScorecard.test.js src/components/chart/engine/ast/pine.blindCorpus.test.js
```

Read the totals line, not just the exit code. If any file asserts an exact `loopBlocked` total across the wider corpus, correct it with a comment naming this task and the measured before/after — never silently, per this repo's existing ratchet-floor-correction convention (e.g. the RISK-043 `29→27`/`38→36` corrections already in `pine.blindCorpus.test.js`).

- [ ] **Step 6: Commit**

```bash
git add app/src/components/chart/engine/ast/pineObjects.js app/src/components/chart/engine/ast/pineLoopBlockedCollections.test.js
git commit -m "$(cat <<'EOF'
pine objects: array.set on a plain numeric array is not a dropped object op

emitCollection flagged the loop boundary before checking whether the target
array was ever registered as an object-family collection, so any
array.set/push/remove/pop/shift/clear on an ordinary array.new_float()
scratch array inside a for loop was counted as a dropped line/label/box/
table op. Measured on the real parity-set fixture
high_engagement__10-rsi-divergence-faytterro.pine: its reported
loopBlocked: 6 was entirely six such scratch-array writes.

Its six real line.new/label.new creates were never in that count -- they
have no loop ancestor at all. They are dropped via guard:create instead,
because their guard (cg/cr) is reassigned inside a for loop and RISK-043's
existing value-lane fix correctly forces it opaque. This is RISK-043
working as designed, not a bug this commit fixes -- the spec doc's own
"RISK-043 stands" conclusion was right; its cited "loopBlocked: 6" evidence
was counting six unrelated statements.

Reordered emitCollection to check decls-relevance before inLoop. RISK-043
is unchanged for the case it protects (an object-family collection, e.g.
array.new_line(), inside a loop is still refused and still counted).
EOF
)"
```

---

## Task 2: Formalize the `last_bar_index` fix (H8) — a working prototype already exists in this worktree

### What this plan found

`bar_index` resolves via `engineClockKeyFor(name)` (`pine.js`) → `TABLE.clock` (`closedTable.json`'s `"clock"` section) → `clockLeaf(key) = { type: 'series', name: key }`, fed generically into `interpret.js` from the same bundle `indicators.js::computeClock` produces (mirrored in `api/services/indicator_compute.py::compute_clock`). This is a **completely separate mechanism from `BUILTIN_SERIES_TREE`** (which holds only `tr`/`trGuarded`) and from the not-yet-live "runtime IR" lane (`buildRuntimeIr`) described in this plan's Architecture section — the object-rendering pipeline this plan is scored against (`objectColumns.js`) imports only `interpret.js`, never `runtime/`, so the clock mechanism is the correct and complete fix location.

`last_bar_index` is declared in `PINE_KNOWN_BUILTINS` (a named refusal) but had no entry anywhere in this chain — confirmed empirically before any fix: `plot(last_bar_index)` → `ok: false`, `refusal.guard: "pine:builtin"`, message `"this Pine built-in names something the engine grammar does not hold — `last_bar_index`"`. Unlike `bar_index` (the per-bar loop counter), `last_bar_index` is a dataset-wide constant — the same value (`bars.length - 1`) on every bar — exactly like the existing `islast`/`isfirst` "EXTENT" columns' own family (`indicators.js`'s `CLOCK_EXTENT`, whose doc comment already describes this class: "which bar this is out of how many... and no clock at all").

**A complete, four-file, cross-language-parity fix for this is already applied, uncommitted, in this exact worktree** (see the "Shared worktree" note at the top of this plan) — independently designed to match what this plan's own research had separately concluded, and empirically confirmed working before this task was written:

```
plot(last_bar_index)                                    -> ok: true, refusal: null
if bar_index >= last_bar_index - 2                       -> real label.new create op,
    label.new(bar_index, close, text = "x")                 zero drops, zero refusals
```

The four diffs (verify these are still present, or reapply them exactly, before Step 1):

`app/src/components/chart/engine/ast/closedTable.json` — one new `clock` entry, inserted as a text edit immediately after `"barindex"` (never round-trip this file through a JSON parser — see this repo's own standing rule against it):

```json
    "lastbarindex": {
      "lookback": 0,
      "yields": "num",
      "sentence": "the newest bar's own barindex, the same value on every bar -- NOT window-dependent, exactly like islast: widen the fetch and the number moves, but it names the same real bar either way, the way islast's 1 always lands on that same bar"
    },
```

`app/src/components/chart/indicators.js` — `lastbarindex` joins the EXTENT family (renamed from a pair to a trio) and is filled as a broadcast constant right after `barindex`'s own per-bar loop:

```js
export const CLOCK_EXTENT = Object.freeze(['islast', 'isfirst', 'lastbarindex'])
...
  for (let i = 0; i < length; i++) cols.barindex[i] = i
  ...
  cols.isfirst[0] = 1
  cols.islast[length - 1] = 1
  // `lastbarindex` is `barindex[length - 1]`, broadcast to every bar -- the
  // newest bar's own position, read from wherever a formula sits in the series.
  cols.lastbarindex.fill(length - 1)
```

`api/services/indicator_compute.py` — the identical shape:

```python
CLOCK_EXTENT = ("islast", "isfirst", "lastbarindex")
...
    cols["isfirst"] = [1.0 if i == 0 else 0.0 for i in range(n)]
    cols["islast"] = [1.0 if i == n - 1 else 0.0 for i in range(n)]
    # ``lastbarindex`` is ``barindex[n - 1]``, broadcast to every bar -- the
    # newest bar's own position, read from wherever a formula sits in the series.
    cols["lastbarindex"] = [float(n - 1)] * n
```

`app/src/components/chart/engine/ast/pine.js` — the Pine-spelling-to-manifest-key translation, without which the manifest entry above is unreachable from the bare Pine name (`engineClockKeyFor` only ever checks `TABLE.clock` under either the untranslated name or a `PINE_TO_CLOCK_SPELLING` entry — there is no underscore-stripping or other normalization):

```js
const PINE_TO_CLOCK_SPELLING = Object.freeze({
  bar_index: 'barindex',
  last_bar_index: 'lastbarindex',
})
```

**What remains is exactly what this task does: confirm the prototype, add both language's tests (there are none yet for this), re-run the vendor-parity rail, and commit all four files together as one unit** (they are not independently meaningful — the manifest entry with no spelling map, or either `computeClock` twin without the other, each leave the fix half-done).

### Files

- Verify/finish (already modified in this worktree, uncommitted, as of plan-writing time): `app/src/components/chart/engine/ast/closedTable.json`, `app/src/components/chart/indicators.js`, `api/services/indicator_compute.py`, `app/src/components/chart/engine/ast/pine.js`
- Test: `app/src/components/chart/engine/ast/pineLastBarIndex.test.js` (new)
- Test: `tests/test_indicator_compute_clock_lastbarindex.py` (new)

### Interfaces

- Consumes: `TABLE.clock`, `computeClock`'s per-bar `cols` object (read generically by `interpret.js`).
- Produces: `plot(last_bar_index)` and any object guard/coordinate using it (e.g. `bar_index >= last_bar_index - 2`) resolve through the same `{type:'series', name:'lastbarindex'}` leaf `bar_index` uses — no change to `objectProgram.js`'s `valueRef` shapes.

- [ ] **Step 1: Confirm the four-file diff is present (or reapply it exactly as shown above), then write the failing-until-confirmed tests**

```bash
git status --short   # confirm the 4 files above, or reapply their diffs exactly
```

```js
// app/src/components/chart/engine/ast/pineLastBarIndex.test.js
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'

describe('⭐⭐ last_bar_index resolves the same way bar_index does (H8)', () => {
  it('plot(last_bar_index) translates', () => {
    const t = translatePine(`//@version=6
indicator("t2", overlay=true)
plot(last_bar_index)
`, { strict: true })
    expect(t.ok).toBe(true)
    expect(t.refusal).toBeNull()
  })

  it('the vendor-idiom guard `bar_index >= last_bar_index - 2` resolves an object create', () => {
    const t = translatePine(`//@version=6
indicator("t2b", overlay=true)
if bar_index >= last_bar_index - 2
    label.new(bar_index, close, text = "x")
plot(close)
`, { strict: true })
    expect(t.ok).toBe(true)
    const ops = (t.objects && t.objects.ops) || []
    expect(ops.some((o) => o.k === 'create' && o.family === 'label')).toBe(true)
    expect((t.objectDiagnostics.dropReasons || {})['guard:create']).toBeUndefined()
  })

  it('CONTROL: a name this engine truly does not hold is still a NAMED refusal', () => {
    const t = translatePine(`//@version=6
indicator("t2c", overlay=true)
plot(open_time)
`, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:builtin')
  })
})
```

```python
# tests/test_indicator_compute_clock_lastbarindex.py
from api.services.indicator_compute import compute_clock, CLOCK_EXTENT


def test_lastbarindex_is_the_final_bar_index_on_every_bar():
    bars = [{"t": 1700000000 + i * 86400, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1} for i in range(5)]
    cols = compute_clock(bars, tf="D")
    assert list(cols["lastbarindex"]) == [4.0, 4.0, 4.0, 4.0, 4.0]
    assert list(cols["barindex"]) == [0.0, 1.0, 2.0, 3.0, 4.0]


def test_lastbarindex_is_declared_in_clock_extent():
    assert "lastbarindex" in CLOCK_EXTENT
```

- [ ] **Step 2: Run both suites**

```bash
cd app && npx vitest run src/components/chart/engine/ast/pineLastBarIndex.test.js
cd .. && python -m pytest tests/test_indicator_compute_clock_lastbarindex.py -v
```

Expected: `3 passed` (JS), `2 passed` (Python) — this task's own research confirmed the underlying behavior already works empirically before these tests were written, so this step should pass immediately; if it does not, the four-file diff in this worktree has diverged from what Step 1 checked, and that divergence must be resolved before proceeding.

- [ ] **Step 3: Run the vendor-parity rail and confirm the H8 divergence is closed**

```bash
cd app && npx vitest run src/components/chart/builder/vendorObjectParity.test.js src/components/chart/engine/ast/pine.barstate.test.js
```

Cross-reference against `C3B_CLOSE_LIVE_VENDOR_AND_PARITY.md` §3's own numbers for the vendor probe script (`droppedOps: 1, dropReasons: {"guard:create": 1}` before this fix, for the label guarded by `bar_index >= last_bar_index - 2`) — confirm it now reads `droppedOps: 0` for that probe.

- [ ] **Step 4: Commit all four source files plus both new test files together**

```bash
git add app/src/components/chart/engine/ast/closedTable.json app/src/components/chart/engine/ast/pine.js app/src/components/chart/indicators.js api/services/indicator_compute.py app/src/components/chart/engine/ast/pineLastBarIndex.test.js tests/test_indicator_compute_clock_lastbarindex.py
git commit -m "$(cat <<'EOF'
pine: resolve last_bar_index the same way bar_index resolves (H8)

last_bar_index was declared in PINE_KNOWN_BUILTINS (a named refusal) but
had no column anywhere. bar_index resolves through the clock mechanism
(PINE_TO_CLOCK_SPELLING -> TABLE.clock -> clockLeaf -> indicators.js::
computeClock), not through BUILTIN_SERIES_TREE, and not through the
separate, not-yet-live runtime IR lane.

Added lastbarindex to the CLOCK_EXTENT family alongside islast/isfirst: a
dataset-wide constant (bars.length - 1 on every bar), computed in
indicators.js::computeClock and mirrored in api/services/
indicator_compute.py::compute_clock per this manifest's own JS/Python
parity contract, with tests added for both lanes.

Unblocks the vendor capture's one divergence (C3B_CLOSE_LIVE_VENDOR_AND_
PARITY.md SS3): `bar_index >= last_bar_index - 2`, a common
"only draw on the last few bars" guard.
EOF
)"
```

---

## Task 3: Correct `ta.supertrend`'s tuple refusal to name its own reason

### What this plan found (verified empirically, not only by reading)

General `pine:tuple` destructuring is **already fully implemented and tested** — `pine.tuples.test.js` (35 tests, confirmed green, run independently twice) covers a tuple-returning user function, `ta.dmi`, the closed `PINE_TUPLE_BUILTINS` table (`bb`/`macd`/`kc`), tuple `request.security` (including the R18 array-literal-argument entrance), and a destructure inside an `if` branch. This plan's own research additionally **empirically confirmed** (not merely inferred from shared code) that a working tuple binding correctly reaches an object coordinate, exactly as it reaches a plot value — via the identical `Resolver.resolve()` method either way:

```
[mid, upper, lower] = ta.bb(close, 20, 2); line.new(bar_index - 5, mid, ...)
  -> ok: true, ops: [{"k":"create","family":"line"}]

f_parts() => [close, high]; [a, b] = f_parts(); box.new(bar_index - 5, b, ..., a, ...)
  -> ok: true, ops: [{"k":"create","family":"box"}]
```

There is **no separate, narrower "object-coordinate tuple" gap** — the C3B-CLOSE doc's suspicion that `mid_engagement__05-supertrend-fibonacci-ote`'s value-refs fail *because* they feed an object coordinate specifically is not what is happening; the same refusal reproduces identically for a bare `plot(...)`.

`destructureBindings` (`pine.js`) tries, in order: a hand-recognized `ta.dmi` shape; the closed, pure, stateless `PINE_TUPLE_BUILTINS` table (`bb`/`macd`/`kc`); a user-defined function whose body's last statement is a genuine tuple literal; a tuple `request.security(...)` call. Anything else falls to `tupleRefusalTail`, producing the generic `"this engine has no tuple form for `<name>` — the ones it can take apart are …"`.

A script titled **"Supertrend + Fibonacci OTE Grid & Bands"** almost certainly writes `[direction, level] = ta.supertrend(factor, atrPeriod)` — Pine's canonical, near-universal spelling for this exact indicator. **Empirically confirmed**, reproducing the generic refusal exactly:

```
[dir, level] = ta.supertrend(3, 10); plot(dir)
  -> ok: false, refusal.guard: "pine:tuple"
  -> message: "this Pine call answers with several values at once and a column
     carries one — `dir` — this engine has no tuple form for `ta.supertrend`
     — the ones it can take apart are `ta.bb`, `ta.dmi`, `ta.kc`, `ta.macd`.
     Writing it WITHOUT the brackets says more about why"
```

`ta.supertrend` is **not** in `PINE_TUPLE_BUILTINS`, and cannot be added the way `bb`/`macd`/`kc` were: `closedTable.json`'s own `"supertrend"` note (a top-level `series` entry, not a `functions` entry) states in full that it is **"NOT EXPRESSIBLE"** — it carries state that depends on its own previous value (the band ratchet + the direction flip), which this grammar (a pure expression tree over sealed primitives, no series assignment, no self-reference) cannot hold without "a new SEALED entry with its own recurrence, declared and mirrored in both lanes — not an expansion," the same class of work as adding a new `ema`/`rma`-style primitive. This is categorically larger than a tuple-mechanism gap, and is **not implemented by this task** — it needs a new recurrence primitive, interpreter execution, a Python-lane mirror, and a vendor capture proving the ratchet-and-flip formula, none of which this plan scopes or authorizes.

**What this task does instead:** corrects the refusal's wording for this one callee name, so it names the true reason (a missing primitive, not a missing tuple form) instead of listing `bb`/`macd`/`kc`/`dmi` as "the ones it can take apart" — a list that invites exactly the wrong, unsound fix (silently adding `supertrend` there would drop the ratchet and the flip and serve a different, look-alike series under the Supertrend name, precisely what the manifest's own note refuses).

### Files

- Modify: `app/src/components/chart/engine/ast/pine.js` (`tupleRefusalTail`)
- Test: `app/src/components/chart/engine/ast/pineTupleRefusalWording.test.js` (new)

### Interfaces

- Consumes: `tupleRefusalTail(call, names, env)` (unchanged signature).
- Produces: no new exports. `pine:tuple`'s message text changes for exactly the callee name `supertrend` (bare or `ta.`-namespaced) — no other callee's message changes.

- [ ] **Step 1: Write the failing test**

```js
// app/src/components/chart/engine/ast/pineTupleRefusalWording.test.js
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'

describe('⭐⭐ ta.supertrend refuses its tuple form with its own real reason', () => {
  it('names the recurrence gap, not the generic "no tuple form" list', () => {
    const t = translatePine(`//@version=6
indicator("t3", overlay=true)
[dir, level] = ta.supertrend(3, 10)
plot(dir)
`, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:tuple')
    expect(t.refusal.message).toMatch(/previous bar|its own previous value|recurrence/i)
    expect(t.refusal.message).not.toMatch(/the ones it can take apart are/)
  })

  it('CONTROL: an unrelated unknown-tuple callee still gets the generic list', () => {
    const t = translatePine(`//@version=6
indicator("t3b", overlay=true)
[a, b] = ta.nonexistentThing(1, 2)
plot(a)
`, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.message).toMatch(/the ones it can take apart are/)
  })

  it('CONTROL: bb/macd/kc are unaffected', () => {
    const t = translatePine(`//@version=6
indicator("t3c", overlay=true)
[mid, upper, lower] = ta.bb(close, 20, 2)
plot(mid)
`, { strict: true })
    expect(t.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run and confirm the first case fails today, both controls already pass**

```bash
cd app && npx vitest run src/components/chart/engine/ast/pineTupleRefusalWording.test.js
```

- [ ] **Step 3: Implement**

In `app/src/components/chart/engine/ast/pine.js`, in `tupleRefusalTail`, find:

```js
function tupleRefusalTail(call, names, env) {
  if (!call) return 'the right-hand side is not an expression this engine could read'
  if (call.type !== 'call') {
    return 'the right-hand side is not a call, and only a call answers with several values'
  }
  const shown = String(call.name)
  const supplied = call.args || []
  const callee = env.get(call.name)
```

Add, immediately after `const supplied = call.args || []` and before `const callee = env.get(call.name)`:

```js
  // ⭐⭐ TASK 3 — `ta.supertrend` NAMES ITS OWN REASON, NOT THE GENERIC LIST.
  //
  // `closedTable.json::series.supertrend`'s own top-level note already states
  // this in full: Supertrend carries state that depends on its OWN PREVIOUS
  // VALUE (the band ratchet + the direction flip), which this grammar — a
  // pure expression tree over sealed primitives, no self-reference — cannot
  // hold without a NEW SEALED RECURRENCE PRIMITIVE, the same class of work
  // `ema`/`rma`/`atr`/`rsi`/`adx` already needed. That is materially larger
  // than "the tuple mechanism does not know this name," and the generic "the
  // ones it can take apart are bb/macd/kc/dmi" list invites exactly the
  // wrong fix: silently adding `supertrend` to `PINE_TUPLE_BUILTINS` (a table
  // of PURE, STATELESS expansions) would drop the ratchet and the flip and
  // serve a different series under the Supertrend name.
  const bareForSupertrend = normaliseName(shown.split('.').pop())
  if (bareForSupertrend === 'supertrend') {
    return '`' + shown + '`' + ' carries state that depends on its own previous '
      + 'value — the band only tightens while the trend holds, and the direction '
      + 'flips only when price crosses the band it produced last bar. This engine '
      + 'has no self-reference in its expression grammar yet, so this is not a '
      + 'missing tuple form, it is a missing primitive'
  }
```

(`normaliseName` is already imported/in scope in this file, used a few lines below this insertion under the existing local name `bare` — this insertion uses `bareForSupertrend` to avoid redeclaring within the same function scope.)

- [ ] **Step 4: Run and verify all three pass**

```bash
cd app && npx vitest run src/components/chart/engine/ast/pineTupleRefusalWording.test.js
```

- [ ] **Step 5: Run the tuple regression suite**

```bash
cd app && npx vitest run src/components/chart/engine/ast/pine.tuples.test.js
```

Expected: `35 passed`, unchanged.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/chart/engine/ast/pine.js app/src/components/chart/engine/ast/pineTupleRefusalWording.test.js
git commit -m "$(cat <<'EOF'
pine: ta.supertrend's tuple refusal names its own reason

Diagnosed mid_engagement__05-supertrend-fibonacci-ote's pine:tuple
refusal, empirically: its [dir, level] = ta.supertrend(...) destructure
fails not because the tuple-destructure mechanism (already fully
implemented and tested, pine.tuples.test.js, 35/35 green) lacks a case for
this name, but because ta.supertrend itself is not expressible in this
grammar at all -- closedTable.json's own "supertrend" note says it needs
bar-to-bar recurrence state (the ratchet + the flip) this pure-expression-
tree engine has no self-reference for. Confirmed the same refusal
reproduces identically for a bare plot() and for an object-coordinate
consumer -- there is no separate, narrower object-coordinate-tuple gap.

That recurrence primitive is a materially larger undertaking than this
plan scopes and is explicitly NOT implemented here. This narrow fix
corrects the refusal's WORDING for this one callee name so it names the
real reason instead of listing bb/macd/kc/dmi as "the ones it can take
apart" -- a list that invites the wrong, unsound fix (silently adding
supertrend there would drop the ratchet/flip and serve a different series
under the Supertrend name).
EOF
)"
```

---

## Task 4: Diagnose and fix (or precisely scope out) the dropped `create:box` in `mid_engagement__01-zeiierman-trend-pressure`

### What was found (this task's fixture is licensed and not yet re-fetched — the mechanism below is fully read and verified; the specific triggering construct is not)

The drop-ledger mechanism for a `create` op, read in full from `buildObjectProgram`'s per-op assembly loop:

```js
if (op.k === 'create') {
  const order = CREATE_POSITIONAL[op.family] || []
  const raw = namedOrPositional(op.args, order)
  const props = {}
  let bad = false
  const required = REQUIRED[op.family] || new Set()
  for (const [k, node] of Object.entries(raw)) {
    ...
    const v = valueRef(node, k)
    if (!v) {
      if (required.has(k) || (CONTENT[op.family] && CONTENT[op.family].has(k))) { bad = true; break }
      dropProp(op.family, k, node)
      continue
    }
    props[k] = v
  }
  if (!bad) for (const k of required) if (!(k in props)) { bad = true; break }
  if (bad) { dropped(`create:${op.family}`); continue }
  ...
```

For `family: 'box'`: `REQUIRED.box = new Set(['left', 'top', 'right', 'bottom'])`, `CONTENT.box = new Set(['text'])`. `dropped('create:box')` fires when at least one of these fails to resolve through `valueRef(node, k)` → `resolveTree` → `canonicalOf` → the general resolver, whose `try { return makeResolver(...).resolve(node) } catch { diagnostics.unresolvedValues += 1; return null }` swallows every exception — `pine:type`, `pine:function-def`, `pine:builtin`, anything — into a plain `null`. A `create:box` drop therefore names only that *some* geometry argument failed, never *which* refusal caused it, which is why the spec doc could not diagnose this beyond naming the drop.

The spec doc's own row for this script says its plot outputs refuse with `pine:type`/`pine:function-def`/`pine:builtin` — a style associated with heavy use of Pine's user-defined-type (`type`) and user-function features. The evidence-consistent hypothesis (to confirm in Step 1, not assume) is that the box's coordinate expression reads a field of a user-defined-type instance, or the return of a user function this engine cannot fully inline — the same *class* of grammar gap as Task 3's tuple issue (a value wrapped in a construct the resolver's pattern-matching does not unwrap), a different specific construct.

### Files (final shape depends on Step 1's empirical finding)

- Test: `app/src/components/chart/engine/ast/pineBoxCreateDrop.test.js` (new, written regardless of outcome)
- Modify (only if Step 1 confirms a narrow, in-scope construct — Branch A below): `app/src/components/chart/engine/ast/pine.js`
- Reference only: `mid_engagement__01-zeiierman-trend-pressure.pine`, re-fetched per Global Constraint 2 (`https://www.tradingview.com/script/SEdUWOIJ-Zeiierman-Trend-Pressure-Zeiierman/`, `sha256_source: 5c6d87f8e3c8a29f173a68f3d2081f246a41ec9b33c8d2935d0642c41663c8cb`)

### Interfaces

- Consumes: `valueRef(node, slot)` and the `create` branch in `buildObjectProgram` (unchanged signatures).
- Produces: depends on Step 1's finding — see Step 3.

- [ ] **Step 1: Confirm the diagnosis empirically against the real fixture, exactly as Tasks 1 and 3 did**

```bash
# Re-fetch and verify per Global Constraint 2, save to a local gitignored path.
grep -n "box\.new\|type \|=>" <verified-copy-path> | head -50
```

Extract the box's `box.new(left, top, right, bottom, ...)` call and its geometry arguments' declarations into a minimal standalone script, then run it through `translatePine(src, {strict:true})` directly (the exact method that made Tasks 1 and 3's diagnoses definitive) and read `t.objectDiagnostics.dropReasons['create:box']` alongside `t.notes`/`t.refusals` (which carry every refusal raised during the walk) to find the specific guard that fired.

**Branch A — the failing argument is a bare UDT field read (`instance.field`) or a directly-inlinable user-function call whose only obstacle is that `valueRef`/`resolveTree` does not currently walk into it, and the underlying value is an ordinary numeric/series expression once unwrapped one level.** Narrow, in-scope. Implement Step 3 Branch A.

**Branch B — the failing argument genuinely depends on multi-field `type` state, a UDT method, or anything requiring general UDT execution (not merely reading one already-computed field).** Out of scope for the same reason `ta.supertrend` is (Task 3): not "the resolver doesn't unwrap one construct," but "this needs UDT execution support," a materially larger undertaking than this plan authorizes. Implement Step 3 Branch B — still a real deliverable (an honestly-scoped, correctly-diagnosed finding), not a non-outcome.

Do not guess between these; Step 1's read decides it.

- [ ] **Step 2: Write the test**

If Branch A:

```js
// app/src/components/chart/engine/ast/pineBoxCreateDrop.test.js
//
// Diagnosed against the real fixture mid_engagement__01-zeiierman-trend-
// pressure.pine (Step 1): the single box.new(...) call's [ARGUMENT NAME]
// reads [EXACT CONSTRUCT CONFIRMED IN STEP 1], which valueRef/resolveTree
// could not unwrap.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'

describe('⭐⭐ a box create resolves a geometry argument through [CONSTRUCT]', () => {
  it('a box whose [top/bottom/etc.] reads [the confirmed construct] no longer drops create:box', () => {
    const t = translatePine(`//@version=6
indicator("t4", overlay=true)
[MINIMAL REPRODUCTION EXTRACTED FROM THE VERIFIED FIXTURE IN STEP 1 -- write
 it out in full here, matching the real shape found, not a placeholder]
`, { strict: true })
    expect((t.objectDiagnostics.dropReasons || {})['create:box']).toBeUndefined()
    const ops = (t.objects && t.objects.ops) || []
    expect(ops.some((o) => o.k === 'create' && o.family === 'box')).toBe(true)
  })
})
```

If Branch B: write the analogous message-correction test Task 3 Step 1 uses, asserting `dropReasons['create:box']` is unchanged (still `1` — this is honestly not a fix to the drop itself) but that the confirmed guard/construct is recorded precisely for Task 5's close-out notes.

- [ ] **Step 3, Branch A: Implement the narrow unwrap**

Extend `valueRef`'s `node.type === 'name'` case (which already unwraps a bound plain-name expression via `openName`) or the general resolver's member-access handling — whichever Step 1 shows is the actual gap — following the exact pattern `openName` uses: open one level, recurse into `resolveTree`/`valueRef` on the opened node, never invent a value. Do not write this before Step 1 has named the exact node shape.

- [ ] **Step 3, Branch B: Implement the honest-scoping deliverable**

Confirm precisely (via Step 1's instrumentation) which single guard is swallowed (near-certainly `pine:type` or `pine:function-def`). If it cleanly matches Task 3's precedent (a single, named, structurally-hopeless construct), apply the same message-correction pattern, scoped to that one construct. If the construct is too script-specific to name generically, leave the existing generic sentence as-is (it already names the true reason, unlike Task 3's `pine:tuple` case) and record the exact confirmed guard and node shape in this plan's own completion notes for Task 5, so a future UDT-execution wave has a real, evidenced starting point.

- [ ] **Step 4: Run and verify**

```bash
cd app && npx vitest run src/components/chart/engine/ast/pineBoxCreateDrop.test.js
```

- [ ] **Step 5: Run the object-model regression suite**

```bash
cd app && npx vitest run src/components/chart/engine/ast/objectCorpus.test.js src/components/chart/engine/ast/doorScorecard.test.js
```

- [ ] **Step 6: Commit**

```bash
git add app/src/components/chart/engine/ast/pineBoxCreateDrop.test.js
# plus app/src/components/chart/engine/ast/pine.js only if Branch A applied
git commit -m "$(cat <<'EOF'
pine objects: diagnose the dropped create:box in mid_engagement__01-
zeiierman-trend-pressure

[Branch A: names the exact construct found and unwrapped -- e.g. "a box's
top/bottom geometry read a user-defined-type field (<TypeName>.<field>),
which valueRef/resolveTree did not unwrap before this fix. Extended [X] to
open one level exactly as openName already does for a plain bound name.
create:box no longer fires for this shape."]

[Branch B: "Confirmed via instrumentation against the real fixture that
this script's single box.new(...) call's [argument] reads [confirmed
construct], the same pine:type/pine:function-def-class obstacle already
refusing this script's plots. Requires UDT execution support this plan
does not scope (see Task 3's ta.supertrend precedent for the same class
of finding). Recorded rather than silently left unfixed: [exact guard +
node shape], for a future wave."]
EOF
)"
```

---

## Task 5: Re-run the parity-set measurement, close out the gap register, and record before/after against the same metric C3B-CLOSE used

### Why this is the completion criterion, not a new one

The C3B-CLOSE doc measured this gap with `tools/c0_visual_journey.py` against `tests/fixtures/oos2_parity`, reporting two independent, never-added columns: `CHART_DRAW_AND_REOPEN` and `objects painted` (real, non-transparent pixels, read via `getImageData` on the layer's own canvas). This task re-runs the identical tool against the identical fixture set, on a fresh isolated sandbox, so this plan's own progress is measured the same way the gap was found.

### Files

- None created or modified except this plan document's own completion notes and the gap register.
- Reads: `tools/c0_visual_journey.py`, `tools/_gj_launch_backend.py` (re-confirm flags via `--help` first), `tests/fixtures/oos2_parity/`.

- [ ] **Step 1: Re-materialize the fixture set**

Per `tests/fixtures/oos2_parity/README.md`'s own "To re-materialise" section: copy each of the ten members' `.pine` from `tests/fixtures/pine_oos/` into `tests/fixtures/oos2_parity/` under the same name, re-fetching and SHA-256-verifying any withheld one against `docs/superpowers/specs/universal-indicator-ecosystem/OOS_2_PARITY_SET.json`'s authoritative `source_url`/`sha256_source` per member. Tasks 3 and 4 already did this for two of the six withheld members.

```bash
ls tests/fixtures/oos2_parity/*.pine | wc -l   # must read 10 before proceeding
```

- [ ] **Step 2: Launch a fresh, isolated sandbox backend**

```bash
python tools/_gj_launch_backend.py --port 18772
# confirm the actual flag/default against --help first; never reuse a running
# backend or a browser profile — the C3A measurement problem this tool's own
# history names as a defect class to avoid.
```

- [ ] **Step 3: Run the measurement**

```bash
python tools/c0_visual_journey.py --base http://127.0.0.1:18772 \
       --fixtures tests/fixtures/oos2_parity --out tools/c3b_geometry_gaps_close
```

- [ ] **Step 4: Record the before/after table, using the same two columns C3B-CLOSE used**

| # | script | CHART_DRAW_AND_REOPEN (before → after) | objects painted (before → after) | note |
|---|---|---|---|---|
| 1 | `high_engagement__10-rsi-divergence-faytterro` | ✅ → [fill in] | ⛔ no object layer → [fill in] | Task 1: `loopBlocked` corrected 6→0. Expect **no change** to objects-painted — RISK-043's guard mechanism, correctly, still blocks the 6 real creates (`guard:create`); this is not a bug this plan fixes |
| 2–6, 9–10 | (not targeted by this plan) | — → [fill in] | — → [fill in] | record for completeness only |
| 3 | `high_engagement__16-klinger-volume-oscillator-everget` | ⛔ IMPORT_BLOCKED → [fill in] | — | `pine:state` family — out of scope |
| 7 | `mid_engagement__01-zeiierman-trend-pressure` | ✅ → [fill in] | ⛔ no object layer → [fill in] | Task 4: record the confirmed Branch A/B outcome |
| 8 | `mid_engagement__05-supertrend-fibonacci-ote` | ✅ → [fill in] | 🟡 0 objects → [fill in] | Task 3: refusal wording corrected. Expect **no change** to objects-painted (`ta.supertrend`'s recurrence remains unimplemented, out of scope) |

Also record: the vendor-capture re-check from Task 2 Step 3 (before: `droppedOps:1, dropReasons:{"guard:create":1}`; after: expect `0`); the full test suite's totals line from the last regression run; and the headline honesty sentence this plan's own findings require — **most of the objects-painted column will not move**, because two of the three named causes (RISK-043's guard mechanism, `ta.supertrend`'s missing recurrence) turned out to be correctly-standing or out-of-scope rather than bugs, and the third (Task 4) may turn out the same way. The value delivered is: an honest `loopBlocked` diagnostic, a resolvable `last_bar_index` column (closing H8), a correctly-worded `ta.supertrend` refusal, and — either way — a precise, evidenced diagnosis of `create:box`, none of which were true before this plan, independent of whether the parity-set's paint count itself moves.

- [ ] **Step 5: Close out the gap register**

In `docs/superpowers/specs/universal-indicator-ecosystem/` (re-verify the current filename per the top-of-plan re-verification discipline — as of this writing `C3B_CLOSE_LIVE_VENDOR_AND_PARITY.md` §6 and `ENDZONE_GAP_REGISTER.md` both carry gap rows):

- **H8**: closed by Task 2 — cite the commit.
- **H7 (modulo)**: correct the register to say DONE, citing `pine.modulo.test.js` (10/10 green) — it was already implemented before this plan and the register had not been updated.
- General `pine:tuple` destructuring: correct any register language suggesting this is unimplemented — `pine.tuples.test.js` (35/35 green) and this plan's own empirical object-coordinate proof (Task 3) both predate this plan's own work and should be cited, not re-derived by a future reader.
- `ta.supertrend`'s missing recurrence (Task 3) and Task 4's confirmed finding: add both as explicit, named, unauthorized-for-this-plan pointers.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-09-19-pine-geometry-grammar-gaps.md docs/superpowers/specs/universal-indicator-ecosystem/
git commit -m "$(cat <<'EOF'
pine geometry grammar gaps: parity re-measurement and gap-register close-out

Re-ran tools/c0_visual_journey.py against tests/fixtures/oos2_parity on a
fresh sandbox, the same tool and fixture set C3B-CLOSE used, and recorded
CHART_DRAW_AND_REOPEN / objects-painted before/after per script -- never
added into one number.

Closed H8 (last_bar_index). Corrected the register's stale H7 (modulo)
and general pine:tuple entries to DONE. Recorded the ta.supertrend
recurrence gap and Task 4's finding as explicit, unauthorized-for-this-
plan pointers.
EOF
)"
```

---

## Self-Review

**Spec coverage:** all three originally-named causes (loop-boundary, `pine:tuple`, `create:box`) have a task each, each corrected against what this plan's own research and the coordinator's parallel research empirically found rather than what the spec doc assumed. H8 has a task. The separately-decided fold-door ruling was investigated and explicitly, evidentially ruled out rather than silently dropped or blindly implemented. The final re-measurement uses the spec doc's own metric and columns, never a new one.

**Placeholder scan:** every implementation step contains real, current-tree-verified, in several cases *empirically executed and confirmed* code rather than a description of what to do. The two tasks whose exact fix depends on an unread, licence-withheld fixture (Task 4, and Task 3's confirmation step) say so explicitly and branch on the empirical finding rather than asserting an untested fix, per this plan's own brief.

**Type/interface consistency:** `objectDiagnostics.loopBlocked`/`.dropReasons` (Tasks 1, 2, 3, 4) are read consistently, with exact shapes confirmed by direct execution, across every task that touches them. `PINE_TO_CLOCK_SPELLING`/`CLOCK_EXTENT`/`compute_clock` (Task 2) match the JS/Python parity contract exactly as already applied in this worktree, verified rather than assumed.
