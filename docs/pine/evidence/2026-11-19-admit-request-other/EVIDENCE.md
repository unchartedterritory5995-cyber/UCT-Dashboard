# admit:request-other: request.security admitted by capability, for closed-bar history (2026-11-19, engine 84)

Coordinator rulings (2026-11-18 / 2026-11-19, step C of the request unit). The unblock order, approved:
1. B1 and B2 numbered (engine 84, #2006);
2. promote the request witnesses;
3. regenerate both snapshots at 84;
4. kill the DIVERGE sources;
5. add the row as its own PR, stamped.

Plus the e84 train's finding, folded in here: the REACH report's population block is derived from its rows, never kept
by hand. Branch `feat/admit-request-other-e84` from master `0edf93b82b` (engine 84). No engine number: data, rails and
one admission rule.

## 1. The answer

- **`request-other` is admitted, scope `closed-bar-history`** (`api/data/pine_runtime_allowlist.json`, stamped at
  engine 84 by `tools/pine_coverage/stamp_admission.py`).
- **Evidence: two community scripts, six captures, every one runtime-on MATCH at engine 84:**
  - **PA ZigZag Fibonacci FAN** (`F`, MPL-2.0) at Alt Timeframe 1W and 1M, on NYSE:RDDT and AMEX:SPY 1D from the
    listing. 10 / 10 items each, drawn by the runtime lane: #1958's region series (engine 82) and the harness's
    moved-timeframe seam.
  - **Support and Resistance Multi Time frame** (`SNR`, `//@version=4`) on RDDT and SPY 1D 2026-10-02. The member door
    draws SR-MTF on the HOST lane, so these two entries say `runtimeLane: "forced"`: their runtime-lane witness is the
    harness's forced lane (#1985). `capabilityEvidenceLane.test.js` holds each to that flag: host at the door, runtime
    forced, MATCH there.
- **Closed-bar history only.** `request-other` joins `rollout_gate.PINE_CAPABILITY_FORMING_UNGRADED`, so the member door
  refuses a script admitted on it by name while the newest bar is forming. Every capture that admits it holds a
  finished newest bar. On a forming one, a look-ahead-on weekly or monthly read is withheld by name, and the
  look-ahead-off developing value is witnessed only by an uncommitted probe. Q-HTF-FORM (#1994) is the capture that
  can lift this.
- **The reach (the tool's three steps, below).**
  - Admitted captures: 555 -> 753.
  - The one stop: `vw-deadband-ticks-brk-a-1d-2026-09-28`, the named WITHHELD_WHOLE case, unchanged.
  - MATCH -> DIVERGE: none.
  - Runtime-drawn captures: 182, all MATCH or INCONCLUSIVE but that stop.
- **Killed, by source hash (the DRAW-1 rule).** Eleven sources this row newly admits have a committed capture grading
  DIVERGE on either lane:
  - **8 corpus sources:** artemis-oscillator-pro, average-day-range-adr-pivots,
    dual-view-htf-candlestick-patterns-theultimator5, ema-ribbon-trend-filter-strixedge, htf-liquidity-dashboard-tfo,
    pmax-explorer, position-size-calc, vold-market-breadth;
  - **3 probes:** request-realtime-alignment, rs-seed-rsrating, vw-other-symbol.

  Each entry names its capture, the difference in the member's words, and its `liftWhen`.
- **NOT killed: rs-rating-fred6724** (coordinator ruling). It is served through its own sha allowlist entry and is left
  out of this row's evidence. Its four runtime-on DIVERGE captures are named and re-proved in
  `SERVED_BY_OWN_SHA`, and the door draws them on the host lane under admission:
  - pc-agl / pc-nvda / pc-rddt 2026-11-17: the rating labels are withheld by name (`pine:object-removal-lost`) where
    TradingView holds two; every plot agrees;
  - pm-alab 2026-11-16: one label's y on the newest bar after the close, the after-close SP:SPX read TradingView itself
    answered two ways (Q-SPX-AFTERCLOSE).

  Its production-lane DIVERGE captures are further known differences; the coordinator's ruling names pre-2023 history
  and the SPX 60m vendor hole among them (not re-measured here). Those are outside this row: it does not serve the
  script.

## 2. The REACH report's population block, derived (the e84 train's finding)

`runs/report.json` carried a `populations` block written once per run and then edited by hand beside spliced rows. Git
merged two units' identical edits to it as ONE, and after #1941's re-pins master's block was 4 rows off its own rows
(capture: block runtimeLane 165 / refused 140, rows 169 / 136).

- `capability_admission.py::populations_of` derives the block from the rows. Every admitted script now has exactly one
  row: `captures`, `admittedUngraded`, or the new `admittedGraded` (an admitted script whose source a capture grades,
  which the block counted and no row listed). `populationSizes` carries the run's population sizes.
- The generator refuses to write a report whose refusals (door `ok`) disagree with its rows' lanes.
- The rail `test_REACH_the_population_block_is_derived_from_its_rows` recomputes the block and holds `capture` /
  `committed` sizes to the snapshot and to `corpus/committed`. Its controls: a moved lane, and a dropped row. Mutants
  C1-C3 below.

## 3. Runs (local steps under the heavy lock, VITEST_MAX_WORKERS=1)

| step | result |
|---|---|
| promote | 6 captures from the store (MPL-2.0, `corpus_licence`: commit): `pa-zigzag-fibonacci-fan-alt{w,m}-{rddt,spy}-1d-2026-11-17` (run rozz-2026-11-18), `support-and-resistance-multi-time-frame-{rddt,spy}-1d-2026-11-18` (run adm-2026-11-18) |
| snapshots | the corpus test, both lanes, stores pinned EMPTY as pine heavy pins them: engine 84, 954 results each; against engine 84's train run (44521764546) no verdict moved on either lane, six added (runtime-on MATCH x6; production MATCH x2, INCONCLUSIVE x4 for the moved setting) |
| REACH | `capability_admission.py input` (954 captures, 266 corpus, the local 271 reference + 142 built-in sample) -> `capabilityAdmission.measure.test.js CAPADMIT_MODE=admission` (3 min) -> `report` |
| stamp | `stamp_admission.py request-other`: engine 84 |
| rails, local | pytest `test_pine_capability_admission`, `test_pine_capabilities`, `test_pine_runtime_switch_on`, `test_pine_parity_roadmap`, `test_runtime_definitions` (346 passed), `test_pine_host_known_divergence` (11), `test_corpus_licence_rail` (20); vitest `capabilityEvidenceLane` + `reqBareSecurityForced` (820 passed: every REACH lane re-asked of the door, both forced entries MATCH) |
| remote lane, pine heavy, mutants | the PR description |

Mutants (`runs/mutants-manifest.json`):
- C1 the block drifts one row;
- C2 the derivation counts host as runtime;
- C3 the derivation drops the graded rows;
- C4 request-other admitted for every bar;
- C5 the kill rail stops exempting the sha-served script;
- C6 a sha-served capture with a diverging plot still reads as its named difference;
- C7 one kill loses its source;
- C8 SR-MTF's evidence loses its forced flag.
