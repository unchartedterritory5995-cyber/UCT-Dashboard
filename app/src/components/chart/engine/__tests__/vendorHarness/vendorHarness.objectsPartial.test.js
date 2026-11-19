// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.objectsPartial.test.js
//
// ─── ⭐⭐ A DISCLOSED PARTIAL GRADES ON WHAT IT DRAWS (coordinator ruling 2026-11-19) ─────────────────────────────────
//
// ⚰️ MEASURED on rsi-support-resistance-by-dgt (local licence-held capture, RDDT 1D; its shape is rebuilt here, never its
// text): the member door draws its 5 level lines, which equal TradingView's dotted level lines bit for bit, and names its
// 200 oscillator lines and 5 labels as not supported ("6 of 52 drawing elements aren't supported yet"). The harness
//   · paired our 5 lines with TradingView's 5 NEWEST lines (oscillator lines: it aligned at the newest end) and reported
//     "y differs" (objects v2), and
//   · graded the drawing DIVERGE on COUNT (5 lines where TradingView holds 205), as if the withheld lines were wrong ones.
// Now (1) where the counts differ, records pair BY VALUE (`objectRecords.js::alignByValue`), never by position; and (2) a
// family our side drew fewer of BY NAME (`ourSide.js` `partialFamilies`) is graded on what it draws
// (`compare.mjs::compareObjects`): every drawn record agreeing is WITHHELD (`objects:partial`, INCONCLUSIVE), one that
// differs is still a DIVERGE. A family we hold MORE of, or one nobody named, grades on its count as before.
import { describe, it, expect, vi, afterEach } from 'vitest'

import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { __objectsReportForTests } from './ourSide'
import { pairRecords } from './objectRecords'
import {
  compareObjects, compareObjectsV2, OBJECTS_PARTIAL_GUARD,
} from '../../../../../../../tools/vendor_harness/compare.mjs'

const GREEN = 0xff819908 // #089981 packed as TradingView records it (0xAABBGGRR)
const RED = 0xff4536f2 // #F23645 (TradingView's 4282726130 on the measured capture)
const PURPLE = 0xffc2577e // #7E57C2
const DAY = 86400
const T0 = 1700000000
const N = 12
const TIMES = Array.from({ length: N }, (_, i) => T0 + i * DAY)
const TABLE = Array.from({ length: N }, (_, i) => i) // x position k is bar k
const xIndex = { schema: 'uct.object-x-index/v1', found: true, path: 'graphics()._indexes', indexes: TABLE,
  times: TABLE.map((i) => TIMES[i]), modelBars: { first: 0, last: N - 1, count: N, contiguous: true } }
const capOf = (records) => ({ symbol: { pricescale: 100 }, study: {}, bars: { rows: TIMES.map((t) => [t, 1, 1, 1, 1, 1]) },
  objects: { records, xIndex } })
const FRAME = { bars: TIMES.map((t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 })), windowStart: 0, windowBars: N, tf: 'D' }

// TradingView: three dotted LEVEL lines across bars 1..11 (made first), then the oscillator segments (solid, newest).
const LEVELS = [[228.83474999999999, 2, GREEN], [225.86550000000003, 1, GREEN], [216.95775000000003, 2, RED]]
const vLevel = (id, [y, w, ci]) => ({ id, x1: 1, y1: y, x2: 11, y2: y, ex: 'n', st: 'dot', ci, w })
const vOsc = (id, k) => ({ id, x1: k, y1: 200 + k, x2: k + 1, y2: 201 + k, ex: 'n', st: 'sol', ci: PURPLE, w: 2 })
const VENDOR = { lines: [...LEVELS.map((l, i) => vLevel(i + 1, l)), ...[1, 2, 3, 4, 5, 6].map((k, i) => vOsc(10 + i, k))] }
const hex = (ci) => ({ [GREEN]: '#089981', [RED]: '#F23645' })[ci]
const oLevel = (id, [y, w, ci], over = {}) => ({ family: 'line', id,
  props: { x1: 1, y1: y, x2: 11, y2: y, style: 'dotted', width: w, color: hex(ci), ...over } })
const OURS = LEVELS.map((l, i) => oLevel(i + 1, l))
const objs = (held, over = {}) => ({ ok: true, held, pineVersion: 6, xFrame: FRAME, ...over })
const fam = (r, f) => r.families.find((x) => x.family === f)

/** v1 for the drawn lines, with the door's own statement of what it withheld by name. */
function v1(held, ourOver = {}, vendorLabels = 2) {
  const records = pairRecords(capOf(VENDOR), objs(held))
  const vendorObjs = { counts: { lines: VENDOR.lines.length, labels: vendorLabels, boxes: 0, tables: 0, tableCells: 0 },
    texts: { labels: Array.from({ length: vendorLabels }, (_, i) => `L${i}`), tableCells: [] }, records: VENDOR }
  const ourObjs = { drawsObjects: true, ok: true, counts: { lines: held.length, labels: 0, boxes: 0, tables: 0, tableCells: 0 },
    texts: { labels: [], tableCells: [] }, held, ...ourOver }
  return { records, verdict: compareObjects(vendorObjs, ourObjs, null, records) }
}
const NAMED = { partialFamilies: ['label', 'line'] }

describe('objects v2 pairs BY VALUE where the counts differ, never by position', () => {
  it('our level lines pair with TradingView\'s level lines, not its newest (oscillator) lines', () => {
    const p = pairRecords(capOf(VENDOR), objs(OURS)).families.lines
    expect(p.pairedByValue).toBe(true)
    expect(p.pairs.map((x) => x.vendorId)).toEqual([1, 2, 3])
    expect(p.unpairedVendor).toBe(6)
    expect(p.pairs.every((x) => x.fields.every((r) => r.state !== 'differ')), JSON.stringify(p.pairs[0].fields)).toBe(true)
  })
  it('the same records in another creation order pair the same way (by value, not by position)', () => {
    // the level lines made LAST (the newest): the pairing is the same records, whatever their position
    const tail = { lines: [...VENDOR.lines.slice(3), ...VENDOR.lines.slice(0, 3).map((l, i) => ({ ...l, id: 20 + i }))] }
    const p = pairRecords(capOf(tail), objs(OURS)).families.lines
    expect(p.pairs.map((x) => x.vendorId)).toEqual([20, 21, 22])
    expect(p.pairs.every((x) => x.fields.every((r) => r.state !== 'differ'))).toBe(true)
  })
  it('equal counts keep creation order (nothing a capture already pairs moves)', () => {
    const p = pairRecords(capOf({ lines: VENDOR.lines.slice(0, 3) }), objs([OURS[1], OURS[0], OURS[2]].map((o, i) => ({ ...o, id: i + 1 })))).families.lines
    expect(p.pairedByValue).toBeUndefined()
    expect(p.pairs.map((x) => [x.vendorId, x.ourId])).toEqual([[1, 1], [2, 2], [3, 3]])
  })
})

describe('a family drawn in part, BY NAME, is graded on what it draws', () => {
  it('every drawn record agrees: WITHHELD (objects:partial), never a count DIVERGE', () => {
    const { verdict } = v1(OURS, NAMED)
    expect(verdict.verdict, verdict.reason).toBe('INCONCLUSIVE')
    expect(verdict.withheld).toBe(OBJECTS_PARTIAL_GUARD)
    expect(verdict.reason).toMatch(/disclosed partial \(lines 3 of 9, labels 0 of 2 drawn\)/)
    expect(verdict.counts.find((r) => r.family === 'lines')).toMatchObject({ partial: true, withheld: true, vendor: 9, ours: 3 })
  })
  it('CONTROL: nobody named the missing lines: a count DIVERGE, as before', () => {
    expect(v1(OURS).verdict.verdict).toBe('DIVERGE')
  })
  it('a drawn line at the wrong price is still a DIVERGE, named', () => {
    const wrong = [OURS[0], oLevel(2, LEVELS[1], { y1: 230, y2: 230 }), OURS[2]]
    const { verdict } = v1(wrong, NAMED)
    expect(verdict.verdict).toBe('DIVERGE')
    expect(verdict.counts.find((r) => r.family === 'lines').drawnDiffers).toMatchObject({ field: 'y1', ours: 230 })
  })
  it('a drawn line in the wrong style is still a DIVERGE', () => {
    expect(v1([OURS[0], OURS[1], oLevel(3, LEVELS[2], { style: 'solid' })], NAMED).verdict.verdict).toBe('DIVERGE')
  })
  it('a family we hold MORE of than TradingView is a DIVERGE, named or not (a withheld element cannot add one)', () => {
    const extra = [...OURS, ...[1, 2, 3, 4, 5, 6, 7].map((k) => ({ family: 'line', id: 10 + k,
      props: { x1: k, y1: 200 + k, x2: k + 1, y2: 201 + k, style: 'solid', width: 2, color: '#7E57C2' } }))]
    expect(v1(extra, NAMED).verdict.verdict).toBe('DIVERGE')
  })
  it('a drawn label text TradingView does not hold is a DIVERGE; the ones it holds are a partial', () => {
    const vendorObjs = { counts: { lines: 0, labels: 3, boxes: 0, tables: 0, tableCells: 0 }, texts: { labels: ['a', 'b', 'c'], tableCells: [] } }
    const lab = (id, text) => ({ family: 'label', id, props: { x: 1, y: 5, text, color: '#089981', textcolor: '#FFFFFF' } })
    const vLab = (id, t) => ({ id, x: 1, y: 5, yl: 'pr', t, st: 'ldn', ci: GREEN, tci: 0xffffffff, sz: 'normal', ta: 'center', tt: '' })
    const records = (held) => pairRecords(capOf({ labels: [vLab(1, 'a'), vLab(2, 'b'), vLab(3, 'c')] }), objs(held))
    const grade = (held) => compareObjects(vendorObjs, { drawsObjects: true, ok: true, held,
      counts: { lines: 0, labels: held.length, boxes: 0, tables: 0, tableCells: 0 },
      texts: { labels: held.map((o) => o.props.text), tableCells: [] }, partialFamilies: ['label'] }, null, records(held))
    expect(grade([lab(1, 'a'), lab(2, 'c')]).verdict).toBe('INCONCLUSIVE')
    expect(grade([lab(1, 'a'), lab(2, 'z')]).verdict).toBe('DIVERGE')
    // where the capture's label RECORDS hold no text (`undecoded`, never compared), its text LIST still decides
    const noText = (held) => pairRecords(capOf({ labels: ['a', 'b', 'c'].map((t, i) => { const { t: _t, ...r } = vLab(i + 1, t); return r }) }), objs(held))
    const gradeNoText = (held) => compareObjects(vendorObjs, { drawsObjects: true, ok: true, held,
      counts: { lines: 0, labels: held.length, boxes: 0, tables: 0, tableCells: 0 },
      texts: { labels: held.map((o) => o.props.text), tableCells: [] }, partialFamilies: ['label'] }, null, noText(held))
    expect(gradeNoText([lab(1, 'a'), lab(2, 'c')]).verdict).toBe('INCONCLUSIVE')
    expect(gradeNoText([lab(1, 'a'), lab(2, 'z')]).verdict, 'a drawn label text TradingView does not hold').toBe('DIVERGE')
  })
  it('no pairing at all (a capture without records): the count grades as before, never a partial', () => {
    const vendorObjs = { counts: { lines: 9, labels: 0, boxes: 0, tables: 0, tableCells: 0 }, texts: { labels: [], tableCells: [] } }
    const ourObjs = { drawsObjects: true, ok: true, held: OURS, counts: { lines: 3, labels: 0, boxes: 0, tables: 0, tableCells: 0 },
      texts: { labels: [], tableCells: [] }, ...NAMED }
    expect(compareObjects(vendorObjs, ourObjs, null, null).verdict).toBe('DIVERGE')
  })
})

describe('objects v2 counts the withheld records of a partial, never as a difference', () => {
  it('the paired records are graded; the 6 TradingView holds that we withheld by name are counted apart', () => {
    const { records, verdict } = v1(OURS, NAMED)
    const r = compareObjectsV2(verdict, records)
    const lines = fam(r, 'lines')
    expect(lines.paired).toBe(3)
    expect(lines.withheldUnpaired).toBe(6)
    expect(lines.agreeWithoutX).toBe(true)
    expect(lines.differing).toBe(0)
    expect(r.verdict).toBe('INCONCLUSIVE')
  })
  it('CONTROL: not a partial, the same unpaired records are a count difference', () => {
    const { records, verdict } = v1(OURS)
    expect(fam(compareObjectsV2(verdict, records), 'lines').first).toMatchObject({ field: 'count', vendor: 9, ours: 3 })
  })
})

// ─── our side SAYS which families a disclosed partial drew fewer of (the product path: the member door, its object run) ──
describe('our side names the families its drawing withheld by name (`partialFamilies`)', () => {
  afterEach(() => { vi.unstubAllEnvs() })
  const BARS = Array.from({ length: 30 }, (_, i) => ({ t: T0 + i * DAY, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1 }))
  const H = '//@version=6\nindicator("p", overlay = true)\nif barstate.islast\n    line.new(bar_index - 5, high, bar_index, high)\n'
  const report = (source) => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const d = memberPaneDefinition({ source, id: 'u_obj_partial', name: 'p' })
    expect(d.ok && !!d.definition.objects, d.reason).toBe(true)
    return __objectsReportForTests(d.definition, BARS, { tf: 'D', historyFromListing: true }, null, d)
  }
  it('a create the program lost (a line in a loop it cannot carry): `line` is named', () => {
    const r = report(`${H}    for i = 0 to 9\n        line.new(bar_index[i], close[i], bar_index[i + 1], close[i + 1])\nplot(close)\n`)
    expect(r.ok, r.reason).toBe(true)
    expect(r.partialFamilies).toEqual(['line'])
    expect(r.counts.lines).toBe(1)
  })
  it('CONTROL: a program that lost nothing names nothing', () => {
    const r = report(`${H}plot(close)\n`)
    expect(r.ok, r.reason).toBe(true)
    expect(r.partialFamilies).toBeUndefined()
  })
})
