// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c18MaxPain.test.js
//
// ─── C18 — MAX-PAIN'S LAST-BAR PROGRAM, AGAINST TRADINGVIEW ─────────────────────
//
// Captured on a live TradingView chart 2026-09-28 (NYSE:RDDT 1D, 632 bars from the
// listing day). Everything the script draws is computed on the last bar by
// imperative helpers — `generate_strikes` fills a global array in a `while`,
// `populate_strike_data` fills three more, `calculate_max_pain_direct` scans them in
// two nested `while`s — and the columnar lane refused every value that reads them
// (`pine:block`, `pine:collection`, and below the loops `pine:reassign` /
// `pine:undefined`). C18 reads those values from the runtime lane AT THE DRAWING'S
// OWN STATEMENT (`objectProgram.js::RUNTIME_AT_CALL`).
//
// ⭐ WHAT IS PINNED: every object we draw is TradingView's — the table and all
// sixteen cells (text, colour, background), the max-pain line and the gamma zero
// line (y, colour, width, style), and the three captions (y, text, colour, style,
// size) — in TradingView's creation order, x in the same order as the capture's
// dense ranks. And what we do NOT draw is named: the drawings inside `while` loops
// (strike levels, gamma bars and their labels, heatmap boxes, legend labels) are
// still refused by the reader, the pin-zone box is dropped whole because its
// background (`color.new(red, input)`) cannot be read (`runtime:prop`), and the
// NET label because its text reads a string only the runtime lane holds.
//
// ⛔ ON A SERIES THAT DOES NOT START AT THE LISTING the runtime values are
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
const TV_LINE = { sol: undefined, dsh: 'dashed', dot: 'dotted' }

describe("⭐ C18 — max-pain draws TradingView's table, lines and captions", () => {
  afterEach(() => { vi.unstubAllEnvs() })

  const runMaxPain = (historyFromListing) => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const loaded = loadCapture(FILE)
    expect(loaded.capture, loaded.reason).toBeTruthy()
    const cap = loaded.capture
    const bars = toProductBars(cap)
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c18_maxpain', name: 'mp' })
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

  it('from the listing: the runtime values are SERVED, and every object drawn is TradingView\'s', () => {
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

    // ── the lines: the max-pain line and the gamma zero line, nothing else ──────
    const vlines = cap.objects.records.lines
    const oLines = live.filter((o) => o.family === 'line')
    const wantLines = [vlines[0], vlines[vlines.length - 1]]
    expect(oLines.map((l) => [l.props.y1, l.props.y2, ours(l.props.color), l.props.width, l.props.style]))
      .toEqual(wantLines.map((l) => [l.y1, l.y2, tvHex(l.ci), l.w, TV_LINE[l.st]]))

    // ── the captions: GAMMA EXPOSURE, MAX PAIN ZONE, PAIN HEATMAP ──────────────
    const vlabels = cap.objects.records.labels
    const oLabels = live.filter((o) => o.family === 'label')
    const want = ['GAMMA\nEXPOSURE', 'MAX PAIN\nZONE', 'PAIN\nHEATMAP'].map((t) => vlabels.find((l) => l.t === t))
    expect(oLabels.map((l) => [l.props.text, l.props.y, ours(l.props.color), ours(l.props.textcolor), l.props.style, l.props.size]))
      .toEqual(want.map((l) => [l.t, l.y, tvHex(l.ci), tvHex(l.tci), TV_STYLE[l.st], l.sz]))

    // ── TradingView's creation order, and x in the capture's order ─────────────
    const drawn = live.filter((o) => o.family !== 'table')
    const vById = [...vlines, ...vlabels]
    const order = drawn.map((o) => {
      if (o.family === 'line') return o.props.y1 === 140 ? vlines[0].id : vlines[vlines.length - 1].id
      return vById.find((v) => v.t === o.props.text).id
    })
    expect(order).toEqual([...order].sort((a, b) => a - b))
    const ourX = drawn.flatMap((o) => (o.family === 'line' ? [o.props.x1, o.props.x2] : [o.props.x]))
    const tvX = drawn.flatMap((o) => {
      if (o.family === 'line') {
        const v = o.props.y1 === 140 ? vlines[0] : vlines[vlines.length - 1]
        return [v.x1, v.x2]
      }
      return [vlabels.find((v) => v.t === o.props.text).x]
    })
    for (let i = 0; i < ourX.length; i += 1) {
      for (let j = 0; j < ourX.length; j += 1) {
        expect(Math.sign(ourX[i] - ourX[j]), `x order ${i} vs ${j}`).toBe(Math.sign(tvX[i] - tvX[j]))
      }
    }

    // ── and nothing drawn that TradingView lacks ────────────────────────────────
    expect(live.filter((o) => o.family === 'box')).toEqual([])
  })

  it('names what it does not draw, and why', () => {
    const { d } = runMaxPain(true)
    const diag = d.translation.objectDiagnostics
    // the drawings inside `while` loops are the reader's refusal, unchanged
    expect(diag.loopBlockedCalls).toEqual(['box.new', 'label.new', 'line.new'])
    // the pin-zone box: its values are the runtime lane's, its bgcolor unreadable
    expect(diag.dropReasons['runtime:prop']).toBe(1)
    expect(diag.droppedPropNames).toContain('box.bgcolor@242')
  })

  it('⛔ behind the listing (a series that does not start there), every runtime value is WITHHELD', () => {
    const { reader, live, state } = runMaxPain(false)
    expect(reader.runtime).toEqual({ served: false, reason: 'runtime:not-from-listing' })
    // what the columnar lane computes by itself stays: the table and its static cells
    expect(live.filter((o) => o.family === 'line' || o.family === 'label')).toEqual([])
    const texts = state.tables.flatMap((t) => t.cells).map((c) => c.text)
    expect(texts).not.toContain('140')
    expect(texts).not.toContain('-2.15%')
    expect(texts).toContain('143.08')
  })
})
