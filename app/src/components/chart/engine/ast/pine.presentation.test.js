// app/src/components/chart/engine/ast/pine.presentation.test.js
//
// ─── ⭐⭐ WAVE B: THE VISUAL PROGRAM SURVIVES THE IMPORT DOOR ────────────────
//
// ⚰️ WHAT THIS FILE EXISTS TO STOP. Before this wave the string `overlay`
// appeared ZERO times in `pine.js` — 8,457 lines — and the only presentation
// argument read at all was `display`, used solely to hide an output. Everything
// a Pine author says about how their indicator LOOKS was parsed past: which
// pane, what colour, how thick, which style, which levels. The receiving plot
// row was then born `style:'line'`, default colour, default width.
//
// ⛔ THE RENDERER WAS NEVER THE LIMIT, which is the whole reason this wave is
// cheap. `defSchema` already validates eight plot styles, per-plot colour,
// width, line style, opacity, precision, legend, levels and placement, and
// `binder.js` already draws them. `plot(offset=-N)` proved the shape of the
// problem: the translator COMPUTED it into `row.displace` and nothing
// downstream ever carried it.
//
// ⭐ MEASURED DEMAND, from the 60-script blind OOS corpus: 33/60 scripts plot,
// 40/60 colour conditionally, 19/60 draw shapes, 17/60 fill, 10/60 draw levels.

import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'

const src = (body, decl = 'indicator("t")') => `//@version=5\n${decl}\n${body}\n`

describe('the declaration says which pane, and it is now read', () => {
  it('⭐⭐ overlay = true / false is carried; absent stays ABSENT', () => {
    expect(translatePine(src('plot(close)', 'indicator("t", overlay = true)'))
      .presentation.overlay).toBe(true)
    expect(translatePine(src('plot(close)', 'indicator("t", overlay = false)'))
      .presentation.overlay).toBe(false)
    // ⛔ NOT `false`. A script that says nothing must not be reported as having
    // asked for a pane — absent is a third answer, and the builder keeps its own
    // default when it sees it.
    expect(translatePine(src('plot(close)')).presentation.overlay).toBe(null)
  })

  it('⭐ a declaration argument this grammar has no node for cannot refuse the script', () => {
    // ⛔ A TOKEN SCAN, NOT A PARSE, and this is why: `max_lines_count` and
    // `format` are ordinary Pine and would have to be parsed to reach one
    // boolean. Parsing the declaration to read `overlay` would let an unrelated
    // argument refuse a whole indicator.
    const out = translatePine(src('plot(close)',
      'indicator("t", overlay = true, max_lines_count = 500, format = format.price)'))
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(out.presentation.overlay).toBe(true)
  })
})

describe('per-output styling is carried, and what is NOT carried is reported', () => {
  const pres = (call) => translatePine(src(call)).outputs[0].presentation

  it('⭐⭐ TradingView`s own colour constants, by their published hex', () => {
    // ⛔ THE VENDOR'S VALUES, NOT OUR PALETTE. An indicator that comes back a
    // different red has not been imported faithfully.
    expect(pres('plot(close, color = color.red)').color).toBe('#F23645')
    expect(pres('plot(close, color = color.green)').color).toBe('#4CAF50')
    expect(pres('plot(close, color = color.purple)').color).toBe('#9C27B0')
  })

  it('⭐ a hex literal needs no table, and color.new carries its transparency', () => {
    expect(pres('plot(close, color = #FF9800)').color).toBe('#FF9800')
    const p = pres('plot(close, color = color.new(color.blue, 40))')
    expect(p.color).toBe('#2962FF')
    expect(p.opacity).toBeCloseTo(0.6, 5)
  })

  it('⭐ width, style and transparency', () => {
    expect(pres('plot(close, linewidth = 3)').width).toBe(3)
    expect(pres('plot(close, style = plot.style_stepline)').style).toBe('stepline')
    expect(pres('plot(close, style = plot.style_histogram)').style).toBe('histogram')
    expect(pres('plot(close, style = plot.style_circles)').style).toBe('markers')
    expect(pres('plot(close, transp = 25)').opacity).toBeCloseTo(0.75, 5)
  })

  it('⛔⛔ A STYLE WITH NO COUNTERPART IS REPORTED, NEVER MAPPED TO A NEIGHBOUR', () => {
    // `defSchema` reserves `cross` and refuses it, because LWC draws
    // circle/square/arrow markers only. Sending `markers` instead would put dots
    // where the member wrote crosses and call it fidelity.
    const p = pres('plot(close, style = plot.style_cross)')
    expect(p.style).toBeUndefined()
    expect(p.styleUncarried).toBe('plot.style_cross')
  })

  // ⚰️ THIS CASE USED TO ASSERT `colorDynamic: true` FOR A CONDITIONAL, and that
  // was the right answer while nothing could carry one: 49 of the 60 OOS scripts
  // colour from an expression, and picking one branch to show a flat colour is
  // the silent-false-success shape Wave A exists to stop, moved into pixels.
  // ⭐ C1-A CARRIES IT. The claim is unchanged — DO NOT FLATTEN — and is now met
  // by carrying the whole rule instead of by declining to.
  it('⭐⭐ A CONDITIONAL BETWEEN TWO STATIC COLOURS IS CARRIED, condition and all', () => {
    const p = pres('plot(close, color = close > open ? color.green : color.red)')
    expect(p.colorUp).toBe('#4CAF50')
    expect(p.colorDown).toBe('#F23645')
    expect(p.colorCondition.formula).toBe('close > open')
    // ⛔ AND IT IS NO LONGER REPORTED AS UNCARRIED — a document that both carries
    // the rule and warns it was dropped tells the member two different things.
    expect(p.colorDynamic).toBeUndefined()
    // ⛔ NOR IS A SINGLE FLAT COLOUR INVENTED.
    expect(p.color).toBeUndefined()
  })

  it('⭐ …through a NAME, which is how 217 of the corpus\' colour arguments read', () => {
    const p = pres('col = close > open ? color.green : color.red\nplot(close, color = col)')
    expect(p.colorUp).toBe('#4CAF50')
    expect(p.colorDown).toBe('#F23645')
    expect(p.colorCondition.formula).toBe('close > open')
  })

  it('⛔⛔ A BRANCH THAT IS NOT A STATIC COLOUR IS STILL REPORTED, NEVER GUESSED', () => {
    // `cond ? a : someExpression` is a colour this door cannot say. Carrying one
    // of the two branches would give the member a confident wrong picture.
    const p = pres('plot(close, color = close > open ? color.green : color.new(color.red, close))')
    expect(p.colorDynamic).toBe(true)
    expect(p.colorUp).toBeUndefined()
    expect(p.colorCondition).toBeUndefined()
  })

  it('⭐ absent is absent — a plot that says nothing carries nothing', () => {
    expect(pres('plot(close)')).toEqual({})
  })
})

describe('hline is a level, and the schema has had one all along', () => {
  it('⭐⭐ every folded level is carried, with its title and styling', () => {
    const out = translatePine(src(
      'plot(ta.rsi(close, 14))\nhline(70, "Overbought", color = color.red, linewidth = 2)\nhline(30, "Oversold")'))
    expect(out.presentation.levels).toEqual([
      { value: 70, title: 'Overbought', color: '#F23645', width: 2 },
      { value: 30, title: 'Oversold' },
    ])
  })

  it('⛔ it is still an ignored LINE — carried is not the same as offered', () => {
    // The level now reaches the document; the call is still not a column, and
    // the member's disclosure list must keep saying so.
    const out = translatePine(src('plot(close)\nhline(70)'))
    expect(out.notes.map((n) => n.code)).toContain('pine:chart-only')
  })

  it('⛔ a level this grammar cannot fold is dropped, not guessed', () => {
    const out = translatePine(src('plot(close)\nhline(ta.sma(close, 20))'))
    expect(out.presentation.levels).toEqual([])
    expect(out.refusal, 'an unfoldable level must not refuse the script').toBe(null)
  })
})

describe('non-vacuity — the parse-node vocabulary trap', () => {
  it('⛔⛔ a PARSE node is `number`; a CANONICAL node is `num`', () => {
    // ⚰️ THIS COST A DEBUGGING CYCLE AND IS WORTH A PERMANENT TEST. Reading
    // `type === 'num'` off a PARSE node matches nothing, so every literal read as
    // ABSENT — `linewidth = 2` silently vanished and every `hline` produced an
    // empty level list, while the code looked entirely correct. Two vocabularies
    // one letter apart, failing silently in the direction of "the author said
    // nothing". These four assertions are the ones that were wrong.
    expect(translatePine(src('plot(close, linewidth = 2)')).outputs[0].presentation.width).toBe(2)
    expect(translatePine(src('plot(close, transp = 50)')).outputs[0].presentation.opacity)
      .toBeCloseTo(0.5, 5)
    expect(translatePine(src('plot(close)\nhline(42)')).presentation.levels[0].value).toBe(42)
    expect(translatePine(src('plot(close, color = color.new(color.red, 20))'))
      .outputs[0].presentation.opacity).toBeCloseTo(0.8, 5)
  })

  it('⭐ CONTROL — carrying presentation changed no acceptance decision', () => {
    // Wave B is a carriage change, not a semantics change. If reading `overlay=`
    // or an `hline` ever alters whether a script imports, something has leaked
    // from the presentation lane into the calculation lane.
    for (const body of [
      'plot(close)',
      'plot(ta.rsi(close, 14))\nhline(70)\nhline(30)',
      'plot(close, color = color.red, linewidth = 4, style = plot.style_area)',
    ]) {
      const out = translatePine(src(body, 'indicator("t", overlay = true)'))
      expect(out.ok, body).toBe(true)
      expect(out.refusal, body).toBe(null)
    }
  })
})
