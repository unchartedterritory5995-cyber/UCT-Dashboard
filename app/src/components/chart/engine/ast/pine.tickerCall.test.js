// app/src/components/chart/engine/ast/pine.tickerCall.test.js
//
// ─── 🔴 A SYMBOL WRAPPED IN THE FUNCTION PINE GIVES YOU FOR WRAPPING IT ──────
//
// ⛔ `request.security` takes a ticker id, and Pine's own way to build one is
// `ticker.new(prefix, ticker, session)` (v5) or `tickerid(prefix, ticker)` (v3).
// This door already knew every SPELLING of "this chart's symbol" and already
// followed bindings — so the only thing standing between it and
// `12-ichimoku-clouds` was seeing through one call. The script was being refused
// for wrapping its own ticker in the function that exists to wrap it.
//
// ⭐ AND A CONSTANT-CONDITION TERNARY PICKS ITS BRANCH, which is the idiom
// `ownTimeframeOf` and `timeframeLiteralOf` have carried all along — applied to
// the other axis. A test that does NOT fold refuses, because a symbol that could
// vary per bar is exactly what the `sym` node shape forbids.
//
// ⛔⛔ THE HALF THAT COSTS A CORPUS POINT IS THE HALF THAT MATTERS. Reading the
// call made `26-spy-to-es` translate, and it asks for
// `ticker.new('AMEX', 'SPY', session.extended)` — PRE- AND POST-MARKET prints.
// `sym` serves the regular session, so folding that request onto it answers a
// real, plausible, DIFFERENT number on every bar. It is refused again here, on
// purpose, and the corpus went 42 back to 41. That is the same trade this door
// already makes for `barmerge.lookahead_on`.

import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'

const sec = (body) => `//@version=5\nindicator("t")\n${body}\nplot(v)\n`
const formulaOf = (out) => (out.outputs.find((o) => o.formula) || {}).formula

describe('a ticker-constructing call resolves to the symbol inside it', () => {
  it('⭐⭐ v3 `tickerid(prefix, ticker)` at the own timeframe is the IDENTITY', () => {
    // ⛔ THE ASSERTION IS THE FORMULA, NOT MERELY THAT IT TRANSLATED. This engine's
    // whole claim is that it does not quietly answer something else, so a case that
    // only checked `ok` would pass just as happily for a door that folded this to
    // some other series.
    const out = translatePine(sec('t = tickerid(syminfo.prefix, ticker)\nv = security(t, period, hl2)'))
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(formulaOf(out)).toBe('(high + low) / 2')
  })

  it('⭐ v5 `ticker.new(prefix, "SPY")` is ANOTHER instrument, and says so', () => {
    const out = translatePine(sec('t = ticker.new("AMEX", "SPY")\nv = request.security(t, timeframe.period, close)'))
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(formulaOf(out)).toBe("sym('SPY', close)")
  })

  it('⭐ a ternary whose test FOLDS picks its branch', () => {
    // `input.bool` folds to its default, so exactly one ticker is meant and the
    // engine can name it.
    const out = translatePine(sec(
      'useSpy = input.bool(true)\n'
      + 't = useSpy ? ticker.new("AMEX", "SPY") : ticker.new("NASDAQ", "QQQ")\n'
      + 'v = request.security(t, timeframe.period, close)'))
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(formulaOf(out)).toBe("sym('SPY', close)")
  })

  it('⛔ …and the OTHER default picks the other branch — not a hardcoded first arm', () => {
    // ⚰️ WITHOUT THIS, a resolver that always took `yes` would pass the case above.
    const out = translatePine(sec(
      'useSpy = input.bool(false)\n'
      + 't = useSpy ? ticker.new("AMEX", "SPY") : ticker.new("NASDAQ", "QQQ")\n'
      + 'v = request.security(t, timeframe.period, close)'))
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(formulaOf(out)).toBe("sym('QQQ', close)")
  })

  it('⛔ a ternary whose test does NOT fold refuses — a symbol may not vary per bar', () => {
    const out = translatePine(sec(
      't = close > open ? ticker.new("AMEX", "SPY") : ticker.new("NASDAQ", "QQQ")\n'
      + 'v = request.security(t, timeframe.period, close)'))
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:request')
  })
})

describe('🔴 an EXTENDED session is a different series, and is refused', () => {
  it('⛔⛔ `session.extended` refuses even though everything else resolves', () => {
    // ⭐ THE PAIR IS THE POINT: the only difference between this and the passing
    // case below is the session argument, so nothing but the session can explain
    // the refusal.
    const out = translatePine(sec(
      't = ticker.new("AMEX", "SPY", session.extended)\n'
      + 'v = request.security(t, timeframe.period, close)'))
    expect(out.ok, 'an extended-hours request must not fold onto the regular session')
      .toBe(false)
    expect(out.refusal.guard).toBe('pine:request')
  })

  it('⭐ `session.regular` is what `sym` actually serves, so it translates', () => {
    const out = translatePine(sec(
      't = ticker.new("AMEX", "SPY", session.regular)\n'
      + 'v = request.security(t, timeframe.period, close)'))
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(formulaOf(out)).toBe("sym('SPY', close)")
  })

  it('⛔ and an UNRECOGNISED session spelling refuses rather than being assumed', () => {
    // This admits the one declared value, never "anything that isn't extended" —
    // the same shape the lookahead reader uses two functions away.
    const out = translatePine(sec(
      't = ticker.new("AMEX", "SPY", someSession)\n'
      + 'v = request.security(t, timeframe.period, close)'))
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:request')
  })
})
