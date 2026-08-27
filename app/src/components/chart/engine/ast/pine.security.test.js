import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

/**
 * `request.security(syminfo.tickerid, '<TF>', expr)` → the `tf` node.
 *
 * ⛔⛔ WHY THIS FILE EXISTS SEPARATELY FROM THE CORPORA. Neither the carve-out
 * nor the timeframe FOLD moved either corpus number — both stayed 12/21 owner
 * and 10/30 community, measured before and after. Without this file the whole
 * path would be code with no exercise anywhere, and the day it broke both
 * corpora would stay green. That is `lesson_built_tested_green_and_unreachable`,
 * and a translator path measured by no corpus is exactly its shape.
 *
 * ⭐ AND THE SECOND MEASUREMENT RETIRED A FALSE PREMISE. The plan predicted the
 * fold would free “the ~6 variable-timeframe scripts — the largest single group”.
 * It freed none, because a variable timeframe was never the BINDING constraint on
 * any of them. Read at the refusing line, the six `pine:request` scripts are:
 *
 *   05-mtf-structure-bias        `tf2 = input.timeframe("60")`  → FOLDS, to a
 *                                 timeframe we cannot resample from daily bars.
 *                                 The fold worked; the answer is still no.
 *   19-cm-macd-ult-mtf           `res = useCurrentRes ? period : resCustom`
 *   20-cm-ultimate-ma-mtf         — a TERNARY. No literal exists to fold to.
 *   23-higher-timeframe-ema      `ema[barstate.isrealtime ? 1 : 0]` — the CHILD
 *                                 is the blocker, not the timeframe.
 *   04-superguppy                `s01 = input('BINANCE:BTCEUR', type=input.symbol)`
 *   13-relative-strength-vs-spy  `benchmark = input.symbol("SPY")`, read at
 *                                 `timeframe.period` — no resample at all.
 *
 * ⛔ SO THE BINDING CONSTRAINT IS `sym`, NOT `tf`, AND IT IS TWO SCRIPTS, NOT SIX.
 * 13 is precisely the benchmark-whitelist case already decided; 04 asks for a
 * crypto pair on another exchange. “Variable timeframe” was a property these
 * scripts SHARED, never the reason they refused — the same shape as
 * `lesson_a_premise_that_says_nothing_to_find_retires_the_search`, caught only by
 * doing the work and re-measuring instead of trusting the row.
 *
 * ⭐ THE FOLD IS STILL CORRECT AND STILL KEPT: it is what TradingView's own Pine
 * Screener does, and it is what a MEMBER's pasted `input.timeframe("W")` needs.
 * The corpora simply do not contain that shape. Its exercise is here.
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

  it('⭐ an `input.timeframe` VARIABLE folds to its default — TradingView does the same', () => {
    // ⭐ THIS IS FIDELITY, NOT A SHORTCUT. This file's own header records that
    // their Pine Screener "supports most `input.*`, falling back to defaults for
    // `input.timeframe`/`input.symbol`/`input.time`" — so on the surface these
    // scripts were written for, `res = input.timeframe(defval='W')` really does
    // mean 'W'. Six community scripts name their timeframe through a variable;
    // refusing them refuses the IDIOM, not the maths.
    const ast = treeOf(translatePine(src(
      "res = input.timeframe(defval='W')\nplot(request.security(syminfo.tickerid, res, close))")))
    expect(ast).toEqual({ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] })
  })

  it('⭐ and a `tickerid = syminfo.tickerid` ALIAS is still this chart\'s own symbol', () => {
    // Three community scripts write it this way. Accepting the bare name while
    // refusing its alias would accept the same script only when spelled the less
    // common way.
    const ast = treeOf(translatePine(src(
      "tickerid = syminfo.tickerid\nplot(request.security(tickerid, 'W', close))")))
    expect(ast.type).toBe('tf')
    expect(ast.value).toBe('W')
  })

  it('⛔ FOLDING IS NOT PERMISSION — a folded timeframe we cannot resample still refuses', () => {
    // The control that stops the fold becoming a yes-machine: `'60'` resolves to
    // a real string and is STILL not something `tf` can produce from daily bars.
    const out = translatePine(src(
      "res = input.timeframe(defval='60')\nplot(request.security(syminfo.tickerid, res, close))"))
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:request')
  })

  it('⛔ and a genuinely COMPUTED timeframe refuses — there is no literal to fold to', () => {
    // The node carries its code as a FIELD precisely so a timeframe can never be
    // computed at runtime. Here that rule is enforced by there being nothing to
    // read: a user function has no default to fall back to.
    const out = translatePine(src(
      "tfOf(x) => x > 1 ? 'W' : 'M'\nplot(request.security(syminfo.tickerid, tfOf(close), close))"))
    expect(out.refusal).toBeTruthy()
  })
  it('⭐ the v2/v3 spelling `tickerid` is the SAME “this chart” — age is not a refusal', () => {
    // 19-cm-macd-ult-mtf and 20-cm-ultimate-ma-mtf are v3 scripts that write
    // `security(tickerid, res, x)`. Knowing only v5's `syminfo.tickerid` would
    // refuse them for the year they were written in. (Both still refuse today —
    // their `res` is a ternary — which is why this is pinned HERE and not by a
    // corpus number that cannot move.)
    for (const spelled of ['tickerid', 'ticker', 'syminfo.ticker']) {
      const ast = treeOf(translatePine(src(
        `plot(security(${spelled}, 'W', close))`)))
      expect(ast.type, spelled).toBe('tf')
      expect(ast.value, spelled).toBe('W')
    }
  })

  it('⛔ but a LOCAL binding that shadows `tickerid` is another symbol, and refuses', () => {
    // The control on the spellings above: recognising the built-in must not
    // become “any variable called tickerid is this chart”. Here it is bound to a
    // literal, which is a DIFFERENT instrument — `sym`'s job, and `sym` is not built.
    const out = translatePine(src(
      `tickerid = 'SPY'
plot(security(tickerid, 'W', close))`))
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:request')
  })
})
