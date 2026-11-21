// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.objectsV2Verdict.test.js
//
// THREE GRADER FAULTS IN THE OBJECTS GRADE (coordinator rulings 2026-11-21, after the engine-92 regrade). Rows read
// MATCH while the field-by-field grade (objectsV2) said DIVERGE; each was traced before anything was withheld, and each
// was the GRADER, not the engine:
//   LF  ORPHAN FILLS: TradingView keeps the record of a fill whose lines the object limit removed; such a fill cannot
//       be drawn, so only fills whose two lines are in the capture's line records are paired and counted
//       (`objectRecords.js::pairRecords`, `orphanVendor`; `compare.mjs::compareObjectsV2`, `orphanFills`).
//   SB  SUPPLY BEHIND, FOR THE DRAWINGS: a drawing placed on the forming newest bar whose other-symbol supply predates
//       the session is not compared, by name, as the plots already were (`compare.mjs::unsettledBarsOf`, `supplyBehind`).
//   V2  A v1 MATCH CANNOT STAND WHEN v2 DIVERGES (`compare.mjs::v2Overrules`).
// Mutants: ci/mutants/objects-v2-verdict.json.
import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import {
  compareObjects, compareObjectsV2, unsettledBarsOf, v2Overrules, v2DiffersBeyondColour,
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

function gradeOne(id) {
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  __admitEveryRunHalfForTests()
  __serveEveryTimeframeSettingForTests()
  memberDoorsAtCollection({ hkd: true })
  const run = runHarness([path.join(REPO, 'tests/fixtures/vendor/harness', `${id}.json`)])
  expect(run.results.length).toBe(1)
  return run.results[0]
}

const fam = (r, f) => r.objectsV2.families.find((x) => x.family === f)

describe('real captures, runtime-on lane', () => {
  it('LF1 — liquidity-pools SPY daily: 252 of TradingView\'s 504 fill records are orphans; the 252 drawable ones pair with ours and agree', () => {
    const r = gradeOne('liquidity-pools-spy-1d-2026-10-03')
    const lf = fam(r, 'linefills')
    expect(lf.paired).toBe(252)
    expect(lf.unpairedVendor).toBe(0)
    expect(lf.unpairedOurs).toBe(0)
    expect(lf.orphanVendor).toBe(252)
    expect(lf.agreeWithoutX).toBe(true)
    expect(r.objectsV2.orphanFills).toBe(252)
    expect(r.objectsV2.reason).toMatch(/252 of TradingView's fill records are between lines the object limit removed \(not drawable, not graded: orphanFills\)/)
    expect(r.objectsV2.verdict).not.toBe('DIVERGE')
    expect(r.objects.overruledBy).toBeUndefined()
  })

  it('SB1 — RS Rating NVDA weekly: the two labels on the forming week are not compared, by name (supplyBehind)', () => {
    const r = gradeOne('rs-rating-fred6724-w-nvda-1w-2026-11-17')
    expect(r.supplyBehind && r.supplyBehind.symbol).toBe('SPX')
    expect(r.objects.supplyBehind.map((e) => [e.family, e.symbol, e.session])).toEqual([
      ['labels', 'SPX', '2026-11-17'], ['labels', 'SPX', '2026-11-17']])
    expect(r.objects.otherSymbolUnsettled).toBeUndefined()
    expect(r.objects.verdict).toBe('INCONCLUSIVE')
    expect(r.objects.reason).toMatch(/2 drawing object\(s\) placed on the forming newest bar, which the SPX supply recorded beside this capture \(newest row 2026-11-16\) cannot answer for session 2026-11-17, are not compared \(supplyBehind\)/)
    expect(r.objectsV2.verdict).not.toBe('DIVERGE')
    expect(r.objectsV2.supplyBehind).toEqual(r.objects.supplyBehind)
    // the bar the drawings sit on is the one the plot grade named
    expect(r.objects.supplyBehind[0].time).toBe(r.supplyBehind.time)
  })

  it('V2R1 — htf-candle-footprint RDDT daily: v1 MATCH, v2 DIVERGE on a label y: the objects grade is DIVERGE, by name', () => {
    const r = gradeOne('htf-candle-footprint-cartel-console-rddt-1d-2026-09-28')
    expect(r.objects.overruledBy).toBe('objectsV2')
    expect(r.objects.v1Verdict).toBe('MATCH')
    expect(r.objects.verdict).toBe('DIVERGE')
    expect(r.verdict).toBe('DIVERGE')
    expect(r.objects.reason).toMatch(/^the records differ field by field \(objectsV2, first: labels y of label #10/)
    // the v2 report still says what v1 read
    expect(r.objectsV2.v1).toBe('MATCH')
    expect(r.objectsV2.verdict).toBe('DIVERGE')
  })
})

// ── the rules, pure ─────────────────────────────────────────────────────────────
const x = (bar, state = 'agree') => ({ field: 'x', x: true, state, vendor: bar, ours: bar })
const empty = { pairs: [], unpairedVendor: 0, unpairedOurs: 0 }
const counts = (labels) => ({ lines: 0, labels, boxes: 0, tables: 0, tableCells: 0 })
const label = (id, bar, more) => ({ vendorId: id, ourId: id, where: `label #${id}`, fields: [x(bar), ...more] })
const recordsOf = (labels, extra = {}) => ({ families: { lines: empty, labels: { pairs: labels, unpairedVendor: 0, unpairedOurs: 0 }, boxes: empty, tables: empty, tableCells: empty, linefills: empty, ...extra } })
const V1_MATCH = { verdict: 'MATCH', verdictWithoutColour: 'MATCH', reason: 'object counts and texts agree', counts: [] }
const OURS = { ok: true, objects: { withheldFamilies: [] } }

describe('SB — the newest bar supply rule for the drawings', () => {
  const rows = [[100], [200], [300]]
  const capture = { bars: { rows } }
  const behindPlot = { supplyBehind: { verdict: 'INCONCLUSIVE', bar: 2, time: 300, symbol: 'SPX', session: '2026-11-17', newestRow: '2026-11-16' } }

  it('SB2 — the plot\'s supplyBehind bar is an excluded bar, named with its rule; none named, none excluded', () => {
    const u = unsettledBarsOf([behindPlot], capture)
    expect([...u.bars]).toEqual([2])
    expect(u.names.get(2)).toEqual({ rule: 'supplyBehind', time: 300, symbol: 'SPX', session: '2026-11-17', newestRow: '2026-11-16' })
    expect(unsettledBarsOf([{ title: 'no record' }], capture)).toBe(null)
  })

  it('SB3 — a differing label on that bar is not compared; CONTROL: the same label on a bar the supply answers DIVERGEs', () => {
    const A = label(1, 0, [{ field: 'text', state: 'agree', vendor: 'A', ours: 'A' }])
    const B = label(2, 2, [{ field: 'text', state: 'differ', vendor: 'B', ours: 'X' }])
    const vendor = { counts: counts(2), texts: { labels: ['A', 'B'], tableCells: [] } }
    const ours = { ok: true, drawsObjects: true, counts: counts(2), texts: { labels: ['A', 'X'], tableCells: [] } }
    const cut = compareObjects(vendor, ours, null, recordsOf([A, B]), unsettledBarsOf([behindPlot], capture))
    expect(cut.verdict).toBe('MATCH')
    expect(cut.supplyBehind.map((e) => [e.family, e.bar, e.symbol])).toEqual([['labels', 2, 'SPX']])
    expect(cut.otherSymbolUnsettled).toBeUndefined()
    expect(cut.reason).toMatch(/\(supplyBehind\)$/)
    const v2 = compareObjectsV2(cut, recordsOf([A, B]), [])
    expect(v2.supplyBehind).toEqual(cut.supplyBehind)
    expect(v2.families.find((f) => f.family === 'labels').paired).toBe(1)
    // CONTROL
    expect(compareObjects(vendor, ours, null, recordsOf([A, B]), null).verdict).toBe('DIVERGE')
  })
})

describe('LF — orphan fills are named, never a count difference', () => {
  it('LF2 — orphans are counted apart and named; CONTROL: an UNPAIRED drawable fill is still a count difference', () => {
    const fills = (unpairedVendor, orphanVendor) => ({ pairs: [], unpairedVendor, unpairedOurs: 0, ...(orphanVendor ? { orphanVendor } : {}) })
    const v2 = compareObjectsV2(V1_MATCH, recordsOf([], { linefills: fills(0, 3) }), [])
    expect(v2.orphanFills).toBe(3)
    expect(v2.families.find((f) => f.family === 'linefills').orphanVendor).toBe(3)
    expect(v2.verdict).toBe('MATCH')
    const control = compareObjectsV2(V1_MATCH, recordsOf([], { linefills: fills(1, 3) }), [])
    expect(control.verdict).toBe('DIVERGE')
    expect(control.first).toMatchObject({ family: 'linefills', field: 'count', vendor: 1, ours: 0 })
  })
})

describe('V2 — a v1 MATCH cannot stand when v2 DIVERGEs', () => {
  const yDiffers = recordsOf([label(1, 3, [{ field: 'y', state: 'differ', vendor: 1, ours: 2 }])])
  const colourDiffers = recordsOf([label(1, 3, [{ field: 'color', state: 'differ', vendor: '#000000ff', ours: '#ffffffff' }])])

  it('V2R2 — a coordinate difference overrules v1, both verdicts, v1 kept beside it', () => {
    const o = v2Overrules(V1_MATCH, yDiffers, OURS)
    expect(o).toMatchObject({ verdict: 'DIVERGE', verdictWithoutColour: 'DIVERGE', overruledBy: 'objectsV2', v1Verdict: 'MATCH', v1Reason: V1_MATCH.reason })
    expect(o.reason).toMatch(/^the records differ field by field \(objectsV2, first: labels y of label #1/)
    expect(v2DiffersBeyondColour(compareObjectsV2(V1_MATCH, yDiffers, []))).toBe(true)
  })

  it('V2R3 — a colour-only difference moves the verdict, never `verdictWithoutColour` (C44)', () => {
    const o = v2Overrules(V1_MATCH, colourDiffers, OURS)
    expect(o.verdict).toBe('DIVERGE')
    expect(o.verdictWithoutColour).toBe('MATCH')
    expect(v2DiffersBeyondColour(compareObjectsV2(V1_MATCH, colourDiffers, []))).toBe(false)
  })

  it('V2R4 — nothing else moves: v1 not MATCH, no pairing, v2 agreeing, an x nobody could resolve', () => {
    const inconclusive = { ...V1_MATCH, verdict: 'INCONCLUSIVE' }
    expect(v2Overrules(inconclusive, yDiffers, OURS)).toBe(inconclusive)
    expect(v2Overrules(V1_MATCH, null, OURS)).toBe(V1_MATCH)
    const agrees = recordsOf([label(1, 3, [{ field: 'y', state: 'agree', vendor: 1, ours: 1 }])])
    expect(v2Overrules(V1_MATCH, agrees, OURS)).toBe(V1_MATCH)
    const xMissing = recordsOf([{ vendorId: 1, ourId: 1, where: 'label #1', fields: [{ field: 'x', x: true, state: 'xMissing', why: 'no x table' }, { field: 'y', state: 'agree', vendor: 1, ours: 1 }] }])
    expect(compareObjectsV2(V1_MATCH, xMissing, []).verdict).toBe('INCONCLUSIVE')
    expect(v2Overrules(V1_MATCH, xMissing, OURS)).toBe(V1_MATCH)
  })

  it('V2R5 — a v2 DIVERGE that is ONLY creation order is the same picture: v1 stands; CONTROL: not only order, it moves', () => {
    const swapped = (only) => ({ families: { lines: empty, boxes: empty, tables: empty, tableCells: empty, linefills: empty,
      labels: { pairs: [label(1, 3, [{ field: 'text', state: 'differ', vendor: 'B', ours: 'A' }])], unpairedVendor: 0, unpairedOurs: 0, differsOnlyByCreationOrder: only } } })
    expect(compareObjectsV2(V1_MATCH, swapped(true), [])).toMatchObject({ verdict: 'DIVERGE', differsOnlyByCreationOrder: true })
    expect(v2Overrules(V1_MATCH, swapped(true), OURS)).toBe(V1_MATCH)
    expect(v2Overrules(V1_MATCH, swapped(false), OURS).verdict).toBe('DIVERGE')
  })
})
