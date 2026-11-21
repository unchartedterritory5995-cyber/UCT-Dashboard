// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.objectsOtherSymbolUnsettled.test.js
//
// OTHER-SYMBOL UNSETTLED, FOR THE DRAWINGS (coordinator, 2026-11-21; `compare.mjs::unsettledCutOf`). The plot grade
// leaves a bar unsettled where TradingView's own captures disagree about another symbol there
// (`vendorHarness.otherSymbolUnsettled.test.js`). A drawing PLACED on that bar reads the same unsettled value, so it is
// not compared either, by the same name.
// ⚰️ rs-rating-fred6724-pm-alab-1d-2026-11-16 (runtime-on): plots 667 / 668 agree, the newest bar unsettled on SPX, and
// the two RS labels drawn ON that bar graded DIVERGE (y 91.6678 vs 89.9090, exactly SPX 7416.59 / 7561.67; text 74 vs 69).
import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import {
  compareObjects, compareObjectsV2, unsettledBarsOf,
} from '../../../../../../../tools/vendor_harness/compare.mjs'

vi.setConfig({ testTimeout: 600000 })

// the runtime-on lane, armed as `vendorHarness.corpus.test.js` arms it (members are on the runtime lane)
vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
const { __permitRuntimePaneForTests } = await import('../../runtimePaneGate')
const { __allowEveryRuntimeScriptForTests } = await import('../../runtimeKill')
const { __admitEveryRunHalfForTests } = await import('../../runHalfRailSeam')
const { __serveEveryTimeframeSettingForTests } = await import('../../runtime/runtimeInputs.js')
const { memberDoorsAtCollection } = await import('../../../../../testing/runtimeGate')
const { runHarness, REPO } = await import('./harness')

const PM_ALAB = 'rs-rating-fred6724-pm-alab-1d-2026-11-16'

describe('RS Rating ALAB after the close of 2026-11-16 (real capture), runtime-on lane', () => {
  it('OU1 — the labels on the unsettled bar are not compared, by name: the drawing reads INCONCLUSIVE, never DIVERGE', () => {
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    __admitEveryRunHalfForTests()
    __serveEveryTimeframeSettingForTests()
    memberDoorsAtCollection({ hkd: true })
    const run = runHarness([path.join(REPO, 'tests/fixtures/vendor/harness', `${PM_ALAB}.json`)])
    const [r] = run.results
    expect(r.verdict, r.reason).not.toBe('DIVERGE')
    expect(['MATCH', 'INCONCLUSIVE']).toContain(r.objects.verdict)
    expect(r.objects.verdict).toBe('INCONCLUSIVE')
    expect(r.objects.reason).toMatch(/placed on a bar where TradingView's own captures disagree on SPX are not compared \(otherSymbolUnsettled\)/)
    expect(r.objects.otherSymbolUnsettled.map((e) => [e.family, e.bar, e.symbol, e.date])).toEqual([
      ['labels', 667, 'SPX', '2026-11-16'], ['labels', 667, 'SPX', '2026-11-16']])
    expect(r.objectsV2.verdict).not.toBe('DIVERGE')
    expect(r.objectsV2.otherSymbolUnsettled).toEqual(r.objects.otherSymbolUnsettled)
    // the plot's own record is the one the drawings read
    const line = r.plots.find((p) => p.title === 'RS Line')
    expect(line.otherSymbolUnsettled.map((x) => x.time)).toEqual([r.objects.otherSymbolUnsettled[0].time])
  })
})

// ── the rule, on a synthetic drawing (pure) ────────────────────────────────────
const x = (bar) => ({ field: 'x', x: true, state: 'agree', vendor: bar, ours: bar })
const PAIR_A = { vendorId: 1, ourId: 1, where: 'label #1', fields: [x(3), { field: 'y', state: 'agree', vendor: 1, ours: 1 }, { field: 'text', state: 'agree', vendor: 'A', ours: 'A' }] }
const PAIR_B = { vendorId: 2, ourId: 2, where: 'label #2', fields: [x(5), { field: 'y', state: 'differ', vendor: 1, ours: 2 }, { field: 'text', state: 'differ', vendor: 'B', ours: 'X' }] }
const empty = { pairs: [], unpairedVendor: 0, unpairedOurs: 0 }
const records = () => ({ families: { lines: empty, labels: { pairs: [PAIR_A, PAIR_B], unpairedVendor: 0, unpairedOurs: 0 }, boxes: empty } })
const counts = (labels) => ({ lines: 0, labels, boxes: 0, tables: 0, tableCells: 0 })
const VENDOR = { counts: counts(2), texts: { labels: ['A', 'B'], tableCells: [] } }
const OURS = (texts = ['A', 'X']) => ({ ok: true, drawsObjects: true, counts: counts(2), texts: { labels: texts, tableCells: [] } })
const unsettledAt = (...bars) => ({ bars: new Set(bars), names: new Map(bars.map((b) => [b, { time: b * 100, symbol: 'SPX', date: 'd' }])) })
const grade = (unsettled, ours = OURS()) => {
  const rec = records()
  const v1 = compareObjects(VENDOR, ours, null, rec, unsettled)
  return { v1, v2: compareObjectsV2(v1, rec) }
}

describe('the rule (pure)', () => {
  it('OU2 — CONTROL, no unsettled bar: the differing label DIVERGEs (v1 text, v2 y)', () => {
    const { v1, v2 } = grade(null)
    expect(v1.verdict).toBe('DIVERGE')
    expect(v1.otherSymbolUnsettled).toBeUndefined()
    expect(v2.verdict).toBe('DIVERGE')
  })
  it('OU3 — the differing label sits on the unsettled bar: not compared, by name; the rest grades MATCH (v1 and v2)', () => {
    const { v1, v2 } = grade(unsettledAt(5))
    expect(v1.verdict).toBe('MATCH')
    expect(v1.otherSymbolUnsettled).toEqual([{ verdict: 'INCONCLUSIVE', family: 'labels', vendorId: 2, ourId: 2, where: 'label #2', bar: 5, time: 500, symbol: 'SPX', date: 'd' }])
    expect(v2.verdict).toBe('MATCH')
    expect(v2.families.find((f) => f.family === 'labels').paired).toBe(1)
  })
  it('OU4 — CONTROL: a wrong label on a SETTLED bar still DIVERGEs (the unsettled bar holds the agreeing one)', () => {
    const { v1, v2 } = grade(unsettledAt(3))
    expect(v1.verdict).toBe('DIVERGE')
    expect(v1.otherSymbolUnsettled.map((e) => e.where)).toEqual(['label #1'])
    expect(v2.verdict).toBe('DIVERGE')
  })
  it('OU5 — every drawing on an unsettled bar: INCONCLUSIVE, never MATCH', () => {
    const { v1, v2 } = grade(unsettledAt(3, 5))
    expect(v1.verdict).toBe('INCONCLUSIVE')
    expect(v1.reason).toMatch(/^every drawing object is on such a bar: 2 drawing object\(s\)/)
    expect(v2.verdict).toBe('INCONCLUSIVE')
  })
  it('OU6 — FAIL CLOSED: a text the counted texts do not hold leaves the grade as it was', () => {
    const { v1 } = grade(unsettledAt(5), OURS(['A', 'Y']))
    expect(v1.verdict).toBe('DIVERGE')
    expect(v1.otherSymbolUnsettled).toBeUndefined()
  })
  it('OU7 — the unsettled bars are the plot records\' TIMES on the capture\'s bars; a time off them unsettles nothing', () => {
    const capture = { bars: { rows: [[100], [200], [300]] } }
    const plots = [{ otherSymbolUnsettled: [{ time: 300, symbol: 'SPX', date: 'd' }, { time: 999, symbol: 'SPX', date: 'e' }] }, {}]
    const u = unsettledBarsOf(plots, capture)
    expect([...u.bars]).toEqual([2])
    expect(u.names.get(2)).toEqual({ time: 300, symbol: 'SPX', date: 'd' })
    expect(unsettledBarsOf([{}], capture)).toBe(null)
  })
})
