// app/src/components/chart/builder/memberPane/runHalfLostDrawings.test.js
//
// ⭐⭐ PARITY UNIT 1 (`objects`, Engine 77, #1824) — a host document whose object program LOST drawings is
// drawn on the chart pane with the run's drawings (its run half, `compute.runtimeObjects`, engine 53),
// the calls it lost included (`runHalfObjectRail.js`, the lost-drawings rule), on a committed script
// measured in docs/pine/evidence/2026-11-18-objects-unit/EVIDENCE.md. What these rails hold:
//
//   · CHART-PANE ONLY. The document the member saves is the HOST document (`compute.kind: 'ast'`) whatever
//     pane the member has: with the runtime pane on it carries the run half beside its formula, and its
//     formula half is byte for byte the document a member with the pane off saves. Every server lane
//     (alerts, scans, backtests, `param_inputs.specialize`) reads a document through
//     `runtime_definitions.is_runtime` (`compute.kind == 'runtime'`), so they read this one's formula,
//     exactly as before (tests/test_run_half_server_lanes.py is the server half of this rail).
//   · NOTHING THE HOST DRAWS IS TAKEN AWAY. With the run half served, every plot column the pane draws is
//     the host's own column, bar for bar, on and off the listing; only the drawings come from the run.
//   · ITS GATES DECIDE FIRST. A script the server has not admitted keeps the host picture.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { memberPaneDefinition, RUN_HALF_SOURCE_STAMP } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { RUN_HALF_DRAWING_SENTENCE } from '../../engine/ast/objectLoss'
import { runHalfOf, runtimeObjectsOf } from '../../engine/runtime/runtimeObjects'
import { runtimeColumnsFor, setRuntimeDoorClock } from '../../engine/runtime/runtimeColumns'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import {
  __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList, __resetRuntimeAdmission,
  setRuntimeCapabilityAdmission, latchRuntimeAdmission, runtimeSourceHash,
} from '../../engine/runtimeKill'
import { setRunHalfObjectEvidence } from '../../engine/runHalfRailSeam'

const REPO = path.resolve(__dirname, '../../../../../..')
const script = (slug) => fs.readFileSync(path.join(REPO, 'corpus', 'committed', `${slug}.pine`), 'utf8')
const capture = (file) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', file), 'utf8'))
// host: 24 of its 27 drawing steps dropped (`guard:loop <- pine:block`, `coll:diverged`, `geometry:*`); it
// carries 3 of them, and the run makes every box and line itself
const ATR_SR = 'atr-support-and-resistance__3e9ddb38c4'
const CAPTURES = [
  { file: 'atr-support-and-resistance-rddt-1d-2026-09-28.json', symbol: { ticker: 'RDDT', exchange: 'NYSE' } },
  { file: 'atr-support-and-resistance-spy-1d-2026-10-03.json', symbol: { ticker: 'SPY', exchange: 'AMEX' } },
]
const ID = 'u_member-pane-lost'
const barsOf = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const ctxOf = (cap, symbol) => ({ tf: 'D', newestBarIsForming: false, historyFromListing: !!(cap.history && cap.history.startsAtBar0 === true), symbol })

const paneOn = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
}
const paneOff = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '0')
}
/** The run half taken out again (`memberPaneDefinition.js::withRunHalf`'s inverse, `withoutRunHalf`). */
function withoutRunHalf(def) {
  const compute = { ...def.compute }
  delete compute.runtimeObjects
  const meta = { ...(def.meta || {}) }
  delete meta[RUN_HALF_SOURCE_STAMP]
  if (Array.isArray(meta.disclosures)) {
    meta.disclosures = meta.disclosures.map((n) => (n && typeof n.note === 'string' && n.note.endsWith(` ${RUN_HALF_DRAWING_SENTENCE}`)
      ? { ...n, note: n.note.slice(0, -(RUN_HALF_DRAWING_SENTENCE.length + 1)) } : n))
  }
  return { ...def, compute, meta }
}
function columnsOf(def, bars, ctx) {
  const { installed, errors } = registry.installUserDefinitions([def])
  expect(installed.length, errors.join(' | ')).toBe(1)
  try {
    return registry.computeFor(installed[0], bars, undefined, ctx)
  } finally {
    registry.uninstallUserDefinition(installed[0].id)
  }
}
const same = (a, b) => a.length === b.length && Array.from(a).every((x, i) => Object.is(x, b[i]))

afterEach(() => {
  vi.unstubAllEnvs()
  setRuntimeDoorClock(null)
  setRunHalfObjectEvidence([])
  __resetRuntimeAdmission()
  setRuntimeCapabilityAdmission(false)
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
})

describe('⭐⭐ chart-pane only: the saved document is the host document', () => {
  it('with the runtime pane on, the member saves the HOST document, its run half beside the formula', () => {
    paneOn()
    const on = memberPaneDefinition({ source: script(ATR_SR), id: ID })
    expect(on.ok).toBe(true)
    expect(on.definition.compute.kind, 'the server lanes read a document by this').toBe('ast')
    expect(on.runHalf, JSON.stringify(on.runHalfDeclined)).toBeTruthy()
    expect(on.definition.compute.runtimeObjects.source).toBe(script(ATR_SR))
    expect(on.definition.objects, 'the host carries the drawings it could read').toBeTruthy()
  })

  it('⛔ its formula half is byte for byte the document a member with the pane OFF saves', () => {
    paneOn()
    const on = memberPaneDefinition({ source: script(ATR_SR), id: ID }).definition
    vi.unstubAllEnvs()
    paneOff()
    const off = memberPaneDefinition({ source: script(ATR_SR), id: ID }).definition
    expect(off.compute.runtimeObjects).toBeUndefined()
    expect(JSON.stringify(withoutRunHalf(on))).toBe(JSON.stringify(off))
  })
})

describe('⭐⭐ the pane draws the run\'s drawings and the host\'s plots, on its committed captures', () => {
  for (const { file, symbol } of CAPTURES) {
    it(`${file}: every plot column the pane draws is the host's, bar for bar`, () => {
      const cap = capture(file)
      const bars = barsOf(cap.bars.rows)
      const ctx = ctxOf(cap, symbol)
      paneOn()
      registry.registerRuntimeLane(runtimeColumnsFor)
      setRuntimeDoorClock(() => 0)
      const on = memberPaneDefinition({ source: script(ATR_SR), id: ID }).definition
      const paneCols = columnsOf(on, bars, ctx)
      const hostCols = columnsOf(withoutRunHalf(on), bars, ctx)
      const keys = (on.plots || []).map((p) => p.key).filter((k) => typeof k === 'string')
      expect(keys.length).toBeGreaterThan(0)
      for (const k of keys) {
        expect(hostCols[k], k).toBeTruthy()
        expect(same(paneCols[k], hostCols[k]), `${k}: the pane's column is the host's`).toBe(true)
      }
      const half = runHalfOf(paneCols)
      if (ctx.historyFromListing) {
        // ⭐ from the listing the run half is served: its boxes and lines, the 24 the host lost included
        expect(half).toEqual({ state: 'served', code: null })
        const fam = {}
        for (const o of runtimeObjectsOf(paneCols).live) fam[o.family] = (fam[o.family] || 0) + 1
        expect(fam).toEqual({ box: 20, line: 20 })
      } else {
        // off the listing the pane keeps the host's plots whatever the run half answers
        expect(['served', 'refused']).toContain(half && half.state)
      }
    }, 120000)
  }
})

describe('⛔ its gates decide first: a script the server has not admitted keeps the host picture', () => {
  const run = (admitted) => {
    const cap = capture(CAPTURES[0].file)
    paneOn()
    registry.registerRuntimeLane(runtimeColumnsFor)
    setRuntimeDoorClock(() => 0)
    const def = memberPaneDefinition({ source: script(ATR_SR), id: ID }).definition
    __resetRuntimeAllowList()
    __resetRuntimeAdmission()
    setRuntimeCapabilityAdmission(true)
    latchRuntimeAdmission(runtimeSourceHash(script(ATR_SR)), { admitted })
    return runHalfOf(columnsOf(def, barsOf(cap.bars.rows), ctxOf(cap, CAPTURES[0].symbol)))
  }
  it('admitted by capability: served; not admitted: refused by name, nothing of the run drawn', () => {
    expect(run(true)).toEqual({ state: 'served', code: null })
    expect(run(false)).toEqual({ state: 'refused', code: 'pane:not-graded' })
  }, 120000)
})
