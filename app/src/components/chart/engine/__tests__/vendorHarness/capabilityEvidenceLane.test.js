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
import { __permitRuntimePaneForTests, runtimePaneEnabled } from '../../runtimePaneGate'
import {
  __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList, __resetRuntimeAdmission,
  setRuntimeCapabilityAdmission, latchRuntimeAdmission, runtimeSourceHash,
} from '../../runtimeKill'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')

const registry = JSON.parse(fs.readFileSync(path.join(REPO, 'api/data/pine_runtime_allowlist.json'), 'utf8')).capabilities
const verdicts = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/pine/vendor-harness/runtime-on/verdicts.json'), 'utf8'))
const fileOf = Object.fromEntries(verdicts.results.map((r) => [r.id, r.file]))
const evidence = [...new Set(Object.values(registry)
  .filter((r) => r && r.admitted === true)
  .flatMap((r) => r.evidence.map((e) => e.capture)))].sort()

function sourceOfCapture(id) {
  return loadCapture(path.join(REPO, fileOf[id])).capture.source.text
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

  it.each(evidence)('%s takes the runtime lane', (id) => {
    expect(fileOf[id], id).toBeTruthy()
    expect(laneOf(id)).toBe('runtime')
  })

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
  'docs/pine/evidence/2026-11-13-capability-admission/runs/report.json'), 'utf8'))

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

  it.each(report.captures.map((c) => [c.capture, c.lane]))('%s: %s', (id, lane) => {
    const source = sourceOfCapture(id)
    latchRuntimeAdmission(runtimeSourceHash(source), { admitted: true })
    const d = memberPaneDefinition({ source, id: 'u_capreach', name: 'reach lane' })
    expect(d.ok ? (d.lane || 'host') : null).toBe(lane)
  })
})
