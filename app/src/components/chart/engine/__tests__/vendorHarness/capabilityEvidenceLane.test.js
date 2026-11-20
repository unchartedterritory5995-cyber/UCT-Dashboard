// app/src/components/chart/engine/__tests__/vendorHarness/capabilityEvidenceLane.test.js
//
// ─── WS-I PART 2 (2026-11-13) — EVERY CAPABILITY'S EVIDENCE WAS DRAWN BY THE RUN ──
//
// An admitted capability (`api/data/pine_runtime_allowlist.json` `capabilities`) names
// captures graded MATCH with the runtime pane on. A capture the HOST lane drew says
// nothing about the runtime lane, so each evidence capture's script must take the
// RUNTIME lane through the member door (`memberPaneDefinition`, a permitted member,
// every script graded: the harness's runtime-on mode). `tests/test_pine_capability_
// admission.py` (A8) holds the same ids to the committed runtime-on verdicts.

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { asMember } from '../../../../../testing/runtimeGate'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { loadCapture, gradeCapture, REPO } from './harness'
import { fixturePath, itNeedsHeld } from '../../ast/__tests__/licenceHeld'
import { __permitRuntimePaneForTests, runtimePaneEnabled } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, latchRuntimeAdmission, runtimeSourceHash } from '../../runtimeKill'
import { memberPaneDefinition, __forceRuntimeLaneForTests } from '../../../builder/memberPane/memberPaneDefinition'
import { strategyBrokerFlag } from './strategyLane'
import { heldHolds, heldPinsOf, heldReading } from './storeHeld.js'
import { loadPineLibraryStoreFromEnv } from '../../ast/__tests__/pineLibraryStoreLoader.js'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
// ⭐⭐ (strategy-decl admission) — the strategy broker's flag ON, as the production build arms it (`Dockerfile.web`) and
// as the reach run measured it (`capabilityAdmission.measure.test.js`): a strategy's door mints the broker document
vi.stubEnv(strategyBrokerFlag(), '1')

const registry = JSON.parse(fs.readFileSync(path.join(REPO, 'api/data/pine_runtime_allowlist.json'), 'utf8')).capabilities
const verdicts = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/pine/vendor-harness/runtime-on/verdicts.json'), 'utf8'))
const fileOf = Object.fromEntries(verdicts.results.map((r) => [r.id, r.file]))
// ⭐ STORE-HELD (libraries chain, coordinator ruling 2026-11-19): the snapshot is graded with production's library
// store, and each row that needed it names the versions (`storeHeld`, `./storeHeld.js`). Library code is never
// committed, so where the store is not loaded (CI) such a case is SKIPPED BY NAME, saying which versions it needs,
// exactly as a licence-held capture is; with `PINE_LIBRARY_STORE` set to production's store it runs.
loadPineLibraryStoreFromEnv()
// ⭐⭐ (2026-11-19) both kinds of held input: a row graded with a local supply record (`supplyHeld`) is skipped by name
// where that record is not held, exactly as a store-held row is (`./storeHeld.js::heldHolds`)
const pinsOf = Object.fromEntries(verdicts.results.map((r) => [r.id, heldPinsOf(r)]))
function itNeedsHeldAndStore(id, name, fn, timeout) {
  const pins = pinsOf[id] || []
  if (pins.length && !heldHolds(pins)) return it.skip(`${name} [${heldReading(pins)}]`, fn, timeout)
  return itNeedsHeld(fileOf[id] ? [fileOf[id]] : [], name, fn, timeout)
}
const evidence = [...new Set(Object.values(registry)
  .filter((r) => r && r.admitted === true)
  .flatMap((r) => r.evidence.filter((e) => e.runtimeLane !== 'forced').map((e) => e.capture)))].sort()
// ⭐⭐ admit:request-other (coordinator ruling 2026-11-19) — an evidence entry marked `runtimeLane: "forced"` names a capture
// the member door draws on the HOST lane: its runtime-lane witness is the harness's forced lane
// (`memberPaneDefinition.js::__forceRuntimeLaneForTests`, #1985's REQ-B1). Each is held below to exactly that: the door
// draws it on the host lane (so the flag is true), forced it takes the runtime lane, and there it grades MATCH.
const forcedEvidence = [...new Set(Object.values(registry)
  .filter((r) => r && r.admitted === true)
  .flatMap((r) => r.evidence.filter((e) => e.runtimeLane === 'forced').map((e) => e.capture)))].sort()

// ⛔ A licence-held capture (docs/pine/vendor-harness/licence-held.json) is read from the local
// capture store when it is on this machine, and its case is SKIPPED BY NAME when it is not.
function sourceOfCapture(id) {
  return loadCapture(fixturePath(fileOf[id]) || path.join(REPO, fileOf[id])).capture.source.text
}

function laneOf(id) {
  const source = sourceOfCapture(id)
  const d = memberPaneDefinition({ source, id: 'u_capevidence', name: 'evidence lane' })
  return d.ok ? (d.lane || 'host') : `refused:${d.guard}`
}

describe('WS-I Part 2 — every admitted capability\'s evidence was drawn by the run', () => {
  beforeAll(() => {
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
  })

  it('there is evidence to check (a rail over nothing passes)', () => {
    expect(evidence.length).toBeGreaterThanOrEqual(10)
    expect(runtimePaneEnabled()).toBe(true)
  })

  for (const id of evidence) {
    itNeedsHeldAndStore(id, `${id} takes the runtime lane`, () => {
      expect(fileOf[id], id).toBeTruthy()
      expect(laneOf(id)).toBe('runtime')
    })
  }

  it('CONTROL: a capture the host draws reads host (the probe can say no)', () => {
    expect(laneOf('atr-bands-spy-1d-2026-10-03')).toBe('host')
  })

  for (const id of forcedEvidence) {
    itNeedsHeldAndStore(id, `${id}: the door draws it on the host lane; FORCED, the runtime lane MATCHES`, () => {
      expect(fileOf[id], id).toBeTruthy()
      expect(laneOf(id)).toBe('host')
      __forceRuntimeLaneForTests(true)
      try {
        expect(laneOf(id)).toBe('runtime')
        const capture = loadCapture(fixturePath(fileOf[id]) || path.join(REPO, fileOf[id])).capture
        expect(gradeCapture(capture).verdict.verdict).toBe('MATCH')
      } finally { __forceRuntimeLaneForTests(false) }
    }, 240000)
  }
})

// ─── THE REACH RUN'S LANES ARE THE DOOR'S (coordinator ruling 2026-11-13) ─────────
// `tests/test_pine_capability_admission.py` (REACH) reads the committed reach run
// (`runs/report.json`): no capture the RUNTIME lane draws under admission may DIVERGE.
// That is only true if the lanes it records are the door's, so each admitted capture
// is asked again here as the reach run asked it: the allowlist EMPTY, capability
// admission ON, the server's verdict (admitted) latched.
const report = JSON.parse(fs.readFileSync(path.join(REPO,
  'docs/pine/evidence/2026-11-16-draw1-drawing-objects/runs/report.json'), 'utf8'))
// ⭐ HIST (Engine 64 (#1450), feat/pine-coverage-runtime-history) re-pinned one row of that report, lane
// `null` -> `runtime`: `kernel-channel-backquant-rddt-1d-2026-11-14` (a helper with history in a `?:` arm,
// now drawn while the arm runs every bar; runtime-on MATCH). `momentum-based-zigzag-rddt-1d-2026-11-14`
// left the report: the runtime lane reaches it too, its runtime-on grade is DIVERGE, so it is on the
// committed kill list and no longer admitted (docs/pine/evidence/2026-11-16-runtime-history/EVIDENCE.md).
// ⭐ TF-FOLD (request unit PR 1, NUMBER PENDING) re-pinned the two cppivot-boss-floor-pivots rows (and its
// `admittedGraded` row), lane `null` -> `runtime`, runtime-on MATCH (27 / 27 on RDDT and SPY 1D): the runtime lane
// now reads its six-hop request timeframe (docs/pine/evidence/2026-11-19-request-unit/EVIDENCE.md); the
// population block re-derived (`capability_admission.py::populations_of`).
// ⭐ (request unit PR 2, NUMBER PENDING) re-pinned one `admittedUngraded` row, lane `null` (`pine:request`) -> `runtime`:
// `reference:saty-atr-levels__99165984ef`. The runtime lane now reads its timeframe written as a call to its own function
// (`timeframe_func()`) and its extended-session own ticker at the chart's own "D" (EXT-OWN); asked as the reach run asks
// it (this file's member door), the door answers `runtime`. Its captures are licence-held (MATCH 32 / 32 on RDDT and SPY
// 1D, runtime-on: docs/pine/evidence/2026-11-20-request-unit-pr2/EVIDENCE.md); the population block re-derived.
// ⭐ DRAW-1 (engine 66, feat/pine-coverage-drawings): the reach run is RE-DERIVED on the engine-65 train
// tree (input, CAPADMIT_MODE=admission, report), so it carries HIST's rows above as the tool answers them.
// ⭐ ROUTE BY COST (Engine 73 (#1711), feat/route-by-cost) re-pinned 14 rows, lane `host` -> `runtime`: the
// door now moves a host document whose recurrences hold the main thread to the runtime lane when that lane
// draws the same picture (docs/pine/evidence/2026-11-17-host-lane-cost/EVIDENCE.md), and these 7 scripts'
// captures are the ones it moves (btc-charlie, pivot-point-supertrend, qqe-signals, trend-duration-forecast,
// trendlines, twin-range-filter, vw-ratchet-stops; RDDT and SPY each). Each was graded on the runtime lane
// after the change: 14 of 14 MATCH, every plot and object (and `runtimeOn` was MATCH in this report already).
// ⭐ PINE'S TOLERANT COMPARE (engine 78, feat/pine-tolerant-compare-engine, #1858) added 4 rows, lane `host`:
// contraction-box-doji-lines' RDDT and SPY captures. Its runtime kill entry was lifted on its own condition (both SPY
// captures re-grade MATCH runtime-on, run 44319610649), so the registry now admits it. The door answers `host` for
// all four, each MATCH on both lanes (docs/pine/evidence/2026-11-18-tolerant-compare/EVIDENCE.md).
// ⭐ U-STMT PR 1 (engine 82, feat/pine-statements, #1930) removed 3 rows, lane `null`:
// machine-learning-moving-average-backquant's RDDT and SPY captures. `ta.change(source, length)` on the runtime lane
// builds it, so this rail found the door answering `runtime` for all three; on that PR's run (44427583401) RDDT grades
// MATCH twice and SPY DIVERGE (the run stops at the array-operation limit). By the REACH stop rule the script is on
// the committed kill list, no longer admitted, and so no longer in the report
// (docs/pine/evidence/2026-11-18-ustmt-change-length/EVIDENCE.md).
// ⭐ PARITY UNIT LF step 1 (#1941, feat/parity-lf-run-owned) re-pinned 4 rows, lane `null` -> `runtime`: a runtime
// document whose host object program is clean now draws its RUN's drawings, so the door no longer refuses these probes
// (`pine:drawing` / `pine:collection`): rs-arm-label-last-bar RDDT and SPY 2026-11-15, and vw-object-gc-d SPY 1D and 1W
// (the 1W capture's id repeats the 1D one). Graded runtime-on in #1941's pine heavy run (44450876200): MATCH, MATCH,
// MATCH and INCONCLUSIVE (was INCONCLUSIVE, refused); none DIVERGES, so none is a REACH stop.
// ⭐ CO-2 (engine 84, feat/pine-theme-colours-runtime, #1984) removed 3 rows, lane `null`:
// volatility-coil-edge-bullbyte's RDDT (2026-11-14, 2026-11-17) and SPY captures. Theme colours on the runtime lane
// build it, so this rail found the door answering `runtime` for all three; on that PR's run (44482355116) all three
// grade DIVERGE (its "Signal Bar BG" background is not drawn). By the REACH stop rule the script is on the committed
// kill list, no longer admitted, and so no longer in the report
// (docs/pine/evidence/2026-11-18-co2-theme-colours-runtime/EVIDENCE.md).
// ⭐ A2 (engine 84, feat/pine-named-args-minmax, #1986) re-pinned 2 rows, lane `host` -> `runtime`:
// optimized-keltner-channels-sltp-strategy-for-btc's RDDT and SPY captures. A named argument on a served built-in
// (`color.new`, `array.new`) now builds it on the runtime lane, so this rail found the door answering `runtime`. On
// that PR's run (44482185005) every compared item agrees, but the runtime lane runs the strategy's broker and the
// captures hold no Strategy Tester report, so both grade INCONCLUSIVE (as seven committed strategy captures already
// do), not DIVERGE: no stop (docs/pine/evidence/2026-11-19-a2-named-builtin-args/EVIDENCE.md).
// ⭐ PARITY UNIT LF step 3 (feat/parity-lf3-admit-linefill-e84, engine 84): the reach run is RE-DERIVED (input,
// CAPADMIT_MODE=admission, report) after admitting obj:linefill. 25 rows join, none moves: the 16 captures of the
// scripts whose last unadmitted capability was obj:linefill (trend-targets x6 and FVG Finder x2 on the runtime lane;
// liquidity-pools, price-action-as-in-book, k-clustering and vdubus-pattern-gen-v2 x2 each on the host lane) and 9
// captures new since the report was last derived (vw-fcmp-arrays x2, macd-shortlong-strategy-is and
// supertrend-strategy-is on the runtime lane; vw-w4-max-bars-back-m1..m4 host, m5 runtime). Stops: vw-deadband only
// (named); MATCH -> DIVERGE: none (docs/pine/evidence/2026-11-18-admit-obj-linefill/EVIDENCE.md section 7).

describe('WS-I Part 2 — the reach run records the lanes the door itself answers', () => {
  // ⭐⭐ THE MEMBER'S DOOR, EXACTLY (GATE-BLIND follow-up (a), 2026-11-19): the allowlist EMPTY, capability admission
  // ON (each script's verdict latched admitted below) and the host lane's KNOWN-DIVERGENCE LIST APPLIED, as the
  // committed reach run is now derived (`capabilityAdmission.measure.test.js` under asMember). With the list applied,
  // 25 rows that read `host` take the runtime lane and 3 are refused by name (`pine:known-divergence`); the runtime-on
  // record grades those on the lane the member gets (`vendorHarness.corpus.test.js`, `memberDoorsAtCollection`).
  // ⚰️ Until 2026-11-19 it narrowed these doors in a beforeAll, so every case ran under the test grant (every script
  // graded, the list ignored): the admission verdicts it latched were never consulted, and 31 rows answered `host`.
  asMember({ allow: true, hkd: true, admission: true })

  it('records captures, some drawn by the run (a rail over nothing passes)', () => {
    expect(report.captures.length).toBeGreaterThanOrEqual(100)
    expect(report.captures.filter((c) => c.lane === 'runtime').length).toBeGreaterThanOrEqual(10)
  })

  for (const { capture: id, lane } of report.captures) {
    itNeedsHeldAndStore(id, `${id}: ${lane}`, () => {
      const source = sourceOfCapture(id)
      latchRuntimeAdmission(runtimeSourceHash(source), { admitted: true })
      const d = memberPaneDefinition({ source, id: 'u_capreach', name: 'reach lane' })
      expect(d.ok ? (d.lane || 'host') : null).toBe(lane)
    })
  }
})
