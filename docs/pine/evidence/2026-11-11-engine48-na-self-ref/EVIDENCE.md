# Engine 48: `x = na(x[k]) ? na : U` refuses `pine:cycle` by name, in both lanes

Branch `fix/pine-engine48-na-self-ref`, on origin/master `9d5e0847b8` (engine 47).
Source of the defects: `dsk/reviews/LANE2-r1r3.md` N1 and N3 (and `LANE2.md` N1), outside the repo.

## What changed
- `pine.js` (the `throughBinding` self-reference branch): a declaration whose seed is Pine's `na`
  and whose test is a bare history read (`naSeededSelfReference`) now throws
  `PineRefusal('pine:cycle', REFUSALS['pine:cycle'] + ' — ' + naSeededSelfReferenceSentence(name, version))`
  before the seed/update fold. It used to return the constant `na` on v3+ (engine 46) and fall
  through to the `accum` fold on v1/v2.
- The runtime lane resolves through the same `Resolver`, so the host (screen and pane
  translations), the runtime lane and the member door all refuse with the same sentence.
- `naSeededSelfReferenceSentence` (exported, one wording for both lanes):
  - v3+: "`x` reads its own history inside its own declaration. This does not compile in Pine
    v3+: a variable cannot refer to itself in its own declaration, so TradingView draws nothing
    for this script and nothing is drawn here. In v3+ the variable is declared once and updated
    with `:=`"
  - v1/v2 and no pragma: "`x` is `na` whenever its own previous value is `na`. Pine v1/v2 (and a
    script with no `//@version`) does not state what `x`'s history reads before the first bar:
    read as `na`, `x` is `na` on every bar; read as 0, the update runs from the first bar. The two
    answers differ on every bar and no TradingView capture has settled which one it draws, so
    neither is drawn"
  - Both follow the lead sentence `REFUSALS['pine:cycle']` ("this Pine name is defined in terms of
    itself"). `editorStatus.js` files `pine:cycle` under the "language" family.

## Why a refusal, not a withhold
- v3+: TradingView does not compile the spelling, so there is no TradingView value. A drawn
  all-`na` column was a silent blank.
- v1/v2: the answer turns on W34-I4b's unpinned fact (`x[k]` before bar 0: `na` or 0). The
  listing pass's candidates (seed, update(U, na), zero) did not include the ternary under
  `na`-history, so for an update that forgets its seed they agreed from bar 1 on the 0-history
  value, and the host served it. Capture row W34-I4-S1 already asks the question.
- Withholding every bar would draw the same blank column with no reason attached.

## Behaviour, before and after (probe: host listing / host off-listing / runtime listing / runtime off-listing)
| spelling | v1 (no pragma), v2 before | v3, v5 before | after (all versions, all four) |
|---|---|---|---|
| `x = na(x[1]) ? na : (close<3000 ? close : x[1])` | host listing and runtime listing: na, then close from bar 1; off-listing: all na | all na | refused `pine:cycle` |
| `x = na(x[1]) ? na : x[1] + 1` | screen translation refused `pine:state`; runtime: all na (pane translation not probed before) | all na | refused `pine:cycle` |
| `x = na(nz(x[1])) ? na : U` (control) | unchanged | unchanged | unchanged |
| `y = na(y[1]) ? 7.0 : U` (control) | unchanged | unchanged | unchanged |
| `b = 0.0; b := c ? close : nz(b[1])` (control) | unchanged | unchanged | unchanged |

LANE2-r1r3 N4 (`na(nz(x[1]))`, "runtime serves all na"): not reproduced. Built with the same
options (`historyFromListing` for both), the runtime lane equals the host bar for bar (v2: na, then
close; v3/v5: close from bar 0). Off-listing both lanes draw na on the 12-bar probe. The likely
source of the reviewer's "all na" is a runtime build without `historyFromListing` compared with the
host's listing pass (not confirmed: the reviewer's probe file was deleted). No code change. Note
that this spelling, like a stated seed `y = na(y[1]) ? 7.0 : U`, does not compile on TradingView in
v3+ either, and is still served there: a pre-existing leniency outside this change (below).

## Corpus
0 scripts use the spelling: `rg -P '\b(\w+)\s*=\s*na\(\s*\1\s*\[\s*\d+\s*\]\s*\)\s*\?\s*na\b'` over
`corpus/`, `tests/fixtures/` (464 `.pine` files plus the harness capture sources) and the
licence-held sample (414 files) finds none.

## Engine bump: yes (48)
Member-served output changes (a drawn column becomes a named refusal), and translator output changes.
- `scriptEngineVersion.js`: history line + `SCRIPT_ENGINE_VERSION = 48`.
- hostParity, Node 24.13.1: `--write` 166 cases, identity-only (script_engine 47 -> 48; every case's
  status, guards and warmup unchanged; bars hashes unchanged); `--host node --check` HP-1 GREEN
  166/166; `--mutation-control` HP-4 GREEN (perturbed bundle red on 35 cases).
- `tests/fixtures/pine_runtime/service_smoke.json` re-recorded against a local engine-48 service
  (127.0.0.1:18948, Node 20.20.2, `--experimental-permission --allow-worker
  --disallow-code-generation-from-strings`, pool with the L4 self-test, canary on, throwaway
  secret; stopped afterwards). `--record` PASS 4/4, then plain smoke PASS 4/4 (engine 48/1/1,
  canary green, digest 4cba0c804f59, unsigned 401). On Windows the boot went through a private
  launcher that hands `main({ pool: SERVICE_POOL_OPTIONS })` an env of PORT, the secret and PATH,
  because MSYS injects MSYSTEM/SYSTEMROOT/WINDIR, which the env allowlist refuses.

## Rails and mutation proof
`ast/b0NaSeed.test.js`: the engine-46 constant-na test and the r1 `ns.some(...)` assertion are
replaced by refusal pins; a new block runs 3 spellings (forgets, counter, `x[2]` lag) x 6 pragmas
(none, 2, 3, 4, 5, 6) through the screen translation, the pane translation (`strict`), the runtime
build (`pane`, `historyFromListing`) and `memberPaneDefinition`, and requires guard `pine:cycle` and
one identical message from all of them; the wording is pinned once in full; controls (stated seed,
`na(nz(x[1]))`, the v3+ mutable form) still translate in both lanes.

Mutations (private script; copy, exact-string edit, run b0NaSeed + listingSeed, restore from the
copy, restored blob verified equal to HEAD's; `git status` clean after):

| mutant | result |
|---|---|
| C0 control: no-op comment in the guard line | GREEN 59/59 |
| M1 refusal off (guard never fires) | KILLED (24 failed) |
| M2 refuse only v1/v2 (N3 regresses) | KILLED (17 failed) |
| M3 refuse only v3+ (N1 regresses) | KILLED (7 failed) |
| M4 engine-46 behaviour restored | KILLED (24 failed) |
| M5 guard `pine:cycle` -> `pine:state` | KILLED (24 failed) |
| M6 sentence branches swapped | KILLED (19 failed) |
| M7 `naSeededSelfReference` true for any `na()` test (review A3) | KILLED (2 failed) |

## Runs (Node 20.20.2 unless stated, every heavy run under heavy_lock, maxWorkers 1)
- Whole engine folder `src/components/chart/engine` (ast, runtime, `__tests__` incl. vendorHarness):
  977 files passed, 24 skipped; 18115 tests passed, 175 skipped; 0 failed.
- Service suite: Node 20 `node --test services/pine_runtime/test/*.mjs` 141/141 pass; Node 24
  `node --test "services/pine_runtime/test/**/*.mjs"` 142/142 pass. (Node 20's `--test` does not
  expand the `**` glob.) `tools/pine_runtime_closure.mjs --check` host-neutral.
- pytest: test_script_engine_version_gate, test_saved_script_prebump,
  test_pine_runtime_engine_identity, test_pine_runtime_composition, test_pine_runtime_service_smoke,
  test_pine_runtime_deploy_gate, test_pine_runtime_dockerfile: 176 passed.
- Vendor harness corpus, runtime ON (`VENDOR_HARNESS_RUNTIME_ON=1`, 336 captures):
  before (9d5e0847b8) MATCH 163 / DIVERGE 46 / INCONCLUSIVE 127; after MATCH 163 / DIVERGE 46 /
  INCONCLUSIVE 127; `verdicts.json` byte-identical.

## Open (not this change)
- v3+ still serves other self-referencing declarations that TradingView does not compile (a stated
  seed `y = na(y[1]) ? 7.0 : U`, `na(nz(x[1]))`). A v3+ refusal for every self-reference in a
  declaration would be the consistent rule; it needs its own census before it moves any column.
- LANE2-r1r3 N2 (unstamped legacy documents) and N4's v2 PLAIN bar-0 asymmetry are untouched.

## Logs
`C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/runs/eng48/` (hlog-base/tip, harness-base/tip,
hp-*.log, mut-*.log, mut-results.json, suite-engine.log, service-node20/24.log, smoke-*.log).
