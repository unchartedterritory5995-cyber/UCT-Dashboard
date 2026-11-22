// app/src/components/chart/builder/memberPane/routeByCost.test.js
//
// ⭐⭐ ROUTE BY COST (Engine 73 (#1711)) — the member door, on committed scripts measured in
// docs/pine/evidence/2026-11-17-host-lane-cost/EVIDENCE.md. A host document whose recurrences cost
// more than a long task moves to the runtime lane only when that lane builds it, admits it and draws
// the same picture; anything else keeps the host answer, and with the runtime pane off nothing moves.
// The moved script computes the same values on both lanes (the last block).
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { memberPaneDefinition } from './memberPaneDefinition'
import { COST_ROUTE_SURFACE } from './costRoute'
import { parityOf } from './costRouteParity'
import * as registry from '../../engine/nativeRegistry'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../../engine/runtimePaneGate'
import {
  __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList, __resetRuntimeAdmission,
  setRuntimeCapabilityAdmission, latchRuntimeAdmission, runtimeSourceHash,
} from '../../engine/runtimeKill'
import { setRuntimeDoorClock } from '../../engine/runtime/runtimeColumns'

const REPO = path.resolve(__dirname, '../../../../../..')
const script = (slug) => fs.readFileSync(path.join(REPO, 'corpus', 'committed', `${slug}.pine`), 'utf8')
// measured (5,000 daily bars): host 13.8 s, runtime 4.9 ms; same picture
const TWIN_RANGE = 'twin-range-filter__xF3L2PeXm7'
// host 6.5 s; the runtime document draws none of its ten fills
const KELTNER = 'keltner-center-of-gravity-channel__e4a81d76f6'
// host 17.0 s; the runtime lane declines it (`runtime:function-global-state`)
const PMAX = 'pmax-explorer__jN9HBNhynF'
// host 4.6 ms, no recurrence
const ATR_BANDS = 'atr-bands__ad60b125e6'
// host 82 ms, runtime 8.9 ms; same picture; cheap enough to compute in a rail
const TREND_DURATION = 'trend-duration-forecast-chartprime__2c5c233f31'

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

afterEach(() => {
  vi.unstubAllEnvs()
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
})

describe('route by cost — the door', () => {
  it('⭐ an expensive host document the runtime lane draws the same is MOVED there', () => {
    runtimeView()
    const built = memberPaneDefinition({ source: script(TWIN_RANGE), id: 'u_member-pane-cost' })
    expect(kindOf(built)).toBe('runtime')
    expect(built.costRoute).toMatchObject({ moved: true })
    expect(built.costRoute.cost.over).toBe(true)
    expect(built.costRoute.cost.stepsPerBar).toBeGreaterThan(540)
    // the member reads WHY it is drawn bar by bar: its cost, never "a formula cannot hold it"
    const drawn = (built.notes || []).find((n) => n && n.name === 'Drawn bar by bar')
    expect(drawn && drawn.note).toMatch(/hold the chart for a noticeable time on every update/)
    expect(drawn.note).not.toMatch(/single formula per line/)
  })

  it('⛔ with the runtime pane off (a viewer the stage does not reach) nothing moves and nothing is asked', () => {
    memberView()
    const built = memberPaneDefinition({ source: script(TWIN_RANGE), id: 'u_member-pane-cost' })
    expect(kindOf(built)).toBe('ast')
    expect(built.costRoute).toBeUndefined()
  })

  it('⛔ a runtime document that draws a different picture keeps the host answer (keltner\'s fills)', () => {
    runtimeView()
    const built = memberPaneDefinition({ source: script(KELTNER), id: 'u_member-pane-cost' })
    expect(kindOf(built)).toBe('ast')
    expect(built.costRoute).toMatchObject({ moved: false, code: COST_ROUTE_SURFACE })
    expect(built.costRoute.why).toMatch(/fills \(10 against 0\)/)
  })

  it('⛔ a script the runtime lane declines keeps the host answer, with the decline\'s own code', () => {
    runtimeView()
    const built = memberPaneDefinition({ source: script(PMAX), id: 'u_member-pane-cost' })
    expect(kindOf(built)).toBe('ast')
    expect(built.costRoute).toMatchObject({ moved: false, code: 'runtime:function-global-state' })
  })

  it('⛔ a script not graded for the runtime lane keeps the host answer', () => {
    runtimeView()
    __resetRuntimeAllowList()
    const built = memberPaneDefinition({ source: script(TWIN_RANGE), id: 'u_member-pane-cost' })
    expect(kindOf(built)).toBe('ast')
    expect(built.costRoute).toMatchObject({ moved: false, code: 'runtime:not-yet-graded' })
  })

  it('⭐ production\'s admission (no test grant): the server\'s latched verdict admits it, and it moves', () => {
    runtimeView()
    __resetRuntimeAllowList()
    __resetRuntimeAdmission()
    setRuntimeCapabilityAdmission(true)
    const source = script(TWIN_RANGE)
    // no verdict yet: the run declines ("still being checked") and the host answer stands
    const pending = memberPaneDefinition({ source, id: 'u_member-pane-cost' })
    expect(kindOf(pending)).toBe('ast')
    expect(pending.costRoute).toMatchObject({ moved: false, code: 'runtime:not-yet-graded' })
    latchRuntimeAdmission(runtimeSourceHash(source), { admitted: true })
    const built = memberPaneDefinition({ source, id: 'u_member-pane-cost' })
    expect(kindOf(built)).toBe('runtime')
    expect(built.costRoute).toMatchObject({ moved: true })
    __resetRuntimeAdmission()
  })

  it('a cheap host document is not offered at all (control: the route only reads cost)', () => {
    runtimeView()
    const built = memberPaneDefinition({ source: script(ATR_BANDS), id: 'u_member-pane-cost' })
    expect(kindOf(built)).toBe('ast')
    expect(built.costRoute).toBeUndefined()
  })
})

describe('route by cost — the moved script computes the same values on both lanes', () => {
  const cap = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness',
    'vw-deadband-ticks-aapl-1d-2026-09-28.json'), 'utf8'))
  const barsOf = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
  const symbol = { ticker: 'AAPL', exchange: 'NASDAQ' }

  const columnsOf = (built, bars, ctx) => {
    const { installed } = registry.installUserDefinitions([built.definition])
    expect(installed).toHaveLength(1)
    try {
      return registry.computeFor(installed[0], bars, undefined, ctx)
    } finally {
      registry.uninstallUserDefinition(installed[0].id)
    }
  }

  it.each([
    ['from the listing (a member\'s deep daily chart)', cap.bars.rows, true],
    ['over the newest 5,000 bars', cap.bars.rows.slice(-5000), false],
  ])('%s: every bar both lanes draw is equal, and no output is lost', (_name, rows, fromListing) => {
    const source = script(TREND_DURATION)
    memberView()
    const host = memberPaneDefinition({ source, id: 'u_member-pane-cost' })
    vi.unstubAllEnvs()
    runtimeView()
    const run = memberPaneDefinition({ source, id: 'u_member-pane-cost' })
    expect(kindOf(host)).toBe('ast')
    expect(kindOf(run)).toBe('runtime')
    const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: fromListing, symbol }
    setRuntimeDoorClock(() => 0)
    let rows2
    let control
    try {
      const runCols = columnsOf(run, barsOf(rows), ctx)
      vi.unstubAllEnvs()
      memberView()
      const hostCols = columnsOf(host, barsOf(rows), ctx)
      rows2 = parityOf(host, hostCols, run, runCols)
      // ⛔ CONTROL — the comparison can fail: one run value moved by 0.1% is reported as a difference
      const perturbed = { ...runCols }
      const k = Object.keys(perturbed).find((key) => {
        const c = perturbed[key]
        return c && typeof c.length === 'number' && Number.isFinite(c[c.length - 1]) && c[c.length - 1] !== 0
      })
      expect(k).toBeTruthy()
      const col = Float64Array.from(perturbed[k])
      col[col.length - 1] *= 1.001
      perturbed[k] = col
      control = parityOf(host, hostCols, run, perturbed)
    } finally {
      setRuntimeDoorClock(null)
    }
    expect(control.reduce((n, r) => n + (r.differ || 0), 0)).toBe(1)
    const compared = rows2.filter((r) => Number.isInteger(r.bars))
    expect(compared.length).toBeGreaterThan(0)                  // non-vacuity: something was compared
    expect(rows2.filter((r) => r.runtime === 'absent' || r.host === 'absent')).toEqual([])
    for (const r of compared) {
      expect({ output: r.output, differ: r.differ }).toEqual({ output: r.output, differ: 0 })
      expect(r.equal).toBeGreaterThan(0)
    }
    if (fromListing) {
      // from the listing both lanes compute every bar: equal everywhere, nothing withheld on one side only
      for (const r of compared) expect([r.hostOnly, r.runOnly]).toEqual([0, 0])
    }
  }, 120000)
})
