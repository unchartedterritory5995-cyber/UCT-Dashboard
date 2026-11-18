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
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { loadCapture, REPO } from './harness'
import { fixturePath, itNeedsHeld } from '../../ast/__tests__/licenceHeld'
import { __permitRuntimePaneForTests, runtimePaneEnabled } from '../../runtimePaneGate'
import {
  __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList, __resetRuntimeAdmission,
  setRuntimeCapabilityAdmission, latchRuntimeAdmission, runtimeSourceHash,
} from '../../runtimeKill'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { strategyBrokerFlag } from './strategyLane'

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
const evidence = [...new Set(Object.values(registry)
  .filter((r) => r && r.admitted === true)
  .flatMap((r) => r.evidence.map((e) => e.capture)))].sort()

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
    itNeedsHeld(fileOf[id] ? [fileOf[id]] : [], `${id} takes the runtime lane`, () => {
      expect(fileOf[id], id).toBeTruthy()
      expect(laneOf(id)).toBe('runtime')
    })
  }

  it('CONTROL: a capture the host draws reads host (the probe can say no)', () => {
    expect(laneOf('atr-bands-spy-1d-2026-10-03')).toBe('host')
  })
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

describe('WS-I Part 2 — the reach run records the lanes the door itself answers', () => {
  beforeAll(() => {
    __permitRuntimePaneForTests()
    __resetRuntimeAllowList()
    __resetRuntimeAdmission()
    setRuntimeCapabilityAdmission(true)
  })

  it('records captures, some drawn by the run (a rail over nothing passes)', () => {
    expect(report.captures.length).toBeGreaterThanOrEqual(100)
    expect(report.captures.filter((c) => c.lane === 'runtime').length).toBeGreaterThanOrEqual(10)
  })

  for (const { capture: id, lane } of report.captures) {
    itNeedsHeld(fileOf[id] ? [fileOf[id]] : [], `${id}: ${lane}`, () => {
      const source = sourceOfCapture(id)
      latchRuntimeAdmission(runtimeSourceHash(source), { admitted: true })
      const d = memberPaneDefinition({ source, id: 'u_capreach', name: 'reach lane' })
      expect(d.ok ? (d.lane || 'host') : null).toBe(lane)
    })
  }
})
