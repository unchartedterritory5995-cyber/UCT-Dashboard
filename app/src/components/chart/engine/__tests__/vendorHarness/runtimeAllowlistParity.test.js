// app/src/components/chart/engine/__tests__/vendorHarness/runtimeAllowlistParity.test.js
//
// ─── ⭐⭐ W2 (2026-11-02) — THE ALLOWLIST'S MATCH IS RE-GRADED ON EVERY TREE ────
//
// Phase 3 arming checklist P1 / P4 (`docs/pine/PHASE3-RUNTIME-PLAN.md` 4.2). The
// starter allowlist (`api/data/pine_runtime_allowlist.json`) names, for every
// script it serves, the TradingView captures that graded it MATCH with the
// runtime pane ON. Until this rail, that verdict was a RECORD: taken once, by a
// harness run at `b09a6bcee6`, and checked since only for being well formed
// (`tests/test_pine_runtime_switch_on.py` reads the ids, the files and the
// hashes, never the verdict). The engine moved four versions under it.
//
// This rail grades every capture the allowlist names, on THIS tree, through the
// REAL member door, with the gate exactly as a permitted member meets it in
// production: both panes on, the per-member permission granted, and the
// server's allowlist latched from the committed file (⛔ NOT the suites'
// allow-every-script override, which would grade a script the server never
// serves). Each must:
//   1. be drawn BY THE RUNTIME LANE (a host attach would grade the other lane);
//   2. grade MATCH, with every vendor plot compared (non-vacuity).
// A control proves the latch is the real one: a runtime-only script the file
// does not list is declined by the gate, by name (`runtime:not-yet-graded`).
//
// ⛔ It reads only the `sha256` and `captures[].id` fields; WHICH scripts the
// server serves is `rollout_gate.pine_runtime_admission`'s answer (Python), and
// this grades a SUPERSET (every listed script), so it can never be laxer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { loadCapture, gradeCapture, REPO, HARNESS_DIR } from './harness'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { runtimeDeclinedTag } from '../../../../../../../tools/pine_coverage/runtime_lane.mjs'
import { enterMemberDoor } from './ourSide'
import {
  setRuntimeAllowList, setRuntimeKillList, runtimeAllowList, runtimeSourceHash,
  __allowEveryRuntimeScriptForTests,
} from '../../runtimeKill'
import { __permitRuntimePaneForTests, runtimePaneEnabled } from '../../runtimePaneGate'

const ALLOWLIST = path.join(REPO, 'api', 'data', 'pine_runtime_allowlist.json')
const doc = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8'))
const scripts = doc.scripts
const listedHashes = scripts.map((s) => String(s.sha256).toLowerCase())

/** The flag NAMES are read off their gate modules, never typed. */
const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const RUNTIME_FLAG = flagOf('src/components/chart/engine/runtimePaneGate.js')
const OBJECTS_FLAG = flagOf('src/components/chart/engine/objectsOnlyPaneGate.js')

/** A runtime-only corpus script that is NOT on the allowlist (the control). */
const CONTROL = 'cc-yata-rddt-1d-2026-09-27.json'

const capture = (file) => {
  const loaded = loadCapture(path.join(HARNESS_DIR, file))
  if (!loaded.capture) throw new Error(`${file}: not a capture — ${loaded.reason}`)
  return loaded.capture
}

beforeEach(() => {
  vi.stubEnv(RUNTIME_FLAG, '1')
  vi.stubEnv(OBJECTS_FLAG, '1')
  __permitRuntimePaneForTests()
  setRuntimeKillList([])
  // ⛔ THE SERVER'S LIST, not the suites' allow-every override (`src/test-setup.js`)
  setRuntimeAllowList(listedHashes)
})

afterEach(() => {
  vi.unstubAllEnvs()
  setRuntimeKillList([])
  __allowEveryRuntimeScriptForTests()
})

describe('W2 — every allowlisted script still grades MATCH through the runtime lane, on this tree', () => {
  it('⛔ the gate is the production gate: flags on, member permitted, the committed list latched', () => {
    expect(RUNTIME_FLAG).toBe('VITE_PINE_RUNTIME_PANE_ENABLED')
    expect(OBJECTS_FLAG).toBeTruthy()
    expect(runtimePaneEnabled()).toBe(true)
    expect(runtimeAllowList()).not.toContain('*')
    expect(runtimeAllowList()).toEqual(listedHashes)
    expect(scripts.length).toBeGreaterThan(0)
  })

  it('⛔ control: a runtime-only script the allowlist does not name is declined BY THE GATE, by name', () => {
    const cap = capture(CONTROL)
    expect(listedHashes).not.toContain(runtimeSourceHash(cap.source.text))
    const door = enterMemberDoor(cap.source.text)
    expect(door.built.ok).toBe(false)
    expect(door.refusal).toContain(runtimeDeclinedTag('runtime:not-yet-graded'))
    // …and with every script allowed, the same script IS a runtime-lane script:
    // the decline above is the gate, never a lane that cannot build it.
    __allowEveryRuntimeScriptForTests()
    const open = memberPaneDefinition({ source: cap.source.text, id: 'u_w2-allowlist-control' })
    expect(open.ok, open.reason).toBe(true)
    expect(open.lane).toBe('runtime')
  })

  for (const s of scripts) {
    for (const c of s.captures) {
      it(`⭐ ${s.slug} · ${c.id}: drawn by the runtime lane and graded ${c.verdict}`, () => {
        expect(c.verdict).toBe('MATCH')
        expect(c.runtimePane).toBe('on')
        const cap = capture(`${c.id}.json`)
        expect(runtimeSourceHash(cap.source.text)).toBe(s.sha256)
        const door = memberPaneDefinition({ source: cap.source.text, id: 'u_w2-allowlist-probe' })
        expect(door.ok, door.reason).toBe(true)
        expect(door.lane).toBe('runtime')
        const { verdict } = gradeCapture(cap)
        expect(verdict.verdict, verdict.reason).toBe('MATCH')
        const compared = (verdict.plots || []).filter((p) => p.verdict === 'MATCH')
        expect(compared.length, 'every vendor plot compared').toBe(cap.study.plots.length)
      })
    }
  }
})
