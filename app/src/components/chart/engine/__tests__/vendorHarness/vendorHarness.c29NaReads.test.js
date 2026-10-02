// ─── ⭐⭐ C29 — `na` in a comparison (C14) and in a history offset (C9) ──────────
//
// Read off the NEW captures, never a typed copy of their numbers:
//
//   vw-ne-na-spy-1d-2026-09-30     every comparison with an `na` operand is FALSE,
//                                  `!=` included; `not (x == close)` is TRUE.
//   vw-offset-na-spy-1d-2026-09-30 `close[na]` reads the CURRENT bar's close.
//   vw-mbb-auto-spy-1d-2026-09-30  with no `max_bars_back`, dynamic offsets up to
//                                  399 run and read the vendor's own bars.
//
// ⚠️ The probes key their `na` pattern on `bar_index`, and the capture's window
// starts at the vendor's bar B0 (its own `*00_bar_index_CONTROL` column, 8175)
// while a 300-bar window counts from 0.
// ⭐⭐ C45 RE-PIN. These scripts used to read `(bar_index + B0)`, B0 typed in from
// the capture, on the 300 bars alone. C45 withholds a value that depends on the
// absolute index wherever the series does not start at the listing — which is
// what a 300-bar SPY window is — so each rule is now measured on the series
// TradingView actually ran: the vendor's own earlier bars joined in front
// (`c38Joined.js`; the join proves itself against the control column), the script
// reading plain `bar_index`, nothing typed in. What the 300 bars alone give is
// asserted beside each: withheld, by name.
// A plot constant over the series is read `+ close * 0` so the member door
// carries it (it hides a constant row by design).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runOurSide, enterMemberDoor, toProductBars, HARNESS_DEF_ID } from './ourSide'
import * as registry from '../../nativeRegistry'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { foldScalar } from '../../ast/bind'
import { AUTO_MAX_BARS_BACK } from '../../ast/objectProgram'
import { parent, joinedFromListing, SPY_FROM_LISTING } from './c38Joined'

const H = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const load = (n) => JSON.parse(fs.readFileSync(path.join(H, n), 'utf8'))

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

function vendorColumns(cap) {
  const titleOf = new Map(cap.study.plots.map((p) => [p.id, p.title]))
  const out = new Map()
  cap.plotValues.fields.forEach((f, i) => {
    if (f !== 'time') out.set(titleOf.get(f), cap.plotValues.rows.map((r) => r[i]))
  })
  return out
}
const b0Of = (cap) => vendorColumns(cap).get(cap.study.plots[0].title)[0]

/** A probe capture on the series TradingView ran it on (the listing on). */
const fromListing = (id, control, source) => joinedFromListing(parent(id), { control, id: 'c29', ...(source ? { source } : {}) })

/** The live labels' y per bar, of a script run on a capture's bars. The capture
 *  says whether its bars start at the listing (`history.startsAtBar0`), as the
 *  harness's own door does. */
function labelYs(cap, source) {
  const door = enterMemberDoor(source)
  try {
    expect(door.def, door.refusal || '').toBeTruthy()
    const bars = toProductBars(cap)
    const reader = objectReaderFor(door.def, bars, { inputs: undefined, tf: 'D', newestBarIsForming: false,
      historyFromListing: !!(cap.history && cap.history.startsAtBar0 === true) })
    expect(reader).toBeTruthy()
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })
    const byBar = new Map()
    for (const o of run.live || []) if (o.family === 'label') byBar.set(o.props.x, o.props.y)
    return { byBar, run, bars, program: reader.program }
  } finally { registry.uninstallUserDefinition(HARNESS_DEF_ID) }
}

describe('C29 rule 6 — a comparison with an `na` operand is false, `!=` included', () => {
  /** the probe's own source; only the constant rows are carried (`+ close * 0`) */
  const carried = (text) => text.split('\n')
    .map((l) => l.replace(/^plot\((.*?),(\s*)("Q\d+_[A-Za-z_]+")\)$/, (m, e, sp, t) => (
      t.startsWith('"Q00') ? m : `plot((${e.trim()}) + close * 0,${sp}${t})`))).join('\n')

  it('vw-ne-na: every Q row equals the vendor on all 300 bars', () => {
    const cap = load('vw-ne-na-spy-1d-2026-09-30.json')
    // on the series TradingView ran: `bar_index` is the vendor's, the source its own
    const ours = runOurSide(fromListing('vw-ne-na-spy-1d-2026-09-30', 'Q00_bar_index_CONTROL', carried))
    expect(ours.ok, ours.refusal).toBe(true)
    const vend = vendorColumns(cap)
    let compared = 0
    for (const p of ours.plots) {
      expect(p.column, `${p.title}: ${p.missingReason}`).toBeTruthy()
      const v = vend.get(p.title)
      const col = Array.from(p.column).slice(-300)
      for (let i = 0; i < v.length; i++) { expect(col[i], `${p.title} bar ${i}`).toBe(v[i]); compared++ }
    }
    // twelve rows now: the `bar_index` control is the vendor's too (it was skipped)
    expect(compared).toBe(12 * 300)
    // non-vacuity: the capture really has both na and non-na bars, and `!=` false on the na ones
    const naBars = vend.get('Q01_x_is_na').filter((v) => v === 1).length
    expect(naBars).toBe(150)
    expect(vend.get('Q02_x_ne_close').every((v) => v === 0)).toBe(true)
    expect(vend.get('Q09_not_x_eq_close').filter((v, i) => vend.get('Q01_x_is_na')[i] === 1).every((v) => v === 1)).toBe(true)
  })

  it('⭐ C45 — on the capture\'s own 300 bars (not from the listing) every row keyed on `bar_index % 2` is WITHHELD by name', () => {
    const cap = load('vw-ne-na-spy-1d-2026-09-30.json')
    expect(cap.history.startsAtBar0).toBe(false)
    // ⚰️ what was served there: the window counts from 0 and the vendor from 8175,
    // an ODD number, so `bar_index % 2 == 0` was the vendor's pattern inverted
    expect(b0Of(cap) % 2).toBe(1)
    const ours = runOurSide({ ...cap, source: { ...cap.source, text: carried(cap.source.text) } })
    expect(ours.ok, ours.refusal).toBe(true)
    const served = ours.plots.filter((p) => p.column).map((p) => p.title)
    // the two rows that read a `var` left `na` and never touch the index
    expect(served).toEqual(['Q10_na_var_ne_close', 'Q11_na_var_eq_close'])
    for (const p of ours.plots.filter((q) => !q.column)) {
      expect(p.missingReason, p.title).toMatch(/withheld on this chart on every bar, by name \(bar-index:window\)/)
    }
    expect(ours.notes.some((n) => /`bar_index` withheld \(bar-index:window\) on 10 plot\(s\)/.test(n))).toBe(true)
  })

  it('the bind fold agrees: `na != 1` folds to 0, not JavaScript\'s 1', () => {
    const na = { type: 'op', name: '/', args: [{ type: 'num', value: 0 }, { type: 'num', value: 0 }] }
    expect(foldScalar({ type: 'op', name: '!=', args: [na, { type: 'num', value: 1 }] }, {})).toBe(0)
    expect(foldScalar({ type: 'op', name: '==', args: [na, { type: 'num', value: 1 }] }, {})).toBe(0)
    expect(foldScalar({ type: 'op', name: '!=', args: [{ type: 'num', value: 2 }, { type: 'num', value: 1 }] }, {})).toBe(1)
  })
})

describe('C29 rule 7 — `x[na]` is `x`; no `max_bars_back` reaches the measured 399', () => {
  it('vw-offset-na: `close[e]` with `e` na on a third of the bars is the vendor\'s E02 on every bar', () => {
    const cap = load('vw-offset-na-spy-1d-2026-09-30.json')
    const B0 = b0Of(cap)
    const vend = vendorColumns(cap)
    const src = [
      '//@version=6',
      'indicator("c29 offset na", overlay = true, max_bars_back = 500, max_labels_count = 500)',
      'int e = bar_index % 3 == 0 ? na : 1',
      'label.new(bar_index, close[e])',
    ].join('\n')
    // on the series TradingView ran: the label on its bar B0 + i carries E02[i]
    const { byBar } = labelYs(fromListing('vw-offset-na-spy-1d-2026-09-30', 'E00_bar_index_CONTROL'), src)
    const want = vend.get('E02_close_at_e')
    expect(vend.get('E01_e_is_na').filter((v) => v === 1).length).toBe(100)
    let compared = 0
    for (let i = 0; i < want.length; i++) { // every bar: the bar before the window is held now
      expect(byBar.get(B0 + i), `bar ${i}`).toBeCloseTo(want[i], 9)
      compared++
    }
    expect(compared).toBe(300)
  })

  it('vw-mbb-auto: no `max_bars_back`, a dynamic offset is served and reads the vendor bar it names', () => {
    const cap = load('vw-mbb-auto-spy-1d-2026-09-30.json')
    const B0 = b0Of(cap)
    // the capture: offsets up to 399, never na, never an error
    const vend = vendorColumns(cap)
    expect(Math.max(...vend.get('M01_k'))).toBe(399)
    expect(vend.get('M03_close_at_k_is_na').every((v) => v === 0)).toBe(true)
    const src = [
      '//@version=6',
      'indicator("c29 mbb auto", overlay = true, max_labels_count = 500)',
      'int k = bar_index % 7 * 40',
      'label.new(bar_index, close[k])',
    ].join('\n')
    const joined = fromListing('vw-mbb-auto-spy-1d-2026-09-30', 'M00_bar_index_CONTROL')
    const { byBar, program, bars } = labelYs(joined, src)
    const at = JSON.stringify(program)
    expect(at).toContain('"auto":true')
    let compared = 0
    for (let i = B0; i < bars.length; i++) {          // the capture's own 300 bars
      const k = (i % 7) * 40
      expect(byBar.get(i), `bar ${i}`).toBe(bars[i - k].c)
      compared++
    }
    expect(compared).toBe(300)
  })

  it('past the measured bound an undeclared read is WITHHELD, never read and never an error', () => {
    const cap = load('vw-mbb-auto-spy-1d-2026-09-30.json')
    const bars = toProductBars(cap)
    // ⭐ C45 RE-PIN: the offset is chosen by the BAR (`close > open`), not by
    // `bar_index >= 200` — a test against the absolute index, which a 300-bar
    // window answers for its own count and TradingView for 8175 more.
    const src = [
      '//@version=6',
      'indicator("c29 mbb beyond", overlay = true, max_labels_count = 500)',
      `int k = close > open ? ${AUTO_MAX_BARS_BACK} : 1`,
      'label.new(bar_index, close[k])',
    ].join('\n')
    const { byBar, run } = labelYs(cap, src)
    expect(run.error || null).toBe(null)
    const up = bars.map((b) => b.c > b.o)
    const beyond = up.filter(Boolean).length
    expect(beyond).toBeGreaterThan(100)
    for (let i = 0; i < 300; i++) {
      if (up[i]) expect(byBar.has(i), `bar ${i} drawn past the bound`).toBe(false)
      else if (i >= 1) expect(byBar.get(i), `bar ${i}`).toBe(bars[i - 1].c)
    }
    expect(run.stats.atBeyondAutoBuffer).toBe(beyond)
  })
})

describe('C45 — a history read that lands BEFORE the first bar held (C38\'s item 3: the object lane answered `na`)', () => {
  // an offset the BAR chooses (no index in it): 40 back on an up bar, 280 on a down one
  const SRC = [
    '//@version=6',
    'indicator("c45 before the first bar", overlay = true, max_labels_count = 500)',
    'int k = close > open ? 40 : 280',
    'label.new(bar_index, close[k])',
  ].join('\n')
  const kOf = (b) => (b.c > b.o ? 40 : 280)

  it('⭐ NOT from the listing: TradingView holds the earlier bar and reads a price, so the op is WITHHELD — never a label at `na`', () => {
    const cap = load('vw-mbb-auto-spy-1d-2026-09-30.json')
    expect(cap.history.startsAtBar0).toBe(false)
    // the vendor's own answer on such reads: never `na` (its M03 column, 300 of 300)
    expect(vendorColumns(cap).get('M03_close_at_k_is_na').every((v) => v === 0)).toBe(true)
    const { byBar, run, bars } = labelYs(cap, SRC)
    const before = bars.map((b, i) => i - kOf(b) < 0)
    const n = before.filter(Boolean).length
    expect(n).toBeGreaterThan(100)                       // most of a 300-bar window
    expect(n).toBeLessThan(300)
    for (let i = 0; i < bars.length; i++) {
      if (before[i]) expect(byBar.has(i), `bar ${i}: a label drawn off a bar this window does not hold`).toBe(false)
      else expect(byBar.get(i), `bar ${i}`).toBe(bars[i - kOf(bars[i])].c)
    }
    expect(run.stats.withheldUnknown).toBe(n)
  })

  it('from the listing there IS no earlier bar: the read is Pine\'s `na`, and the label is held at `na` as before', () => {
    const hist = parent(SPY_FROM_LISTING)
    expect(hist.history.startsAtBar0).toBe(true)
    const first300 = { ...hist, bars: { ...hist.bars, count: 300, rows: hist.bars.rows.slice(0, 300) } }
    const { byBar, run, bars } = labelYs(first300, SRC)
    expect(bars.length).toBe(300)
    let na = 0
    for (let i = 0; i < bars.length; i++) {
      const k = kOf(bars[i])
      if (i - k < 0) { expect(Number.isNaN(byBar.get(i)), `bar ${i}`).toBe(true); na += 1 } else expect(byBar.get(i), `bar ${i}`).toBe(bars[i - k].c)
    }
    expect(na).toBeGreaterThan(100)
    expect(run.stats.withheldUnknown || 0).toBe(0)
  })
})
