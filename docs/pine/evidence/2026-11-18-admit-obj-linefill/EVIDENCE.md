# `obj:linefill` admission: graded at engine 74, and NOT admitted (2026-11-18)

Ask (coordinator, parity roadmap unit `admit:obj:linefill`, PR #1766): the roadmap reads the evidence as READY
(`fvg-detector-tradingfinder-…` and `trend-targets-algoalpha` grade runtime-on MATCH on committed captures).
Confirm every clause of the admission rule, re-grade at the current engine number, and add the `obj:linefill`
registry row if the evidence meets the rule.

Base: `origin/master` `c233623449` (`SCRIPT_ENGINE_VERSION = 74`, the e74 train #1785 plus #1770). Branch
`feat/admit-obj-linefill`. No engine number: nothing here changes what a stored script computes.

## 1. The answer

- **`obj:linefill` is NOT admitted.** `api/data/pine_runtime_allowlist.json` is unchanged; the rails that pin
  linefill as withheld (`test_U3b_linefill_is_withdrawn_until_an_x_graded_capture_carries_it`,
  `test_A7_the_committed_object_families_are_U1s_four_and_U3s_two`, the two member-copy examples) stay as they are.
- **One script meets the object clauses, not two.** FVG Finder's run draws its linefills and grades objects v2
  MATCH on them. AlgoAlpha Trend Targets grades MATCH too, but **its run does not draw its drawings**: the
  member door carries the host object program (64 ops) in the runtime document, so its lines, labels and
  linefills are the host lane's (`objectsLane` is host). The registry readme has said so since PR #1374 and
  DRAW-1 re-checked it; the roadmap's `runtimeDrawnWithMatch` reads the document's lane, not the objects' lane.
- **And AlgoAlpha has a capture that DIVERGES at engine 74**: `trend-targets-algoalpha-spy-1d-2026-11-17`
  (promoted at e73 after the committed runtime-on snapshot was last written, so the snapshot does not hold it):
  runtime-on DIVERGE, 1 of 7 items, a paint (`barcolor` plot_6 "Bar Color", bar 200: vendor `#ff110080`, ours
  `#00000000`). That capture is not asserted from the listing (`history.startsAtBar0: not asserted`, 8,509 bars);
  the 11-15 SPY capture from the listing grades MATCH. Under the safety rule a row admitting AlgoAlpha would
  have to kill it, and a killed script is evidence for no object family.
- **Served to members: 275 / 679 before and after** (no registry change).

## 2. The rule, clause by clause

`rollout_gate.pine_capability_admission` + A8 (`tests/test_pine_capability_admission.py`), as
`docs/pine/evidence/2026-11-17-admit-strategy-decl/EVIDENCE.md` section 2 reads it, plus the `obj:*` clauses.

| clause | FVG Finder (`fvg-detector-tradingfinder-…`) | AlgoAlpha Trend Targets |
|---|---|---|
| community script (`pine_evidence_script`) | yes ("FVG Finder") | yes ("AlgoAlpha - Trend Targets") |
| distinct family | 1 | 2 |
| runtime-on verdict MATCH, at engine 74 | 11-14 MATCH, 11-15 MATCH (ledger rows at 74, this PR) | 10-02 x2, 11-15 x2, 11-17 RDDT MATCH; **11-17 SPY DIVERGE** (ledger rows at 74) |
| drawn by the runtime lane (`CAPADMIT_MODE=lanes` door) | runtime | runtime |
| objects drawn by the RUN (`objectsLane: runtime`: `compute.objects === true`) | **yes** | **no**: `compute.objects` false, host object program of 64 ops carried |
| objects v2 MATCH, linefills paired (committed snapshot) | 11-15: MATCH, linefills 22 paired / 0 differing, x 110 / 110 | 11-15: MATCH, linefills 2 / 0, x 15 / 15 (but host-drawn) |
| x grade, no DIVERGE | 11-15 x MATCH; 11-14 has no x table (objects v2 INCONCLUSIVE, does not count) | x MATCH where graded |
| on no kill list, no DIVERGE capture | yes | **no**: 11-17 SPY DIVERGE |
| counted toward `obj:linefill` | 1 capture | 0 |

Counted: **1 capture of 1 script** (FVG Finder 11-15). The rule needs 2 captures of 2 distinct scripts.

## 3. Every script the row would admit, and the DIVERGE check

The row would make four sample scripts servable (the roadmap's sole four), plus every other source whose only
unadmitted capability is `obj:linefill`. Graded at engine 74:

| script | where its capture lives | runtime-on at 74 | objects drawn by the run |
|---|---|---|---|
| `committed:fvg-detector-tradingfinder-…` | committed | MATCH x2 | yes |
| `committed:trend-targets-algoalpha` | committed | MATCH x5, **DIVERGE x1** (SPY 11-17, paint) | no (host program) |
| `builtin:linear-regression-channel` | licence-held, local only | MATCH (was DIVERGE at engine 54) | yes |
| `reference:best-sr-indicator-with-candlestick-patterns` | licence-held, local only | MATCH x2 | yes |

Committed captures of other sources the row would admit (`linefill` the only missing capability): K-clustering
(INCONCLUSIVE x2), Liquidity Pools (MATCH x2, host-drawn), Price action as in book (MATCH x2, host-drawn), Vdubus
Gen V2 (MATCH, INCONCLUSIVE; host-drawn). The full runtime-on harness at engine 74 is in section 5.

`builtin:linear-regression-channel` and `best-sr-indicator` are run-drawn and MATCH at 74, but both captures are
licence-held (LEDGER_ONLY): the ledger row carries the verdict, not the objects v2 grade, so A8 cannot hold an
`obj:*` entry for them (`objectsV2`, `objectsPaired`, `objectsX` are read off the committed runtime-on snapshot).
They cannot be the second script without either a licence-permitted capture or an objects v2 record in the ledger.

## 4. What would admit it

1. A second community script whose RUN draws linefills, with a committed (licence-permitted) capture graded
   runtime-on MATCH, objects v2 MATCH with linefills paired and an x table. No such capture exists today: of the
   215 sample scripts that use `obj:linefill` or `request-other`, the runtime lane draws 7, and the only
   run-drawn linefill scripts are FVG Finder and the two licence-held ones above.
2. Or AlgoAlpha's drawings on its own run (a door change: the run owns the objects only where the host program
   draws nothing, `memberPaneDefinition.js::runtimeLaneDefinition` / `runtimeOwnObjectsOf`), with its SPY paint
   settled: an engine unit, not evidence.
3. Or the evidence ledger recording an objects v2 grade per row, with A8 reading it for a LEDGER_ONLY `obj:*`
   entry (an evidence-engine and rail change), which would let best-sr or linear-regression-channel count.

## 5. Runs (engine 74, `c233623449`)

All at `c233623449` (engine 74), every heavy step under the machine-wide heavy lock, `--maxWorkers=1`, the
head recorded before and after (the branch commits change only `evidence-ledger.jsonl`). Outputs stay in a local
scratch directory; only identifiers and counts are written here.

| run | result |
|---|---|
| member door, `lanes` mode (every script graded, the runtime pane on; `capabilityAdmission.measure.test.js`'s door, plus whether `compute.objects` is true), over the 253 committed captures and 209 local-only captures that use `obj:linefill` or `request-other`, the 215 sample scripts that do, and 6 timeframe variants | runtime lane 24 rows: fair-value-gap x2, FVG Finder x2, PA ZigZag x2, AlgoAlpha x4 (objects: host program, 64 ops), linear-regression-channel (held) x1, best-sr-indicator (held) x2, the 7 sample scripts, PA ZigZag at W / M / 1D, fair-value-gap at 1D (at W and M: refused `runtime:unbound`); identical to the same measurement at engine 73 |
| vendor harness, runtime-on, every committed capture (`tests/fixtures/vendor`) | 915 graded: MATCH 312, DIVERGE 79, INCONCLUSIVE 504, MATCH_SUBSTITUTED 20; `LANE MEASURED: runtime-on (gate OPEN, runtime lane reached 499 ...) runtime drew 192, declined 307`; 5.4 min. Against the committed snapshot 34 captures move, every one a strategy (W9 broker probes, macd / tradingview-alerts / supertrend strategies) or two `vw-` probes; no `obj:linefill` or `request-other` capture moves |
| vendor harness, production | 915 graded: MATCH 207, DIVERGE 81, INCONCLUSIVE 627; 5.1 min |
| `evidence_engine.py regrade` (both lanes, its own lock) | 11 captures, 11 ledger rows at engine 74 (grader `5500f8f1c291`, this PR): runtime-on 10 MATCH, 1 DIVERGE (AlgoAlpha SPY 11-17) |
| census, both lanes, and the engine door (`run_census.py`, `coverageMapDoorCensus.measure.test.js`), the 11-17 sample manifest | 967 / 967 rows each lane; map: host-only 220 / 679, runtime-on 285 / 679, runtime-attached 88 |
| `parity_roadmap.py facts` + `build` (master's registry) | **SERVED 275 / 679** (allowlisted 1, capability 54, not admitted 10), as at engine 73 |
| the same with a hypothetical row (a temp copy of the registry; the committed file untouched) | `obj:linefill` admitted: 279 / 679 (+4: FVG Finder, AlgoAlpha, linear-regression-channel, best-sr-indicator) |

## 6. Addendum, same day: the follow-up captures, graded at engine 75 (still NOT admitted)

patrick-54 took the rows sent for this unit (run `adm-2026-11-18`, local; packet `b416f5fa…`; all from the listing,
defaults, x table recorded). Filed as ledger rows at engine 75 (`evidence_engine.py regrade`, both lanes; grader
`5500f8f1c291`) and graded on the runtime-on lane at `394853a21e`:

| capture | production | runtime-on | objects v2 (runtime-on) | for this unit |
|---|---|---|---|---|
| `trend-targets-algoalpha-spy-1d-2026-11-18` | INCONCLUSIVE (`pine:state`) | MATCH, 7 / 7 | MATCH, linefills 2 / 0, x 15 / 15 | the 11-17 barcolor DIVERGE was the history start (that capture is not from the listing): the safety objection to AlgoAlpha is gone. It still does not count: its objects are the host program's (`objectsLane` host) |
| `fvg-detector-tradingfinder-…-spy-1d-2026-11-18` | INCONCLUSIVE (`pine:no-output`) | MATCH, 1 / 1 | **DIVERGE**: linefills held, vendor 289, ours 250 (lines 500 / 500 paired at the 500 cap, labels 289 / 289, linefills 250 paired, 0 field differing, x 1,289 / 1,289) | a LINEFILL COUNT AT THE LINE CAP: TradingView keeps 39 more linefills than we do once the line collector runs. This capture cannot count (objects v2 is not MATCH), and it is the obj:linefill analogue of `obj:box`'s count-at-cap carve-out: a row would need that carve-out, or the count settled, before FVG Finder's SPY picture reaches a member |
| `vdubus-pattern-gen-v2-restored-refined-rddt-1d-2026-11-18` | MATCH | MATCH | MATCH, linefills 52 / 0, x 245 / 245 | host-drawn (its run builds its drawings but the door keeps the host program): counts only after the roadmap's run-owned-objects change |
| `vdubus-…-spy-1d-2026-11-18` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE: lines withheld by name (`objects:collector`, 500 lines / 505 linefills) | not evidence |
| `k-clustering-{rddt,spy}-1d-2026-11-18` | INCONCLUSIVE | INCONCLUSIVE (`objects:not-computable`) | INCONCLUSIVE | not evidence (TradingView now draws 3 linefills) |

Counted for `obj:linefill` after the follow-up: still 1 capture of 1 script (FVG Finder RDDT 11-15). Two walls stand,
both on the roadmap's objects unit: the run owning a runtime document's drawings (AlgoAlpha, vdubus-pattern-gen-v2),
and the linefill count once the line collector has run (FVG Finder SPY).

## 7. PARITY UNIT LF step 3 (2026-11-18): ADMITTED

Ordered by the coordinator after LF step 1 (#1941: a clean host program's runtime document is drawn by its RUN, the
program beside it) and LF step 2 (#1942: the linefill family is withheld by name once the run's line collector deletes
a filled line). Both steps are on master since engine 82 (#1981). This branch (`feat/parity-lf3-admit-linefill-e84`) is
cut from `origin/master` at ENGINE 84 (`0edf93b82b`, #2006): it is evidence only, no engine number of its own. (It was
first built at engine 81 on `feat/parity-lf-admit-linefill`; every number below is re-measured at engine 84.)

### 7.1 The snapshot

`docs/pine/vendor-harness/runtime-on/verdicts.json` regenerated at this tree at ENGINE 84 (`scriptEngineVersion: 84`,
`vendorHarness.corpus.test.js`, `VENDOR_HARNESS_RUNTIME_ON=1`, under the heavy lock): 948 committed captures, MATCH 331,
DIVERGE 73, INCONCLUSIVE 521, MATCH_SUBSTITUTED 23; `LANE MEASURED: runtime-on (gate OPEN, runtime lane reached 514, host
refusals 546) · runtime drew 211, declined 303 · strategy lane: broker gate ON, 86 graded, 71 broker runs`. Plus the one
licence-held row the snapshot has always carried (`supertrend-kivancozbilgic-rddt-1d-2026-10-02`, graded at this tree
on the same lane: MATCH, all 8 items), 949 rows in all.

Item by item (every plot, objects v1 and v2 with x and per-family counts, paints, strategy), MATCH -> DIVERGE: NONE.
- Against the engine-84 train's own `pine heavy` runtime-on artifact (#2006): 0 captures move. This branch changes no
  engine code, so the regenerated snapshot IS master's engine-84 grade, plus the held row.
- Against the snapshot committed before (engine 78, seeded, with the trains' spliced records): 26 captures move, none
  MATCH -> DIVERGE. 3 are LF step 1's probes, INCONCLUSIVE (refused) -> MATCH (`rs-arm-label-last-bar` RDDT / SPY,
  `vw-object-gc-d` SPY 1D); 23 stay INCONCLUSIVE with a reason engines 79-84 changed (a different first refusal, or
  items not comparable: `vw-object-gc-d` SPY 1W). 9 captures are new since engine 78 (`vw-fcmp-arrays` x2,
  `macd-shortlong-strategy-is`, `supertrend-strategy-is`, `vw-w4-max-bars-back-m1..m5`).

### 7.2 The row

`api/data/pine_runtime_allowlist.json` `capabilities["obj:linefill"]`, 3 captures of 2 community scripts:

| capture | script | runtime-on | objects v2 | linefills paired | x | drawn by |
|---|---|---|---|---:|---|---|
| `fvg-detector-tradingfinder-fair-value-gap-imbalance-mitigated-rddt-1d-2026-11-15` | FVG Finder | MATCH | MATCH | 22 | MATCH (110 / 110) | the run (22 linefills held) |
| `trend-targets-algoalpha-rddt-1d-2026-11-15` | AlgoAlpha - Trend Targets | MATCH | MATCH | 2 | MATCH (15 / 15) | the run (LF step 1) |
| `trend-targets-algoalpha-rddt-1d-2026-11-17` | AlgoAlpha - Trend Targets | MATCH | MATCH | 2 | MATCH (15 / 15) | the run (LF step 1) |

Not evidence, each for its reason:
- `trend-targets-algoalpha-spy-1d-2026-11-15`: objects v2 MATCH, but on AMEX:SPY the run holds its drawings back by name
  (`format:tick-unsettled`: a `format.mintick` text no capture settles), so the HOST program draws them (LF step 1's
  fallback). It is the new rail's control.
- `trend-targets-algoalpha-{rddt,spy}-1d-2026-10-02`, `fvg-detector-…-rddt-1d-2026-11-14`: objects v2 INCONCLUSIVE
  (taken before the x table: U3b's reason).
- `trend-targets-algoalpha-spy-1d-2026-11-17`: INCONCLUSIVE (its history start; not from the listing).

The rule (`rollout_gate.pine_capability_admission`): admitted, conformant, 3 counted captures of 2 scripts, both
community; every entry objects v2 MATCH, `objectsLane: runtime`, `objectsPaired` > 0; no x DIVERGE on any capture of
either source (A8 `_x_vetoed_sources`); neither on the kill list. `pine_capability_admission("obj:linefill", row) == []`.

### 7.3 Who draws each entry: measured, not typed

`vendorHarness.objLinefillEvidence.test.js` (new) asks, per evidence entry, the member door (runtime pane on) and the
binder's own predicate (`runtimeObjects.js::drawsRunObjectsOn`) on the capture's bars: the document's run owns its
drawings, the chart draws the RUN's objects, and the run holds exactly the paired linefills (22 / 2 / 2). Its control,
trend-targets SPY 11-15, answers false (the host program draws there).
Mutant (`runtimeObjectsDoor.js`: LF step 1's run-owned drawings taken away, `if (false)` for the `hostFallback`
return): 3 red (both AlgoAlpha entries and the control, whose run no longer owns its drawings); restored from saved
bytes, byte-equal.

The row is STAMPED by `tools/pine_coverage/stamp_admission.py obj:linefill` against the engine-84 snapshot:
`"admission": {"scriptEngineVersion": 84, "rowSha256": "1391f03e…"}` (A10; the digest is the engine-81 build's, as the
evidence entries did not change). At engine 84 the rail below passes on all three entries and the control.

### 7.4 REACH, re-derived

`capability_admission.py input` (the regenerated snapshot + the local sample cache), the door in
`CAPADMIT_MODE=admission`, `report`, at this tree; `docs/pine/evidence/2026-11-16-draw1-drawing-objects/runs/report.json`
regenerated at engine 84 (578 rows, was 553):
- **Stops (runtime-lane DIVERGE): `vw-deadband-ticks-brk-a-1d-2026-09-28` only**, the named WITHHELD_WHOLE capture, as before.
- **MATCH -> DIVERGE: none.** MATCH_SUBSTITUTED -> DIVERGE: none. No existing row moves lane or grade.
- 25 rows join. The 16 captures of the scripts whose last unadmitted capability was `obj:linefill`: trend-targets x6
  and FVG Finder x2 (runtime lane), liquidity-pools x2, price-action-as-in-book x2, vdubus-pattern-gen-v2 x2 and
  k-clustering x2 (host lane). And 9 captures new since the report was last derived (vw-fcmp-arrays x2 and the two
  `-is` strategies on the runtime lane; `vw-w4-max-bars-back-m1..m4` host, `m5` runtime).
- Populations, derived by the tool from the rows: captures 580 admitted of 949, committed 122 of 266, reference 171 of
  271, builtin 111 of 142.

### 7.5 The licence-held captures of the scripts the row admits (local, never committed)

Graded on the runtime-on lane at this tree, engine 84 (`VENDOR_HARNESS_DIR`, the local store; never committed); every
grade below is the same as at engine 81. No DIVERGE:

| capture | runtime-on | objects v2 |
|---|---|---|
| `fvg-detector-tradingfinder-…-spy-1d-2026-11-18` | MATCH | MATCH (was DIVERGE: TradingView 289 linefills at the line cap, ours 250; LF step 2 withholds the family by name there) |
| `trend-targets-algoalpha-spy-1d-2026-11-18` | MATCH | MATCH |
| `vdubus-pattern-gen-v2-restored-refined-rddt-1d-2026-11-18` | MATCH | MATCH |
| `vdubus-…-spy-1d-2026-11-18` | INCONCLUSIVE | INCONCLUSIVE (lines withheld by name, `objects:collector`) |
| `k-clustering-{rddt,spy}-1d-2026-11-18` | INCONCLUSIVE | INCONCLUSIVE |
| `linear-regression-channel-8b555890-rddt-1d-2026-11-14` | MATCH | INCONCLUSIVE (no x table) |
| `best-sr-indicator-with-candlestick-patterns-rddt-1d-2026-11-15` / `-11-14` | MATCH / MATCH | MATCH / INCONCLUSIVE |

Not evidence (licence-held: the ledger carries no objects v2 grade), and none diverges.

### 7.6 Rails changed

- `tests/test_pine_capability_admission.py`: the admitted set gains `obj:linefill`; the object families gain
  `LF_OBJECT_FAMILIES`; `test_U3b_linefill_is_withdrawn…` becomes `test_LF3_obj_linefill_is_admitted_on_run_drawn_captures`
  (the row, its readme, the captures it must not count, the carve-out in the store); the unadmitted object family in the
  member-copy examples is now `polyline`; `test_RT1_the_trend_targets_kill_is_lifted…` now says the script IS admitted.
- `vendorHarness.objLinefillEvidence.test.js` (new, above).
- REACH: `docs/pine/evidence/2026-11-16-draw1-drawing-objects/runs/report.json` regenerated; `capabilityEvidenceLane.test.js`
  records why.
- Python rails run locally: `test_pine_capability_admission.py` (A1-A10, REACH, RT1), `test_pine_allowlist_measured_verdicts.py`,
  `test_pine_run_half_evidence.py`, `test_pine_capabilities.py`, `test_pine_capability_admission_tool_kill.py`,
  `test_corpus_licence_rail.py`, `test_pine_host_known_divergence.py`, `test_pine_parity_roadmap.py`,
  `test_pine_runtime_switch_on.py`: 356 passed.
