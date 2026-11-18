// app/src/components/chart/builder/memberPane/dirtyRoute.test.js
//
// ⭐⭐ PARITY UNIT 1 (`objects`, NUMBER PENDING) — the member door's dirty route, on committed scripts
// measured in docs/pine/evidence/2026-11-18-objects-unit/EVIDENCE.md. A host document whose object program
// LOST drawings (or withheld a paint) moves to the runtime lane only when that lane builds it, admits it and
// draws everything the host draws plus what the host lost; anything else keeps the host answer (and its run
// half), and with the runtime pane off nothing moves. The moved script's plots compute the same values on
// both lanes (the last block).
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { memberPaneDefinition } from './memberPaneDefinition'
import { DIRTY_ROUTE_SURFACE, DIRTY_ROUTE_OBJECTS, DIRTY_ROUTE_PAINTS, hostLossOf, drawsWhatTheHostLost, hostAuthorHiddenOutputsOf } from './dirtyRoute'
import { parityOf } from './costRouteParity'
import * as registry from '../../engine/nativeRegistry'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import {
  __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList, __resetRuntimeAdmission,
  setRuntimeCapabilityAdmission, latchRuntimeAdmission, runtimeSourceHash,
} from '../../engine/runtimeKill'
import { setRuntimeDoorClock } from '../../engine/runtime/runtimeColumns'

const REPO = path.resolve(__dirname, '../../../../../..')
const script = (slug) => fs.readFileSync(path.join(REPO, 'corpus', 'committed', `${slug}.pine`), 'utf8')
// host: 24 of its drawing steps dropped (`guard:loop <- pine:block`, `coll:diverged`, `geometry:*`); the run
// makes every box and line itself, and its two plots are the host's
const ATR_SR = 'atr-support-and-resistance__3e9ddb38c4'
// host: two labels lost (`create:label <- pine:function`); the runtime document draws no fill (the host draws
// one), so it stays, with its run half
const ATR_TRAIL = 'atr-trailing-stop-by-ceyhun__UMldb6tGLd'
// host: 12 setters lost (`update:props`); the run refuses `runtime:conditional-history` (a self-history read
// inside a block), so it stays
const KILLZONE = 'ict-killzone-index-version__28962c02dd'
// a clean host program: never offered
const CLEAN = 'atr-bands__ad60b125e6'

const memberView = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '0')
}
const runtimeView = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
}
const kindOf = (built) => built && built.ok && built.definition && built.definition.compute && built.definition.compute.kind
const ID = 'u_member-pane-dirty'

afterEach(() => {
  vi.unstubAllEnvs()
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
})

describe('the dirty route — the door', () => {
  it('⭐ a host document that lost drawings, which the run draws itself, is MOVED to the runtime lane', () => {
    runtimeView()
    const built = memberPaneDefinition({ source: script(ATR_SR), id: ID })
    expect(kindOf(built)).toBe('runtime')
    expect(built.definition.compute.objects).toBe(true)        // its drawings are the run's own
    expect(built.dirtyRoute).toEqual({ moved: true, lost: { objects: true, paints: 0 } })
    // the member reads WHY it is drawn bar by bar, and that the run's drawings replace the lost program
    const drawn = (built.notes || []).find((n) => n && n.name === 'Drawn bar by bar')
    expect(drawn && drawn.note).toMatch(/some of its drawings could not be made/)
    const drawings = (built.notes || []).find((n) => n && n.name === 'Drawings')
    expect(drawings && drawings.note).toMatch(/These replace the drawing program/)
  })

  it('⛔ with the runtime pane off nothing moves and nothing is asked', () => {
    memberView()
    const built = memberPaneDefinition({ source: script(ATR_SR), id: ID })
    expect(kindOf(built)).toBe('ast')
    expect(built.dirtyRoute).toBeUndefined()
  })

  it('⛔ `routeDirty: false` (the run-half rails, the probe\'s master column) asks nothing', () => {
    runtimeView()
    const built = memberPaneDefinition({ source: script(ATR_SR), id: ID, routeDirty: false })
    expect(kindOf(built)).toBe('ast')
    expect(built.dirtyRoute).toBeUndefined()
  })

  it('⛔ a runtime document that draws a different picture keeps the host answer AND its run half (a fill)', () => {
    runtimeView()
    const built = memberPaneDefinition({ source: script(ATR_TRAIL), id: ID })
    expect(kindOf(built)).toBe('ast')
    expect(built.dirtyRoute).toMatchObject({ moved: false, code: DIRTY_ROUTE_SURFACE })
    expect(built.dirtyRoute.why).toMatch(/fills \(1 against 0\)/)
    expect(built.runHalf).toMatchObject({ minted: true })
    // the host document a member gets is the one the door minted before the route: byte for byte
    const before = memberPaneDefinition({ source: script(ATR_TRAIL), id: ID, routeDirty: false })
    expect(JSON.stringify(built.definition)).toBe(JSON.stringify(before.definition))
    expect(built.notes).toEqual(before.notes)
  })

  it('⛔ a script the runtime lane declines keeps the host answer, with the decline\'s own code', () => {
    runtimeView()
    const built = memberPaneDefinition({ source: script(KILLZONE), id: ID })
    expect(kindOf(built)).toBe('ast')
    expect(built.dirtyRoute).toMatchObject({ moved: false, code: 'runtime:conditional-history' })
  })

  it('⛔ a script not graded for the runtime lane keeps the host answer', () => {
    runtimeView()
    __resetRuntimeAllowList()
    const built = memberPaneDefinition({ source: script(ATR_SR), id: ID })
    expect(kindOf(built)).toBe('ast')
    expect(built.dirtyRoute).toMatchObject({ moved: false, code: 'runtime:not-yet-graded' })
  })

  it('⭐ production\'s admission (no test grant): the server\'s latched verdict admits it, and it moves', () => {
    runtimeView()
    __resetRuntimeAllowList()
    __resetRuntimeAdmission()
    setRuntimeCapabilityAdmission(true)
    const source = script(ATR_SR)
    const pending = memberPaneDefinition({ source, id: ID })
    expect(kindOf(pending)).toBe('ast')
    expect(pending.dirtyRoute).toMatchObject({ moved: false, code: 'runtime:not-yet-graded' })
    latchRuntimeAdmission(runtimeSourceHash(source), { admitted: true })
    const built = memberPaneDefinition({ source, id: ID })
    expect(kindOf(built)).toBe('runtime')
    expect(built.dirtyRoute).toMatchObject({ moved: true })
    // ⛔ and a verdict that REFUSES it keeps the host answer
    latchRuntimeAdmission(runtimeSourceHash(source), { admitted: false })
    const refused = memberPaneDefinition({ source, id: ID })
    expect(kindOf(refused)).toBe('ast')
    __resetRuntimeAdmission()
  })

  it('a clean host program is not offered at all (control: the route only reads what was lost)', () => {
    runtimeView()
    const built = memberPaneDefinition({ source: script(CLEAN), id: ID })
    expect(kindOf(built)).toBe('ast')
    expect(built.dirtyRoute).toBeUndefined()
  })
})

describe('the dirty route — its two predicates', () => {
  it('hostLossOf: any object verdict but `clean`, or a withheld paint', () => {
    expect(hostLossOf({ loss: { verdict: 'clean', attempted: 4, dropped: 0 } })).toBeNull()
    expect(hostLossOf({ loss: null })).toBeNull()
    expect(hostLossOf({ loss: { verdict: 'partial', attempted: 4, dropped: 1 } })).toEqual({ objects: true, paints: 0 })
    expect(hostLossOf({ loss: { verdict: 'removes', attempted: 4, dropped: 1 } })).toEqual({ objects: true, paints: 0 })
    expect(hostLossOf({ loss: { verdict: 'clean' }, paintsWithheld: 2 })).toEqual({ objects: false, paints: 2 })
  })

  const answer = ({ plots = [], paints = 0, ownObjects = false } = {}) => ({
    definition: {
      plots: plots.map((p, i) => ({ key: `k${i}`, style: 'line', ...p })),
      paints: Array.from({ length: paints }, () => ({ kind: 'bgcolor' })),
      compute: ownObjects ? { kind: 'runtime', objects: true } : { kind: 'ast' },
    },
    rows: plots.map((p, i) => ({ key: `k${i}`, output: i })),
    translation: { outputs: [] },
  })

  it('drawsWhatTheHostLost: the same plots, the run\'s own drawings, more paints', () => {
    const host = answer({ plots: [{}, {}], paints: 1 })
    expect(drawsWhatTheHostLost(host, answer({ plots: [{}, {}], paints: 1, ownObjects: true }), { objects: true, paints: 0 })).toEqual({ ok: true })
    // a plot the run does not draw
    expect(drawsWhatTheHostLost(host, answer({ plots: [{}], paints: 1, ownObjects: true }), { objects: true, paints: 0 }).code).toBe(DIRTY_ROUTE_SURFACE)
    // the host lost drawings and the run does not make its own
    expect(drawsWhatTheHostLost(host, answer({ plots: [{}, {}], paints: 1 }), { objects: true, paints: 0 }).code).toBe(DIRTY_ROUTE_OBJECTS)
    // the host withheld a paint and the run draws no more paints than the host
    expect(drawsWhatTheHostLost(host, answer({ plots: [{}, {}], paints: 1 }), { objects: false, paints: 1 }).code).toBe(DIRTY_ROUTE_PAINTS)
    expect(drawsWhatTheHostLost(host, answer({ plots: [{}, {}], paints: 2 }), { objects: false, paints: 1 })).toEqual({ ok: true })
    // fewer paints than the host draws
    expect(drawsWhatTheHostLost(host, answer({ plots: [{}, {}], paints: 0, ownObjects: true }), { objects: true, paints: 0 }).code).toBe(DIRTY_ROUTE_SURFACE)
    // a plot its author hid that the host computes and the run does not
    const run = answer({ plots: [{}, {}], paints: 1, ownObjects: true })
    expect(drawsWhatTheHostLost(host, run, { objects: true, paints: 0 }, new Set([5])).code).toBe(DIRTY_ROUTE_SURFACE)
    run.rows.push({ key: 'h', hidden: true, output: 5 })
    expect(drawsWhatTheHostLost(host, run, { objects: true, paints: 0 }, new Set([5]))).toEqual({ ok: true })
  })

  it('hostAuthorHiddenOutputsOf: only the rows the AUTHOR hid, by translation output', () => {
    const t = { outputs: [{ ast: 'a' }, { ast: 'b', hidden: true, hiddenReason: 'author' }, { ast: 'c', hidden: true, hiddenReason: 'constant' }] }
    const host = { translation: t, rows: [{ ast: 'a' }, { ast: 'b', hidden: true }, { ast: 'c', hidden: true }] }
    expect([...hostAuthorHiddenOutputsOf(host)]).toEqual([1])
    expect([...hostAuthorHiddenOutputsOf(null)]).toEqual([])
  })
})

describe('the dirty route — the moved script\'s plots compute the same values on both lanes', () => {
  const cap = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness',
    'atr-support-and-resistance-rddt-1d-2026-09-28.json'), 'utf8'))
  const barsOf = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
  const symbol = { ticker: 'RDDT', exchange: 'NYSE' }

  const columnsOf = (built, bars, ctx) => {
    const { installed } = registry.installUserDefinitions([built.definition])
    expect(installed).toHaveLength(1)
    try {
      return registry.computeFor(installed[0], bars, undefined, ctx)
    } finally {
      registry.uninstallUserDefinition(installed[0].id)
    }
  }

  it('from the listing: every bar both lanes draw is equal, and no output is lost', () => {
    const source = script(ATR_SR)
    runtimeView()
    const host = memberPaneDefinition({ source, id: ID, routeDirty: false })
    const run = memberPaneDefinition({ source, id: ID })
    expect(kindOf(host)).toBe('ast')
    expect(kindOf(run)).toBe('runtime')
    const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol }
    setRuntimeDoorClock(() => 0)
    let rows
    try {
      const runCols = columnsOf(run, barsOf(cap.bars.rows), ctx)
      vi.unstubAllEnvs()
      memberView()
      const hostCols = columnsOf(host, barsOf(cap.bars.rows), ctx)
      rows = parityOf(host, hostCols, run, runCols)
    } finally {
      setRuntimeDoorClock(null)
    }
    const compared = rows.filter((r) => Number.isInteger(r.bars))
    expect(compared.length).toBeGreaterThan(0)
    // ⭐ its six `display = display.none` plotshapes are computed on both lanes (the moved document carries
    // the rows its author hid, `carryHidden`), so nothing the host document computed is absent from the run
    expect(rows.filter((r) => r.runtime === 'absent' || r.host === 'absent')).toEqual([])
    expect(run.rows.filter((r) => r.hidden === true && Number.isInteger(r.output))).toHaveLength(6)
    for (const r of compared) {
      expect({ output: r.output, differ: r.differ, hostOnly: r.hostOnly, runOnly: r.runOnly })
        .toEqual({ output: r.output, differ: 0, hostOnly: 0, runOnly: 0 })
      expect(r.equal).toBeGreaterThan(0)
    }
  }, 120000)
})
