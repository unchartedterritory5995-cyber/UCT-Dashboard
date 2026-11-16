# RESUME: landing train 1 (`land/pine-engine-train-1`, draft PR #1391), IN PROGRESS

> ⛔ Remove this file (and `docs/pine/landing-train-1/`) in the commit that takes the PR out of draft.
> Checkpoint 2026-11-16 (second session). All inputs merged; step D first pass done and attributed;
> NO census / harness regression measured yet; engine number NOT set.

## Coordinator rulings in force (they override the first park's text)
- Train number = master + 1 at push (expected **58**; re-read origin/master's `scriptEngineVersion.js` first).
- Frozen heads: eng57 `5b276cacb6`, eng56-v2 `e63532f7b6`, colour-reader `d2115c85e1` + review `968066d775`,
  legacy `f5676682b0`, hl-cbc `5d5003c34e`. Also merged: `origin/ci/pine-heavy-parallel` `20f93331e5`,
  `origin/master` `f5ea27f37a` (= BASE for the regression today: `git merge-base HEAD origin/master`).
- Step D roots run in the cloud (`pine-heavy.yml`; the PR event did not start it on the draft, dispatch it:
  `gh workflow run pine-heavy.yml --ref land/pine-engine-train-1`). Local: step C, mutants, smoke, host parity.
  vitest `--maxWorkers=2` when free RAM >= 12 GB. Wait 90 s after every heavy-lock release (`lock.sh` does).
- **na() fix (train-owned, attributed to eng56-v2):** the built-in `na(x)` is never `na` in the runtime
  bool-na rule (`pineRuntimeFrontend.js`: `canonNeverTree` + `never()` `EXPR.BUILTIN`). RS Rating's run half
  is minted again. Record under a train-owned heading in eng56's EVIDENCE.md.
- **`ta.rma` summation (train-owned sixth input):** `(prev * (n - 1) + src) / n`, bit-exact on 4,063 / 4,063
  TradingView values. `docs/pine/evidence/2026-11-16-rma-summation/EVIDENCE.md`. If label 437 of
  `vw-w3n-draw-block-history-c-spy` prints TradingView's text, NO waiver and `l4dDrawingHistory` keeps its
  original pin; if it still differs, go back to the coordinator.
- Baseline reuse: only a `before-<sha>` whose sha equals the merge-base AND whose capture set equals ours.

## Step D first pass (local, at `b5ac5b63df` + two pin fixes): 1,239 files
1,185 passed, 23 failed, 31 skipped; 22,797 tests passed, 42 failed. Bisect over the merge chain
(base `f5ea27f37a` green everywhere except one b1Paints pin the CI branch fixed):

| red file | first red at | cause | state |
|---|---|---|---|
| requestSeed (RS Rating acceptance) | eng56-v2 | runtime bool-na rule over `na(x) != true` | FIXED (na() fix) |
| runtime/l4dDrawingHistory (local-only) | hl-cbc | CBC-FMT tie rule + our rma 1 ulp off | rma change; re-run OWED |
| hostParity.rail, hostParity.v8.rail | hl-cbc | digests owed to step E (`--write`) | step E |
| runtimeDocumentRoundTrip | hl-cbc | door stamps `meta.calcBarsCount` | fixture rewritten by its writer |
| vendorHarness.c45BarIndex | hl-cbc | `calcBarsWindow.js` joins the roster | pinned |
| objectRuntime F3 | hl-cbc | `#,###` grouping is served (T20) | pinned; control line NOT YET VERIFIED |
| symbolRosterSpeaks | hl-cbc, legacy | 45 -> 47 refusal codes | pinned |
| textReassignedLocal | hl-cbc | `cells` 1 -> 0 | OPEN: a `PROBE` assertion is in the file, read its output, then pin |
| pine.roles, pine.corpus, screenerColumns | eng57 | `ta.stoch` is `stochPine` | pinned / rewritten |
| blockRunsParity, oosMeasuredBaseline, pineProbeReplay, b1Paints (3 transp), c37Theme, coverageAudit (2), rt6RuntimeColour (1) | colour-reader | colours | pinned / rewritten (CAP3 writer run) |
| editorStatus.families | colour-reader, review, legacy | four new guards | families + spec table |
| doorStamps, v3SelfDeclaration (5) | review | no-pragma + v4+ syntax refused `pine:version-missing` | fixture in v1 forms; controls pinned |
| capabilityEvidenceLane (7) | legacy | seven probes now drawn by the host lane | OPEN: `docs/pine/evidence/2026-11-13-capability-admission/runs/report.json` rows need the door's lane and today's verdicts (take them from the AFTER harness run) |
| coverageAudit (1), rt6RuntimeColour (1) | legacy | B7: the runtime door carries a `constant` row | pinned / rewritten |
| savedDocumentRoundTrip, periodAnchorParity, pine.guardCensus, engine58Review (legend), engine57 F5 | eng56-v2 / eng57 / legacy / master | see commits | done earlier |

Also seen, NOT classified: `tests/test_queue_dispositions.py` fails one assertion locally
(`w9-p1b-on-close-fills-nv@NYSE:RDDT@D` reads CAPTURED, the test wants QUEUED); check it on CI before touching.

## Findings to carry into the PR text
- F5b killed by a new rail; cause: `builtinWitnessMask` and `windowHoleMask` do not list `tf_merge` as a nested
  read (JS and Python), so the root also analyses such a site on the CHART's bars: over-withholding only
  (measured: 25 extra daily bars withheld in a weekly `ta.stoch` probe). NOT fixed, report it.
- eng57 mutants K11, R1-R9, X1-X3, F5b: 14 / 14 killed (rebuilt from EVIDENCE.md; runner in scratch).
- na() count: runtime PANE door `pine:bool-na-unwitnessed` 6 before / 6 after over 2,505 sources (0 cleared);
  run-half door after the fix: 37 sources mint a run half; the "before" run-half census (at `d4b1e8503a`) is OWED.
- na mutants: canonical entry killed; whole-program entry + two new subjects: re-run OWED (`mutNa.json`).
- rma mutants (`mutRmaJs.json`, `mutRmaPy.json`): NOT RUN yet. `tests/test_ast_rma_summation.py` 4 passed.

## NOT DONE, in order
1. Read job 9 (`rmaSummation`, `engine56Values`, `l4dDrawingHistory`, the label probe), finish the two OPEN
   pins, run the na / rma / legend mutants, commit, push, dispatch pine-heavy, fix what the cloud shows red.
2. Step C: `cp -r tests/fixtures/vendor <scratch>/fixtures`, `measure2.sh after`, then detach at BASE and
   `measure2.sh before`, `cmp2.py before after`, attribute every move (six inputs now).
3. Step E: number, `pine_runtime_host_parity.mjs --write` / `--check`, service smoke re-record (commit
   `3ce7585ee3`'s procedure), saved-document and golden fixtures that pin rma / atr / rsi doubles.
4. `queue --check`, `pins --check`, the five named pytest files, `check_repo_hygiene.py`; the six history
   lines under one number; real PR text; remove this file and `docs/pine/landing-train-1/`; out of draft is the
   coordinator's call. Do not merge; do not close #1265 / #1294 / #1330 / #1332 / #1333.

## Tooling (session scratchpad `.../07178e6c-.../scratchpad/TRAIN1/`, copies of the stable ones in
`docs/pine/landing-train-1/`)
`lock.sh` + `inlock.py` (one lock hold, one process per shard; `!@` runs a raw command from `app/`),
`mut.py SPEC.json OUT.json` (copy-aside mutants, control first), `measure2.sh after|before` (one hold per
step), `cmp2.py` (keys by full capture path; `cmp.py` keyed by basename and 28 held basenames repeat),
`rma_bits*.py` (the offline bit-exact table), scratch tests `probe`, `bisect`, `rtguard`, `rthalf`, `l4dprobe`.
