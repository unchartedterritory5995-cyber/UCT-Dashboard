// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c48ForIn.test.js
//
// ─── C48 — `for … in` OVER A LIST ITS BODY CHANGES, `<family>.all`, A SIZED LIST ──
//
// C40 ran `for x in <list>`, `for … in <family>.all` and the cap `while`, and
// refused BY NAME four things no capture showed. The probe was taken —
// `vw-forin-collections-rddt-1d-2026-10-01` (NYSE:RDDT 1D from the listing,
// `tools/visual_conformance/probes/vw-forin-collections.pine`). What it shows,
// each claim re-derived below from the fixture's own rows and objects:
//
//   F03  the body SHIFTS the list it walks       3 passes; y = 23 and 24 are left
//   F04  the body PUSHES onto it (ten at most)   13 passes; 30–32 and 40–49 exist
//   F05  a later slot is REPLACED before the walk reaches it
//                                                the pass is handed y = 59 (x2 + 5)
//        → `for x in <own list>` walks the LIVE list: the length is re-read before
//          every pass, the slot is read when the pass reaches it.
//   A02  the array `box.all` handed back stays 5 long after a delete
//   A04  `for b in box.all → box.delete(b)` over four boxes: 4 passes
//   A05  …and none is left
//   A06  positions in `box.all`: "0", "1", "2", oldest first
//        → `<family>.all` is a SNAPSHOT taken when it is read.
//   Z01  `array.size(array.new_label(3))` is 3 on every bar
//   Z02  the replace-in-place idiom holds 3 labels;  Z03  slot 0 is the last bar's
//        → a sized drawing list holds exactly its slots, `na` until written.
//
// ⛔ The probe is not graded end to end: its rows are counters (`p3 += 1`) the
// object lane does not carry, one loop variable name is reused across families,
// and `box.delete(array.get(held, 0))` reads an alias of `box.all`. Each is
// refused by name, as before. The rail REPLAYS the probe's drawing steps in the
// spelling the door serves — the pass counter read as the loop's own position —
// over the capture's own bars, and every expectation is READ OFF THE FIXTURE's
// objects, never typed.
import { describe, it, expect } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { translatePine } from '../../ast/pine'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/vw-forin-collections-rddt-1d-2026-10-01.json')
let cached = null
const load = () => {
  if (cached) return cached
  const loaded = loadCapture(FILE)
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  cached = loaded.capture
  return cached
}
/** One plot column by title prefix (`F03`), aligned to the plot rows. */
const col = (cap, row) => {
  const plot = cap.study.plots.find((p) => String(p.title).startsWith(`${row}_`))
  if (!plot) throw new Error(`no plot ${row}`)
  const k = cap.plotValues.fields.indexOf(plot.id)
  return cap.plotValues.rows.map((r) => r[k])
}
const last = (cap, row) => { const c = col(cap, row); return c[c.length - 1] }

const LF = String.fromCharCode(10)
// The probe's drawing steps. A pass counter (`p4 < 10`) is the loop's own position.
const F_BLOCK = [
  'if barstate.islast',
  '    line[] fl = array.new_line()',
  '    for k = 0 to 4',
  '        array.push(fl, line.new(bar_index, 10 + k, bar_index + 1, 10 + k))',
  '    for [i1, l1] in fl',
  '        line.set_x2(l1, bar_index + 1 + i1)',
  '    line[] sh = array.new_line()',
  '    for k = 0 to 4',
  '        array.push(sh, line.new(bar_index, 20 + k, bar_index + 1, 20 + k))',
  '    for l3 in sh',
  '        if array.size(sh) > 0',
  '            line.delete(array.shift(sh))',
  '    line[] gr = array.new_line()',
  '    for k = 0 to 2',
  '        array.push(gr, line.new(bar_index, 30 + k, bar_index + 1, 30 + k))',
  '    for [i4, l4] in gr',
  '        if i4 < 10',
  '            array.push(gr, line.new(bar_index, 40 + i4, bar_index + 1, 40 + i4))',
  '    line[] rp = array.new_line()',
  '    for k = 0 to 2',
  '        array.push(rp, line.new(bar_index, 50 + k, bar_index + 1, 50 + k))',
  '    line other = line.new(bar_index, 59, bar_index + 1, 59)',
  '    for [i5, l5] in rp',
  '        if i5 == 0',
  '            array.set(rp, 2, other)',
  '        if i5 == 2',
  '            line.set_x2(l5, bar_index + 5)',
]
const A_BLOCK = [
  'if barstate.islast',
  '    box b0 = box.new(bar_index, 60.5, bar_index + 1, 60)',
  '    for k = 1 to 4',
  '        box.new(bar_index, 60 + k + 0.5, bar_index + 1, 60 + k)',
  '    box.delete(b0)',
  '    for b in box.all',
  '        box.delete(b)',
  '    for k = 0 to 2',
  '        box.new(bar_index + 2, 70 + k + 0.5, bar_index + 3, 70 + k)',
  '    for [i6, b6] in box.all',
  '        box.set_text(b6, str.tostring(i6))',
]
const W_BLOCK = [
  'if barstate.islast',
  '    label[] wl = array.new_label()',
  '    for k = 0 to 3',
  '        array.push(wl, label.new(bar_index, 80 + k, "W" + str.tostring(k)))',
  '    while array.size(wl) > 2',
  '        label.delete(array.shift(wl))',
]
const Z_BLOCK = [
  'var label[] zl = array.new_label(3)',
  'for i = 0 to 2',
  '    label.delete(array.get(zl, i))',
  '    array.set(zl, i, label.new(bar_index, 90 + i, "Z" + str.tostring(i)))',
]
const script = (...blocks) => ['//@version=5',
  'indicator("c48 forin", overlay = false, max_lines_count = 100, max_boxes_count = 100, max_labels_count = 100)',
  ...blocks.flat(), 'plot(close)', ''].join(LF)

const runReplay = (cap, src, trace = false) => {
  const bars = toProductBars(cap)
  const t = translatePine(src, { strict: true })
  expect(t.objects, JSON.stringify(t.objectDiagnostics)).toBeTruthy()
  const reader = objectReaderFor({ objects: t.objects }, bars, { tf: 'D', newestBarIsForming: false })
  const run = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    ...(trace ? { trace: true } : {}),
  })
  return { t, run, bars }
}
const byY = (a, b) => a[0] - b[0]

describe('C48 — the capture: what a `for … in` walks, what `.all` holds, what a sized list is', () => {
  it('⭐ the study ran to the last bar without an error, and holds 24 lines, 3 boxes, 5 labels', () => {
    const cap = load()
    expect(cap.study.status.type).toBe(2)
    expect(cap.objects.counts).toMatchObject({ lines: 24, boxes: 3, labels: 5 })
    expect(cap.history && cap.history.startsAtBar0).toBe(true)
  })

  it('⭐ CONTROLS — F01 five passes in index order, F02 none over an empty list, W01 two cap passes', () => {
    const cap = load()
    expect([last(cap, 'F01'), last(cap, 'F02'), last(cap, 'W01')]).toEqual([5, 0, 2])
    const f01 = cap.objects.records.lines.filter((l) => l.y1 >= 10 && l.y1 <= 14).map((l) => [l.y1, l.x2 - l.x1])
    expect(f01.sort(byY)).toEqual([[10, 1], [11, 2], [12, 3], [13, 4], [14, 5]])
  })

  it('⭐⭐ F03 / F04 / F05: `for x in <own list>` walks the LIVE list', () => {
    const cap = load()
    const ys = cap.objects.records.lines.map((l) => l.y1)
    // F03 — the body shifts: 3 passes (a walk of the list it started with makes 5)
    expect(last(cap, 'F03')).toBe(3)
    expect(ys.filter((y) => y >= 20 && y <= 24).sort()).toEqual([23, 24])
    // F04 — the body pushes ten: 13 passes (fixed at entry: 3)
    expect(last(cap, 'F04')).toBe(13)
    expect(ys.filter((y) => y >= 30 && y <= 49).sort((a, b) => a - b))
      .toEqual([30, 31, 32, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49])
    // F05 — the replaced slot: y = 59 was moved, y = 52 was not
    const x2 = (y) => { const l = cap.objects.records.lines.find((r) => r.y1 === y); return l.x2 - l.x1 }
    expect([x2(59), x2(52)]).toEqual([5, 1])
  })

  it('⭐⭐ A02 / A04 / A05 / A06: `box.all` is a SNAPSHOT, positions oldest first', () => {
    const cap = load()
    expect([last(cap, 'A01'), last(cap, 'A02'), last(cap, 'A03')]).toEqual([5, 5, 4])
    // the walk over the live list would make 2 passes and leave 2
    expect([last(cap, 'A04'), last(cap, 'A05')]).toEqual([4, 0])
    const boxes = cap.objects.records.boxes
    expect(boxes.every((b) => b.y2 >= 70)).toBe(true)
    expect([...boxes].sort((a, b) => a.id - b.id).map((b) => [b.y2, b.t])).toEqual([[70, '0'], [71, '1'], [72, '2']])
  })

  it('⭐⭐ Z01 / Z02 / Z03: a sized list holds its three slots on EVERY bar', () => {
    const cap = load()
    const n = cap.plotValues.rows.length
    expect(n).toBeGreaterThan(600)
    expect(col(cap, 'Z01').filter((v) => v === 3)).toHaveLength(n)
    expect(col(cap, 'Z02').filter((v) => v === 3)).toHaveLength(n)
    const bi = col(cap, 'C00')
    expect(col(cap, 'Z03').filter((v, i) => v === bi[i])).toHaveLength(n)
  })
})

describe('C48 — replayed on the capture\'s bars: our objects are TradingView\'s', () => {
  it('⭐⭐ the whole probe: 24 lines, 3 boxes, 5 labels — every y, every length, every text', () => {
    const cap = load()
    const { t, run, bars } = runReplay(cap, script(F_BLOCK, A_BLOCK, W_BLOCK, Z_BLOCK))
    expect(t.objectDiagnostics.droppedOps, JSON.stringify(t.objectDiagnostics.dropReasons)).toBe(0)
    expect(t.objectDiagnostics.forInRefused).toBeUndefined()
    expect(t.objectDiagnostics.collsDivergedWhy).toBeUndefined()
    expect(run.status).toBe('ok')
    expect(run.stats.objectsTainted || 0).toBe(0)
    const lastBar = bars.length - 1
    const rec = cap.objects.records
    // lines: [y, x1 from the last bar, x2 from the last bar]
    const oursLines = run.live.filter((o) => o.family === 'line').map((o) => [o.props.y1, o.props.x1 - lastBar, o.props.x2 - lastBar])
    expect(oursLines.sort(byY)).toEqual(rec.lines.map((l) => [l.y1, l.x1, l.x2]).sort(byY))
    expect(oursLines).toHaveLength(24)
    // boxes: [bottom, top, left, right, text]
    const oursBoxes = run.live.filter((o) => o.family === 'box')
      .map((o) => [o.props.bottom, o.props.top, o.props.left - lastBar, o.props.right - lastBar, String(o.props.text ?? '')])
    expect(oursBoxes.sort(byY)).toEqual(rec.boxes.map((b) => [b.y2, b.y1, b.x1, b.x2, b.t]).sort(byY))
    // labels: [y, x from the last bar, text]
    const oursLabels = run.live.filter((o) => o.family === 'label').map((o) => [o.props.y, o.props.x - lastBar, String(o.props.text ?? '')])
    expect(oursLabels.sort(byY)).toEqual(rec.labels.map((l) => [l.y, l.x, l.t]).sort(byY))
  }, 240000)

  it('⭐ the pass counts are TradingView\'s: 3 deletes for F03, 10 creates for F04, 5 deletes over `box.all`', () => {
    const cap = load()
    const f = runReplay(cap, script(F_BLOCK)).run
    // 5 + 5 + 3 + 3 + 1 made before the walks, plus F04's pushes; F03's shifts deleted
    expect(f.stats.created - 17).toBe(last(cap, 'F04') - 3)
    expect(f.stats.deleted).toBe(last(cap, 'F03'))
    const a = runReplay(cap, script(A_BLOCK)).run
    // one by hand, then one pass per box the snapshot held
    expect(a.stats.deleted - 1).toBe(last(cap, 'A04'))
    expect(a.live.filter((o) => o.family === 'box')).toHaveLength(3 + last(cap, 'A05'))
  }, 240000)

  it('⭐ the sized list holds three labels on every bar, and slot 0 is that bar\'s (Z01–Z03)', () => {
    const cap = load()
    const { t, run, bars } = runReplay(cap, script(Z_BLOCK))
    expect(t.objects.colls.filter((c) => c.slots === 3)).toHaveLength(1)
    // every bar makes three and deletes the three before: 3 live at the end
    expect(run.stats.created).toBe(3 * bars.length)
    expect(run.stats.deleted).toBe(3 * (bars.length - 1))
    const labels = run.live.filter((o) => o.family === 'label')
    expect(labels.map((o) => o.props.text).sort()).toEqual(['Z0', 'Z1', 'Z2'])
    expect(labels.every((o) => o.props.x === bars.length - 1)).toBe(true)
    expect(col(cap, 'Z03')[cap.plotValues.rows.length - 1]).toBe(bars.length - 1)
  }, 240000)
})

describe('C48 — what stays refused, by name', () => {
  const tr = (lines) => translatePine(script(lines), { strict: true })
  const WALK = (change) => ['var line[] xs = array.new_line()', 'array.push(xs, line.new(bar_index, high, bar_index + 1, high))',
    'for [i, l] in xs', '    line.set_x2(l, bar_index + 2)', `    ${change}`]

  it('⛔ a body that changes its list by `remove` / `pop` / `unshift` / `insert` / `clear`, or reassigns it (no row)', () => {
    for (const change of ['line.delete(array.remove(xs, i))', 'line.delete(array.pop(xs))', 'array.unshift(xs, l)',
      'array.insert(xs, 0, l)', 'array.clear(xs)', 'xs := array.new_line()']) {
      const d = tr(WALK(change)).objectDiagnostics
      expect(d.forInRefused, change).toEqual(['the body changes `xs`, the list it walks, by more than push / shift / set@5'])
    }
    // CONTROL — the three the capture shows are served
    for (const change of ['line.delete(array.shift(xs))', 'array.set(xs, i, l)']) {
      expect(tr(WALK(change)).objectDiagnostics.forInRefused, change).toBeUndefined()
    }
  })

  it('⛔ a sized list with a second argument, a size that is not a literal, or no `var`', () => {
    for (const decl of ['var label[] zl = array.new_label(3, na)', 'var label[] zl = array.new_label(bar_index)',
      'label[] zl = array.new_label(3)']) {
      const d = tr([decl, ...Z_BLOCK.slice(1)]).objectDiagnostics
      expect(d.collsDivergedWhy, decl).toEqual(['zl: coll:sized@3'])
    }
  })
})
