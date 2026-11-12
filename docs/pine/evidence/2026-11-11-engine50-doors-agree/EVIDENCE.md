# Engine 50: the four doors agree on a v3+ self-referencing declaration

Branch `fix/pine-engine50-doors-agree`, on `22836e479c` (origin/master, engine 49).
Sources of the defects (outside the repo): review `ENG49-1122` notes 1, 2, 3, 4 and 6; review
`ENG48-1096` notes 2 and 3; review `OZ-STACK-LAND` N-2.

## The rule (unchanged from engine 49)
Pine v3 removed self-reference in a declaration: a variable must be declared before it is read, so
`s = nz(s[1]) + close` does not compile in v3+ (it is written `s = 0.0` then `s := nz(s[1]) + close`).
v1/v2 (and a script with no `//@version`) compile it. Engine 49 refused every such v3+ declaration
`pine:cycle` by name, but only where the host lane's `Resolver` resolved the binding; the runtime
lane asks at the statement. So in four v3+ shapes the doors disagreed (review ENG49-1122 notes 1-3
and 6), and in three of them the screen, the pane and the member door drew a script TradingView
does not compile:

1. a binding read only through an argument (`color=`);
2. a marked declaration nothing reads, at the top level or in a function body;
3. a variable named after an earlier user function (`x(a) => a * 2` / `x = nz(x[1]) + 1`): Pine keeps
   variables and functions in separate namespaces (which is why `atr = atr(14)` is legal in v4), so
   `x[1]` reads a variable nothing declared. The host env held the function under `x`, so engine 49
   did not mark the declaration;
4. a block-valued declaration whose block reads its own history (`x = if …` / `x = switch …`):
   served by every door (`if`), or `pine:block` in the host and served by the runtime lane (`switch`).

## What changed
- `pine.js`
  - The host walk RECORDS every v3+-refusable self-referencing declaration where it is written
    (`ctx.selfDeclarations`, on the walk's own `ctx` and the contexts spread from it; the harvest
    folds and the text-loop unroll build their own, so a re-fold over a partial env records nothing).
    After the walk, in v3+ only (`!listingSeedIsUnpinned(version)`), the first in source order is a
    HARD refusal (`hardRefusals`, the mechanism a `strategy()` declaration uses): the whole script
    refuses `pine:cycle` with the one v3+ sentence, read or not. This is review option (a), refusing
    at the declaration site, done after the walk so no fold changes.
  - `declaredAsVariable(env, name)`: "declared before" for the host counts a binding that is not a
    function (`kind: 'fn'`, or an opaque `isFunction` one). Note 3.
  - `blockDeclarationReadsOwnHistory(stmts, i, name)`: the block-valued detector (note 6), asked by
    both lanes. True when the declaration's `if` condition, `else if` conditions, arms (the whole
    `if`/`else` chain) or `switch` subject/arms read `name[k]`. Conservative: a block that declares
    `name` itself anywhere (an inner `name = …`, typed or `var`, a tuple, a loop counter) is left
    alone (its `name[k]` may read the inner one); a field read is not a read of `name` (`p.x` lexes as
    one name; `g(close).x[1]` and `a[0].x[1]` put the field after a `.`); `name[]` is not a read; a
    built-in name is never asked (`PINE_BUILTIN_VARIABLE_NAMES`). The host records it at both
    declaration sites (the top-level walk and `foldStatements`), only when `name` is not declared
    before as a variable.
  - The `Resolver` branch engine 49 added still speaks for a resolved binding, with the same sentence.
- `pineRuntimeFrontend.js`
  - The block-valued check before the slot is declared (this lane declares the slot BEFORE it lowers
    the arms, so the arm's `x[1]` read the slot and the script was drawn). A `var`/`varip` keeps its
    own path. "Declared before" is the lane's scope chain, env and `guardOuter`, as engine 49's.
  - `v3SelfDeclarationRefusal`: engine 49's statement refusal, now marked `selfDeclaration`, so a
    function DEFINITION no longer defers it to a call (R2 step 5 defers a body this lane cannot
    compile until something calls it; a self-declaration is a body Pine does not compile, and the host
    walk refuses it called or not). Engine 48's v1/v2 refusal is not marked.
- `runtimeColumns.js` (OZ N-2): the `runtime:objects` WITHHELD reason is a fixed sentence for an error
  with no `guard` (`runtimeObjectsWithheld`, `RUNTIME_OBJECTS_STOPPED_REASON`); the raw text goes to
  `detail`, which no member surface reads. A named refusal keeps its own sentence.
- `scriptEngineVersion.js`: 49 -> 50, history line.

The v3+ sentence is engine 49's, unchanged (`REFUSALS['pine:cycle']`, then):

> `x` reads its own history inside its own declaration. This does not compile in Pine v3+: a
> variable cannot refer to itself in its own declaration, so TradingView draws nothing for this
> script and nothing is drawn here. In v3+ the variable is declared once and updated with `:=`

It names no spelling and is true of each shape above.

## Census (step 1, before any behaviour changed)
Engine 49's private census script, extended (never committed), over the same four sets:
- `corpus/`: 266 `.pine` (all v3+);
- the repo's other `.pine` (`tests/fixtures`, `tools/`, `docs/pine`, the host-parity corpus): 573
  (554 v3+, 19 v1/v2 or no pragma);
- the vendor capture sources (`tests/fixtures/vendor/**` JSON with `source.text`): 353 (all v3+);
- the licence-held sample (`_resume-2026-11-01/pine-sample`, outside the repo): 413 (353 v3+, 60 v1/v2
  or no pragma).

1. Syntactic, scope-aware (engine 49's scan, with user FUNCTION names now kept in their own namespace
   so a declaration named after one is counted, and block-valued `x = if/switch` declarations whose
   block reads `x[k]` counted by kind). v3+ declarations in any of the four new shapes (an argument-only
   reader or an unread one are simply marked declarations, so they are inside engine 49's count; a
   function-name collision; a block-valued self read): **0 in every set**. All v3+ self-reading
   declarations of any kind: **0** (the scan's other v3+ hits are 2 bare same-name reads in an `if`
   and 2 tuple names declared before, in one sample file each, none a history read). v1/v2 and no
   pragma: 3 fixture files (8 declarations) and 13 sample files (35 declarations), the same as engine
   49's count, untouched by design.
2. Engine outcomes: every one of the 1605 sources through the screen translation, the pane
   (`strict`), `buildRuntimeIr` (pane, `historyFromListing`) and `memberPaneDefinition`, on the
   engine-49 blobs of `pine.js` and `pineRuntimeFrontend.js` and on this change. Guard per door and the
   runtime and door messages (first 160 characters): **0 differences**. So no script graded MATCH by the
   vendor harness can become refused, and no v1/v2 row moved, in any real source.
   - The base ran WITHOUT swapping the working tree: a temporary test file `vi.mock`ed `./pine.js`
     and `./pineRuntimeFrontend.js` to copies of the engine-49 blobs (so every importer, the member door
     included, got engine 49). Control: the same mock over the behaviour probe below reproduced the
     swap-the-files measurement exactly (444 rows, guards and full messages, equal), and differs from
     engine 50.

## Behaviour (guards: screen / pane / runtime / door; "all X" = the same at every door)
Measured with a private probe (444 rows: 74 shapes x pragmas none, 2, 3, 4, 5, 6) on the engine-49
blobs and on this change. v3, v4, v5 and v6 are the same in every row; none and v2 are the same.

### The shapes engine 50 makes agree
| shape | v1/v2, none (before = after) | v3+ before (engine 49) | v3+ after |
|---|---|---|---|
| note 1: `c = close > open ? color.green : nz(c[1], color.red)`, `plot(close, color=c)` (and typed `color c = …`) | all OK | OK / OK / pine:cycle / OK | all pine:cycle |
| note 2: `x = nz(x[1]) + 1`, `plot(close)` | all OK | OK / OK / pine:cycle / OK | all pine:cycle |
| note 2: function local nothing reads, `f(s) => x = nz(x[1]) + s; s` | all OK | OK / OK / pine:cycle / OK | all pine:cycle |
| note 2: `if` statement local nothing reads | all OK | OK / OK / pine:cycle / OK | all pine:cycle |
| note 2: an unread `y = nz(y[1]) + x(close)` after a function `x` | all OK | OK / OK / pine:cycle / OK | all pine:cycle |
| function nothing calls, `f(s) => x = nz(x[1]) + s; x`, `plot(close)` | OK / OK / runtime:statement / OK | all OK | all pine:cycle |
| note 3: `x(a) => a * 2`, `x = nz(x[1]) + 1`, `plot(x)` (and a block-bodied `x(a) =>`) | pine:state / OK / OK / OK | pine:state / OK / pine:cycle / OK | all pine:cycle |
| note 3: the same, `plot(close)` | all OK | OK / OK / pine:cycle / OK | all pine:cycle |
| note 3: the same with `y = x(close)` read before | pine:state / pine:state / OK / pine:state | pine:state / pine:state / pine:cycle / pine:state | all pine:cycle |
| note 6: `x = if close > open` / `nz(x[1]) + 1` / `else` / `0.0` (also typed, in the `else` arm, unread, in a function) | all OK | all OK | all pine:cycle |
| note 6: a nested `if` reading `x[2]` | pine:state / pine:state / OK / pine:state | same | all pine:cycle |
| note 6: `x = switch` / `close > open => nz(x[1]) + 1` / `=> 0.0` (and in a function) | pine:block / pine:block / OK / pine:block | same | all pine:cycle |
| note 6: `x = switch m` with a subject | pine:state / OK / OK / OK | same | all pine:cycle |

Every v3+ "after" refusal carries the ONE v3+ sentence in the screen, pane and runtime lanes (the probe
compares the full messages; the rail compares them too), and the member door shows guard
`pine:cycle`. The refusal's line is the declaration's in all three lanes (railed).

### Engine 49's spellings and controls: unchanged
All 14 engine-49 spellings (stated seed, `na(nz(x[1]))`, warm-up, function locals, typed, `x[n]`, inside
a `request.security` argument, the reassigned form, …) are `all pine:cycle` in v3+ before and after with
the same sentence, and keep their engine-49 paths in v1/v2. All 36 controls are unchanged in every
pragma, among them: the `x = 0.0` + `x := …` form, `var`, `varip`, `var x = nz(x[1]) + 1`
(`pine:undefined`, untouched), a different variable, every shadowing control of engine 49, a tuple,
a bare `x = x + 1`, built-in names (`hl2`, an unread `vwap`, `close = close[1] + 1`), and the engine-50
ones: a block-valued declaration of a name declared before, a function local shadowing a global with a
block value, a block reading another name, a block that declares `x` inside itself, `var x = if …`,
`x := if …`, `"x[1]"` in a string, a call's history `sma(close, 5)[1]` in a block, a `switch` reading
`close[1]`, a loop counter, `atr = atr(14)`, `sma = sma(close, 5)[1]`, a mutable variable named after a
function (`float x = 0.0`, `x := …`), and a parameter named after a function.

### ENG48-1096 notes 2 and 3
- Note 2 (the warm-up `U`): with the `na` seed, `x = na(x[1]) ? na : x[1]*0.9 + sma(close,5)*0.1`
  (`ta.sma` for v5) refuses `pine:cycle` at all four doors with ONE sentence in every pragma (none, 2,
  3, 5, 6): the runtime lane's engine-48 check sits before its conditional-history wall. `b0NaSeed`
  now pins the runtime lane's guard AND message (it asserted only "not null"). The STATED-seed warm-up
  (`na(x[1]) ? 0.0 : …`) is the case that still differs, in v1/v2 only: the screen, pane and member
  door draw it (the spelling compiles there) and `buildRuntimeIr` refuses
  `runtime:conditional-history`, a wall of its own; pinned as such, not called one sentence. In v3+ it
  refuses `pine:cycle` at every door.
- Note 3 (the v1/v2 wording): already fixed by engine 48's review commit `3e0043d966` ("The two
  readings can disagree"; "its own earlier value, as its `na()` test reads it", true of any `x[k]`),
  and pinned in full by `b0NaSeed` ("the wording, pinned once in full"). Not changed here; mutant W1
  below proves the rail holds it.

### ENG49-1122 note 4 (the built-in exclusion set)
Already railed by engine 49's review commit `565ecd2cfd`: the rail iterates
`PINE_BUILTIN_VARIABLE_NAMES` (imported, not copied) asserting
`selfReferencingDeclaration(rhs('nz(N[1]) + 1'), N, false)` is false and v5 == v2 at four doors, plus a
floor of the 26 names the set exists for. Re-proved here: mutant X4 (`'vwap'` removed) is killed.

### OZ N-2
- `runtimeColumns.js` WITHHELD path, guard `runtime:objects`: an unnamed error now reads
  "None of this script's drawings are shown on this chart: working them out stopped at a step this
  engine could not complete, so none are drawn rather than some of them. Its plots are drawn." (the
  plain run that follows succeeded, so the plots are drawn). The raw text is in `detail`. Railed end to
  end: an unnamed `TypeError` injected into the object run's build (`vi.mock` of `buildRuntimeIr`, first
  call only) reaches this path through `computeRuntimeColumns`.
- The host stop wording "a history read x[-1]": OZ r3 (`96a418f59b`) already writes the offset as the
  script does (`[n]`), with no rail; `objectHistoryRead.test.js` now pins
  "a history read `[-1]` on bar 5 is a future bar — TradingView stops the script there" (mutant O3).

## Rails and mutation proof
- `ast/v3SelfDeclaration.test.js`: engine-50 blocks — 16 shapes x v3-6 plus 3 `switch` shapes x v5-6 at
  four doors with one message; the refusal's line in three lanes; the same 16 shapes at none/v2 keep
  their engine-49 guards and never say the v3+ sentence; 14 controls x 6 pragmas; both detectors asked
  directly (`blockDeclarationReadsOwnHistory`: an arm, an `else if` condition, a `switch` arm, another
  name, three field spellings, an inner declaration, a tuple, a built-in, `:=`, a non-block;
  `declaredAsVariable`: a function, an opaque function, a variable, an opaque variable, missing, null).
- `ast/b0NaSeed.test.js`: the warm-up rails above.
- `runtime/__tests__/runtimeObjectsWithheldPlain.test.js` (new) and `__tests__/objectHistoryRead.test.js`.

Mutations: private script (engine 49's method): copy the file, exact CRLF-aware edit, run the five
files above (514 tests), restore from the copy (never `git checkout`); after every restore the file
equalled the copy and `git hash-object` equalled the committed blob.

| mutant | edit | result (of 514) |
|---|---|---|
| C0 control | no-op comment on the post-walk refusal | GREEN 514/514 |
| N1 | post-walk refusal off | KILLED (59) |
| N2 | post-walk refusal in every version (gate dropped) | KILLED (52) |
| N3 | the `foldStatements` mark site records nothing | KILLED (12) |
| N4 | the top-level mark site records nothing | KILLED (17) |
| N5 | `declaredAsVariable` counts a function as a variable | KILLED (18) |
| N6 | `foldStatements` block-valued check off | KILLED (6) |
| N7 | top-level block-valued check off | KILLED (25) |
| N8 | block detector: a block declaring `x` itself not excluded | KILLED (5) |
| N9 | block detector: a field read after `.` not excluded | KILLED (1; survived 514/514 first, see below) |
| N10 | block detector: the `else` chain not read | KILLED (5) |
| N11 | top-level block check ignores "declared before" | KILLED (4) |
| R7 | runtime block-valued check off | KILLED (31) |
| R8 | runtime defers a self-declaration in a definition again | KILLED (4) |
| R9 | runtime block check ignores "declared before" | KILLED (8) |
| R10 | runtime engine-48 `na`-seeded check off (the warm-up rail) | KILLED (10) |
| O1 | `runtimeObjectsWithheld` publishes the raw message | KILLED (2) |
| O2 | the call site builds the old raw payload | KILLED (1) |
| O3 | host history-read wording names a placeholder `x[…]` | KILLED (1) |
| W1 | v1/v2 sentence back to "differ on every bar" (ENG48 note 3) | KILLED (1) |
| X4 | `'vwap'` removed from the exclusion set (ENG49 note 4) | KILLED (5) |

N9 survived its first run: `p.x[1]` lexes as ONE identifier (`p.x`), so the field case in the rail never
reached the check. The fields that do put a `.` before `x` (`g(close).x[1]`, `a[0].x[1]`) are now asked
directly (commit `1d18abf89d`), and N9 is killed.

## Runs
Every heavy run went through the machine-wide heavy lock (a small private wrapper around
`heavy_lock.heavy()` polling every 50 ms, because another session's render loop re-took the lock inside
the CLI's 2 s poll for over an hour), vitest `--maxWorkers=1`, Node 20.20.2 unless stated. Free RAM
before each heavy run: 12.3-14.5 GB.
- Focused (`v3SelfDeclaration`, `b0NaSeed`, `listingSeed`, `runtimeObjectsWithheldPlain`,
  `objectHistoryRead`): 5 files, 514/514.
- Whole folders `engine/runtime/__tests__`, `engine/__tests__` and `engine/ast`, final code (head of the
  code commits): **903 files passed, 1 failed, 24 skipped; 16288 tests passed, 1 failed, 175 skipped**
  (92 min). The one red: `vendorHarness.h1Ratchet` "behind the curtain: every bar drawn is
  TradingView's…" timed out at vitest's 15 s under the long run's load (the file took 38 s there); run
  alone on the same tree it passes 10/10 (that test 5.7 s). A timeout, not an assertion; nothing in it
  reads a self-referencing declaration.
- Beyond the three folders, every other test file that reads the engine version or a self-reference
  (the 44 `engine/*.test.js*`, `builder/memberPane/`, `editorStatus`, `PineEditorStatus`,
  `scriptSourceSave`, `useUserDefinitions.upgrade`): 86 files, 2040 passed, **1 failed**:
  `div4RuntimeReadPaint` "a v3 script is not lifted" used `trend = … nz(trend[1], 1)` in a `//@version=3`
  fixture read only through `barcolor` — an engine-50 shape (note 1), which TradingView does not compile.
  Fixed like engine 49's fixtures: the v3 spelling Pine compiles (`trend = 0`, `trend := …`); every
  assertion of the test unchanged (the paint withheld `paint:colour`, the runtime colour present, the door
  ok, no `runtimeColours`); the file then 41/41. A scan of every other test file under `app/src` for a
  v3+ declaration reading its own history found none outside the three folders run above.
- Service suite: Node 24.13.1 `node --test "services/pine_runtime/test/**/*.mjs"` 142/142; Node 20.20.2
  `node --test services/pine_runtime/test/*.mjs` 141/141 on four runs and 140/141 on one earlier run
  whose failing test was not captured (not reproduced in four re-runs; recorded, not explained).
  `tools/pine_runtime_closure.mjs --check`: 91 modules, host-neutral (0 findings), watch coverage 98/98.
- pytest: `test_script_engine_version_gate`, `test_saved_script_prebump`,
  `test_pine_runtime_engine_identity`, `test_pine_runtime_composition`,
  `test_pine_runtime_service_smoke`, `test_pine_runtime_deploy_gate`, `test_pine_runtime_dockerfile`:
  176 passed.
- hostParity, Node 24.13.1: `--write` 166 cases. JSON diff against the engine-49 file, dropping every
  `digest` and `script_engine`: equal. Raw: 167 leaves moved, 166 `digest` values and
  `identity.script_engine` 49 -> 50. `--host node --check`: HP-1 GREEN 166/166. `--mutation-control`:
  HP-4 GREEN (the perturbed bundle is red on 35 cases).
- `tests/fixtures/pine_runtime/service_smoke.json` re-recorded against a local engine-50 service
  (127.0.0.1:18950, Node 20.20.2, `--experimental-permission --allow-fs-read=<worktrees> --allow-worker
  --disallow-code-generation-from-strings`, the pool with the L4 self-test, canary on; a throwaway secret
  that lived only in the launcher process; boot `engine=50/1/1 bundle=399a53b6ce99 workers=24`).
  `--record` PASS 4/4, then plain smoke PASS 4/4 (engine 50/1/1, canary green, digest c79fd38dc0ad,
  unsigned 401). JSON diff against the engine-49 file, dropping `digest` and `script_engine`: equal.
  The service was stopped afterwards (its PID no longer exists).
- Vendor harness, runtime ON (`VENDOR_HARNESS_RUNTIME_ON=1`), `tests/fixtures/vendor` (369 captures;
  runtime lane reached 106, drew 38, declined 68): before (the three engine files swapped to their
  `22836e479c` copies, then restored from saved copies and checked equal) MATCH 181 / DIVERGE 48 /
  INCONCLUSIVE 140; after MATCH 181 / DIVERGE 48 / INCONCLUSIVE 140; `verdicts.json` byte-identical.
  No MATCH became a refusal.

## Engine bump: yes (50)
Member-served output changes (v3+ scripts in the shapes above, drawn at engine 49 by the screen, the
pane and the member door, now refuse by name) and a member-visible sentence changes (OZ N-2). None of
the 1605 census sources moves.

## Not proven / open
- No TradingView capture of any of these shapes exists; the rule rests on the Pine v3 migration guide
  (self-referenced variables removed) and the v3+ "undeclared identifier" compile error, as engines 48
  and 49 did. The namespace rule for note 3 rests on Pine's separate function and variable namespaces
  (`atr = atr(14)` compiles in v4, witnessed by the corpus), not on a capture of `x(a)` + `x = nz(x[1])`.
- Loop bodies still split, as before engine 50 (unchanged, census 0): `for i = 0 to 2` / `y = nz(y[1]) + i`
  (and `while`) is drawn by the screen, the pane and the door and refused `pine:cycle` by the runtime
  lane in v3+; in a function body the host says `pine:block`. The host folds a loop body with its own
  context (the text-loop unroll) or not at all, so its declarations are never recorded. Left alone: it
  needs a scope model of the loop body that this change did not want to add beside the walk's.
- A block that declares its own name inside itself (`x = if c` / `x = close` / `x[1]`) is left alone on
  purpose (the detector's conservative exclusion); its doors are unchanged (pine:state / pine:state / OK
  / pine:state).
- `x = switch …` in v3/v4 now refuses `pine:cycle`; `switch` does not exist before v5, so TradingView
  refuses those scripts for that reason too. The sentence stays true (the declaration does read itself);
  not railed below v5.
- A variable declared, then a function of the same name, then `x = nz(x[1]) + 1` would now be refused:
  the host env keeps only the latest binding of a name, so the function hides the earlier variable from
  `declaredAsVariable`. Pine rejects redeclaring a variable in one scope anyway; census count 0.
- `runtime:failed` (the VM's own stop, `runtimeColumns.js` RF) still embeds the stopping error's text in
  parentheses, by design for the collection errors that word their own reason, but also for a JS
  exception or an `ObjectRunError` reaching the VM (measured: "this script stopped on bar 1 of 300 when
  drawn bar by bar (Cannot read properties of undefined (reading 'x')), …"). Outside OZ N-2's stated
  path; not changed here.
- The engine-49 open items not about the doors (review note 5's v3+ `:=` SuperSmoother refusing
  `pine:state`, MUTABLE binding coverage in the v1/v2 runtime twin, LANE2-r1r3 N2/N4) are untouched.

## Logs
`C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/runs/eng50/` (census-*.json/log, probe-*.json,
probe-diff.txt, mut-*.log, mut-results-*.json, hlog-base/tip, harness-base/tip, hp.log, smoke-*.log,
suite-clean.log, extra.log). The private scripts (census, probe, mutation, harness and smoke drivers)
are beside them in `eng50-scratch/`, outside the repo.
