// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c48GetterHistory.test.js
//
// ─── C48 — A DRAWING GETTER ON A LIVE HANDLE, AND ITS HISTORY ──────────────────
//
// C33 served a getter in a text only where it read `na` ("NaN"), and a getter's
// history only where the handle was empty. The probe that prints the rest was
// taken — `vw-getter-history-spy-1d-2026-10-01` (AMEX:SPY 1D, probe
// `tools/visual_conformance/probes/vw-getter-history.pine`). What it shows, each
// claim re-derived below from the fixture's own columns and labels:
//
//   G01 / G08  `str.tostring(line.get_y1(a))` prints the live number (the close)
//   G06 / G07  a line never moved prints the y it was made at; `get_x1` the bar
//   H03 / H04  `ya[1]` and `line.get_y1(a)[1]` are the value ONE BAR AGO — `close[1]`
//   H07 / H09 / H12  the same for a line never moved, one replaced, and `get_x1`
//   G02        inside the last-bar block `line.get_y1(a)[1]` is NaN (the block's
//              own history: it has no earlier run)
//   G03        `ya[1]` read inside that block is still `close[1]`: `ya` is a
//              top-level variable, its history is the chart's
//   H10        `line.get_y1(c[1])` on the bar `c` was replaced is `na`: the
//              previous handle was deleted
//
// ⛔ The probe is not graded end to end: its rows are PLOTS of getters, and the
// plot lane does not read a drawing (the door refuses, by name). The rail runs
// the same reads through the object lane — the probe's last-bar labels as
// written, and each per-bar row as a label made on every bar — over TradingView's
// own bars from the listing (`joinedFromListing`: `b` is made on the symbol's
// first bar, and `get_x1` is the vendor's `bar_index`). Every expectation is READ
// OFF THE FIXTURE, never typed.
import { describe, it, expect } from 'vitest'

import { toProductBars } from './ourSide'
import { parent, joinedFromListing, vendorColumn } from './c38Joined'
import { translatePine } from '../../ast/pine'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { assertObjectProgram } from '../../ast/objectProgram'

const PROBE = 'vw-getter-history-spy-1d-2026-10-01'
const CONTROL = 'H00_bar_index_CONTROL'
const cap = parent(PROBE)
const col = (title) => vendorColumn(cap, title)
const N = cap.bars.rows.length
const near = (a, b) => (a === null && b === null)
  || (a !== null && b !== null && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)))

const LF = String.fromCharCode(10)
const HEAD = [
  '//@version=6',
  'indicator("c48 getter history", overlay = true, max_labels_count = 500, max_lines_count = 50)',
  'var line a = line.new(bar_index, close, bar_index + 1, close)',
  'line.set_xy1(a, bar_index, close)',
  'line.set_xy2(a, bar_index + 1, close)',
  'var line b = line.new(bar_index, close, bar_index + 1, close)',
  'var line c = na',
  'if bar_index % 5 == 0',
  '    line.delete(c)',
  '    c := line.new(bar_index, high, bar_index + 1, high)',
  'float ya = line.get_y1(a)',
  'float yc = line.get_y1(c)',
]
// the probe's own last-bar block, text for text
const LAST = cap.source.text.split(/\r?\n/).filter((l) => /^if barstate\.islast|^\s+label\.new\(/.test(l))

let joinedBars = null
const bars = () => {
  if (!joinedBars) joinedBars = toProductBars(joinedFromListing(cap, { control: CONTROL, id: 'getter' }))
  return joinedBars
}
const runScript = (lines) => {
  const b = bars()
  const t = translatePine([...HEAD, ...lines, 'plot(close)', ''].join(LF), { strict: true })
  expect(t.objects, JSON.stringify(t.objectDiagnostics && t.objectDiagnostics.dropReasons)).toBeTruthy()
  const reader = objectReaderFor({ objects: t.objects }, b, { tf: 'D', newestBarIsForming: false })
  const run = evaluateObjects(reader.program, {
    barCount: b.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  return { t, run }
}
const labelTexts = (run) => run.live.filter((o) => o.family === 'label').sort((x, y) => x.id - y.id)
  .map((o) => String(o.props.text ?? ''))

describe('C48 — the capture: what a getter and its history read', () => {
  it('⭐ the fixture is the listing\'s last 300 bars, and its controls are what they say', () => {
    expect(N).toBe(300)
    expect(col(CONTROL)[N - 1] - col(CONTROL)[0]).toBe(N - 1)
    expect(col(CONTROL)[0]).toBeGreaterThan(8000)   // the vendor's bar_index, counted from the listing
    expect(col('H01_close_CONTROL')).toEqual(cap.bars.rows.map((r) => r[4]))
  })

  it('⭐ H02: a getter on a line moved every bar is the close, 300 / 300', () => {
    const y = col('H02_get_y1_moved_every_bar'); const c = col('H01_close_CONTROL')
    expect(y.filter((v, i) => near(v, c[i]))).toHaveLength(N)
  })

  it('⭐⭐ H03 / H04: the variable\'s `[1]` and the getter\'s own `[1]` are `close[1]` — ONE BAR AGO, not the current value', () => {
    const prev = col('H05_close_hist1_CONTROL'); const now = col('H01_close_CONTROL')
    for (const row of ['H03_get_y1_var_hist1', 'H04_get_y1_direct_hist1']) {
      const v = col(row)
      expect(v.filter((x, i) => near(x, prev[i])), row).toHaveLength(N)
      // …and it can tell: the current value is a different number on nearly every bar
      expect(v.filter((x, i) => near(x, now[i])).length, row).toBeLessThan(10)
    }
  })

  it('⭐ H07 / H09 / H12: the same one-bar history for a line never moved, one replaced, and `get_x1`', () => {
    const shifted = (title) => { const v = col(title); return v.map((x, i) => (i ? v[i - 1] : undefined)) }
    for (const [hist, live] of [
      ['H07_get_y1_never_moved_hist1', 'H06_get_y1_never_moved'],
      ['H09_get_y1_replaced_hist1', 'H08_get_y1_replaced_every_5'],
      ['H12_get_x1_hist1', 'H11_get_x1_moved_every_bar'],
    ]) {
      const h = col(hist); const want = shifted(live)
      let ok = 0
      for (let i = 1; i < N; i++) if (near(h[i], want[i])) ok += 1
      expect(ok, hist).toBe(N - 1)
    }
    // a replaced line's history differs from its current value on the replace bars
    const h9 = col('H09_get_y1_replaced_hist1'); const h8 = col('H08_get_y1_replaced_every_5')
    expect(h9.filter((x, i) => !near(x, h8[i])).length).toBeGreaterThan(50)
  })

  it('⭐ H10: a getter on the PREVIOUS handle is `na` on the bar the line was replaced (deleted), the line\'s y elsewhere', () => {
    const bi = col(CONTROL); const h = col('H10_get_y1_of_previous_handle'); const ctl = col('H13_high_at_last_replace_CONTROL')
    let na = 0; let same = 0; let replaced = 0; let other = 0
    for (let i = 1; i < N; i++) {
      if (bi[i] % 5 === 0) { replaced += 1; if (h[i] === null) na += 1 } else { other += 1; if (near(h[i], ctl[i])) same += 1 }
    }
    expect([na, replaced]).toEqual([60, 60])
    expect(same).toBe(other)
  })

  it('⭐ the eight labels: live numbers print, the block\'s own `[1]` is NaN, the top-level variable\'s is `close[1]`', () => {
    const t = Object.fromEntries(cap.objects.records.labels.map((l) => { const [h, v] = String(l.t).split('|'); return [h.split(' ')[0], v] }))
    expect(t.G01).toBe(t.G04)
    expect(t.G08).toBe(t.G04)
    expect(t.G02).toBe('NaN')
    expect(t.G03).toBe(t.G05)
    expect(t.G03).not.toBe(t.G04)
    expect(Number(t.G07)).toBe(col(CONTROL)[N - 1])
    expect(Number(t.G06)).toBe(col('H06_get_y1_never_moved')[N - 1])
  })
})

describe('C48 — our object lane on TradingView\'s bars: the same texts', () => {
  it('⭐⭐ the probe\'s last-bar block, as written: our eight labels are TradingView\'s, text for text', () => {
    expect(LAST).toHaveLength(9)
    const { t, run } = runScript(LAST)
    expect(t.objectDiagnostics.droppedOps, JSON.stringify(t.objectDiagnostics.dropReasons)).toBe(0)
    expect(run.status).toBe('ok')
    expect(run.stats.objectsTainted || 0).toBe(0)
    expect(labelTexts(run)).toEqual(cap.objects.records.labels.map((l) => String(l.t)))
  }, 240000)

  // each per-bar row, as a label made on every bar: the last 300 are the window
  const ROWS = [
    ['H02_get_y1_moved_every_bar', 'ya'],
    ['H03_get_y1_var_hist1', 'ya[1]'],
    ['H04_get_y1_direct_hist1', 'line.get_y1(a)[1]'],
    ['H06_get_y1_never_moved', 'line.get_y1(b)'],
    ['H07_get_y1_never_moved_hist1', 'line.get_y1(b)[1]'],
    ['H08_get_y1_replaced_every_5', 'yc'],
    ['H09_get_y1_replaced_hist1', 'yc[1]'],
    ['H11_get_x1_moved_every_bar', 'line.get_x1(a)'],
    ['H12_get_x1_hist1', 'line.get_x1(a)[1]'],
  ]
  for (const [row, expr] of ROWS) {
    it(`⭐⭐ ${row}: \`str.tostring(${expr})\` on every bar is TradingView's number, ${N} / ${N}`, () => {
      const { t, run } = runScript([`label.new(bar_index, high, "v|" + str.tostring(${expr}))`])
      expect(t.objectDiagnostics.droppedOps, JSON.stringify(t.objectDiagnostics.dropReasons)).toBe(0)
      expect(run.status).toBe('ok')
      expect(run.stats.objectsTainted || 0).toBe(0)
      const texts = labelTexts(run).slice(-N)
      expect(texts).toHaveLength(N)
      const want = col(row)
      const ours = texts.map((s) => { const v = s.split('|')[1]; return v === 'NaN' ? null : Number(v) })
      const bad = ours.map((v, i) => (near(v, want[i]) ? null : [i, v, want[i]])).filter(Boolean)
      expect(bad.slice(0, 3)).toEqual([])
    }, 240000)
  }

  it('⭐⭐ H10 — `line.get_y1(c[1])`, a getter on the PREVIOUS handle: `NaN` where the line was replaced, its y elsewhere', () => {
    const { t, run } = runScript(['label.new(bar_index, high, "v|" + str.tostring(line.get_y1(c[1])))'])
    expect(t.objectDiagnostics.droppedOps, JSON.stringify(t.objectDiagnostics.dropReasons)).toBe(0)
    expect(run.stats.objectsTainted || 0).toBe(0)
    const texts = labelTexts(run).slice(-N)
    expect(texts).toHaveLength(N)
    const want = col('H10_get_y1_of_previous_handle')
    const ours = texts.map((s) => { const v = s.split('|')[1]; return v === 'NaN' ? null : Number(v) })
    expect(ours.map((v, i) => (near(v, want[i]) ? null : [i, v, want[i]])).filter(Boolean).slice(0, 3)).toEqual([])
    // non-vacuity: the deleted-handle bars are in the comparison, and print NaN
    expect(texts.filter((s) => s === 'v|NaN').length).toBe(want.filter((v) => v === null).length)
    expect(want.filter((v) => v === null).length).toBeGreaterThanOrEqual(60)
  }, 240000)

  it('⛔ the program door: the target of a getter is a register, or the handle it held 1..50 bars ago, never in a loop', () => {
    const t = translatePine([...HEAD, 'label.new(bar_index, high, "v|" + str.tostring(line.get_y1(c[1])))', 'plot(close)', ''].join(LF), { strict: true })
    expect(JSON.stringify(t.objects)).toContain('"back":1')
    const swap = (back) => JSON.parse(JSON.stringify(t.objects), (k, v) => (v && v.r === 'reg' && v.back === 1 ? { ...v, back } : v))
    expect(() => assertObjectProgram(swap(1))).not.toThrow()
    for (const back of [0, 51, 1.5]) expect(() => assertObjectProgram(swap(back)), String(back)).toThrow(/a getter reads a register/)
  })

  it('⛔ what stays held: a number read back from TWO bars ago is never drawn', () => {
    const { run } = runScript(['label.new(bar_index, high, "v|" + str.tostring(line.get_y1(a)[2]))'])
    // every bar past the second reads a number from two bars back — unmeasured
    expect(labelTexts(run).filter((s) => s !== 'v|NaN')).toEqual([])
    expect(run.stats.objectsTainted).toBeGreaterThan(100)
  }, 240000)

  it('⛔ what stays held: a getter\'s `[1]` in a block that runs on SOME bars (the previous RUN, which is not kept)', () => {
    const { run } = runScript(['if close > open', '    label.new(bar_index, high, "v|" + str.tostring(line.get_y1(a)[1]))'])
    // the only labels drawn are the ones whose previous BAR also ran the block —
    // there the previous run and the previous bar are the same read
    const b = bars()
    const up = b.map((x) => x.c > x.o)
    const drawn = run.live.filter((o) => o.family === 'label')
    expect(drawn.length).toBeGreaterThan(100)
    for (const o of drawn) {
      const i = o.props.x
      expect(up[i] && up[i - 1], `bar ${i}`).toBe(true)
      expect(near(Number(String(o.props.text).split('|')[1]), b[i - 1].c), `bar ${i}`).toBe(true)
    }
    // …and a run after a skipped bar is held
    expect(run.stats.objectsTainted).toBeGreaterThan(100)
  }, 240000)

  it('⛔ a scalar\'s history two bars back is not a served read', () => {
    const t = translatePine([...HEAD, 'label.new(bar_index, high, "v|" + str.tostring(ya[2]))', 'plot(close)', ''].join(LF), { strict: true })
    const made = t.objects ? t.objects.ops.filter((o) => o.k === 'create' && o.family === 'label').length : 0
    expect(made).toBe(0)
  })

  it('⛔ a scalar declared in a block that runs on SOME bars: its `[1]` is the previous RUN\'s, and is never drawn off the previous bar', () => {
    const { run } = runScript(['if close > open', '    float yb = line.get_y1(a)',
      '    label.new(bar_index, high, "v|" + str.tostring(yb[1]))'])
    // nothing but an honest `NaN` may be printed: the previous BAR's value is the wrong number
    expect(labelTexts(run).filter((s) => s !== 'v|NaN')).toEqual([])
  }, 240000)

  it('⛔ the program door: a scalar\'s history is one bar back, never more, never a loop\'s', () => {
    const t = translatePine([...HEAD, 'label.new(bar_index, high, "v|" + str.tostring(ya[1]))', 'plot(close)', ''].join(LF), { strict: true })
    const swap = (edit) => JSON.parse(JSON.stringify(t.objects), (k, v) => (v && v.v === 'num' && v.back === 1 ? edit(v) : v))
    expect(JSON.stringify(t.objects)).toContain('"back":1')
    expect(() => assertObjectProgram(swap((v) => v))).not.toThrow()
    expect(() => assertObjectProgram(swap((v) => ({ ...v, back: 2 })))).toThrow(/exactly one bar back/)
  })

  it('⛔ a scalar\'s `[1]` is as KNOWN as the scalar was on the previous bar (C17), not as it is now', () => {
    const b = bars().slice(0, 12)
    const t = translatePine(['//@version=6', 'indicator("c48 prev taint", overlay = true, max_labels_count = 500)',
      'var line k = line.new(0, 7.5, 1, 7.5)', 'line.set_y1(k, close)', 'float yk = line.get_y1(k)',
      'label.new(bar_index, 5, "v|" + str.tostring(yk[1]))', 'plot(close)', ''].join(LF), { strict: true })
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    const reader = objectReaderFor({ objects: t.objects }, b, { tf: 'D', newestBarIsForming: false })
    // every value read is unknown on bars 0-2 (the curtain)
    const run = evaluateObjects(reader.program, {
      barCount: b.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: (n, bar) => bar < 3,
    })
    // bar 0 has no previous bar: `na`, known. Bars 1-2 read an unknown bar. Bar 3:
    // `yk` is known again, but `yk[1]` is bar 2's — unknown — so that label is held too.
    const made = run.live.filter((o) => o.family === 'label')
    expect(made.map((o) => o.createdBar)).toEqual([0, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(made[0].props.text).toBe('v|NaN')
    // CONTROL — with no curtain every bar draws
    const open = evaluateObjects(reader.program, { barCount: b.length, readNode: reader.readNode, readTime: reader.readTime })
    expect(open.live.filter((o) => o.family === 'label')).toHaveLength(12)
  })

  it('⭐ a scalar declared INSIDE the last-bar block has the block\'s history: its `[1]` is NaN (as G02, and A12 of `vw-call-site-history`)', () => {
    const { run } = runScript(['if barstate.islast', '    float yb = line.get_y1(b)', '    label.new(bar_index, high, "v|" + str.tostring(yb[1]))'])
    expect(labelTexts(run)).toEqual(['v|NaN'])
  }, 240000)
})
