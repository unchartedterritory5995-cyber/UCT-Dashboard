// app/src/components/chart/engine/ast/pine.requestHonestWords.test.js
//
// ─── ⭐⭐ e97 U1 — EVERY `pine:request` REFUSAL NAMES THE ARGUMENT THAT DID NOT FOLD, AND WHY ──────────
//
// ⚰️ THREE DOOR REFUSALS ENDED AT A BARE NAME. The e96 breach measurement (13 `pine:request` rows, SPY 5m
// and 15m) found three whose whole reason was "… what stops this one is that its arguments do not fold to
// those — `request.security`" and nothing after it: a script asking `input.timeframe('360')`, one reading
// `ticker.heikinashi(syminfo.tickerid)`, and TradingView's own `ticker.modify(t1, session.extended)` at
// `"2D"`. `securityDeclineReason` answered null whenever its two named cases (a `ticker.new` session, a
// timeframe this table spells) did not apply, and a member then had three arguments and no hint which one
// to change. It also BLAMED A TIMEFRAME THAT FOLDS: `"1D"` on a daily chart is the chart's own series
// (`requestTargetOf`), yet a request whose SYMBOL did not fold read "`1D` is not one of them".
//
// ⭐ THE RULE THIS FILE HOLDS: over a fixture set of every request shape the door refuses, at four chart
// periods, each `pine:request` refusal ends with a NAMED ARGUMENT AND A REASON (or is the other-symbol
// table's own whole sentence), never at a bare name; the named cases say the argument the member wrote; a
// timeframe naming the chart's own is never blamed. The fixtures are written for this file (no licensed
// source): each is the SHAPE of a measured row, not its text.

import { describe, it, expect } from 'vitest'

import { translatePine, REFUSALS } from './pine.js'

const H = '//@version=6\nindicator("t")\n'

/** Every request shape the door refuses, by the argument that stops it. */
const REFUSED = {
  // the three measured bare endings, by shape
  heikinashi: 'ha = ticker.heikinashi(syminfo.tickerid)\nplot(request.security(ha, timeframe.period, close))',
  inputTf360: 'tf = input.timeframe("360", "Higher")\nplot(request.security(syminfo.tickerid, tf, ta.atr(14)))',
  modifyExtended2D: 't1 = ticker.new(syminfo.prefix, syminfo.ticker, session.regular, adjustment.splits)\n'
    + 't2 = ticker.modify(t1, session.extended)\nplot(request.security(t2, "2D", close))',
  // the neighbours of each
  renkoInline: 'plot(request.security(ticker.renko(syminfo.tickerid, "ATR", 10), timeframe.period, close))',
  modifyExtendedSameTf: 't2 = ticker.modify(syminfo.tickerid, session.extended)\nplot(request.security(t2, "D", close))',
  modifyAdjustment: 't2 = ticker.modify(syminfo.tickerid, adjustment = adjustment.dividends)\nplot(request.security(t2, "D", close))',
  tfTwoDay: 'plot(request.security(syminfo.tickerid, "2D", close))',
  tfThreeWeek: 'plot(request.security(syminfo.tickerid, "3W", close))',
  tfPerBar: 'tf = close > open ? "W" : "M"\nplot(request.security(syminfo.tickerid, tf, close))',
  symbolPerBar: 's = close > open ? "SPY" : "QQQ"\nplot(request.security(s, "1D", close))',
  lookaheadPerBar: 'la = close > open\nplot(request.security(syminfo.tickerid, "W", close, lookahead = la))',
  tfThroughParam: 'f(string tf) => request.security(syminfo.tickerid, tf, close)\nplot(f(timeframe.period))',
  missingExpression: 'plot(request.security(syminfo.tickerid, "W"))',
  unplaceable: 'plot(request.security(syminfo.tickerid, "W", close, timeframe = "M"))',
  tupleHeikinashi: 'ha = ticker.heikinashi(syminfo.tickerid)\n[o, c] = request.security(ha, timeframe.period, [open, close])\nplot(c)',
  tuple360: '[o, c] = request.security(syminfo.tickerid, "360", [open, close])\nplot(c)',
  economic: 'plot(request.economic("US", "GDP"))',
  quandl: 'plot(request.quandl("CFTC/SB_FO_ALL", barmerge.gaps_off, 0))',
  currencyRate: 'plot(request.currency_rate("USD", "EUR"))',
}

const PERIODS = ['D', 'W', '5', '60']

/** Every `pine:request` refusal a translation carries, the script-level list and each output's own. */
function requestRefusals(body, basePeriod) {
  const t = translatePine(H + body, { basePeriod, strict: true })
  const all = [...(t.refusals || []), ...(t.outputs || []).map((o) => o && o.refusal).filter(Boolean)]
  return all.filter((r) => r && r.guard === 'pine:request')
}

const STANDARD = REFUSALS['pine:request']
/** The words after the shared sentence's `— \`<name>\``, or null when the refusal is not built on it. */
function tailOf(message) {
  if (!message.startsWith(STANDARD)) return null
  return message.slice(STANDARD.length)
}

describe('e97 U1 — a pine:request refusal ends with a named argument and a reason', () => {
  it('no refusal over the fixture set ends at a bare name (and the set is not empty)', () => {
    const bare = []
    let seen = 0
    for (const [key, body] of Object.entries(REFUSED)) {
      for (const bp of PERIODS) {
        for (const r of requestRefusals(body, bp)) {
          seen += 1
          const tail = tailOf(r.message)
          // the other-symbol table's own whole sentence (`staticOtherSymbolMessage`) is not built on it
          if (tail === null) continue
          if (!/^ — `[^`]+`: \S.{20,}$/s.test(tail)) bare.push(`${key} @${bp}: …${tail.slice(-120)}`)
        }
      }
    }
    // ⛔ a fixture set that refused nothing would pass the loop above vacuously
    expect(seen).toBeGreaterThanOrEqual(Object.keys(REFUSED).length * PERIODS.length)
    expect(bare).toEqual([])
  })

  it('every fixture is refused at pine:request on a daily chart', () => {
    const notRefused = Object.entries(REFUSED).filter(([, body]) => requestRefusals(body, 'D').length === 0).map(([k]) => k)
    expect(notRefused).toEqual([])
  })

  const said = (key, bp = 'D') => requestRefusals(REFUSED[key], bp).map((r) => r.message).join('\n')

  it('ticker.heikinashi: the symbol argument, by the name the script wrote, and what Heikin-Ashi bars are', () => {
    expect(said('heikinashi')).toContain('the symbol argument `ha` is `ticker.heikinashi(…)`, which asks for Heikin-Ashi bars')
    expect(said('tupleHeikinashi')).toContain('— `c`: the symbol argument `ha` is `ticker.heikinashi(…)`')
    expect(said('renkoInline')).toContain('the symbol argument `ticker.renko(…)` asks for Renko bricks')
  })

  it('input.timeframe("360"): the timeframe argument, its value, and why that value is not served', () => {
    expect(said('inputTf360')).toContain('the timeframe argument `tf` is `360`, below this chart\'s timeframe: lower-tf:not-served')
    expect(said('inputTf360', '5')).toContain('the timeframe argument `tf` is `360`, a timeframe this engine has no bars for')
    expect(said('tuple360')).toContain('— `c`: the timeframe argument `"360"` is below this chart\'s timeframe')
    expect(said('tfTwoDay')).toContain('the timeframe argument `"2D"` is a timeframe this engine has no bars for')
  })

  it('ticker.modify(…, session.extended) at "2D": BOTH arguments, the session by its own spelling', () => {
    const s = said('modifyExtended2D')
    expect(s).toContain('the symbol argument `t2` is `ticker.modify(…)`, which names the session `session.extended`')
    expect(s).toContain('; and the timeframe argument `"2D"` is a timeframe this engine has no bars for')
    // train e97 (U1 x U4): with U4, a written `adjustment` is read by U4's own decline, which names it and why
    expect(said('modifyAdjustment')).toContain(
      'the `adjustment` argument of `ticker.modify`: `adjustment.dividends` asks for prices adjusted for dividends as well as splits')
  })

  it('a timeframe naming the chart\'s own is never blamed: the symbol that did not fold is', () => {
    // `"1D"` / `"D"` on a daily chart fold to the chart's own series (`requestTargetOf`)
    for (const key of ['symbolPerBar', 'modifyExtendedSameTf']) {
      const s = said(key)
      expect(s, key).not.toMatch(/`1?D` is not one of them/)
      expect(s, key).toContain('the symbol argument `')
    }
    // and on a 5-minute chart, where `"1D"` really is not served, the symbol is named beside it
    const intraday = said('symbolPerBar', '5')
    expect(intraday).toContain('the symbol argument `s` is `… ? … : …`, which picks its value on each bar')
    expect(intraday).toContain('; and this engine resamples')
  })

  it('a timeframe passed through a function parameter is refused FOR the parameter, never as "not a timeframe"', () => {
    const s = said('tfThroughParam')
    expect(s).toContain('is the function parameter `tf`, given `timeframe.period` at its call')
    expect(s).not.toContain('is not a timeframe this door can read')
  })

  it('a look-ahead that is not a constant is named', () => {
    expect(said('lookaheadPerBar')).toContain('the `lookahead` argument `la` is not a constant this door can read')
  })

  it('a call that is not request.security says what it reads, by its own arguments', () => {
    expect(said('economic')).toContain('— `request.economic`: it reads TradingView\'s economic data (`"US"`, `"GDP"`)')
    expect(said('quandl')).toContain('— `request.quandl`: it reads a Nasdaq Data Link (Quandl) dataset (`"CFTC/SB_FO_ALL"`)')
    expect(said('currencyRate')).toContain('— `request.currency_rate`: it reads a currency conversion rate (`"USD"`, `"EUR"`)')
  })

  it('CONTROL: the same requests written so they fold are served, not refused', () => {
    const served = [
      'plot(request.security(syminfo.tickerid, "1D", close))',
      'plot(request.security(syminfo.tickerid, "W", close))',
      'plot(request.security(ticker.new(syminfo.prefix, syminfo.ticker, session.regular), "D", close))',
      'plot(request.security(ticker.modify(syminfo.tickerid), "D", close))',
    ]
    for (const body of served) expect(requestRefusals(body, 'D'), body).toEqual([])
  })
})
