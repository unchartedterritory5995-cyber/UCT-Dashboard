# RESUME: landing train 1 (`land/pine-engine-train-1`), PARKED

> ⛔ Remove this file (and `docs/pine/landing-train-1/`) in the commit that opens the train PR.
> Parked 2026-11-15 before a PC restart. No regression has been run on the combined tree yet.

## What the train is
Five finished engine branches landed as ONE engine number with ONE before/after regression run.
Each branch already passed its own focused rails and mutants; their builders own their content.
Merge commits only, no force, conflicts resolved by keeping BOTH sides' rules.
COND-TA (`fix/pine-engine-cond-ta`, worktree `eng-condta`) is NOT in the train: it lands first as
engine 58, so the train takes **59** (= master + 1 at push; re-check at push).

## Inputs

| # | branch | head the train takes | state at park |
|---|---|---|---|
| 1 | `land/pine-engine-hl-cbc` (#1332 + #1333, engine HL + CBC-FMT) | `5d5003c34eacddaace3c776795d8468b3a2a47ee` | **IN** (merge `49ebc0b470`, clean, no conflicts) |
| 2 | `fix/pine-engine57-builtins` (#1294, supertrend / stoch / RCI) | PENDING: its builder pushes a frozen head after its 54 mutants (local head was `8c8945b258`, origin `fe9140a2f5`) | not merged |
| 3 | `fix/pine-engine56-values-v2` (#1265-v2, bool-na, ties, pivots, percentrank, rising/falling) | PENDING: local branch in `C:/Users/Patrick/uct-worktrees/eng56`, builder finishing roots + python (head was `389c81bcb2`) | not merged |
| 4 | `fix/pine-engine-colour-reader` (#1330 + B4 nested iff/switch colour reader) | PENDING (local head was `26f9342a2e`, origin `1d173f426c`) | not merged |
| 5 | `fix/pine-engine-legacy-semantics` (n, v1 barssince, v2/v3 carry, object defaults, arrays) | PENDING: Part B in progress, local in `eng-legacy` (head was `f9240dcc1e`) | not merged |

Base: `origin/master` `f95e46af88` (engine 57). When COND-TA merges, `git merge origin/master` into
the train FIRST, then take the pending inputs. Take each head from the coordinator's report, never
from a moving worktree; confirm with `git -C <wt> log -1` / `git rev-parse origin/<branch>`.

Phase-A evidence per input (read each branch's EVIDENCE.md):
- hl-cbc: `docs/pine/evidence/2026-11-15-engine-hl-holes/EVIDENCE.md`, `docs/pine/evidence/2026-11-15-cbc-fmt/EVIDENCE.md`.
  Coordinator: 15 vitest files 666 passed / 7 skipped; Python focused + AST conformance 444 / 5 skipped; mutants 3/3 killed.
- eng57: `docs/pine/evidence/2026-11-14-engine57-builtins/EVIDENCE.md` (52 mutants killed; harness both lanes
  0 MATCH->DIVERGE; scoped census 0 guard changes). Open note 5: it must rebase after the colour engine
  (`dual-supertrend-ichimoku-and-dmi` colour) and move engine 55's dark-plot census rail subject (note 4; done in `8c8945b258`).
- eng56: `docs/pine/evidence/2026-11-14-engine56-values/EVIDENCE.md`. ⚠️ Its census + harness tables were
  measured at `86dc5eeb5d`; it says they are OWED on the final head. The train's one regression is that measurement.
- colour: `docs/pine/evidence/2026-11-14-engine58-colours/EVIDENCE.md` + `docs/pine/evidence/2026-11-15-colour-reader-b4/EVIDENCE.md`.
- legacy: `docs/pine/evidence/2026-11-15-legacy-semantics/EVIDENCE.md`.

## Conflict map (previewed with `git merge-tree` on the heads at park; re-preview on the frozen heads)
Every input conflicts in `scriptEngineVersion.js`: ONE new number (59), every branch's history
line(s) under it (replace each `NUMBER PENDING =` / `57 =` / `58 =` prefix of the incoming lines with
the single `59 =` line, keep every sentence), `export const SCRIPT_ENGINE_VERSION = 59` once.

- **eng56** (hardest; real semantic overlap with engine HL):
  - `ast/interpret.js` `FINITE_WINDOW.highestbars/lowestbars`: HL made them `na: NA.FINITE, arg: true`
    (offset in BARS over holes, `rolling(series, n, reduce, policy, arg)`); eng56 added `reduceNewest`
    + `holdsTie` and still passes `naCurrent` (`rolling(..., naCurrent)` on its base). Keep HL's
    window (`NA.FINITE`, `arg: true`, HL's `rolling` signature) AND eng56's `reduceNewest` / `holdsTie`;
    `windowFnNewest` must call `rolling(..., FINITE_WINDOW[name].na, FINITE_WINDOW[name].arg === true)`.
    Check eng56's `windowArgExtreme(…, newest)` against HL's index mapping under `arg: true` (HL counts the
    offset in bars across holes; the newest-tie walk must use the same mapping). Ask eng56's owner if unsure.
  - `ast/interpret.js` masks list + `TableRefusal` sentences: keep `windowHoleMask` AND `boolNaMask` +
    `argExtremeTieMask`; keep `'window-extreme:left-edge'` AND `BOOL_NA_UNWITNESSED` / `TIE_UNWITNESSED` sentences.
  - `api/services/ast_interpret.py`: keep `window_hole_mask` AND the `(bool_na_mask, arg_extreme_tie_mask)`
    loop; keep `_HOLE_*`/`window_hole_mask` AND `_WITNESS_*`/`_witness_mask` definitions.
  - `ast/pineRuntimeFrontend.js`: union of imports (`declarationCalcBars` + `neverNaBoolNamesOf, isBoolishTree`;
    `literalTostringText…` import kept; `naConditionIsFalse` vs eng56's `pineNaConditionIsFalse`: check which
    name exists after the merge and keep every caller working); union of sentence table entries; keep HL's
    comment AND eng56's `BOOL_NA_UNWITNESSED || TIE_UNWITNESSED` decline.
  - `__tests__/vendorHarness/ourSide.js`: chain both labels (`window-extreme:` -> 'a window over `na` gaps',
    `pine:` -> 'a value (engine 56 per-bar witness)').
  - `ast/periodAnchorParity.test.js`: exclude both prefix sets (`window-extreme:`, `arg-extreme:`, `pine:`).
- **eng57**: `ast_interpret.py` (both masks: `window_hole_mask` and `builtin_witness_mask`), `interpret.js`
  (both sentence groups; the mask doc comment names both), `pineRuntimeFrontend.js` (union imports
  incl. `STOCH_FLAT_WINDOW, STOCH_LEFT_EDGE, RCI_LEFT_EDGE`; union sentence table; keep HL comment AND the
  `STOCH_FLAT_WINDOW` decline).
- **colour**: `pineRuntimeFrontend.js` import union (`declarationCalcBars` + `isLegacyPineVersion`);
  `docs/pine/vendor-harness/capture-queue.json`: regenerate (`python tools/vendor_harness/evidence_engine.py queue --write`, then `queue --check`).
- **legacy**: `pineRuntimeFrontend.js` import union + sentence-table union (`LITERAL_TOSTRING_UNCAPTURED` AND
  `'pine:fn-history-in-block'`); `capture-queue.json` regenerate as above.
- After all merges: regenerate anything generated (`docs/formulas/GRAMMAR.md`, `tools/lookback_agreement.json`
  via its rail, host-parity digests) and re-run `queue --check`, `evidence_engine.py pins --check`.

## The regression (step C): ONE before/after on the combined tree
Tools (copies committed in `docs/pine/landing-train-1/`, live copies in the session scratchpad
`C:/Users/Patrick/AppData/Local/Temp/claude/6c61ec7db4c79b74/269630a0-d11b-41f6-8959-ec8ae95a9506/scratchpad/TRAIN1/`):
`sources.py` (census input, built ONCE from the train head), `census.train.test.js` + `vitest.train.config.mjs`
(four doors + the member door's served columns on RDDT 1D listing bars, on and off the listing; `TRAIN_LANE=0`
production / `1` runtime-on, the harness's own flag stubs), `measure.sh TAG [c0 c1 f0 f1 h0 h1]` (one heavy-lock
hold per run, RAM gate >= 6 GB, maxWorkers = clamp(floor((freeGB-6)/1.5),1,4)), `held_dirs.txt` (the held store:
every `uct-vendor-batch/runs/*/captures` except `admit-grade`, `regrade-*`, `licence-moved-*`), `cmp.py BEFORE AFTER`
(the moves; exit 1 on any capture that becomes DIVERGE), `record_train.py` (service_smoke launcher).
If the coordinator's sharded census/harness runner has landed (byte-identical to serial), use it instead.
⚠️ `census.train.test.js` has NEVER RUN: the 6-source dry run was queued behind the heavy lock and
stopped at park. Dry-run it first, both lanes, on a subset (`sources.tiny.json`: 3 repo + 3 held sources,
`TRAIN_IN=$T/sources.tiny.json`), and read one output row before the full run. `measure.sh` and `cmp.py`
are untested too. The harness half of `measure.sh` uses the stock `vendorHarness.corpus.test.js`, as
every engine builder did.

```bash
T=C:/Users/Patrick/AppData/Local/Temp/claude/6c61ec7db4c79b74/269630a0-d11b-41f6-8959-ec8ae95a9506/scratchpad/TRAIN1
W=C:/Users/Patrick/uct-worktrees/train-1
# (if the scratchpad is gone: mkdir -p $T && cp $W/docs/pine/landing-train-1/* $T/)
# 0. at the final train head (all five in, master re-merged), freeze the inputs:
git -C $W checkout land/pine-engine-train-1
python $T/sources.py                                  # -> $T/sources.json
rm -rf $T/fixtures && cp -r $W/tests/fixtures/vendor $T/fixtures   # the SAME capture set for both sides
BASE=$(git -C $W merge-base HEAD origin/master)       # = origin/master at the train's base
# 1. AFTER
bash $T/measure.sh after
# 2. BEFORE = the base tree itself (reuse $T/before-$BASE if it already exists for this exact sha)
git -C $W checkout --detach $BASE && bash $T/measure.sh before-$BASE
git -C $W checkout land/pine-engine-train-1 && git -C $W status --short   # must be clean
# 3. diff + gate (0 MATCH->DIVERGE, 0 new DIVERGE); attribute EVERY move to a branch
python $T/cmp.py before-$BASE after
```
Attribution: each move is attributed by what it reads (supertrend/stoch/rci -> eng57; highest/lowest/
highestbars/lowestbars holes, calc_bars_count, str.tostring -> hl-cbc; colours/transp/palette/iff/switch
colour -> colour; `n`, v1 barssince, v2/v3 carry, object defaults, arrays -> legacy; bool na, ties, pivots,
percentrank, rising/falling, v1/v2 self-declaration -> eng56) and checked against that branch's own EVIDENCE
move list. If needed, grade the moved captures alone on the branch's own worktree
(`VENDOR_HARNESS_DIR=<dir of the moved captures>`). Any move no branch explains: STOP and report.

## Then (D, E, F)
- D: the union of the five branches' focused rails (`git diff --name-only $BASE...<head>` per input, test files),
  the section 8 list `python -m pytest tests/test_pine_runtime_*.py -q -p no:cacheprovider`, and
  `node --test services/pine_runtime/test/*.test.mjs`; pytest one file at a time; vitest under the lock.
- E (number last): set 59 (= master + 1 at push); `node tools/pine_runtime_host_parity.mjs --write` then
  `--check`; service_smoke re-record per commit `3ce7585ee3`'s message with `$T/record_train.py`
  (Node 20.20.2, heavy lock), then a plain smoke PASS 4/4.
- F: push, ONE PR listing each branch, its evidence and its attributed census/harness moves; THEN close
  #1265, #1294, #1330, #1332, #1333 with a pointer to the train PR. Do NOT merge.
