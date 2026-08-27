import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

/**
 * `request.security(syminfo.tickerid, '<TF>', expr)` → the `tf` node.
 *
 * ⛔⛔ WHY THIS FILE EXISTS SEPARATELY FROM THE CORPORA. Wiring the carve-out
 * moved NEITHER corpus number, and that is a real measurement rather than a
 * disappointment: of the 13 community scripts that call `security`, **4 pass
 * `lookahead_on`** (11, 14, 22, 30), the rest use a VARIABLE timeframe, another
 * SYMBOL, or `barstate.*`. Not one of them is the plain shape this translates.
 *
 * So without this file the carve-out would be code with no exercise anywhere —
 * "built, green and connected to nothing", measured by no corpus — and the day
 * it broke, both corpora would stay green. That is the defect this repo hunts,
 * and a translator path with no test is exactly its shape.
 */
describe('request.security → tf', () => {
  const src = (body) => `//@version=5\nindicator("t")\n${body}\n`

  const treeOf = (out) => {
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    const first = out.outputs.find((o) => o.refusal === null)
    expect(first, 'no output translated').toBeTruthy()
    return first.ast
  }

  it('⭐ the plain shape becomes a tf node — same symbol, literal timeframe', () => {
    const out = translatePine(src("plot(request.security(syminfo.tickerid, 'W', close))"))
    const ast = treeOf(out)
    expect(ast).toEqual({ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] })
  })

  it('…and the child is translated, not passed through as text', () => {
    const out = translatePine(src("plot(request.security(syminfo.tickerid, 'M', ta.sma(close, 20)))"))
    const ast = treeOf(out)
    expect(ast.type).toBe('tf')
    expect(ast.value).toBe('M')
    expect(ast.args[0]).toEqual({
      type: 'call',
      name: 'sma',
      args: [{ type: 'series', name: 'close' }, { type: 'num', value: 20 }],
    })
  })

  it('⭐ `1W` and `1M` are the same timeframes spelled Pine\'s other way', () => {
    for (const [spelled, code] of [['1W', 'W'], ['1M', 'M']]) {
      const ast = treeOf(translatePine(src(`plot(request.security(syminfo.tickerid, '${spelled}', close))`)))
      expect(ast.value, spelled).toBe(code)
    }
  })

  it('⛔⛔ lookahead_on REFUSES — it reads a bar the base bar is inside', () => {
    // THE ONE THAT MATTERS. Our `tf` is `lookahead_off` + `[1]`: the last CLOSED
    // higher-timeframe bar. `lookahead_on` asks for the bar still forming, i.e.
    // the future mid-week. Translating it as if it were `off` would turn a
    // look-ahead script into a look-behind one — it would backtest beautifully
    // and be wrong, which is the silent mistranslation this door exists against.
    // ⚠️ FOUR REAL SCRIPTS in the community corpus do exactly this, so this is
    // not a hypothetical arm.
    const out = translatePine(src(
      "plot(request.security(syminfo.tickerid, 'W', close, lookahead=barmerge.lookahead_on))"))
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:request')
  })

  it('…and lookahead_off, stated explicitly, still translates', () => {
    // The control: without it the case above would pass for a translator that
    // refused every `lookahead=` argument, or every four-argument call.
    const ast = treeOf(translatePine(src(
      "plot(request.security(syminfo.tickerid, 'W', close, lookahead=barmerge.lookahead_off))")))
    expect(ast).toEqual({ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] })
  })

  it('⛔ another SYMBOL still refuses — that is `sym`, and it is not built', () => {
    const out = translatePine(src("plot(request.security('SPY', 'W', close))"))
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:request')
  })

  it('⛔ a timeframe this engine cannot RESAMPLE refuses at the door the member typed at', () => {
    // `'60'` is on the ladder but not resamplable from daily bars, so it must
    // refuse HERE rather than translate into a node `interpret` would then
    // refuse — a member should be told by the translator they used, not by an
    // engine two layers down.
    for (const tf of ['60', 'D', '3M']) {
      const out = translatePine(src(`plot(request.security(syminfo.tickerid, '${tf}', close))`))
      expect(out.refusal, tf).toBeTruthy()
      expect(out.refusal.guard, tf).toBe('pine:request')
    }
  })

  it('⛔ a COMPUTED timeframe refuses — the node has no slot for one', () => {
    // `res` is a variable; the `tf` node carries its code as a FIELD precisely so
    // a timeframe can never be computed at runtime. This is that shape rule
    // reaching the translator.
    const out = translatePine(src(
      "res = input.timeframe(defval='W')\nplot(request.security(syminfo.tickerid, res, close))"))
    expect(out.refusal).toBeTruthy()
  })
})
