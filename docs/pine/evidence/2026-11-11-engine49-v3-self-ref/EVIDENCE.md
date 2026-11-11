# Engine 49: a v3+ declaration that reads its own history refuses `pine:cycle` by name, in both lanes

Branch `fix/pine-engine49-v3-self-ref`, on `8f775b6ce4` (the head of PR #1096, engine 48).
Source of the defect: review `ENG48-1096` note 4 (and the engine-48 EVIDENCE "Open" list, N4),
plus N2 for the runtime lane's warm-up wall. Both outside the repo.

## The rule
Pine v3 removed self-reference in a declaration: a variable must be declared before it is read, so
`s = nz(s[1]) + close` does not compile in v3+ (it is written `s = 0.0` then `s := nz(s[1]) + close`).
v1/v2 (and a script with no `//@version`) compile it. Engine 48 refused one spelling,
`x = na(x[k]) ? na : U`, in every version. Every other self-referencing declaration was still drawn
in v3+, while the engine-48 v3+ sentence told members that no such script compiles.

## What changed
- `pine.js`
  - `selfReferencingDeclaration(node, name, declaredBefore)`: the one detector. True when the
    initialiser reads `name[k]` (`k` any expression), `name` was not declared before (the caller's
    answer), and `name` is not a built-in variable (`close = close[1] + 1` may read Pine's own
    `close`; not settled, so not refused). A bare self read (`x = x + 1`) is not a history read and
    keeps `pine:undefined`, which is TradingView's own error for it.
  - `selfReferenceSentence(name, version)`: engine 48's `naSeededSelfReferenceSentence`, renamed
    because its v3+ branch is now the sentence for every caught spelling. No second phrasing.
  - `markSelfDeclaration` at the two host declaration sites (the top-level walk and
    `foldStatements`, which folds function bodies and blocks). It asks the detector of the env the
    declaration was written in (`declEnv`), so a local that shadows a global, a function
    parameter, an earlier declaration of the same name, a `var` (its own branch) and a tuple (its
    own branch) are never marked.
  - `Resolver.resolveBindingInner`: a marked binding refuses `pine:cycle` in v3+
    (`!listingSeedIsUnpinned(version)`) BEFORE its initialiser is resolved, so no other wall and no
    recurrence fold speaks first. Engine 48's `na`-seeded branch below it is now reached only by
    v1/v2 and no pragma.
- `pineRuntimeFrontend.js`: the same detector in the ordinary-binding arm, before the env/slot
  decision and before the initialiser is lowered. "Declared before" is this lane's scope chain,
  its env (an inlined body's parameters live there) and `guardOuter` (the root scope a function
  body reads through). Engine 48's runtime twin (`naSeededSelfDeclaration`) stays for v1/v2.
- `scriptEngineVersion.js`: 48 -> 49, history line.
- Rails: `ast/v3SelfDeclaration.test.js` (new); `b0NaSeed.test.js` and `listingSeed.test.js` rows
  that used a v5 stated seed or `na(nz(x[1]))` as a CONTROL now use v2 (those spellings do not
  compile in v5), and the v5 rows assert the refusal. Three other test files used a v3+ self-reference
  as a fixture of the accumulator fold or asserted its old refusal (see Runs); each moved to v2 or to
  the new guard.

The v3+ sentence (lead `REFUSALS['pine:cycle']`, "this Pine name is defined in terms of itself", then):

> `x` reads its own history inside its own declaration. This does not compile in Pine v3+: a
> variable cannot refer to itself in its own declaration, so TradingView draws nothing for this
> script and nothing is drawn here. In v3+ the variable is declared once and updated with `:=`

It names no spelling, so it is true of each one caught. The v1/v2 sentence (engine 48's, for the
`na`-seeded spelling only) is unchanged.

## Census (step 1, before any refusal was written)
A private scratch script (never committed) ran over:
- `corpus/`: 266 `.pine` (all v3+);
- the repo's other `.pine` files (`tests/fixtures`, `tools/`, `docs/pine`, the host-parity corpus):
  573 (554 v3+, 19 v1/v2 or no pragma);
- the vendor capture sources (`tests/fixtures/vendor/**` JSON with `source.text`): 353 (all v3+);
- the licence-held sample (`_resume-2026-11-01/pine-sample`, outside the repo): 413 (353 v3+, 60
  v1/v2 or no pragma).

Two measurements:
1. Syntactic, scope-aware (lexed with `lexPine`/`blockStatements`; scopes for globals, function
   bodies with their parameters, `if`/`else`/`switch`/`for`/`while` blocks and loop counters; a
   comma-joined line's first segment only; named arguments and same-named function calls not
   counted). v3+ `=` declarations that read their own history with the name not declared before,
   excluding `var` and tuples: **0** in every set. Rejected candidates, all scanner artefacts on
   inspection: same-named v4 function calls (`atr = atr(14)`, `rsi = rsi(src, len)`: every
   bare-read hit of the first pass), a comma-joined line
   (`label L = label.new(…), label.delete(L[1])`, one corpus file), a mis-split block (one sample
   file); `var` self-reads (excluded by rule). v1/v2 and no pragma: 3 fixture files (8 declarations)
   and 13 sample files (35 declarations), unchanged by design.
2. Engine outcomes: every one of the 1605 sources through the screen translation, the pane
   (`strict`) translation, `buildRuntimeIr` (pane, `historyFromListing`) and
   `memberPaneDefinition`, on `8f775b6ce4` (the three engine files swapped to its blobs, then
   restored) and on this change. Guard per door, and the runtime and door messages (first 160
   characters): **0 differences**. So no script whose vendor-harness verdict is MATCH becomes refused
   (the premise holds; the harness run below confirms it on the captures). The same four doors do
   move for every v3+ spelling in the behaviour table, so the instrument can see a change.

## Behaviour (guards: screen / pane / runtime / door; "all X" = the same at every door)
Measured with a private probe on `8f775b6ce4` and on this change. v3+ is the same at 3, 4, 5, 6.

| spelling or control | v1/v2, none: before | v1/v2, none: after | v3+ before | v3+ after |
|---|---|---|---|---|
| `x = na(x[1]) ? na : x[1] + 1` (engine 48) | all pine:cycle | unchanged | all pine:cycle | all pine:cycle (engine-49 check first, same sentence) |
| `x = na(x[1]) ? 7.0 : x[1] + 1` (stated seed) | pine:state / OK / OK / OK | unchanged | pine:state / OK / OK / OK | all pine:cycle |
| `x = na(nz(x[1])) ? na : x[1] + 1` | pine:state / OK / OK / OK | unchanged | pine:state / OK / OK / OK | all pine:cycle |
| `x = na(x[1] + 0) ? na : x[1] + 1` | pine:state / OK / OK / OK | unchanged | pine:state / OK / OK / OK | all pine:cycle |
| `x = nz(x[1]) + close` | pine:state / pine:state / OK / pine:state | unchanged | all pine:state | all pine:cycle |
| `x = close > nz(x[1]) ? close : nz(x[1])` | all OK | unchanged | all OK | all pine:cycle |
| warm-up, stated seed: `x = na(x[1]) ? 0.0 : x[1]*0.9 + sma(close,5)*0.1` | OK / OK / runtime:conditional-history / OK | unchanged | OK / OK / runtime:conditional-history / OK | all pine:cycle (N2) |
| warm-up, `na` seed (engine 48 N2) | all pine:cycle | unchanged | all pine:cycle | all pine:cycle |
| function local `f(s) => x = nz(x[1]) + s` | pine:state / pine:state / OK / pine:state | unchanged | same | all pine:cycle |
| function local, stated seed | pine:state / pine:state / OK / pine:state | unchanged | same | all pine:cycle |
| `x = nz(x[1]) + 1` then `x := x * 2` | all OK | unchanged | all OK | all pine:cycle |
| control `x = 0.0`, `x := nz(x[1]) + 1` | pine:state / pine:state / OK / pine:state | unchanged | same | unchanged |
| control `float x = na`, `x := na(x[1]) ? 7.0 : x[1] + 1` | pine:state / OK / OK / OK | unchanged | same | unchanged |
| control `var float x = 0.0`, `x := nz(x[1]) + 1` | pine:state / pine:state / OK / pine:state | unchanged | same | unchanged |
| control a different variable `x = nz(y[1]) + 1` | all OK | unchanged | all OK | unchanged |
| control global `x`, function local `x = nz(x[1]) + s` (shadowing) | pine:state / pine:state / OK / pine:state | unchanged | same | unchanged |
| control global `var x` (a runtime slot), function local shadows it | all OK | unchanged | all OK | unchanged |
| control global `var x`, then top-level `x = nz(x[1]) + 1` | pine:state / pine:state / OK / pine:state | unchanged | same | unchanged |
| control `x = close`, then `x = nz(x[1]) + 1` (same scope) | pine:state / OK / OK / OK | unchanged | same | unchanged |
| control parameter `f(x) => x = nz(x[1]) + 1` | pine:state / OK / OK / OK | unchanged | same | unchanged |
| control parameter, body lowered with slots | pine:state / pine:state / OK / pine:state | unchanged | same | unchanged |
| control parameter read by another local | all OK | unchanged | all OK | unchanged |
| control block local shadowing a global | pine:state / OK / runtime:conditional-history / OK | unchanged | same | unchanged |
| control loop counter redeclared in the body | pine:block / pine:block / runtime:conditional-history / pine:block | unchanged | same | unchanged |
| control tuple `[a, b] = f(nz(a[1]) + close)` | pine:tuple / pine:tuple / pine:undefined / pine:tuple | unchanged | same | unchanged |
| control bare `x = x + 1` | all pine:undefined | unchanged | all pine:undefined | unchanged |
| control built-in name `hl2 = nz(hl2[1]) + 1` | pine:state / OK / OK / OK | unchanged | same | unchanged |

Every v3+ "after" refusal carries the one sentence above in the screen, pane and runtime lanes (the
rail compares the message, not just the guard); the member door shows guard `pine:cycle`.

ENG48 N2: the generalised check runs before the runtime lane's `runtime:conditional-history` wall
(it sits before the initialiser is lowered), so in v3+ every door now agrees on `pine:cycle` for a
warm-up update, stated seed or `na` seed. In v1/v2 the stated-seed warm-up keeps its runtime
`runtime:conditional-history` (the spelling compiles there; its host path is unchanged).

## Rails and mutation proof
`ast/v3SelfDeclaration.test.js` (164 tests):
- 11 spellings x pragmas 3, 4, 5, 6 x doors (screen, pane `strict`, `buildRuntimeIr`,
  `memberPaneDefinition`): guard `pine:cycle` and one identical message;
- the v3+ wording pinned in full;
- the same 11 spellings at no pragma and v2: each door's guard equals its engine-48 value, and no
  message carries the v3+ sentence;
- 16 controls x 6 pragmas (none, 2-6): each door's guard equals its engine-48 value;
- the detector asked directly (history read, declared before, bare read, another name, a built-in).

Mutations (private script: copy the file, exact-string edit, run `v3SelfDeclaration` + `b0NaSeed` +
`listingSeed` (245 tests), restore from the copy, never `git checkout`; after each restore the file
equalled the copy and `git hash-object` equalled `HEAD`'s blob; `git status` clean at the end):

| mutant | edit | result (of 245) |
|---|---|---|
| C0 control | no-op comment on the host check | GREEN 245/245 |
| M1 | host refusal off (`false &&`) | KILLED (38 failed) |
| M2 | host refuses every version (version gate dropped) | KILLED (23 failed) |
| M3 | top-level declaration site not marked | KILLED (30 failed) |
| M4 | `foldStatements` site (function bodies, blocks) not marked | KILLED (8 failed) |
| M5 | detector ignores "declared before" | KILLED (33 failed) |
| M6 | built-in name exclusion off | KILLED (5 failed) |
| M7 | host marker ignores its env | KILLED (28 failed) |
| R1 | runtime refusal off | KILLED (37 failed) |
| R2 | runtime refuses every version | KILLED (17 failed) |
| R3 | runtime "declared before" drops `scope.lookup` | KILLED (16 failed) |
| R4 | runtime "declared before" drops `env.has` | KILLED (12 failed) |
| R5 | runtime "declared before" drops `guardOuter` | KILLED (4 failed) |
| R6 | runtime says a second phrasing (`` `x` `` only) | KILLED (68 failed) |

R5 is held by the `shadowSlot` control alone (a global `var` the runtime lane keeps as a slot, shadowed
by a function local); R3 by `shadowSlotTop`, `paramMut`, `param` and `loopShadow`; M6 by `builtinName`
and the direct detector test; M4 by the function-local spellings.

## Runs
Node 20.20.2 unless stated; every heavy run under `heavy_lock`, vitest `--maxWorkers=1`; free RAM
13.4 GB at the start.
- Focused (`v3SelfDeclaration`, `b0NaSeed`, `listingSeed`): 3 files, 245/245.
- Whole engine folder `src/components/chart/engine`, first pass (code commit `71b5b39833`):
  973 files passed, 5 failed, 24 skipped; 18289 tests passed, 12 failed. The 12, and what was done:
  - `hostParity.rail` (2) and `hostParity.v8.rail` (1): the committed digests still carried engine 48;
    green (36/36) after `--write` below.
  - `pine.convergence` (7) and `thinkscript.selfref` (1): v4/v5 declarations that read their own
    history, used as fixtures of the accumulator fold (the SuperSmoother keystone, the
    `nz(x[1], seed)` block, the thinkScript same-tree comparison). They do not compile in v3+ and now
    refuse `pine:cycle`; the fixtures are v2, where Pine compiles them and the fold is what is graded.
  - `w34I4SelfReference` (1): "v3 and later are untouched … the host refusal stands" asserted
    `pine:state`; the v3+ refusal is now `pine:cycle` by name.
- Whole engine folder, final tree (`863658a8f0`): **978 files passed, 24 skipped; 18301 tests passed,
  175 skipped, 0 failed** (69 min).
- Service suite: Node 24.13.1 `node --test "services/pine_runtime/test/**/*.mjs"` 142/142; Node 20
  `node --test services/pine_runtime/test/*.mjs` 141/141. `tools/pine_runtime_closure.mjs --check`:
  91 modules, host-neutral (0 findings), watch coverage 98/98.
- hostParity, Node 24.13.1: `--write` 166 cases. JSON diff against the engine-48 file, dropping every
  `digest` and `script_engine`: equal. Raw: 166 `digest` values and `identity.script_engine` 48 -> 49
  (`columnDigest.js` folds the engine into the digest input); no parity case uses a caught spelling,
  and every case's status, guards and warmup are unchanged. `--host node --check`: HP-1 GREEN
  166/166. `--mutation-control`: HP-4 GREEN (the perturbed bundle is red on 35 cases).
- `tests/fixtures/pine_runtime/service_smoke.json` re-recorded against a local engine-49 service
  (127.0.0.1:18949, Node 20.20.2, `--experimental-permission --allow-fs-read=<worktrees> --allow-worker
  --disallow-code-generation-from-strings`, pool with the L4 self-test, canary on, throwaway secret
  deleted afterwards; boot `engine=49/1/1 bundle=2f310471ee34 workers=24`). `--record` PASS 4/4, then
  plain smoke PASS 4/4 (engine 49/1/1, canary green, digest 0296d4408f27, unsigned 401). JSON diff
  against the engine-48 file, dropping `digest` and `script_engine`: equal. On Windows the boot went
  through the same kind of private launcher engine 48 used (an env of PORT, the secret and PATH only).
  The service was stopped by its Windows PID afterwards.
- pytest: `test_script_engine_version_gate`, `test_saved_script_prebump`,
  `test_pine_runtime_engine_identity`, `test_pine_runtime_composition`,
  `test_pine_runtime_service_smoke`, `test_pine_runtime_deploy_gate`, `test_pine_runtime_dockerfile`:
  176 passed.
- Vendor harness, runtime ON (`VENDOR_HARNESS_RUNTIME_ON=1`), default directory `tests/fixtures/vendor`
  (369 captures; lane measured runtime-on, runtime lane reached 106, drew 38, declined 68):
  before (engine 48: `pine.js`, `pineRuntimeFrontend.js` and `scriptEngineVersion.js` swapped to their
  `8f775b6ce4` blobs, then restored from saved copies and checked equal to HEAD's blobs)
  MATCH 181 / DIVERGE 48 / INCONCLUSIVE 140; after MATCH 181 / DIVERGE 48 / INCONCLUSIVE 140;
  `verdicts.json` byte-identical. No MATCH became a refusal.

## Engine bump: yes (49)
Member-served output changes (v3+ columns that were drawn now refuse by name) and translator output
changes for those scripts. None of the 1605 census sources moves.

## Not proven / open
- No TradingView capture of a v3+ self-referencing declaration exists; the rule rests on the Pine
  v3 migration guide (self-referenced variables removed) and the v3+ "undeclared identifier"
  compile error, as engine 48's v3+ sentence did.
- Shadowing is excluded, not decided: whether Pine v4/v5 reads a shadowing local's `x[1]` as the
  outer `x` was not settled here, so those declarations keep their engine-48 paths (the host's
  `pine:state` or a translation).
- A declaration named after a built-in variable (`close = close[1] + 1`) is not asked, for the same
  reason.
- A block-valued declaration (`x = if … nz(x[1]) …` / `x = switch …`) is not covered: its binding is
  built by the if/switch fold, not the two marked sites. The census found none in v3+.
- A marked declaration whose value nothing reads is never resolved, so the host does not refuse it
  (nothing is drawn from it either). The runtime lane refuses at the statement regardless.
- The engine-48 open items not about this rule (MUTABLE binding coverage in the runtime twin for
  v1/v2, LANE2-r1r3 N2 and N4's v2 PLAIN asymmetry) are untouched.

## Logs
`C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/runs/eng49/` (census-*.json/log, probe-*.json,
mut-*.log, mut-results-*.json, suite-engine.log, service-*.log, hp-*.log, smoke-*.log,
pytest.log, harness-base/tip).
