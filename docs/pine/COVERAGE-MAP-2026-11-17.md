# Pine coverage map, 2026-11-17 (engine 71 re-measure)

Measured 2026-11-17 on `origin/master` @ `1df860c1e8` (`SCRIPT_ENGINE_VERSION = 71`), with the
repo's own tooling, unmodified. Machine twin: [`coverage-map.json`](coverage-map.json), regenerated
in this commit by `tools/pine_coverage/coverage_map.py`. Previous measurement:
[`COVERAGE-MAP-2026-11-16.md`](COVERAGE-MAP-2026-11-16.md) (`890b6d165c`, engine 60). The prose in
[`COVERAGE-MAP.md`](COVERAGE-MAP.md) keeps the definitions and the re-run procedure.

> **Member-facing: the runtime-on lane, 285 of 679 (42.0%)** (267, 39.3%, on 11-16; 287 under the
> 11-16 rule). Production runs the runtime pane ARMED (section 1), so this lane, with the kill list
> and capability admission, is what members get. The census grants every script, so 285 is a
> ceiling. Apply the server's own admission policy statically to the 65 scripts only the runtime
> lane draws, and **275 (40.5%)** are admitted today (section 1).
> **Host-only baseline (the census's "production" lane, runtime gate closed): 220 of 679 (32.4%)**
> (215, 31.7%, on 11-16). This is kept for comparability with every earlier map. 6 newly transfer;
> 1 stopped, refused by name because its committed capture grades DIVERGE. **Under the 11-16 rule
> the count is 221 (32.5%): +6 from the engine, none lost.** The 11-16 rule is the earlier paint
> rule with no host known-divergence list. 209 of the 220 are also clean on one bind
> (`transferBound`; 204 on 11-16).
> **0 of 70 strategies transfer** (unchanged). The strategy broker is unset, so dark, in production.
> The owner has since ruled to serve witnessed strategies; that work is in progress.

These are door verdicts, not parity verdicts. ⚠️ **Amended before merge (coordinator, 2026-11-17):**
the first version of this page led with the host-only baseline as the headline. Members get the
runtime-on lane. No number was re-measured for the amendment. The admission figure is a static
reading of the committed registry over the same census rows.

## 1. Same sample and predicate; two lists added since 11-16

- **Which lane members get.** Production `web` runs the runtime pane armed. The coordinator read
  these from Railway on 2026-11-17:
  - `VITE_PINE_RUNTIME_PANE_ENABLED=1` and `VITE_PINE_MEMBER_PANE_ENABLED=1`;
  - `PINE_RUNTIME_STAGE=all`;
  - `PINE_RUNTIME_CAPABILITY_ADMISSION=on`;
  - `VITE_PINE_STRATEGY_BROKER_ENABLED` unset, so the broker is dark.

  So the census's **runtime-on** lane is the member-facing one. Its "production" lane (gate CLOSED)
  is the **host-only baseline**: the same door with the runtime pane off, kept because every map
  since 10-30 states it.

  Members get the runtime-on lane through two server gates:
  - **The kill list.** The predicate applies it.
  - **The starter allowlist or capability admission** (`runtime_definitions.not_graded`). The
    census does NOT apply this: it grants every script (`__allowEveryRuntimeScriptForTests`), so
    285 is a ceiling.

  **Static admission check** (not a re-measure). Over the 65 scripts only the runtime lane draws
  (`runtimeOn.added`), the server's own policy gives:
  - **55 admitted**: 1 on the graded allowlist and 54 by capability. 11 of the 54 use
    `realtime-state`, admitted for closed-bar history only, so they are drawn bar by bar only on a
    chart whose newest bar is closed.
  - **10 declined `runtime:not-yet-graded`**, each for a capability not admitted: `obj:linefill`
    4, `collections:matrix` 2, and one each of `request-other`, `varip`, `method-def` and
    `calc-bars`.

  The policy is `graded_allow_list`, plus `pine_capabilities.capabilities_of` against
  `admitted_capabilities()`. `PINE_RUNTIME_CAPABILITY_DENY` is assumed unset. So members get
  **220 + 55 = 275 (40.5%)** on this census; the 11-16 map has no admission-applied figure to
  compare with.
- **Sample**: the same 679 scripts (266 committed, 271 reference, 142 built-in). All 679 keys match
  the 11-16 map, and **every script's source sha256 is identical** (0 differ). Pine version,
  declaration and `placesOrders` are identical for all 679. `sample_manifest.json` is byte-identical
  to the one the 11-16 run used.
- **TradingView reference**: the same `ref_rebuilt.json` (288 whole-script examples; 967 census
  inputs per lane).
- **Predicate**: the census's `isClean`, then `transfers_fully` / `places_orders` /
  `runtime_on_transfers` in `coverage_map.py`. The engine's order-call set is the same 13 names.
  Three things changed in the predicate since 11-16. None of them is an engine change, so every
  headline below is also stated under the 11-16 rule:
  1. **The paint rule** (corrected after the 11-16 measurement; `paint_predicate.mjs`). Every row
     carries both readings. **Measured here, it moves no script on either lane**: the counted sets
     under `clean` and under `cleanTranslatedPaints` are identical.
  2. **The host known-divergence list** (owner decision 2026-11-17, engine 70, #1541).
     `transfers_fully` refuses a script whose committed capture grades DIVERGE with a drawn
     difference on the host lane. 9 sample scripts are listed, all committed. Only one of them is
     door-clean: `committed:contraction-box-doji-lines`.
  3. **The runtime kill list** in `runtime_on_transfers` (#1533, 2026-11-17). 5 sample scripts are
     on it. Two of them attach on the runtime lane: `contraction-box-doji-lines` and
     `committed:momentum-based-zigzag`.

  `coverage-map.json` applies all three. The "11-16 rule" column below drops 2 and 3 and reads the
  earlier paint rule. By item 1, the paint rule alone changes nothing.
- **What the instrument gained since 11-16.** These are additive, and none enters the headline:
  - the `[compute-budget]` bucket and the `pine:install` guard (door robustness, engine 63: the
    member door refuses what the install door would, by name);
  - the `[known-divergence]` bucket;
  - DRAW-1's named drop heads (`<- pine:object-condition` and others, engine 66);
  - the armed strategy column (`wouldTransferIfArmed`), now measured for all 70 strategies.

## 2. Before and after

| | 2026-11-16 (`890b6d165c`, e60) | 2026-11-17, 11-16 rule | 2026-11-17 (`1df860c1e8`, e71) | delta, engine | delta, as published |
|---|---:|---:|---:|---:|---:|
| **runtime-on lane (member-facing; census grants every script)** | **267 (39.3%)** | **287 (42.3%)** | **285 (42.0%)** | **+20** | **+18** |
| runtime-on lane with the server's admission applied (static, section 1) | not computed | | 275 (40.5%) | | |
| **transfers fully, host-only baseline (`headline.transfer`)** | **215 (31.7%)** | **221 (32.5%)** | **220 (32.4%)** | **+6** | **+5** |
| transfers fully AND clean on one bind (`transferBound`) | 204 (30.0%) | 210 | 209 (30.8%) | +6 | +5 |
| attached, any form | 287 (42.3%) | 292 (43.0%) | 292 (43.0%) | +5 | +5 |
| runtime counterfactual (headline field, production census; applies no list) | 267 (39.3%) | 287 (42.3%) | 287 (42.3%) | +20 | +20 |
| runtime-on: attached on the runtime lane | 55 | 70 | 70 | +15 | +15 |
| runtime-on: added over production / lost | 52 / 0 | 66 / 0 | 65 / 0 | | |
| strategies transferring | 0 of 70 | 0 | 0 of 70 | 0 | 0 |
| strategies the door draws but that place orders | 13 | 13 | 13 | 0 | 0 |
| strategies that would transfer if the broker were armed (separate column) | not measured | | 7 of 70 | | |
| TradingView reference examples transferring | 84 of 288 | 84 | 84 of 288 | 0 | 0 |

By population (transfer / attached / runtime counterfactual / runtime-on lane):

| population | n | 11-16 | 11-17, 11-16 rule | 11-17 |
|---|---:|---|---|---|
| committed | 266 | 58 (21.8%) / 88 / 86 / 86 | 60 / 90 / 93 / 93 | 59 (22.2%) / 90 / 93 / 91 |
| reference | 271 | 86 (31.7%) / 127 / 102 / 102 | 89 / 129 / 114 / 114 | 89 (32.8%) / 129 / 114 / 114 |
| builtin | 142 | 71 (50.0%) / 72 / 79 / 79 | 72 / 73 / 80 / 80 | 72 (50.7%) / 73 / 80 / 80 |

By Pine version and declaration (transfer):

| slice | n | 11-16 | 11-17, 11-16 rule | 11-17 |
|---|---:|---:|---:|---:|
| Pine v1-v3 | 85 | 49 (57.6%) | 49 | 49 (57.6%) |
| Pine v4 | 132 | 41 (31.1%) | 42 | 42 (31.8%) |
| Pine v5 | 191 | 39 (20.4%) | 43 | 42 (22.0%) |
| Pine v6 | 271 | 86 (31.7%) | 87 | 87 (32.1%) |
| `indicator()` / `study()` | 609 | 215 (35.3%) | 221 | 220 (36.1%) |
| `strategy()` | 70 | 0 | 0 | 0 |

**The coverage ratchet does not move.** The committed population's transferring set equals
`coverage-ratchet.json` exactly on both lanes: production 59 = 59, runtime-on 91 = 91, no script in
one and not the other. Every gain beyond the snapshot is in the reference and built-in populations,
which the ratchet does not cover. This PR does not touch the snapshot.

## 3. Blockers (top 15 of this map, against 11-16)

These are the **host-only baseline's** blockers (`blockers` in the JSON, the list every map has
ranked), so a member is not stopped by all of them. Some scripts walled here are drawn by the
armed runtime lane: 19 of `[imperative]`'s 40 sole scripts, 4 of `[compute-budget]`'s 9 and 1 of
`[user-functions]`'s 9 (section 8). The member-facing wall list is the runtime-on lane's
(`runtimeOn.walls`): 394 scripts do not transfer there. Their first walls are attached-dirty 77,
`runtime:library` 58, `runtime:request-with-state` 28, `pine:request` 27, `pine:builtin` 21,
`pine:function` 20 and `runtime:no-output` 20.

| blocker | scriptsBlocked 11-16 | 11-17 | soleBlockerOf 11-16 | 11-17 |
|---|---:|---:|---:|---:|
| `[imperative]` | 176 | 174 | 38 | 40 |
| `[strategy]` | 70 | 70 | 37 | 37 |
| `[request-security]` | 54 | 52 | 16 | 15 |
| `[imports-libraries]` | 61 | 61 | 11 | 11 |
| `[user-functions]` | 68 | 63 | 9 | 9 |
| `[compute-budget]` | (new) | 11 | (new) | 9 |
| `[translator-robustness]` | 50 | 24 | 9 | 5 |
| `[output-contract]` | 5 | 7 | 5 | 5 |
| `[history-offsets]` | 22 | 23 | 4 | 4 |
| `[udt-methods]` | 20 | 20 | 3 | 3 |
| `[drawing-objects]` | 44 | 8 | 3 | 3 |
| `object op dropped: update:props` | 30 | 31 | 0 | 2 |
| `[paint-withheld]` | 20 | 18 | 3 | 2 |
| `array.get` | 9 | 9 | 2 | 2 |
| `[text-colour-values]` | 8 | 8 | 2 | 2 |

Two of the 11-16 top 15 left this list: `object op dropped: create:label <- pine:text-value` (10 to 7,
sole 2 to 1) and `ta.sar` (3 / 2, unchanged, now 16th on the tie-break). `[known-divergence]` blocks
9 scripts and is the sole wall of 1.

Most of the movement is relabelling by the instrument, not engine coverage:

- **`[compute-budget]` is new** (engine 63). Its 11 scripts used to "attach" and then failed at the
  install door; that install error counted as `[translator-robustness]`. Of the 26 scripts that left
  `[translator-robustness]`, 11 moved to `[compute-budget]`. The other 15 lost a wall that was an
  install error on a peeled step, and their remaining walls stand. Five scripts whose sole wall was
  `[translator-robustness]` now have `[compute-budget]` as their sole wall.
- **`[drawing-objects]` fell from 44 to 8** because DRAW-1 (engine 66) names what each loss was. 37
  scripts left it, mostly for named keys such as `guard:* <- pine:object-condition`; 4 went to
  `[known-divergence]`.
- **`[imperative]` sole rose from 38 to 40** because two scripts lost their other wall
  (`[translator-robustness]`, the install error), leaving `[imperative]` alone:
  `committed:heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor` and
  `committed:nubia-auto-midas-anchored-vwap-xdecow`.
- **`[request-security]` sole fell from 16 to 15** because `builtin:correlation-coefficient`
  transfers.

## 4. Scripts that STOPPED transferring

Production lane (1):

| script | refusal now | classification |
|---|---|---|
| `committed:contraction-box-doji-lines__1486658151` (Pine v5) | door-clean, refused `pine:known-divergence` by the predicate (wall `[known-divergence]`) | **Deliberate named refusal of a witnessed wrong output.** The host known-divergence list (engine 70, #1541, owner decision 2026-11-17). Its two committed SPY captures grade DIVERGE on today's engine on both lanes, re-graded in this run: 205 lines drawn where TradingView holds 204. Its two RDDT captures grade MATCH. Under the 11-16 rule it still transfers, so the engine did not regress. |

Runtime-on lane (2 against 11-16):

| script | refusal now | classification |
|---|---|---|
| `reference:logistic-rsi-stoch-roc-ao-by-dgt__aYY2rK1EEf` (Pine v5) | the runtime lane declines `runtime:conditional-history` (`wLabel[…]` in a block that does not run on every bar), and the door no longer keeps the host's partial drawing in its place | **Deliberate named refusal of a previously partial picture.** Commit `d4133b55b3` (DRAW-1, #1482, engine 66): a fallback document no longer carries a host drawing that lost creates. On 11-16 the runtime lane "attached" this script while its host object program had dropped label creates (`create:label <- pine:collection`, `prop:unreadable`), so members would have seen a different set of labels, not a smaller one. The rule was witnessed DIVERGE on `trend-levels-chartprime`. This script has no committed capture; its licence-held ledger evidence is stale. Production was not affected: it did not transfer there on either date. |
| `committed:contraction-box-doji-lines__1486658151` | as above: host-listed and kill-listed | the same classification as the production row |

Also not counted on the runtime-on lane: `committed:momentum-based-zigzag`. Engine 64's runtime history
unit (#1450) let the runtime lane build it, and it is kill-listed. Its committed capture grades DIVERGE
runtime-on in this run: TradingView holds 25 drawings, ours none. It appears in neither the 11-16 set
nor today's.

## 5. Scripts that newly transfer

Production lane (6; all also on the runtime-on lane; all six clean on one bind):

| script | wall on 11-16 | what serves it, and its witness |
|---|---|---|
| `builtin:correlation-coefficient__Correlation_` | `[request-security]` (`pine:request`, unresolved symbol) | Engine 64, REQ (#1447). `ticker.modify(<symbol>)` with nothing modified is that symbol. Witness: the reference sentences for `ticker.modify`, plus `vw-other-symbol-rddt-1d-2026-09-30` O02 / O03 MATCH. |
| `committed:high-low-open-mid-ranges__5715509e0b` | `[drawing-objects]` (`pine:constant-only` with 171 ops attempted) | Engine 66, DRAW-1 (#1482) section 3(c): an all-`na` row no longer reads as `pine:constant-only` when the object program draws. Its own committed captures (RDDT, SPY) grade MATCH on both lanes. |
| `committed:sessions__2677` | `[user-functions]` (`time()` with a wrapping session) | Engine 66, bt (#1473): wrapping sessions. Witness: the five BITSTAMP session captures and `sessions-rddt-1d-2026-11-14`, MATCH on both lanes, all 10 items. |
| `reference:nylondonasian-sessions-ict-swings__14bce3660b` | `[user-functions]` + `guard:create <- pine:state` | Engine 66, bt (#1473). Its licence-held capture grades MATCH on both lanes, all 8 items (graded locally by the unit; the map's ledger row is stale). |
| `reference:volume-pace-pressure-table__235d4849a0` | `[drawing-objects]` + `cell:text <- pine:type` | Engine 63, door robustness (#1448): a `var string` in a drawing text is read from its writes. This is the script that stopped on 11-16; it is back. |
| `reference:williams-r-rsi-ema-tendance-silver-wong__sogth7qpzs` | `create:label <- pine:text-value` | Engine 63, door robustness (#1448): the same `var string` reader. Its licence-held capture went DIVERGE to MATCH on both lanes (all 4 items) on that unit's tree. |

Runtime-on lane (20 counted; 21 under the 11-16 rule, including the kill-listed
`momentum-based-zigzag`). The 6 above, plus:

| unit (engine) | scripts |
|---|---|
| door robustness (63): a host install-budget refusal is offered to the per-bar lane | `reference:check-head-and-shouldersmask-man`, `reference:multi-timeframe-vwap-v5`, `reference:range-filter-buy-and-sell-5min`; and `reference:tradingviews-technical-analysis`. Engine 63 routed it; the per-bar decline that unit measured (`runtime:conditional-history`) is gone at 71, not traced to one commit. |
| runtime history (64, #1450) | `committed:kernel-channel-backquant`, `reference:cm-gann-swing-highlow-v2`, `reference:supertrend-cluster-zeiierman` |
| text and colour values (65, #1467) | `committed:volatility-trend-score-backquant`, `reference:color-gradient-framework-pinecoders`, `reference:edufx-amd`, `reference:study-for-squeeze-momentum-indicator-lazybear`, `reference:vwap-supply-demand-zones-pro` |
| UDT / collections (66, #1486) | `committed:bollinger-band-width-percentile` |
| bt session clock (66, #1473) | `committed:session-highs-and-lows-indicator-smc-sessions-dst-safe` |

**Attached, any form**: +5, -0: `correlation-coefficient`, `sessions`,
`nylondonasian-sessions-ict-swings`, `committed:ict-killzone-index-version` and
`reference:range-filter-x-hull-suite`.

**Clean at the door but not on one bind**: the same 11 scripts as on 11-16 (`scripts[].cleanBound`).

## 6. Not comparable with 11-16

- **Parity (`parity`, `runtimeOn.parity`, `verifiedTransfer`)**. The committed capture set grew from
  709 to 837 graded files. Today, production is 188 MATCH / 74 DIVERGE / 575 INCONCLUSIVE.
  Runtime-on is 262 MATCH / 66 DIVERGE / 489 INCONCLUSIVE / 20 MATCH_SUBSTITUTED. 52 scripts
  transfer AND have a MATCH capture (51 on 11-16). **DIVERGE rose through new captures, not moved
  verdicts.**
  - Production: of the 709 captures graded in both runs, 5 moved, all toward MATCH (3 INCONCLUSIVE
    to MATCH, 2 DIVERGE to MATCH), and none moved to DIVERGE. All 23 new DIVERGEs are among the 128
    new capture files.
  - Runtime-on: 10 moved. The only move to DIVERGE is `momentum-based-zigzag`, now kill-listed
    (section 4).
  - The host list (section 1) is derived from the production DIVERGEs.

  The ledger block reads
  `fresh 0, stale 448`, so licence-held ledger evidence credits nothing here, as on 11-16.
- **The armed strategy column** (`strategyOn.wouldTransferIfArmed` = 7, `armedMeasured` = 70). The
  11-16 census predates it.
- **Wall labels**: `[compute-budget]`, `[known-divergence]` and DRAW-1's named drop heads are new
  (section 3). Per-wall counts moved partly by relabelling.
- **The two lists** change what the headline counts (section 1). The "11-16 rule" column is the
  comparable figure. What a member is served today is the runtime-on lane with both lists: 285 at
  most, 275 with the server's admission applied.

## 7. How it was measured

The worktree was at `1df860c1e80445262ba017c34c6d1852083d33bd`; `git rev-parse HEAD` was identical
before and after every lane. One heavy-lock hold per lane, `VITEST_MAX_WORKERS=1`, node v24.13.1.
`$O` is a scratch directory outside the repo. `$O/prod` and `$O/rt` are fresh copies of the sample
cache: `sample_manifest.json` has 679 `ok` rows, every file is present, and 3 built-ins are
`closed_no_auth`, as before. The commands are 11-16's, unchanged.

**Why the census did not run on GitHub.** pine-heavy's census legs (`coverage-ratchet`) run over
`corpus/committed` only. The 271 reference and 142 built-in sources live in the local sample cache:
they are never committed and never sent to CI, the repo being public. So the two census lanes, and
the harness lanes that feed the same map, ran on this PC under the lock, one at a time. The
committed half is cross-checked by this PR's own `coverage-ratchet` legs (section 2).

```sh
L="python C:/Users/Patrick/uct-clips/tools/heavy_lock.py --timeout 14400"
$L --label census-production run -- python tools/pine_coverage/run_census.py --cache $O/prod --ref $REF
$L --label census-runtime-on run -- python tools/pine_coverage/run_census.py --runtime-on --cache $O/rt --ref $REF
# from app/
VENDOR_HARNESS_RUNTIME_ON=0 VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=$O/verdicts-prod \
  $L --label census-harness-production run -- node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=1
VENDOR_HARNESS_RUNTIME_ON=1 VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=$O/verdicts-rt \
  $L --label census-harness-runtime-on run -- node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=1
COVERAGE_DOOR_OUT=$O/engine_door.json $L --label census-engine-door run -- node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js --maxWorkers=1
# the map
python tools/pine_coverage/coverage_map.py --cache $O/prod --ref $REF \
  --verdicts $O/verdicts-prod/verdicts.json --runtime-cache $O/rt --runtime-verdicts $O/verdicts-rt/verdicts.json \
  --engine-door $O/engine_door.json --out docs/pine/coverage-map.json --measured-on 2026-11-17 --master-sha 1df860c1e8
```

The "11-16 rule" figures re-read the same census rows through `coverage_map.py`'s own functions
(imported, never restated), with `cleanTranslatedPaints` and no lists. They are in no file.

Results of each run:

| run | result |
|---|---|
| census, production | 967 / 967 rows, 0 killed, 1 attempt; `LANE MEASURED: production (gate CLOSED, runtime lane reached 0, host refusals 1209)`; vitest 26 passed, 1 skipped; 13.7 min |
| census, runtime-on | 967 / 967 rows, 0 killed, 1 attempt; `LANE MEASURED: runtime-on (gate OPEN, runtime lane reached 1836, host refusals 1654)`; vitest 26 passed, 1 skipped; 11.9 min |
| harness, production | 1 file passed, 11 tests passed; 837 captures graded; 8.7 min |
| harness, runtime-on | 1 file passed, 11 tests passed; 837 captures graded; 9.8 min |
| engine door | 1 file passed, 26 passed, 1 skipped; 12 s |
| derived evidence, against the new map | `evidence_engine.py queue --check` PASS (374 targets), `pins --check` PASS |

Not regenerated in this refresh: `coverage-targets-<date>.json`, `census/wall-detail-<date>.json`, the
section tables of `COVERAGE-MAP.md` (still the 10-30 prose), and `coverage-ratchet.json` (the trains'
job; it does not move, section 2). The JSON carries today's values for all of them.

## 8. The six largest sole blockers: what fixing each would take

Ranked by `soleBlockerOf`. "Newly transfer if it alone were fixed" is that count. It is an upper
bound where the peel stopped before reading the whole script; the "fully enumerated" figure is the
firm part.

**1. `[imperative]`: sole 40 (fully enumerated 14); blocks 174.** This covers statements the
production (host) lane cannot keep as one expression per output: `var` state carried across bars
(`pine:state`, 18 of the 40), `:=` reassignment (`pine:reassign`, 13), `if` / `for` / `while`
blocks (`pine:block`, 7) and dependency cycles (`pine:cycle`, 4). The host lane stores one
expression per output by design, so the honest version is the per-bar runtime lane. It already
builds 19 of the 40: those transfer on the runtime-on lane, which production runs armed
(section 1). **They need no arming and no engine unit.**
- **16 of the 19 serve members today**: 1 is on the graded allowlist and 15 are capability-admitted
  (static check, section 1). Captures for these only strengthen the parity record. 5 of the 19 have
  committed captures grading runtime-on MATCH (`adx-and-di-for-v4`, `fvg-trend`,
  `inside-bar-range-mother-candle…`, `one-sided-gaussian-support-resistance-rate-loxx`,
  `trend-targets-algoalpha`), 2 are INCONCLUSIVE and 12 have none.
- **3 are declined `runtime:not-yet-graded`**, because a capability they use is not admitted:
  `inside-bar-boxes` (`varip`), `one-sided-gaussian-support-resistance-rate-loxx`
  (`collections:matrix`) and `trend-targets-algoalpha` (`obj:linefill`). The last two already have
  runtime-on MATCH captures. What they need is that capability's admission evidence in the
  registry, not engine work.

The other 21 stop on the runtime lane at named walls, each needing its own witness:
- `runtime:conditional-history` (4): per-call-site history beyond `ta.sma`/`ema`/`rma`; C48
  `vw-call-site-history` states the rule, and each kernel needs a capture.
- `runtime:request-with-state` (3): Q-REQ4, a capture grading a bare v1-v4 `security` over state
  MATCH.
- `pine:request` (2), `runtime:function-global-state` (2), `runtime:statement` (2) and
  `runtime:history-dynamic-offset` (2).
- one each of block value, function, colour, lower timeframe, withheld-all and loop.

**Size: large** for the 21 (several engine units). The 19 are already the member's: 16 served and
3 waiting on capability admission.

**2. `[strategy]`: sole 37 (fully enumerated 14); blocks 70. OWNER-GATED: serving strategy
backtests is an owner product decision, pending.** The construct is `strategy()` order simulation:
fills, positions, the trade list and the tester report. The predicate counts no order-placing
strategy, whatever the door draws. The broker exists and is dark: `VITE_PINE_STRATEGY_BROKER_ENABLED`
is unset in production. The owner has since ruled to serve witnessed strategies, and that work is
in progress. The armed column measures what arming would serve today: 5 of these 37 (7 of all 70).
The other 32 stop at named broker questions:
- Q-S1a, a percent-of-equity STOP entry or an entry while trades are open (9);
- Q-S1i, funds at the next open (6);
- a broker-build refusal kept as a host document (6);
- tester-only `pine:no-output` (4);
- Q-S1b, the v4 margin default (3);
- one each of `pine:strategy-call`, B-EXIT-NA, Q-S1e and B-FILLS.

The evidence the honest version needs is Strategy Tester REPORT captures (fills and every value
series), graded MATCH through the ledger's step 8. Those pin each broker rule a script exercises:
41 rules are pinned in `brokerPins.json` today. The value-only witnesses taken in RTH cannot pin.
The next re-takes with the report are B-PYR, B-PYR-PRICE, B-STOP-LIMIT and B-EXIT-LEVELS, plus the
queued `w9-q-s1a-size-stop-v6` probe. **Size: large**, and gated on the owner before any of it
serves.

**3. `[request-security]`: sole 15 (fully enumerated 6); blocks 52.** The construct is
`request.security` (and v1-v4 `security`) for another symbol or timeframe. 0 of the 15 transfer on
the runtime-on lane. About half ask for a symbol we do not hold:
- USI breadth (`USI:ADVN.NY` family, `USI:ADD`), which is in scope as its own unit (our breadth
  data);
- `ECONOMICS:`, `ESD:` earnings, `QUANDL:` CME series and crypto perpetuals, which are out of scope
  by owner ruling.

Those are a data-supply question, not engine work, and nothing may be substituted. The rest are
shapes over our own symbol, each with a queue row and a probe:
- a Heikin Ashi ticker (Q-REQ3);
- a `barmerge.gaps_*` constant passed as `lookahead`, behind a `[barstate.isconfirmed ? 0 : 1]`
  offset (Q-REQ2);
- a lower timeframe with look-ahead on, which is the intraday data-source question (R-LTF: 77% of
  sessions price-equal, volume never equal);
- a symbol reached only through a helper's parameter, plus a v1-v4 bare `security` over state
  (Q-REQ4).

Each needs a CAPTURE grading MATCH; the reference does not state these behaviours. **Size:
medium** for the own-symbol shapes. The held-symbol half is a data and ownership decision.

**4. `[imports-libraries]`: sole 11 (fully enumerated 0); blocks 61.** The construct is `import` of a
published library (`pine:module`). The import stops translation, so nothing behind it was read and
11 is a pure upper bound. None of the imported versions is on the promotion allowlist's `promote`
list:
- 4 built-ins import one TradingView-published library (two versions);
- 4 committed and 1 reference script import community libraries no session has fetched or graded;
- 2 reference scripts import versions on `neverPromoted` (a non-commercial licence). Those two can
  never be served unless the author relicenses.

The runtime lane refuses all of them as well (`runtime:library`, 10 of 11). The honest version needs
U15's promotion rule per version: the version's source pinned by sha256, the licence read from its
header, and every importing script graded MATCH host-only by a CAPTURE. For a v5 library inside a v6
script it also needs the queued LB1 probe capture (`lib-v5-in-v6`), because the reference, the
manual and the migration guide state nothing about cross-version linking. Library linking on the
runtime lane is a separate unit. **Size: large.**

**5. `[user-functions]`: sole 9 (fully enumerated 5); blocks 63.** The construct is user-defined
functions whose bodies the host lane cannot fold. 4 of the 9 are a multi-line body ending in no
value the host can read (`pine:function-def`). The runtime lane runs function bodies. One of the
four transfers on the runtime-on lane and is capability-admitted, so it serves members today. The
other three stop at `runtime:request-with-state` (Q-REQ4) or `runtime:history-dynamic-offset`. 4 are `time()` calls reached through a function:
- 2 are a Pine v2 session with no day list, whose default days no reference text states. This needs
  a CAPTURE of a v2 `time(period, "HHMM-HHMM")`.
- 2 are `time(<timeframe>)` forms the session clock does not yet serve. They need a capture of the
  form.

The last one is v3's `interval` built-in (`pine:builtin`). The v6 reference the census holds has no
`interval`, so it needs a REFERENCE sentence for its v1-v3 meaning, or a capture. **Size: small to
medium:** two small clock readings with captures, and the rest
behind arming or Q-REQ4.

**6. `[compute-budget]`: sole 9 (translation clean: zero refusals); blocks 11.** These are the host
lane's compute caps at the install door:
- look-back 960 bars (6 scripts need 961 to 2547; three of them only because `vwap()` reaches back
  one whole session);
- distinct series 8 (2 need 9 and 10);
- formula nodes 128 (1 needs 334).

4 of the 9 already serve members: the armed runtime lane takes the host refusal, and all 4 are
capability-admitted (static check, section 1). The cap stops 5 for members. A REFERENCE
sentence exists for the look-back cap and says it is ours, not TradingView's: the Pine User Manual,
"Limitations", allows history references of up to 5000 bars for most series and 10,000 for
`open/high/low/close/time` (quoted in `docs/pine/evidence/2026-11-16-door-robustness/EVIDENCE.md`
1.1). TradingView publishes no per-formula series or node limit; those two caps are our performance
budgets. The honest version needs a cap ruling (coordinator, with the compute cost measured: ruling
A of the door-robustness unit made it a separate unit). Then the freed scripts need captures grading
MATCH, because a deeper look-back changes which bars a value reads during warm-up. **Size: small**
engine change (`budget.js` and its Python twin), **medium** with the measurement and captures.
- ⭐ **Ruled the same day, on measurement: no cap is raised**
  (`docs/pine/evidence/2026-11-17-compute-caps/EVIDENCE.md`). On 5,000 daily bars the scripts a raise
  frees cost 1.19 s to 441 s per compute on the host lane, the four the runtime lane serves today cost
  6.7 to 110 ms there (and the door asks the host lane first, so a raise would move them), and the two
  committed scripts a raise would newly serve grade DIVERGE against their captures. Sections 6 and 7 of
  that record name the costs found at today's caps and what would let a cap move.
