NEXT STEP: landing by the coordinator (engine 21 bump + W5 host-parity digest regeneration; hostParity.rail/.v8 red only for that). Nothing left for the lane.

# W6-T5 `array.*` completion (lane w6-t5)

Base: origin/master c04bdbe2c1 (tested-on-master). Spec: W6-BREAKDOWN T5 + section 3 (origin/docs/pine-w6-breakdown @1889bbedd7).
Worktree `C:/Users/Patrick/uct-worktrees/pine-dsk-w6t5`, branch `feat/pine-w6-t5-arrays`. Own measure-pair base
`C:/Users/Patrick/uct-worktrees/pine-dsk-w6t5-base` (detached at the merge-base; node_modules junction to mpbase2's).
Logs: `C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/runs/w6-t5/` (job1.*, job2.*, mp*.log, mp0/, mp1/), final-tip
`runs/w6-t5-final/`. Node 20.20.2 (`dsk/node20.sh`) for every vitest run.

**Engine bump: yes** (refusals become served values on the runtime pane; the coordinator bumps at landing).

## What changed
- `runtime/collections.js`
  - `W19R2_MEMBERS`: hand port of `794bfb02f3`'s collections half (no cherry-pick; its FE hunk is the gradient fill and is
    not ported). `array.fill(a, v[, from[, to]])`, `0 <= from <= to <= size`, `to` exclusive, `na` = end;
    `array.insert(a, i, v)`, `0 <= i < size`. Every other index stops by name (`… Q-W19R2a`).
  - `W6T5_MEMBERS`, each from its v6 reference entry (read 2026-11-06 through `tools/pine_survey/pine_reference_extract.js`;
    the JSON stays out of the repo; each rail cites one short sentence): `reverse`, `lastindexof`, `range` (max - min over
    the real elements, the measured RT7 min/max rule; `na` when none), `abs` (new array), `join` (text elements, explicit
    separator), `variance` / `stdev` / `covariance` (`biased` default true = divide by n; false = n - 1), `median`,
    `percentile_nearest_rank` (rank ceil(p*n/100), 0 < p <= 100), `sort` on real numbers (default ascending), v6 `every` /
    `some` (zero false). Empty arrays answer `na` where the entry says so.
  - `median` / `stdev` left `unmeasuredReduction` on the pane. `MASTER_AT_DOOR`: a run that carries `budget.unmeasured`
    (only `runtimeColumns.js::runtimeObjectValues`, the live C18 door) keeps master's answer word for word.
  - `READS_ALL` (unmeasured-fill guard) covers every new reading member and every array argument; `ARRAY_WRITES` classifies
    the new members (fill/reverse/sort `elements`, insert `size`, the rest `none`).
  - `DOOR_GATED_ARRAY` (exported): the members master did not hold.
- `ast/pineRuntimeFrontend.js`: `heldArray(name)` (review N2: this replaced the round-A `objectDoorRefuses` line): at the
  object door a `DOOR_GATED_ARRAY` member is not held, and all 7 front-end sites that ask "is this array member held?"
  use it, so the door refuses where master did with master's guard and sentence.
- Queue: `docs/pine/capture-queue-2026-11-06-w6.md` (Q-W19R2a/b ported, W6-A1 new). Probes:
  `tools/visual_conformance/probes/vw-w19r2-collections.pine` (ported byte-identical from the w19 branch),
  `vw-w6-array-members.pine` (new). `evidence_engine.py queue` parses all three as QUEUED with their charts; the committed
  `capture-queue.json` is NOT regenerated here (master's copy is already stale: it lacks the w34-d3 doc, and a regen moves
  76 -> 75 CAPTURED from other lanes' state), so the train regenerates it.

## Kept refused by name (each has a rail that reaches it)
- At build, `runtime:array`: `percentile_linear_interpolation`, `standardize`, `percentrank`, `mode`, `binary_search`,
  `binary_search_leftmost`, `binary_search_rightmost` (W6-A1 / Q-W19R2b).
- At run, `CollectionError` naming W6-A1: `na` in sort; text sort; numeric `join`; `join` with no separator; an `na`
  element in variance/stdev/covariance/median/percentile_nearest_rank/abs/every/some; unbiased over one element;
  covariance of different sizes; percentile outside (0, 100]; `lastindexof(a, na)`; every/some of an empty array or
  before v6. Insert/fill at the unsettled indices (Q-W19R2a). `array.slice` write-through: fill/reverse/sort/insert on a
  slice refuse (`guardSliceWrite`).

## Findings for the coordinator
1. `array.sort_indices` on TEXT, and its `na` sinking, are served on master (pre-W6: JS string order, `na` last). The spec
   lists text `sort_indices` as kept-refused; it is NOT changed here because the change would move the live C18 door.
   W6-A1 rows T05-T08, S03-S04 measure it.
2. `array.mode`'s entry does state a tie rule ("returns the smallest value"); kept refused per the spec (review B3), M01
   confirms it.
3. Master's HOST object lane draws a label from an array as built and ignores a later `array.fill` / `array.reverse` /
   `array.sort` statement (doorRun on master c04bdbe2c1: `fill` -> "586.915" = o+h+l+c, `reverse`/`sort` -> "144.14" =
   the open). A live silent wrong value, pre-existing, outside this lane (`pine.js`, W3). Pinned unchanged in
   `objectDoorGate.test.js`.
4. Licence note: the rails cite one short sentence per reference entry (the spec requires it); no reference JSON or
   script text is committed.

## Rails (red on master, green on the tip)
- New: `runtime/__tests__/w6ArrayMembers.test.js` (45 tests), `runtime/__tests__/w19r2Collections.test.js` (12, ported).
  Run on the master base c04bdbe2c1 (`runs/w6-t5/job1-redmaster.log`): `Tests 41 failed | 16 passed (57)`. The 16 that
  pass on master assert unchanged behaviour by design: the 7 kept build refusals (x2 files for the binary searches), the
  `sort_indices` ranking, the served-member control, and the 4 door-run (probe) cases.
- `objectDoorGate.test.js` +58 cases (87 -> 145) (W6-T5 block): per member, the door draws master's pinned answer, the pane builds it,
  the door build refuses as master did (`runtime:array`, by name) in the name and the method form; median/stdev still
  build at the door and draw master's answer; an unread gated binding refuses at the door; control `array.sum`.
- Repointed (the member they used as "not held" is now served): `ast/methodForm.test.js` and
  `runtime/__tests__/callForEffect.test.js` (`a.reverse()` -> `a.mode()`); `c18WhileAndLastBar.test.js` (median of an
  empty array without a probe is `na` now; the probe half is unchanged).
- Regression, tip 65bb5fd15f (master merged): 10 files incl. arrays, methodsAndArrayMembers, objectRuntimeValues,
  p3WsaReviewFixes: `Test Files 10 passed`, `Tests 419 passed` (`runs/w6-t5/job5.out`); earlier 15 files / 439 tests
  (`job1.out`).

## Mutations (`mutate.py`, Node 20.20.2, lock heavy-mut-w6-t5.lock; logs job1-mut.log, job2-mut.log, job3-mut.log, job4-mut.log)
Test set: w6ArrayMembers, w19r2Collections, objectDoorGate, c18WhileAndLastBar.
| mutation | result | killed by |
|---|---|---|
| M00 no-op comment (control, each run) | SURVIVED | - |
| M01 fill `to` inclusive (spec) | KILLED | w19r2 "`fill(a, v, 1, 3)` writes indices 1 and 2 only (the manual's example)" |
| M02 stdev unbiased by default (spec) | KILLED | "the default is the POPULATION form" |
| M03 sort places `na` first (spec) | KILLED | "an `na` element stops by name: where Pine places `na` is W6-A1" |
| M04 door gate removed (round A design) | KILLED | objectDoorGate per-member door refusals |
| M04b `heldArray` holds gated members at the door | KILLED | objectDoorGate "refuses as master did" |
| M04c holdsArray asks the table directly | SURVIVED, equivalent | the initialiser is lowered and refused at the call either way; the site keeps master's predicate for fidelity |
| M05 door run stops keeping master (median/stdev) | KILLED | c18WhileAndLastBar probe test + w6 door-run cases |
| M06 `na` element served in the statistics | KILLED | per-member `na` refusal rails |
| M07 unbiased over one element served | KILLED | "what the entries do not pin" |
| M08 covariance of different sizes served | KILLED | same |
| M09 percentile outside (0, 100] served | KILLED | pnr refusal rail |
| M10 nearest rank as p/100*n | SURVIVED (round 1), then KILLED | round 1's 30%-of-10 fixture was exact in floats; rail now 7% of 100 |
| M11 join formats numbers / M12 join default separator | KILLED / KILLED | join refusal rail |
| M13 every/some of empty / M14 before v6 | KILLED / KILLED | every/some refusal rail |
| M15 lastindexof of `na` / M16 sort over text | KILLED / KILLED | their refusal rails |
| M17 median even count upper middle | KILLED | median rail |
| M18 unfilled check on the first array only | KILLED | "in any array argument" |
| M19 FE `holdsText` hook for join | SURVIVED -> code removed | join is typed as text without it; removed rather than shipped unproved |
| M20 range refuses `na` | KILLED | range over real elements |
| M21 insert at `size` served | KILLED (job2; job1 was BADMATCH) | w19r2 unsettled-index rail |
| M22 abs `na` served / M23 sort ignores order | KILLED / KILLED | abs refusal / descending rail |

## measure-pair (own base `pine-dsk-w6t5-base`, lock heavy-mp2-w6-t5.lock; `runs/w6-t5/mpA/` and `runs/w6-t5/mp0`)
Round A: tip 17c3e0ed65 vs base c04bdbe2c1 (`== side tip 17c3e0ed65` / `== side base c04bdbe2c1`), both lanes, complete.
Round B: tip 65bb5fd15f (door fix + master merged) vs base 2f40ee68c5 (new merge-base), runtime 0 complete; runtime 1 was
STOPPED by Claude Code for low system memory while it ran (not a failure; not restarted, per the harness rule).
- **C18 corpus audit (395) and constructed probes (69): round B 0 diffs.** Round A had 1 audit row,
  `machine-learning-moving-average-backquant`: `.probes[0].guard` `runtime:object-door` vs master `runtime:array` (refused
  both sides, reason moved). Fixed by `heldArray` (the door refuses with master's own guard and sentence); round B: 0.
  The audit is lane-independent (round A showed the same single row on both lanes).
- **Harness**: runtime 0 identical (A and B). Runtime 1 (A): MATCH 111 / DIVERGE 107 / INCONCLUSIVE 118 vs base
  110 / 107 / 119: one capture, `delta-rsi-oscillator-strategy-rddt-1d`, INCONCLUSIVE ("computeFor returned no column") on
  the base and MATCH on the tip. It uses only `array.get/new_float/set/size/sum` (none changed here): the known delta-rsi
  wall-clock flake (ready-check names it). Not a lane effect.
- **Census runtime 1 (A), 22 rows, all classified:**
  - intended, spec movers: `range-filter-dw` ATTACHES (attached true, peelSteps 0 vs 1, the spec's expected attach);
    `initial-balance-…` reachedAfterPeel true (peel 4 vs 7); `machine-learning-moving-average-backquant` (peel 2 vs 3);
    `session-tpo-profile` (2 vs 4); `vp-period` (1 vs 2); first wall moves off `runtime:array` on `auto-trendlines-…`,
    `market-sessions-…-leviathan`, `smart-money-concept-…`, `footprint`, `rsi-kernel-…`, `volume-open-interest-footprint-…`;
    `bollinger-band-width-percentile` message only (its array wall is now `array.binary_search_rightmost`, Q-W19R2b, as the
    spec says).
  - intended, not on the list: `luxy-super-duper-supertrend-predictor-engine` (step 5 wall `runtime:array` ->
    `runtime:conditional-history`); 7 reference examples now attach (`array.covariance/insert/join/lastindexof/range/sort/
    variance`); `array.binary_search` example's wall line moves 4 -> 5 (its `array.sort` line is served now).
  - not moved, expected: `supertrend-relative-volume-kernel-optimized-flux-charts`: its array wall is
    `array.standardize`, kept refused (W6-A1 Z01).
  - noise: `multi-timeframe-trend-indicator` (a `pine:timeout` refusal's line).
- **Census runtime 0 (production lane):** A 14 rows, B 12 rows. Intended: `range-filter-dw` and the 7 examples
  (`.runtime.attached` true; the census's own runtime column). The rest (A: ai-supertrend-x-pivot, multi-timeframe-trend,
  volatility-coil-edge, halftrend, luxy-momentum, mirage-liquidity-sweep; B: volatility-coil-edge, halftrend, luxy-momentum,
  mirage) are host-translation `pine:timeout` steps (10000 ms wall clock) that land differently run to run: the set changes
  between A and B and every such row has a timeout on one side. The host lane (`pine.js`) does not import any file this
  lane changed. Not a lane effect.

## final-tip (FULL, 2 parallel shards, Node 20.20.2, ram_gate, lock heavy-final2-w6-t5.lock)
Command `runs/w6-t5/ft2.sh` = `final-tip.sh pine-dsk-w6t5 w6-t5-final2` + pytest `test_script_engine_version_gate`,
`test_saved_script_prebump`, `test_runtime_definitions`, `test_language_coverage`, `test_evidence_engine`,
`test_saved_probe_integrity`. Logs `runs/w6-t5-final2/`, `runs/w6-t5/ft2.out`.
- `TIP ad9425772b done` (the final code tree; later commits are docs only), `scope=full shards=2`,
  `rc gate=0 hyg=0 py=0 js=1`, `totals=ok`, `errors=0`; gate 46 passed, rails pytest 247 passed;
  vitest `Test Files 9 failed | 1367 passed | 28 skipped`, `Tests 10 failed | 23510 passed | 122 skipped`.
- Failing files: the named baselines (controlDoorCensus, enumerationSites, vendorHarness, vendorHarness.coverageAudit
  delta-rsi, settingsScope.rail, pollingSites.rail, usePreferences.additionsOnly), plus **hostParity.rail and
  hostParity.v8.rail: INTENDED, waiting for the engine bump.** Both say `RED a digest changed WITHOUT an engine bump`:
  `arrays_basic@listing` and `arrays_sort@listing` go `withheld` (runtime:failed / runtime:array) -> `ok`, which is this
  lane's served change. Spec rule 6: the coordinator's SCRIPT_ENGINE_VERSION bump regenerates W5's host-parity digests;
  this lane may not bump.
- `integrity=tree-changed-during-run`: `lookbackAgreement.test.js` rewrote `tools/lookback_agreement.json` during the run
  with `distinct_trees_walked` 605 instead of the committed 608 (all 146 rows identical). A host-lane walk count that
  drops under full-run load (round 1, below, wrote 608 and left the tree clean); no file this lane changed is in that
  walk's path. The file was restored byte-exact from the HEAD blob afterwards. Not re-run (each full run is about 1 h and
  the bump commit needs its own final-tip anyway).
- Round 1 (`runs/w6-t5-final/`, TIP 1cc7add0b0): `integrity=ok`, same baselines and hostParity, plus two lane rails that
  pinned the old refusals and were repointed in ad9425772b: `vendorHarness.f6SpyDrawings` (volume-profile's own-drawings
  runtime build now compiles; it stopped at `array.fill`) and `runtimePaneSafety` (its collection-stop example was the
  median of an empty array, now `na`; it uses an `na` element now). Both green alone after the fix (50/50).

## ready-check
`ready-check.sh pine-dsk-w6t5 runs/w6-t5-final2` at bd8243d322: `READY-CHECK FAIL: final-tip integrity=tree-changed-during-run`. Expected FAIL on `integrity` (above); with the
bump and digest regeneration done at landing, the only remaining reds are the named baselines.

## measure-pair round B, runtime 1 (re-run, complete)
`runs/w6-t5/mpB1.sh` (runtime 1 only), lock `dsk/heavy-mp2.lock` (shared), ram_gate 14.2 GB free; logs
`runs/w6-t5/mpB1-all.log`, `mpB-rt1.log`, out `runs/w6-t5/mpB-rt1/`. `== side tip a0ea54286b` (code tree ad9425772b) /
`== side base 2f40ee68c5` (base side reused from the measure-pair cache). Two earlier attempts were stopped by Claude Code
for low system memory (`mpB-rt1-stopped*`), not failures.
- C18 audit 395 rows / probes 69: **0 diffs**. Harness: **identical** (110/107/119 both sides; round A's delta-rsi flip
  did not recur, confirming it as the wall-clock flake).
- Census 22 rows: exactly round A's set and classification (spec movers incl. the `range-filter-dw` attach, 7 reference
  examples attach, `luxy-super-duper` wall move, `binary_search` example line move; `multi-timeframe-trend-indicator`
  a `pine:timeout` reason: noise). 0 unintended.

## r1 (review NO-GO @fd0f39664d)
- B1: `array.median` over an even count, and `median` / `stdev` / `variance` over an array the run cannot prove is float
  (no fractional element; the `array<int>` forms return `series int` with unstated rounding) stop by name (W6-A1). Queue
  rows H01-H02, I01-I04 (I04 measures master's `array.avg`, which has the same int form but is a master member served at
  the C18 door: flagged, not changed). Re-checked: sum/min/max/range/abs are exact on ints; covariance has no int form;
  percentile_nearest_rank returns an element. Rails: w6ArrayMembers (49 tests; fixture bars made fractional).
  Mutations (`runs/w6-t5/mut-b1.log`): control SURVIVED; even-count guard dropped KILLED; provablyFloat dropped KILLED.
- B2: origin/master merged (0839080514), objectDoorGate conflict with W9-T1 resolved keeping both blocks; objectDoorGate,
  w6ArrayMembers, c18WhileAndLastBar 220/220, runtimePaneSafety + w19r2 31/31 (--maxWorkers=1).
- Census rows B1 may move (runtime-on): `example:functions:array.median/stdev/variance`, `auto-fibonacci-and-gann-fan…`,
  `cobra039s-crypto-market-visualizer`, `liquidity-pools-pro-willyalgotrader`, `logistic-rsi-stoch-roc-ao-by-dgt`,
  `luxy-super-duper-supertrend-predictor-engine` (the sources that call median/stdev/variance). C18 door unaffected
  (MASTER_AT_DOOR).

## r1 checks on the final tree (coordinator GO)
measure-pair `runs/w6-t5/mpC.sh` (lock dsk/heavy-mp2.lock; logs `runs/w6-t5/mpC-all.log`, `mpC0/`, `mpC1/`):
`== side tip 21d72f793e` / `== side base 3e8dc3fae5`.
- C18 audit 395 / probes 69: **0 diffs on both runtimes**. Harness: identical on both (rt0 93/103/140, rt1 111/107/118).
- Census rt1: the same 22 rows as rounds A/B, same classification (spec movers incl. `range-filter-dw` attach; 7 examples;
  luxy-super-duper; binary_search example line; multi-timeframe-trend timeout noise). None of the B1 candidates
  (median/stdev/variance examples, auto-fibonacci, cobra039s, liquidity-pools-pro, logistic-rsi) moved: their walls are
  elsewhere or their arrays are fractional. Census rt0: 12 rows = range-filter-dw + 7 examples (`runtime.attached`) +
  4 `pine:timeout` noise rows (ai-supertrend flipped the opposite way from round A, volatility-coil, halftrend, mirage).
  0 unintended.
Then origin/master bde38b0d69 (W6-T6 engine 20, deterministic lookback oracle #891) merged as 6750309fef (clean;
objectDoorGate + w6ArrayMembers + w19r2 216/216).

final-tip `runs/w6-t5/ftC.sh` -> `runs/w6-t5-final3/` (lock heavy-final2-w6-t5.lock, FULL, 2 parallel shards, Node 20.20.2):
`TIP 6750309fef done`, `scope=full`, `rc gate=0 hyg=0 py=0 js=1`, `totals=ok`, `errors=0`, **`integrity=ok`**; pytest
247 passed; vitest `Test Files 9 failed | 1372 passed`, `Tests 10 failed | 23608 passed | 122 skipped`. Failing: the
named baselines plus hostParity.rail / hostParity.v8.rail (`arrays_basic`, `arrays_sort` withheld -> ok: the engine bump
the coordinator applies at landing regenerates the digests).
ready-check (`runs/w6-t5-final3`, HEAD e449c69a5b): `READY-CHECK FAIL: js failure outside the baseline allowlist: hostParity.rail.test.js` (the pending-bump digests above; ready-check not changed).
