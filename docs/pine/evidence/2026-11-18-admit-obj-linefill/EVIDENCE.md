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
