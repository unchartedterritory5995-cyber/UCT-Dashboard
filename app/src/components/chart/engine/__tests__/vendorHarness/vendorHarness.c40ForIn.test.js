// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c40ForIn.test.js
//
// ─── C40 — `for … in` WALKS EVERY ELEMENT, AGAINST TRADINGVIEW ───────────────
//
// ⭐ THE WITNESS (committed capture, NYSE:RDDT 1D, 632 bars from the listing):
// `trend-lines-supports-and-resistances` draws, on the last bar, an extension
// line, a main line and a label per trend (in that order — ids 1…6 for its two
// uptrends, 7…12 for its two downtrends) and then walks each list:
//
//     for [i, v] in uptrends
//         if v.getLowsBelowPrice(exceptBars = tlExceptBars) > tlMaxViolation
//             v.setViolated(trendColor = stlHighColor)
//
// `setViolated` deletes the trend's extension line and label and restyles its
// main line (dotted, extended, no colour). TradingView's objects at the end:
//
//     uptrend 0   line 2 dotted, lines 1 and label 3 GONE      ← violated
//     uptrend 1   line 4 dashed, line 5 arrow, label 6 KEPT     ← not violated
//     downtrend 0 line 8 dotted, line 7 and label 9 GONE       ← violated
//     downtrend 1 line 11 dotted, line 10 and label 12 GONE    ← violated
//
// So the walk visited BOTH elements of a two-element list (downtrends), applied
// the body's deletes and setters to each, and evaluated the body's `if` per
// element (uptrends: one violated, one not).
//
// ⭐ WHAT IS PINNED:
//   1. the capture itself says so (ids, styles, extension);
//   2. OUR object lane, running the same loop shape over plain drawing lists on
//      the vendor's bars, ends with TradingView's objects: the same ids, the same
//      styles and extension, every line at the vendor's prices;
//   3. CONTROL: without the loops the twelve objects all stand — so rail 2 cannot
//      pass by drawing whatever the loops do;
//   4. the two captured scripts whose `for … in` this lane touches or leaves
//      alone grade as they did: ict-killzones MATCH, trend-lines unchanged.
//
// ⚠️ NOT THIS LANE'S, and said rather than hidden: the violation test itself
// (`getLowsBelowPrice` — a counted loop accumulating over `line.get_price`) and
// the list of user-defined `trendLine`s. The probe takes TradingView's verdict per
// element (read off the capture: element 0 violated, element 1 not) and keeps
// the lines, labels and extension lines in three plain lists.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture, gradeCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects, OBJECT_STATUS } from '../../objectRuntime'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const TSR = 'trend-lines-supports-and-resistances-rddt-1d-2026-09-28.json'
const KZ = 'ict-killzones-pivots-tfo-rddt-1d-2026-09-28.json'

afterEach(() => { vi.unstubAllEnvs() })

const capture = (file = TSR) => loadCapture(path.join(DIR, file)).capture
const barsOf = (cap) => {
  const ix = Object.fromEntries(cap.bars.fields.map((f, i) => [f, i]))
  return cap.bars.rows.map((r) => ({ o: r[ix.open], h: r[ix.high], l: r[ix.low], c: r[ix.close] }))
}
const near = (a, b) => Math.abs(a - b) < 1e-6
const lineOf = (cap, id) => cap.objects.records.lines.find((l) => l.id === id)

/** The capture's four trends: each main line's two anchors, located on the
 *  capture's own bars — an uptrend joins two LOWS, a downtrend two HIGHS. */
function vendorTrends(cap) {
  const bars = barsOf(cap)
  const at = (field, price) => {
    const hits = bars.map((b, i) => (near(b[field], price) ? i : -1)).filter((i) => i >= 0)
    return hits.length === 1 ? hits[0] : -1
  }
  return [
    { kind: 'up', field: 'l', main: lineOf(cap, 2), violated: true },
    { kind: 'up', field: 'l', main: lineOf(cap, 5), violated: false },
    { kind: 'dn', field: 'h', main: lineOf(cap, 8), violated: true },
    { kind: 'dn', field: 'h', main: lineOf(cap, 11), violated: true },
  ].map((t) => ({ ...t, a: at(t.field, t.main.y1), b: at(t.field, t.main.y2) }))
}

/** The capture's loop shape (lines 240–318) over three plain lists per
 *  direction: draw each trend's extension, main line and label, then walk the
 *  mains and treat each element as TradingView did. */
const probe = (trends, { walk = true } = {}) => {
  const draw = (t, p) => {
    const s = t.field === 'l' ? 'low' : 'high'
    const pts = `${t.a}, ${s}[bar_index - ${t.a}], ${t.b}, ${s}[bar_index - ${t.b}]`
    return [
      `    array.push(${p}Ext, line.new(${pts}, extend = extend.right, style = line.style_dashed))`,
      `    array.push(${p}Main, line.new(${pts}, style = line.style_arrow_both))`,
      `    array.push(${p}Lbl, label.new(bar_index, ${s}[bar_index - ${t.b}], "trend"))`,
    ]
  }
  const violate = (p, pad) => [
    `${pad}line.delete(array.get(${p}Ext, i))`,
    `${pad}label.delete(array.get(${p}Lbl, i))`,
    `${pad}line.set_style(v, line.style_dotted)`,
    `${pad}line.set_extend(v, extend.right)`,
  ]
  const ups = trends.filter((t) => t.kind === 'up')
  const dns = trends.filter((t) => t.kind === 'dn')
  return [
    '//@version=5',
    'indicator("C40 probe", overlay = true, max_bars_back = 5000)',
    ...['up', 'dn'].flatMap((p) => [
      `var line[] ${p}Ext = array.new_line()`, `var line[] ${p}Main = array.new_line()`, `var label[] ${p}Lbl = array.new_label()`,
    ]),
    'if barstate.islast',
    ...ups.flatMap((t) => draw(t, 'up')),
    // TradingView's verdict per element: element 0 violated, element 1 not.
    ...(walk ? ['    for [i, v] in upMain', '        if i == 0', ...violate('up', '            ')] : []),
    ...dns.flatMap((t) => draw(t, 'dn')),
    // …and both downtrends violated: the body runs for every element.
    ...(walk ? ['    for [i, v] in dnMain', ...violate('dn', '        ')] : []),
  ].join('\n')
}

function ourObjects(cap, source) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const bars = toProductBars(cap)
  const d = memberPaneDefinition({ source, id: 'u_c40_forin', name: 'c40' })
  if (!d.ok || !d.definition.objects) return { d, live: [] }
  const reader = objectReaderFor(d.definition, bars, {
    tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
    historyFromListing: true,
  })
  const run = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  return { d, run, live: run.live }
}
const STYLE = { 'line.style_dotted': 'dot', 'line.style_dashed': 'dsh', 'line.style_arrow_both': 'ab', dotted: 'dot', dashed: 'dsh', arrow_both: 'ab' }
const EXTEND = { 'extend.right': 'r', 'extend.none': 'n', right: 'r', none: 'n', undefined: 'n' }
const shapeOf = (o) => (o.family === 'line'
  ? `line#${o.id} ${STYLE[String(o.props.style)]} ${EXTEND[String(o.props.extend)]} ${o.props.y1.toFixed(4)}→${o.props.y2.toFixed(4)}`
  : `${o.family}#${o.id}`)
const vendorShapes = (cap) => [
  ...cap.objects.records.lines.map((l) => ({ id: l.id, s: `line#${l.id} ${l.st} ${l.ex} ${l.y1.toFixed(4)}→${l.y2.toFixed(4)}` })),
  ...cap.objects.records.labels.filter((l) => l.id <= 12).map((l) => ({ id: l.id, s: `label#${l.id}` })),
].sort((a, b) => a.id - b.id).map((x) => x.s)

describe('C40 — `for … in` applies its body to every element of the list', () => {
  it('⭐ the capture: both elements of `downtrends` were walked, and the `if` was read per element of `uptrends`', () => {
    const cap = capture()
    const ids = (list) => list.map((o) => o.id)
    // six trend objects survive of the twelve the script made (ids 1…12)
    expect(ids(cap.objects.records.lines)).toEqual([2, 4, 5, 8, 11])
    expect(ids(cap.objects.records.labels).filter((id) => id <= 12)).toEqual([6])
    // a violated trend's main line is dotted, extended, colourless; the unviolated one is not
    for (const id of [2, 8, 11]) expect(lineOf(cap, id)).toMatchObject({ st: 'dot', ex: 'r', ci: null })
    expect(lineOf(cap, 5)).toMatchObject({ st: 'ab', ex: 'n' })
    expect(lineOf(cap, 4)).toMatchObject({ st: 'dsh', ex: 'r' })
    // every anchor sits on exactly one of the capture's own bars, in the capture's x order
    const tr = vendorTrends(cap)
    for (const t of tr) {
      expect(t.a, JSON.stringify(t.main)).toBeGreaterThanOrEqual(0)
      expect(t.b).toBeGreaterThan(t.a)
    }
    expect(tr[0].a).toBe(tr[1].a)          // both uptrends start at the 119.27 low (x rank 4)
    expect(tr[0].b).toBeLessThan(tr[1].b)  // x ranks 6 < 9
    expect(tr[2].a).toBeLessThan(tr[3].a)  // x ranks 1 < 2
    expect(tr[2].b).toBe(tr[3].b)          // both downtrends end at the 208.05 high (x rank 8)
  })

  it("⭐ our object lane, walking the same lists, ends with TradingView's objects — id for id", () => {
    const cap = capture()
    const { d, run, live } = ourObjects(cap, probe(vendorTrends(cap)))
    expect(d.ok, d.reason || '').toBe(true)
    expect(d.translation.objectDiagnostics.dropReasons).toEqual({})
    expect(d.translation.objectDiagnostics.loopBlockedCalls).toEqual([])
    expect(run.status).toBe(OBJECT_STATUS.OK)
    expect(live.map(shapeOf)).toEqual(vendorShapes(cap))
    // three trends violated: three extension lines and three labels deleted
    expect(run.stats.deleted).toBe(6)
  })

  it('🔴 CONTROL: without the walks all twelve objects stand, and the comparison fails', () => {
    const cap = capture()
    const { d, live } = ourObjects(cap, probe(vendorTrends(cap), { walk: false }))
    expect(d.ok, d.reason || '').toBe(true)
    expect(live).toHaveLength(12)
    expect(live.map(shapeOf)).not.toEqual(vendorShapes(cap))
  })
})

describe('C40 — the captured scripts that write `for … in` grade as they did', () => {
  it('ict-killzones (`for l in levels`, a list of user types — not walked) stays MATCH', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const v = gradeCapture(capture(KZ)).verdict
    expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
  }, 120000)

  it('trend-lines: `f_clearAll`\'s three `.all` walks are carried; its drawing stays behind the next walls, by name', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const cap = capture()
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c40_tsr', name: 'tsr' })
    const od = (d.translation && d.translation.objectDiagnostics) || {}
    // no `for … in` this lane holds was refused — the loops left are over user types
    expect(od.forInRefused).toBeUndefined()
    // the creates and the per-trend setters still sit in loops over user-type lists / a `while`
    expect(od.loopBlockedCalls).toEqual(expect.arrayContaining(['box.new', 'label.new', 'line.new', 'line.set_style']))
    // …so nothing of its picture is drawn: no object TradingView lacks
    expect(d.ok && d.definition.objects ? d.definition.objects.ops.some((o) => o.k === 'create') : false).toBe(false)
  }, 120000)
})
