import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'

/**
 * ⭐⭐ C10 (2026-09-29, objects-triage fix-order step 20) — what a
 * `request.security` the chart cannot serve may and may not cost.
 *
 * artemis-oscillator-pro asks for its oscillator at 15m / 1h / 4h / D on every
 * chart and forces a timeframe below the chart's own to `— n/a`:
 *
 *   bool mtfV1 = timeframe.in_seconds(mtfTf1) >= chartSec
 *   int  mtfD1 = not mtfV1 or na(mtfO1) ? 0 : …
 *   mtfTag(d, valid) => not valid ? "— n/a" : d > 0 ? "▲ BULL" : …
 *
 * On a daily chart `mtfV1` is `900 >= 86400` — false on every bar — so the
 * 15-minute request is never read. The resolver already skipped a branch a
 * constant test never takes, but only when the test WAS a `num`; this one is a
 * constant EXPRESSION, so the dead arm was resolved, refused, and took the cell
 * TradingView draws as `— n/a` with it. In the OBJECT pass a ternary or an
 * `and`/`or` whose test folds (`constantTestValue`) now answers with its live
 * side when the side it never takes refuses (`Resolver.deadArmRescue`), and so do
 * the text and colour readers. The PLOT lane keeps refusing: there a newly
 * translating output would re-number the parameters members save
 * (`paramIds.test.js`). The vendor half is `__tests__/c10SecurityObjects.vendor.test.js`.
 */
const v6 = (body) => `//@version=6\nindicator("t")\n${body}\n`
// ⚠️ a script whose every column is a constant refuses as a whole
// (`pine:constant-only`), so each plot probe carries a live `plot(close)` AFTER
// the output under test and reads output 0
const firstTree = (out) => {
  expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
  expect(out.outputs[0].refusal, out.outputs[0].refusal && out.outputs[0].refusal.message).toBe(null)
  return out.outputs[0].ast
}
const withLive = (src) => `${src}plot(close)\n`
const VALID15 = 'v = timeframe.in_seconds("15") >= timeframe.in_seconds()'
// ⚰️ C41 (2026-09-30): this was `"15"`, which a daily chart SERVES now (an `ltf`
// read). The cases below are about a side that REFUSES, so the request is one
// that still does — `"30"`, a timeframe no capture shows read below a chart
// (`lower-tf:unwitnessed`). The validity test keeps artemis's own shape.
const REQ15 = 'request.security(syminfo.tickerid, "30", close)'
/** The object program's tree behind a table cell whose text is
 *  `str.tostring(<expr>)`, or the drop reasons when the cell was dropped. */
const cellTree = (expr) => {
  const out = translatePine(v6(`${VALID15}
var table tb = table.new(position.top_right, 1, 1)
if barstate.islast
    table.cell(tb, 0, 0, str.tostring(${expr}))`), { strict: true })
  const cellOp = out.objects && out.objects.ops.find((op) => op.k === 'cell')
  if (!cellOp) return { dropped: out.objectDiagnostics.dropReasons }
  return out.objects.trees[cellOp.props.text.node.tree]
}

describe('in the OBJECT pass, a test that is a constant EXPRESSION answers with its live side', () => {
  it('⭐ ternary: `not v ? 0 : <15m request>` is 0 on a daily chart, the request never needed', () => {
    expect(cellTree(`not v ? 0 : ${REQ15}`)).toEqual({ type: 'num', value: 0 })
  })

  it('⭐ …and with the dead side FIRST: `v ? <15m request> : 0` is 0', () => {
    expect(cellTree(`v ? ${REQ15} : 0`)).toEqual({ type: 'num', value: 0 })
  })

  it('⭐ `or`: a left side that folds to true decides it, the refusing right side is skipped', () => {
    expect(cellTree(`(not v or na(${REQ15})) ? 1 : 2`)).toEqual({ type: 'num', value: 1 })
  })

  it('⛔ CONTROL — a test that reads the bars keeps both sides, and the cell is dropped', () => {
    expect(cellTree(`close > open ? 0 : ${REQ15}`)).toEqual({ dropped: { 'cell:text': 1 } })
  })

  it('⛔ a LIVE side that refuses is still the answer — the rescue skips only the dead one', () => {
    expect(cellTree(`v ? 0 : ${REQ15}`)).toEqual({ dropped: { 'cell:text': 1 } })
  })

  it('⛔ a `na` inside the test never folds — what Pine answers for a comparison against it is not decided here', () => {
    // JavaScript would read `NaN != 1` as true and pick the 0 arm
    expect(cellTree(`na != 1 ? 0 : ${REQ15}`)).toEqual({ dropped: { 'cell:text': 1 } })
  })

  it('⛔ CONFINED — the PLOT lane still refuses the same expression (its parameter addresses must not move)', () => {
    const out = translatePine(withLive(v6(`${VALID15}
plot(not v ? 0 : ${REQ15})`)))
    expect(out.outputs[0].refusal).toBeTruthy()
    expect(out.outputs[0].refusal.guard).toBe('pine:request')
  })
})

describe('the object lane\'s text and colour readers take the same arm', () => {
  const cell = (cond) => v6(`${VALID15}
o = ${REQ15}
var table tb = table.new(position.top_right, 1, 1)
if barstate.islast
    table.cell(tb, 0, 0, ${cond} ? "n/a" : o > 0 ? "up" : "dn")`)

  it('⭐ `not v ? "n/a" : …` is the cell "n/a", drawn — no op dropped', () => {
    const out = translatePine(cell('not v'), { strict: true })
    expect(out.objectDiagnostics.droppedOps).toBe(0)
    const cellOp = out.objects.ops.find((op) => op.k === 'cell')
    expect(cellOp.props.text).toEqual({ v: 'text', node: { t: 'lit', s: 'n/a' } })
  })

  it('⭐ …and its colour, written the same way, is that arm\'s colour — the prop is not dropped', () => {
    const out = translatePine(v6(`${VALID15}
o = ${REQ15}
var table tb = table.new(position.top_right, 1, 1)
if barstate.islast
    table.cell(tb, 0, 0, "x", text_color = not v ? color.gray : o > 0 ? color.green : color.red)`), { strict: true })
    expect(out.objectDiagnostics.droppedProps || 0).toBe(0)
    const cellOp = out.objects.ops.find((op) => op.k === 'cell')
    expect(cellOp.props.text_color).toBeTruthy()
    expect(JSON.stringify(cellOp.props.text_color)).not.toContain('"if"')
  })

  it('⛔ CONTROL — a per-bar test keeps the 15m request live, and the cell is DROPPED, never guessed', () => {
    const out = translatePine(cell('close > open'), { strict: true })
    expect(out.objectDiagnostics.droppedOps).toBe(1)
    expect(out.objectDiagnostics.dropReasons['cell:text']).toBe(1)
  })

  it('⭐ a text whose both arms read is unchanged — the conditional node, not a pick', () => {
    const out = translatePine(v6(`${VALID15}
var table tb = table.new(position.top_right, 1, 1)
if barstate.islast
    table.cell(tb, 0, 0, not v ? "n/a" : "live")`), { strict: true })
    const cellOp = out.objects.ops.find((op) => op.k === 'cell')
    expect(cellOp.props.text.node.t).toBe('if')
  })
})

describe('a `timeframe.*` read inside a request at ANOTHER timeframe refuses by name', () => {
  it('⛔ `request.security(…, "W", timeframe.in_seconds())` is not the chart\'s 86400', () => {
    const out = translatePine(v6('plot(request.security(syminfo.tickerid, "W", timeframe.in_seconds()))'))
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:request')
    expect(out.refusal.message).toContain('`timeframe.in_seconds` read inside a `request.security` at `W`')
  })

  it('⛔ …nor `timeframe.multiplier`, nor `timeframe.period` reached through a name', () => {
    for (const body of [
      'plot(request.security(syminfo.tickerid, "M", timeframe.multiplier))',
      'p = timeframe.period\nplot(request.security(syminfo.tickerid, "W", p == "W" ? 1 : 0))',
    ]) {
      const out = translatePine(v6(body))
      expect(out.refusal, body).toBeTruthy()
      expect(out.refusal.guard, body).toBe('pine:request')
    }
  })

  it('⭐ CONTROL — the chart\'s own timeframe is the identity, so the read is the chart\'s, and outside a request nothing changes', () => {
    expect(firstTree(translatePine(withLive(v6('plot(request.security(syminfo.tickerid, "D", timeframe.in_seconds()))')))))
      .toEqual({ type: 'num', value: 86400 })
    expect(firstTree(translatePine(withLive(v6('plot(timeframe.in_seconds())'))))).toEqual({ type: 'num', value: 86400 })
  })
})

describe('a timeframe chosen through a long preset chain is read — in the object pass', () => {
  const PRESET = `p = input.string("Swing", "Preset", options=["Scalp","Intraday","Swing","Position","Crypto"])
tf = p=="Scalp" ? "60" : p=="Intraday" ? "240" : p=="Position" ? "M" : p=="Crypto" ? "240" : "W"`

  it('⭐ a name plus five ternary arms (artemis\' `mtfTf4`) reaches its timeframe', () => {
    const out = translatePine(v6(`${PRESET}
var table tb = table.new(position.top_right, 1, 1)
if barstate.islast
    table.cell(tb, 0, 0, str.tostring(request.security(syminfo.tickerid, tf, close)))`), { strict: true })
    const cellOp = out.objects.ops.find((op) => op.k === 'cell')
    expect(cellOp, JSON.stringify(out.objectDiagnostics.dropReasons)).toBeTruthy()
    expect(out.objects.trees[cellOp.props.text.node.tree])
      .toEqual({ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] })
  })

  it('⛔ CONFINED — the plot lane keeps its four-hop reader (its parameter addresses must not move)', () => {
    const out = translatePine(withLive(v6(`${PRESET}
plot(request.security(syminfo.tickerid, tf, close))`)))
    expect(out.outputs[0].refusal).toBeTruthy()
    expect(out.outputs[0].refusal.guard).toBe('pine:request')
  })
})
