// app/src/components/chart/builder/plotshapeEndToEnd.test.js
//
// ─── C3A.4/.9: `plotshape` FROM PINE TEXT TO A DRAWN GLYPH ──────────────────
//
// ⛔⛔ THE WIRE, NOT THE COMPONENTS. Every stage of this already had its own
// test before this file existed — the translator's, the schema's, the marker
// arithmetic's — and all three were green while `plotshape` drew nothing,
// because nothing carried the glyph BETWEEN them. That is the exact shape the
// 2026-08-08 audit named: "8 features built, tested, green, and connected to
// nothing". So this file mocks nothing on the path under test.
//
// The chain: Pine text → `translatePine` presentation → `buildDefinition` →
// `validateDefinition` (the real save gate) → `markersFor` (the real renderer
// input). If any link drops the marker, this goes red.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../engine/ast/pine'
import { memberInputTranslation } from './builderInputs'
import { buildDefinition } from './BuilderSheet.jsx'
import { evaluateFormula } from './FormulaField.jsx'
import { BUILDER_INPUT_SCOPE, BUILDER_INPUTS } from './builderInputs.js'
import { validateDefinition } from '../engine/defSchema'
import { markersFor } from '../engine/markerPrimitive'
import { interpret } from '../engine/ast/interpret'
import { DEFAULT_BUDGET } from '../engine/ast/budget'

const SCRIPT = `//@version=5
indicator("Marks", overlay = true)
up = ta.crossover(close, ta.sma(close, 5))
dn = ta.crossunder(close, ta.sma(close, 5))
plot(ta.sma(close, 5), title = "MA", color = color.blue)
plotshape(up, title = "Buy", style = shape.triangleup, location = location.belowbar, color = color.green, text = "BUY", size = size.small)
plotshape(dn, title = "Sell", style = shape.triangledown, location = location.abovebar, color = color.red, text = "SELL")
`

const bars = (n) => Array.from({ length: n }, (_, i) => ({
  t: 1500000000 + i * 86400,
  o: 100, h: 106, l: 94,
  c: 100 + Math.sin(i / 3) * 9,
  v: 1_000_000,
}))

/** The document the sheet would save for this paste. */
function documentFor(src) {
  const t = memberInputTranslation(translatePine, src, { paramManifest: true })
  const outs = (t.outputs || []).filter((o) => o && o.ast && o.formula && !o.hidden)
  const rows = outs.map((o, i) => {
    const ev = evaluateFormula(o.formula, BUILDER_INPUT_SCOPE)
    const op = o.presentation || {}
    return {
      key: i === 0 ? 'value' : `out${i + 1}`,
      label: o.title || '',
      source: o.formula,
      ast: o.ast,
      mode: ev.verdict ? ev.verdict.mode : 'clean',
      readback: ev.readback || '',
      style: typeof op.style === 'string' ? op.style : 'line',
      color: typeof op.color === 'string' ? op.color : BUILDER_INPUTS[0].default,
      width: BUILDER_INPUTS[1].default,
      hidden: false,
      ...(op.marker && op.marker.shape ? { marker: op.marker } : {}),
    }
  })
  return {
    doc: buildDefinition({
      defId: 'u_mark00000000',
      name: 'Marks',
      source: rows[0].source,
      ast: rows[0].ast,
      mode: rows[0].mode,
      readback: rows[0].readback,
      plots: rows,
      placement: { target: 'price' },
    }),
    rows,
    outs,
  }
}

describe('C3A.4 — the translator claims the glyph', () => {
  it('shape, position, text and size all reach the presentation', () => {
    const { outs } = documentFor(SCRIPT)
    const buy = outs.find((o) => o.title === 'Buy')
    const sell = outs.find((o) => o.title === 'Sell')
    expect(buy.presentation.marker).toMatchObject({
      shape: 'arrowUp', position: 'belowBar', text: 'BUY', size: 0.8,
      pineShape: 'shape.triangleup', shapeApprox: true,
    })
    expect(sell.presentation.marker).toMatchObject({
      shape: 'arrowDown', position: 'aboveBar', text: 'SELL',
    })
    // ⭐ AND THE ROW IS BORN A MARKER ROW. Without this the sheet would draw a
    // LINE through a 0/1 column — which is what shipped before this wave.
    expect(buy.presentation.style).toBe('markers')
  })

  it('⚰️ the shape is no longer filed as an unsupported PLOT style', () => {
    // Pre-C3A `style = shape.triangleup` missed the `plot.style_*` lookup and was
    // recorded as `styleUncarried: 'shape.triangleup'` — the author's glyph
    // reported as an unsupported plot style, which is a true sentence about the
    // wrong thing.
    const { outs } = documentFor(SCRIPT)
    for (const o of outs) expect(o.presentation.styleUncarried).toBeUndefined()
  })

  it('⛔ AN APPROXIMATION IS RECORDED, NOT HIDDEN', () => {
    // LWC draws four shapes; Pine names twelve. A triangle drawn as an arrow at
    // the right bar is the author's signal — a triangle silently called a
    // triangle is a claim the chart does not honour.
    const { outs } = documentFor(SCRIPT)
    expect(outs.find((o) => o.title === 'Buy').presentation.marker.shapeApprox).toBe(true)
    const circle = documentFor(SCRIPT.replace('shape.triangleup', 'shape.circle'))
    expect(circle.outs.find((o) => o.title === 'Buy').presentation.marker.shapeApprox)
      .toBeUndefined()
  })
})

describe('C3A.9 — the document carries it, and the save gate accepts it', () => {
  it('validateDefinition — the REAL gate — passes the marker through', () => {
    const { doc } = documentFor(SCRIPT)
    const marked = doc.plots.filter((p) => p.marker)
    expect(marked).toHaveLength(2)
    for (const p of marked) expect(p.style).toBe('markers')
    const v = validateDefinition(doc)
    expect(v.ok, JSON.stringify(v.errors)).toBe(true)
    expect(v.def.plots.filter((p) => p.marker)).toHaveLength(2)
  })

  it('⛔ THE CONTROL: the gate REFUSES a marker on a line plot', () => {
    const { doc } = documentFor(SCRIPT)
    const bad = JSON.parse(JSON.stringify(doc))
    const i = bad.plots.findIndex((p) => p.marker)
    bad.plots[i].style = 'line'
    const v = validateDefinition(bad)
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/marker: only a plot with style "markers"/)
  })

  it('⛔ THE CONTROL: the gate REFUSES a shape the renderer cannot draw', () => {
    const { doc } = documentFor(SCRIPT)
    const bad = JSON.parse(JSON.stringify(doc))
    bad.plots[bad.plots.findIndex((p) => p.marker)].marker.shape = 'triangleUp'
    const v = validateDefinition(bad)
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/marker\.shape/)
  })

  it('a save/reopen round trip keeps the glyph', () => {
    const { doc } = documentFor(SCRIPT)
    const back = JSON.parse(JSON.stringify(doc))
    expect(back.plots.filter((p) => p.marker)).toHaveLength(2)
    expect(back.plots.find((p) => p.marker).marker.shape).toBe('arrowUp')
  })
})

describe('C3A.4 — and glyphs actually land on the right bars', () => {
  it('the column the translator emitted marks the crossover bars', () => {
    const { doc, rows } = documentFor(SCRIPT)
    const B = bars(120)
    const buyRow = rows.find((r) => r.label === 'Buy')
    const column = interpret(buyRow.ast, B, {}, DEFAULT_BUDGET)
    const plot = doc.plots.find((p) => p.key === buyRow.key)
    const out = markersFor({
      column,
      times: B.map((b) => b.t),
      marker: plot.marker,
      color: plot.color,
    })
    // ⛔ NOT "SOME MARKERS APPEARED". A crossover of a 5-bar mean by a sine
    // close happens repeatedly but nowhere near every bar, so both bounds are
    // real: all-bars and no-bars are the two silent failures.
    expect(out.length).toBeGreaterThan(2)
    expect(out.length).toBeLessThan(B.length / 3)
    for (const m of out) {
      expect(m.shape).toBe('arrowUp')
      expect(m.position).toBe('belowBar')
      expect(m.text).toBe('BUY')
    }
    // …and every marked bar really is a bar where the column said 1.
    const marked = new Set(out.map((m) => m.time))
    B.forEach((b, i) => {
      if (marked.has(b.t)) expect(column[i]).toBe(1)
    })
  })
})

describe('C3A.5 — plotchar rides the SAME model, and plotarrow is not built', () => {
  it('`char=` becomes the marker text, through one code path', () => {
    // ⛔ NOT A SECOND RENDERING SYSTEM. `plotchar` differs from `plotshape` in
    // one respect a reader cares about — the glyph is a CHARACTER the author
    // typed — so it is the same marker with `text` from `char=`.
    const { outs } = documentFor(`//@version=5
indicator("C", overlay = true)
plotchar(close > open, title = "Up", char = "U", location = location.abovebar, color = color.green)
`)
    const m = outs.find((o) => o.title === 'Up').presentation.marker
    expect(m.text).toBe('U')
    expect(m.position).toBe('aboveBar')
    expect(m.shape).toBe('circle')
  })

  it('a `plotchar` with no char keeps Pine’s own default rather than going blank', () => {
    const { outs } = documentFor(`//@version=5
indicator("C", overlay = true)
plotchar(close > open, title = "Up")
`)
    expect(outs.find((o) => o.title === 'Up').presentation.marker.text).toBe('★')
  })

  it('⛔ `plotarrow` IS DELIBERATELY NOT A MARKER — zero scripts ask for it', () => {
    // C3A.1 census, frozen 60: `plotshape` 18/60, `plotchar` 2/60,
    // `plotarrow` **0/60**. Building a renderer for it would be building for
    // nobody, and its existing behaviour (the author's own numeric series,
    // screenable, sign-carrying) is not improved by drawing a glyph on it.
    // ⭐ THIS TEST IS THE RECORD OF THAT DECISION. If a future corpus does ask
    // for it, this goes red and the decision gets re-made rather than inherited.
    const { outs } = documentFor(`//@version=5
indicator("A", overlay = true)
plotarrow(close - open, title = "Arr")
`)
    const row = outs.find((o) => o.title === 'Arr')
    expect(row).toBeTruthy()
    expect(row.presentation.marker).toBeUndefined()
    expect(row.presentation.style).not.toBe('markers')
  })
})
