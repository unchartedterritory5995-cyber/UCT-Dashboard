// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c20MaxPain.test.js
//
// ─── C18 + C20 — MAX-PAIN, AGAINST TRADINGVIEW, VALUE FOR VALUE ─────────────────
//
// Captured on a live TradingView chart 2026-09-28 (NYSE:RDDT 1D, 632 bars from the
// listing day). Everything the script draws is computed on the last bar by
// imperative helpers — `generate_strikes` fills a global array in a `while`,
// `populate_strike_data` fills three more, `calculate_max_pain_direct` scans them in
// two nested `while`s — and most of what it draws is made INSIDE `while` loops.
//
// C18 read the last bar's NUMBERS from one run of the script, at each drawing's own
// statement (`objectProgram.js::RUNTIME_AT_CALL`). C20 reads, off the same run:
//   · the drawings the loops MAKE — the strike levels, the gamma bars and their
//     labels — pass by pass, in Pine's creation order;
//   · the NET label's word ("SHORT", a string only the run holds) beside a number
//     the object runtime formats (`#.#`);
//   · the colours the run computes: `color.new(red, <input>)` (the pin zone),
//     `color.new(base, <computed alpha>)` (the gamma bars), a colour chosen by the
//     run (the NET label) — each with TradingView's alpha formula.
//
// ⭐ WHAT IS PINNED: EVERY object we draw equals the capture — lines (y1, y2,
// colour, width, style), labels (y, text, colour, text colour, style, size), the
// pin box (top, bottom, background, border), the table and its sixteen cells —
// in TradingView's creation order (our ids sort as TradingView's), x in the order
// of the capture's dense ranks. And what we do NOT draw is named: the twelve
// heatmap boxes and two legend labels, whose colours are `color.from_gradient` —
// an interpolation no capture has measured — are WITHHELD at run time (the two
// probe runs disagree), never painted a guess.
//
// ⛔ ON A SERIES THAT DOES NOT START AT THE LISTING every runtime value is
// WITHHELD (ruling R-W): the run would start where the fetch did, and a `var`
// array filled on bar 0 there is not Pine's.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { toRenderState } from '../../objectRenderState'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/options-max-pain-calculator-backquant-rddt-1d-2026-09-28.json')

/** TradingView's colour integer is 0xAABBGGRR; ours is `#RRGGBB[AA]`. */
const tvHex = (n) => {
  const v = Number(n) >>> 0
  const r = v & 0xff
  const g = (v >>> 8) & 0xff
  const b = (v >>> 16) & 0xff
  const a = (v >>> 24) & 0xff
  const h = (x) => x.toString(16).padStart(2, '0').toUpperCase()
  return `#${h(r)}${h(g)}${h(b)}${a === 0xff ? '' : h(a)}`
}
const ours = (c) => (c ? String(c).toUpperCase() : null)
const TV_STYLE = { lcn: 'label_center', llf: 'label_left', lrg: 'label_right' }
const TV_LINE = { sol: 'solid', dsh: 'dashed', dot: 'dotted' }
const lineStyle = (s) => s || 'solid'

describe("⭐ C18 + C20 — max-pain draws TradingView's objects, value for value", () => {
  afterEach(() => { vi.unstubAllEnvs() })

  const runMaxPain = (historyFromListing) => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const loaded = loadCapture(FILE)
    expect(loaded.capture, loaded.reason).toBeTruthy()
    const cap = loaded.capture
    const bars = toProductBars(cap)
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c20_maxpain', name: 'mp' })
    expect(d.ok, d.reason).toBe(true)
    const reader = objectReaderFor(d.definition, bars, {
      tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
      historyFromListing,
    })
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })
    const state = toRenderState(run.live, { bars, tf: 'D' })
    const live = [...run.live].sort((a, b) => a.id - b.id)
    return { cap, d, reader, run, state, live }
  }

  /** Each drawn object → the capture record it is, by value (never by id). */
  const pair = (cap, live) => {
    const R = cap.objects.records
    const used = new Set()
    return live.filter((o) => o.family !== 'table').map((o) => {
      const pool = o.family === 'line' ? R.lines : o.family === 'label' ? R.labels : R.boxes
      const hit = pool.find((v) => !used.has(v.id) && (
        o.family === 'line' ? v.y1 === o.props.y1 && v.y2 === o.props.y2 && v.w === o.props.width
          : o.family === 'label' ? v.t === o.props.text && v.y === o.props.y
            : v.y1 === o.props.top && v.y2 === o.props.bottom))
      expect(hit, `${o.family} #${o.id} ${JSON.stringify(o.props)} is one TradingView drew`).toBeTruthy()
      used.add(hit.id)
      return [o, hit]
    })
  }

  it('from the listing: every object drawn is TradingView\'s, value for value, in its creation order', () => {
    const { cap, d, reader, live, state } = runMaxPain(true)
    expect(d.definition.objects.runtime, 'the program reads from the runtime lane').toBeTruthy()
    expect(reader.runtime).toEqual({ served: true, reason: null })

    // ── the table and its sixteen cells ───────────────────────────────────────
    const vt = cap.objects.records.tables[0]
    const table = live.find((o) => o.family === 'table')
    expect([table.props.position, table.props.columns, table.props.rows]).toEqual([vt.pos, vt.cols, vt.rows])
    expect(ours(table.props.bgcolor)).toBe(tvHex(vt.bgc))
    expect(ours(table.props.border_color)).toBe(tvHex(vt.brdc))
    const cells = state.tables.flatMap((t) => t.cells)
    const vcells = cap.objects.records.tableCells
    expect(cells.length).toBe(vcells.length)
    for (const vc of vcells) {
      const c = cells.find((x) => x.col === vc.col && x.row === vc.row)
      expect(c, `cell (${vc.col},${vc.row})`).toBeTruthy()
      expect(c.text).toBe(vc.t)
      expect(ours(c.text_color)).toBe(tvHex(vc.tc))
      expect(c.bgcolor ? ours(c.bgcolor) : null).toBe(vc.bgc === null ? null : tvHex(vc.bgc))
    }

    const pairs = pair(cap, live)
    // ── EVERY line TradingView drew, and each at TradingView's values ──────────
    const lines = pairs.filter(([o]) => o.family === 'line')
    expect(lines.length).toBe(cap.objects.records.lines.length)
    for (const [o, v] of lines) {
      expect([o.props.y1, o.props.y2, ours(o.props.color), o.props.width, lineStyle(o.props.style)])
        .toEqual([v.y1, v.y2, tvHex(v.ci), v.w, TV_LINE[v.st]])
    }
    // ── the labels — since C29 the two gradient legend labels too ─────────────────────
    const labels = pairs.filter(([o]) => o.family === 'label')
    for (const [o, v] of labels) {
      expect([o.props.text, o.props.y, ours(o.props.color), ours(o.props.textcolor), o.props.style, o.props.size])
        .toEqual([v.t, v.y, tvHex(v.ci), tvHex(v.tci), TV_STYLE[v.st], v.sz])
    }
    expect(labels.map(([, v]) => v.t).sort()).toEqual(['140', '145', 'GAMMA\nEXPOSURE', 'HIGH\nPAIN', 'LOW\nPAIN',
      'MAX PAIN\nZONE', 'NET: SHORT\n98314.6', 'PAIN\nHEATMAP'])
    // ── the pin zone box and (C29) the twelve gradient heatmap boxes ─────────────
    const boxes = pairs.filter(([o]) => o.family === 'box')
    expect(boxes.length).toBe(cap.objects.records.boxes.length)
    for (const [o, v] of boxes) {
      expect([o.props.top, o.props.bottom, ours(o.props.bgcolor), ours(o.props.border_color)])
        .toEqual([v.y1, v.y2, tvHex(v.bc), tvHex(v.c)])
    }

    // ── TradingView's creation order: our ids sort exactly as its ids do ────────
    const tvIds = pairs.map(([, v]) => v.id)
    expect(tvIds).toEqual([...tvIds].sort((a, b) => a - b))
    // ── x in the order of the capture's dense ranks ────────────────────────────
    const xs = (o, v) => {
      if (o.family === 'line') return [[o.props.x1, v.x1], [o.props.x2, v.x2]]
      if (o.family === 'label') return [[o.props.x, v.x]]
      return [[o.props.left, v.x1], [o.props.right, v.x2]]
    }
    const allX = pairs.flatMap(([o, v]) => xs(o, v))
    for (let i = 0; i < allX.length; i += 1) {
      for (let j = 0; j < allX.length; j += 1) {
        expect(Math.sign(allX[i][0] - allX[j][0]), `x order ${i} vs ${j}`).toBe(Math.sign(allX[i][1] - allX[j][1]))
      }
    }
  })

  // ⚰️ C20 WITHHELD the twelve heatmap boxes and two legend labels here: their
  // colours are `color.from_gradient`, whose curve was then unmeasured. C29 serves
  // it (the vendor's curve, `vw-gradient-spy-1d-2026-09-30`), so nothing is withheld.
  it('C29 — nothing is withheld: every box and label TradingView drew is drawn', () => {
    const { cap, d, run, live } = runMaxPain(true)
    const diag = d.translation.objectDiagnostics
    expect(diag.loopBlockedCalls).toEqual([])
    expect(diag.dropReasons['runtime:prop']).toBeUndefined()
    const R = cap.objects.records
    expect(live.filter((o) => o.family === 'box').length).toBe(R.boxes.length)
    expect(live.filter((o) => o.family === 'label').length).toBe(R.labels.length)
    expect(run.stats.withheldUnknown || 0).toBe(0)
  })

  it('⛔ behind the listing (a series that does not start there), every runtime value is WITHHELD', () => {
    const { reader, live, state } = runMaxPain(false)
    expect(reader.runtime).toEqual({ served: false, reason: 'runtime:not-from-listing' })
    // what the columnar lane computes by itself stays: the table and its static cells
    expect(live.filter((o) => o.family !== 'table')).toEqual([])
    const texts = state.tables.flatMap((t) => t.cells).map((c) => c.text)
    expect(texts).not.toContain('140')
    expect(texts).not.toContain('-2.15%')
    expect(texts).toContain('143.08')
  })
})
