// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c33ObjectReads.test.js
//
// ─── C33 — OBJECT-LANE READS, AGAINST TRADINGVIEW'S OWN RECORDS ───────────────
//
// Three captures (NYSE:RDDT 1D, 632 bars, 2026-09-28), one wall each:
//
//   average-day-range-adr-pivots — `array.push(arr, draw_box(…))`: a helper's
//     drawing pushed straight onto a list. Vendor holds 2 boxes, 2 lines and a
//     4-cell table; before C33 this chart drew none of the four objects.
//   high-low-open-mid-ranges — an `input.timeframe` in a label's text, a getter
//     (and its history) in a label's text and y, an `na` arm in a text colour,
//     and a block whose guard has a term nothing here reads. Vendor holds 504
//     labels; before C33 none was drawn.
//   volume-profile — `last_bar_time`, the chart's last bar.
//
// ⭐ WHAT IS PINNED IS EVERY OBJECT THIS LANE NOW DRAWS, against the vendor's own
// record of it: id (TradingView's one creation counter, where ours is the same
// sequence), TEXT, POSITION and colour. Where the capture cannot say something
// (an x on a time axis is a dense rank; a float is the vendor's own rounding
// order) the comparison says which and how.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars, enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import * as registry from '../../nativeRegistry'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { toRenderState } from '../../objectRenderState'
import { probeObjectRuntime } from '../../runtime/runtimeColumns'
import { INPUT_TIMEFRAME_TEXT_WITNESS } from '../../ast/pine'
import { decodePackedColour } from '../../../../../../../tools/vendor_harness/compare.mjs'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const capOf = (id) => {
  const loaded = loadCapture(path.join(DIR, `${id}.json`))
  if (!loaded.capture) throw new Error(`${id}: ${loaded.reason}`)
  return loaded.capture
}
const ADR = 'average-day-range-adr-pivots-rddt-1d-2026-09-28'
const OHLM = 'high-low-open-mid-ranges-rddt-1d-2026-09-28'
const VP = 'volume-profile-rddt-1d-2026-09-28'

afterEach(() => { vi.unstubAllEnvs() })

/** The member door's object run on the capture's own bars. */
function runObjects(cap, source = cap.source.text) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const bars = toProductBars(cap)
  const d = memberPaneDefinition({ source, id: 'u_c33', name: 'c33' })
  expect(d.ok, d.reason).toBe(true)
  const reader = objectReaderFor(d.definition, bars, {
    tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
    historyFromListing: true,
  })
  const run = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  return { d, run, bars, diag: d.translation.objectDiagnostics || {} }
}
const byId = (xs) => [...xs].sort((a, b) => a.id - b.id)
/** Dense rank of the distinct values, 0-based — the capture's own time-axis `x`. */
const denseRank = (xs) => {
  const order = [...new Set(xs)].sort((a, b) => a - b)
  return xs.map((x) => order.indexOf(x))
}
/** `#rrggbb` / `#rrggbbaa`, lower case, opaque spelled without its alpha. */
const hexOf = (c) => {
  const s = String(c || '').toLowerCase()
  return /^#[0-9a-f]{8}$/.test(s) && s.endsWith('ff') ? s.slice(0, 7) : s
}
/** A float equal to the vendor's to the last place either engine can hold: the
 *  two sum the same 14 highs in a different order, so the last bit may differ
 *  (measured: 152.42832142857145 here, 152.4283214285714 there — 3e-14 apart).
 *  ⛔ 1e-12 RELATIVE: twelve orders of magnitude under a cent on this chart, and
 *  far too tight for a different bar or a different formula to pass. */
const sameFloat = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))

describe('C33 — average-day-range-adr-pivots: a helper\'s drawing pushed onto a list', () => {
  it('⭐ the two boxes and two lines TradingView holds: same ids, text, prices, time order and colours', () => {
    const cap = capOf(ADR)
    const { run, diag } = runObjects(cap)
    expect(diag.dropReasons['fn:in-expression']).toBeUndefined()
    expect(diag.dropReasons['coll:diverged']).toBeUndefined()

    const vBoxes = byId(cap.objects.records.boxes)
    const oBoxes = byId(run.live.filter((o) => o.family === 'box'))
    expect(vBoxes.length).toBe(2)
    expect(oBoxes.map((b) => b.id)).toEqual(vBoxes.map((b) => b.id))
    expect(oBoxes.map((b) => b.props.text)).toEqual(vBoxes.map((b) => b.t))
    oBoxes.forEach((b, i) => {
      expect(sameFloat(b.props.top, vBoxes[i].y1), `box ${b.id} top ${b.props.top} vs ${vBoxes[i].y1}`).toBe(true)
      expect(sameFloat(b.props.bottom, vBoxes[i].y2), `box ${b.id} bottom ${b.props.bottom} vs ${vBoxes[i].y2}`).toBe(true)
      expect(hexOf(b.props.border_color)).toBe(hexOf(decodePackedColour(vBoxes[i].c)))
      expect(hexOf(b.props.bgcolor)).toBe(hexOf(decodePackedColour(vBoxes[i].bc)))
      expect(hexOf(b.props.text_color)).toBe(hexOf(decodePackedColour(vBoxes[i].tc)))
    })

    const vLines = byId(cap.objects.records.lines)
    const oLines = byId(run.live.filter((o) => o.family === 'line'))
    expect(vLines.length).toBe(2)
    expect(oLines.map((l) => l.id)).toEqual(vLines.map((l) => l.id))
    // the multiplier lines are one division of one sum — exact, bit for bit
    expect(oLines.map((l) => [l.props.y1, l.props.y2])).toEqual(vLines.map((l) => [l.y1, l.y2]))
    oLines.forEach((l, i) => expect(hexOf(l.props.color)).toBe(hexOf(decodePackedColour(vLines[i].ci))))

    // ⭐ x: the capture's time-axis x is a dense rank over what it holds; ours are
    // millisecond timestamps, and they must fall in the same order …
    const ours = [...oBoxes.flatMap((b) => [b.props.left, b.props.right]), ...oLines.flatMap((l) => [l.props.x1, l.props.x2])]
    const theirs = [...vBoxes.flatMap((b) => [b.x1, b.x2]), ...vLines.flatMap((l) => [l.x1, l.x2])]
    expect(denseRank(ours)).toEqual(theirs)
    // … and the left edge IS the chart's last bar, which the capture states.
    expect(new Set([...oBoxes.map((b) => b.props.left), ...oLines.map((l) => l.props.x1)]))
      .toEqual(new Set([cap.window.lastBarTime * 1000]))
    for (const o of [...oBoxes, ...oLines]) expect(o.props.xloc).toBe('bar_time')
  })

  it('⭐ the table: every cell this chart draws is TradingView\'s text at its address', () => {
    const cap = capOf(ADR)
    const { run, bars } = runObjects(cap)
    const vendor = new Map(cap.objects.records.tableCells.map((c) => [`${c.col}|${c.row}`, c.t]))
    const state = toRenderState(run.live, { bars, tf: 'D' })
    const cells = state.tables.flatMap((t) => t.cells)
    for (const c of cells) expect(c.text ?? '', `cell ${c.col},${c.row}`).toBe(vendor.get(`${c.col}|${c.row}`))
    // CONTROL + the cell C33 recovered: `str.tostring(w, '#.##') + ' % (' + res_to_str(tf) + ')'`
    expect(cells.find((c) => c.col === 1 && c.row === 0).text).toBe('4.6 % (D)')
    expect(cells.find((c) => c.col === 0 && c.row === 0).text).toBe('Range Width:')
  })

  // ⭐ C48 re-pin — this pinned two refusals (`'M' v6`, `'W' v6`): the weekly and
  // monthly boxes' texts were unwitnessed under v6. `vw-input-tf-text-v6` prints
  // both verbatim, so nothing is refused for them now — and the picture is the
  // one it was: TradingView deletes each of those boxes the bar it makes it.
  it('⭐ the weekly and monthly boxes (texts `(W)` / `(M)`) are read, and deleted the bar they are made', () => {
    const cap = capOf(ADR)
    const { run, diag } = runObjects(cap)
    expect(Object.keys(diag.textFormatRefusals || {})).toEqual([])
    // TradingView deletes each the bar it makes it (`showlast` 1), and so does this
    // run — so none is held, and nothing unwitnessed can reach the chart.
    expect(run.live.filter((o) => o.family === 'box').map((b) => b.props.text).filter((t) => !/\(D\)$/.test(String(t)))).toEqual([])
    expect(run.withheld || {}).toEqual({})
  })
})

describe('C33 — a fill whose transparency is an input, on a second capture', () => {
  it('⭐ institutional-smc: both zones wear TradingView\'s own fill (`color.new(c_bear_zone, zone_opacity)`)', () => {
    const cap = capOf('institutional-smc-order-flow-matrix-pro-rddt-1d-2026-09-28')
    const { run } = runObjects(cap)
    const vBoxes = byId(cap.objects.records.boxes)
    const oBoxes = byId(run.live.filter((o) => o.family === 'box'))
    expect(vBoxes.length).toBe(2)
    expect(oBoxes.map((b) => b.id)).toEqual(vBoxes.map((b) => b.id))
    expect(oBoxes.map((b) => hexOf(b.props.bgcolor))).toEqual(vBoxes.map((b) => hexOf(decodePackedColour(b.bc))))
    // CONTROL: a real, translucent colour — not the renderer's default, not opaque
    expect(new Set(oBoxes.map((b) => hexOf(b.props.bgcolor)))).toEqual(new Set(['#ff174426']))
  })
})

describe('C33 — high-low-open-mid-ranges: the 504 labels', () => {
  it('⭐ every label TradingView holds, in creation order: text, price, bar order and text colour', () => {
    const cap = capOf(OHLM)
    const { run, diag } = runObjects(cap)
    expect(diag.dropReasons['create:label']).toBeUndefined()
    expect(diag.dropReasons['state:lost']).toBeUndefined()
    const vLabels = byId(cap.objects.records.labels)
    const oLabels = byId(run.live.filter((o) => o.family === 'label'))
    expect(vLabels.length).toBe(504)
    expect(oLabels.length).toBe(504)
    // ⚠️ ids are compared up to ONE constant: TradingView's counter also numbers
    // the objects of the first partial week, which this run withholds (C30 — the
    // bars before the window are not held). Creation ORDER is the id sort.
    const idDelta = new Set(oLabels.map((l, i) => vLabels[i].id - l.id))
    expect(idDelta.size).toBe(1)
    expect(oLabels.map((l) => (l.props.text == null ? '' : String(l.props.text)))).toEqual(vLabels.map((l) => l.t))
    expect(oLabels.map((l) => (Number.isFinite(l.props.y) ? l.props.y : null))).toEqual(vLabels.map((l) => l.y))
    expect(denseRank(oLabels.map((l) => l.props.x))).toEqual(denseRank(vLabels.map((l) => l.x)))
    // text colour, through the capture's own palette; `tci: null` is `na` — no colour.
    const palette = cap.study.palettes.palette_common.colors
    const rgba = (s) => {
      const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(String(s).replace(/\s+/g, ''))
      if (!m) return hexOf(s)
      const h = (n) => Number(n).toString(16).padStart(2, '0')
      return hexOf(`#${h(m[1])}${h(m[2])}${h(m[3])}${h(Math.round(Number(m[4]) * 255))}`)
    }
    oLabels.forEach((l, i) => {
      const v = vLabels[i]
      const want = v.tci === null ? '#00000000' : rgba(palette[String(v.tci)].color)
      expect(hexOf(l.props.textcolor), `label ${i} "${v.t}"`).toBe(want)
    })
    // CONTROL: each kind of label is really in the comparison.
    const texts = oLabels.map((l) => String(l.props.text))
    expect(texts.filter((t) => /^W \| /.test(t)).length).toBe(4)        // `higherTF + b + …`
    expect(texts.filter((t) => /^LW \| .* NaN$/.test(t)).length).toBe(4) // a getter's history, empty handle
    expect(texts.filter((t) => /^Monday.*: NaN$/.test(t)).length).toBe(4) // a getter-fed local
    expect(texts.filter((t) => /^L[OMHL] \| /.test(t)).length).toBe(492)
    expect(vLabels.filter((l) => l.tci === null).length).toBe(4)
  })

  it('⭐ on wave 9 the divider\'s guard is READ (C30 `time("W")`): 503 of TradingView\'s 504 lines, beside the 504 labels', () => {
    const cap = capOf(OHLM)
    const { run, diag, d } = runObjects(cap)
    // ⚰️ Before C30 merged, `if ta.change(time(higherTF)) and i_v1` had a term
    // nobody read: the guard was carried PARTIAL (`guardPartial`
    // ['create@169: pine:function']) and the line family withheld whole. C30
    // serves `time("W")` on a daily chart, so nothing here is partial any more —
    // the partial guard's vendor witness is ict-killzones (below).
    expect(diag.guardPartial).toBeUndefined()
    expect(JSON.stringify(d.definition.objects.ops)).not.toContain('"v":"unknown"')
    expect(run.withheld).toBeUndefined()
    const vAll = byId(cap.objects.records.lines)
    const oLines = byId(run.live.filter((o) => o.family === 'line'))
    expect(vAll.length).toBe(504)
    expect(oLines.length).toBe(503)
    // the ONE line not held is TradingView's oldest (id 2151): the collector's edge
    const vLines = vAll.slice(1)
    expect(vAll[0].id).toBe(2151)
    expect(new Set(oLines.map((l, i) => vLines[i].id - l.id)).size).toBe(1)
    // position: both ends' price, and the bar order of both ends
    expect(oLines.map((l) => [l.props.y1, l.props.y2])).toEqual(vLines.map((l) => [l.y1, l.y2]))
    expect(denseRank(oLines.flatMap((l) => [l.props.x1, l.props.x2])))
      .toEqual(denseRank(vLines.flatMap((l) => [l.x1, l.x2])))
    // style: extension, dash, width, colour (through the capture's own palette)
    const palette = cap.study.palettes.palette_common.colors
    const rgba = (s) => {
      const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(String(s).replace(/\s+/g, ''))
      if (!m) return hexOf(s)
      const h = (n) => Number(n).toString(16).padStart(2, '0')
      return hexOf(`#${h(m[1])}${h(m[2])}${h(m[3])}${h(Math.round(Number(m[4]) * 255))}`)
    }
    const EX = { n: 'none', b: 'both', r: 'right', l: 'left' }
    const ST = { dot: 'dotted', dsh: 'dashed', sol: 'solid' }
    oLines.forEach((l, i) => {
      const v = vLines[i]
      expect([l.props.extend, l.props.style, l.props.width, hexOf(l.props.color)], `line ${i} (vendor id ${v.id})`)
        .toEqual([EX[v.ex], ST[v.st], v.w, rgba(palette[String(v.ci)].color)])
    })
    // CONTROL: all three kinds of line are in the comparison
    expect(vLines.filter((l) => l.ex === 'b').length).toBe(100)   // the weekly dividers
    expect(vLines.filter((l) => l.ex === 'r').length).toBe(4)
    expect(vLines.filter((l) => l.ex === 'n').length).toBe(399)
  })

  it('⛔ a getter\'s history on a LIVE handle is unmeasured: the label that reads it is held, not drawn', () => {
    const cap = capOf(OHLM)
    // "Extend Last Range" on: `hline` in `f_line2` now holds a line, so
    // `line.get_y1(hline)[1]` reads a NUMBER back — which no capture shows.
    const on = cap.source.text.replace('bool3       =   input.bool        (   false,', 'bool3       =   input.bool        (   true,')
    expect(on).not.toBe(cap.source.text)
    const { run } = runObjects(cap, on)
    const texts = run.live.filter((o) => o.family === 'label').map((l) => String(l.props.text))
    expect(texts.filter((t) => /^LW \| /.test(t))).toEqual([])
    expect(run.withheld.label).toBeGreaterThan(0)
  })
})

describe('C33 — a guard with a term nothing reads, on a capture (ict-killzones-pivots-tfo)', () => {
  it('⭐ the steps under its partial guards are carried and never drawn: the table is TradingView\'s three cells', () => {
    const cap = capOf('ict-killzones-pivots-tfo-rddt-1d-2026-09-28')
    const { run, diag, d, bars } = runObjects(cap)
    expect((diag.guardPartial || []).length).toBeGreaterThan(0)
    const ops = d.definition.objects.ops
    expect(ops.some((o) => o.k === 'latch' && JSON.stringify(o.cond).includes('"v":"unknown"'))).toBe(true)
    expect(ops.filter((o) => o.unknownGuard === true).length).toBeGreaterThan(0)
    // every family equals the capture's count …
    const live = (fam) => run.live.filter((o) => o.family === fam)
    for (const [key, fam] of [['lines', 'line'], ['labels', 'label'], ['boxes', 'box'], ['tables', 'table']]) {
      expect(live(fam).length, fam).toBe(cap.objects.counts[key])
    }
    // … and the table holds exactly the cells TradingView shows, text for text.
    const state = toRenderState(run.live, { bars, tf: 'D' })
    const cells = (state.tables || []).flatMap((t) => (t.cells || []).map((c) => String(c.text ?? '')))
    expect(cells.sort()).toEqual([...cap.objects.texts.tableCells].map(String).sort())
    expect(cap.objects.texts.tableCells.length).toBe(3)
  })
})

// ⭐⭐ C48 — THE RULE'S OWN WITNESS: `vw-input-tf-text-v5` / `-v6` (AMEX:SPY 1D,
// 2026-10-01), one label per default under each Pine version.
describe('C48 — `input.timeframe` text: every default is printed VERBATIM, under v5 and v6', () => {
  for (const [version, id] of Object.entries(INPUT_TIMEFRAME_TEXT_WITNESS)) {
    it(`⭐⭐ v${version} — ${id}: our ten labels are TradingView's, text for text`, () => {
      const cap = capOf(id)
      expect(Number((/\/\/@version=(\d+)/.exec(cap.source.text) || [])[1])).toBe(Number(version))
      // what TradingView printed: each default as written, the empty one empty
      const texts = cap.objects.records.labels.map((l) => String(l.t ?? ''))
      expect(texts).toEqual(expect.arrayContaining(['L01 D|D', 'L02 W|W', 'L03 M|M', 'L04 60|60', 'L05 240|240', 'L06 1D|1D', 'L07 empty|', 'D', 'W']))
      // …and the one thing the version changes: `timeframe.period` itself
      expect(texts).toContain(`L08 timeframe.period CONTROL|${version === '6' ? '1D' : 'D'}`)
      expect(texts).toHaveLength(10)
      // our object lane, on the probe's own source and the capture's bars
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      const bars = toProductBars(cap)
      const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c48tf', name: 'c48tf' })
      expect(d.ok, d.reason).toBe(true)
      expect((d.translation.objectDiagnostics || {}).textFormatRefusals).toBeUndefined()
      const reader = objectReaderFor(d.definition, bars, { tf: 'D', symbol: { ticker: 'SPY', exchange: 'AMEX' }, newestBarIsForming: cap.newestBarIsForming ?? null })
      const run = evaluateObjects(reader.program, {
        barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
      })
      const ours = run.live.filter((o) => o.family === 'label').map((o) => String(o.props.text ?? ''))
      expect(run.withheld || {}).toEqual({})
      expect([...ours].sort()).toEqual([...texts].sort())
    })
  }

  it('⭐ the plots agree too: `"D" == "1D"` is false both ways, and an empty default is not the chart\'s period', () => {
    for (const id of Object.values(INPUT_TIMEFRAME_TEXT_WITNESS)) {
      const cap = capOf(id)
      const col = (title) => {
        const p = cap.study.plots.find((x) => x.title === title)
        const k = cap.plotValues.fields.indexOf(p.id)
        return [...new Set(cap.plotValues.rows.map((r) => r[k]))]
      }
      expect(col('I02_D_eq_D')).toEqual([1])
      expect(col('I03_D_eq_1D')).toEqual([0])
      expect(col('I16_1D_eq_D')).toEqual([0])
      expect(col('I14_len_1D')).toEqual([2])
      expect(col('I17_len_empty')).toEqual([0])
      expect(col('I18_empty_eq_timeframe_period')).toEqual([0])
    }
  })
})

// The two corpus captures C33 served from, before the probes: still printed.
const CORPUS_TF_TEXT = Object.freeze({
  D: Object.freeze({ versions: Object.freeze([6]), capture: ADR }),
  W: Object.freeze({ versions: Object.freeze([5]), capture: OHLM }),
})
describe('C33 — `input.timeframe` text: the two corpus captures that print a default', () => {
  for (const [spelling, w] of Object.entries(CORPUS_TF_TEXT)) {
    it(`⭐ \`${spelling}\` under v${w.versions.join('/v')} — ${w.capture}`, () => {
      const cap = capOf(w.capture)
      const version = Number((/\/\/@version=(\d+)/.exec(cap.source.text) || [])[1])
      expect(w.versions).toContain(version)
      // the script declares that default …
      expect(new RegExp(`input\\.timeframe\\s*\\(\\s*(defval\\s*=\\s*)?['"]${spelling}['"]`).test(cap.source.text)).toBe(true)
      // … and TradingView's own records print it, standing alone.
      const recs = cap.objects.records
      const texts = [...recs.labels, ...recs.boxes, ...recs.tableCells].map((r) => String(r.t ?? ''))
      const printed = texts.filter((t) => new RegExp(`(^|[^A-Za-z0-9])${spelling}($|[^A-Za-z0-9])`).test(t))
      expect(printed.length).toBeGreaterThan(0)
      // ⛔ and never the v6 `timeframe.period` re-spelling (`1D`, `1W`).
      expect(texts.filter((t) => new RegExp(`(^|[^A-Za-z0-9])1${spelling}($|[^A-Za-z0-9])`).test(t))).toEqual([])
    })
  }
})

describe('C33 — `last_bar_time` is the chart\'s last bar, as each capture states it', () => {
  const SRC = ['//@version=6', 'indicator("c33 last_bar_time")', 'plot(last_bar_time)'].join('\n')
  const dailies = fs.readdirSync(DIR).filter((f) => /-rddt-1d-2026-09-2[78]\.json$/.test(f)).sort()
  it('⭐ on every bar of every RDDT 1D capture: `window.lastBarTime`, in milliseconds', () => {
    const door = enterMemberDoor(SRC)
    try {
      expect(door.def, door.refusal).toBeTruthy()
      const row = door.built.rows[0]
      let compared = 0
      for (const f of dailies) {
        const cap = capOf(f.replace(/\.json$/, ''))
        if (!cap.window || !Number.isFinite(cap.window.lastBarTime)) continue
        const bars = toProductBars(cap)
        const cols = registry.computeFor(door.def, bars, undefined, { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' } })
        const col = Array.from(cols[row.key])
        expect(new Set(col), f).toEqual(new Set([cap.window.lastBarTime * 1000]))
        compared += 1
      }
      // ⛔ non-vacuity: the three C33 captures at least, and the comparison ran.
      expect(compared).toBeGreaterThanOrEqual(3)
    } finally {
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
    }
  }, 120000)

  it('volume-profile: its next wall is the viewport, by name; its three value lines stay withheld', () => {
    const cap = capOf(VP)
    const probe = probeObjectRuntime(cap.source.text, [])
    expect(probe.ok).toBe(false)
    expect(probe.refusal.token).toBe('chart.left_visible_bar_time')
    const { run } = runObjects(cap)
    expect(run.live.filter((o) => o.family === 'line').length).toBe(200)
    expect(run.withheld).toEqual({ line: 3 })
  })
})
