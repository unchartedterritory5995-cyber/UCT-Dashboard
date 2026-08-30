// app/src/components/chart/engine/ast/pine.requestOffer.test.js
//
// ─── ⭐⭐ A `request.security` REFUSAL THAT NAMES THE REWRITE ────────────────
//
// ⛔⛔ THE ASSERTION THAT MAKES AN OFFER AN OFFER: the suggested text is APPLIED
// to the real published script and the script must then TRANSLATE. `pine.window.
// test.js::U1` states the rule this file inherits — *advice nobody can act on is
// worse than none* — and `doorScorecard`'s OFFERED roster now means "the door
// hands back the exact text that works", which is a claim about behaviour rather
// than about what a reviewer could imagine.
//
// ⚰️ FOUR SCRIPTS WERE PROPOSED FOR THAT ROSTER IN A REVIEW WHERE NONE OF THEM
// EMITTED A SINGLE CHARACTER OF ADVICE. Two of them are here because the door
// learned to speak; one (`07-hull-suite`) got there through the window advice;
// and one (`01-supertrend-mobius`) was left OPEN because the thinkScript resolver
// does not hold the source text and could offer only a template with
// placeholders. A template is not the exact text that works.
//
// ⚠️ AND BOTH SENTENCES SAY WHAT THEY COST. Neither rewrite is the member's
// original request — one reads the chart's own timeframe instead of forcing a
// daily rung, the other reads the regular session instead of the extended one —
// so the message says so in the same breath as the offer. An offer that hid the
// difference would be the silent mistranslation this engine exists against,
// wearing a helpful face.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'

const DIR = path.resolve(process.cwd(), '../tests/fixtures/pine_community')
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8')

describe('the request door names its reason and its rewrite', () => {
  it('⭐⭐ a timeframe this engine cannot resample offers `timeframe.period`', () => {
    const out = translatePine(read('23-higher-timeframe-ema.pine'))
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:request')
    expect(out.refusal.suggest).toBe('timeframe.period')
    // ⛔ THE SENTENCE NAMES WHAT THIS ENGINE *CAN* SERVE, derived from
    // `TF_RESAMPLABLE` rather than typed, so it follows the engine.
    expect(out.refusal.message).toMatch(/weekly and monthly/)
    // ⛔⛔ AND IT WARNS THAT THE REWRITE IS NOT THE SAME REQUEST. Without this the
    // offer would quietly convert "give me the daily EMA" into "give me the EMA of
    // whatever chart I happen to be on".
    expect(out.refusal.message).toMatch(/NOT THE SAME REQUEST/)
  })

  it('⭐⭐ …and APPLYING it makes the published script translate', () => {
    // ⛔ THE HALF THAT CANNOT BE FAKED. The rewrite is applied the way a member
    // would apply it — to their own source — and the door must then take it.
    const applied = read('23-higher-timeframe-ema.pine')
      .replace(/res\s*=\s*input\.timeframe\([^)]*\)/, 'res = timeframe.period')
    const out = translatePine(applied)
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(out.ok).toBe(true)
  })

  it('⭐⭐ an extended-session ticker offers `session.regular`', () => {
    const out = translatePine(read('26-spy-to-es-qqq-to-nq.pine'))
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:request')
    expect(out.refusal.suggest).toBe('session.regular')
    expect(out.refusal.message).toMatch(/pre- and post-market/)
    expect(out.refusal.message).toMatch(/DIFFERENT number/)
  })

  it('⭐⭐ …and APPLYING that one makes its script translate too', () => {
    const applied = read('26-spy-to-es-qqq-to-nq.pine').replace(/session\.extended/g, 'session.regular')
    const out = translatePine(applied)
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(out.ok).toBe(true)
  })

  it('⛔⛔ the symbol is followed through a BINDING and a TERNARY, as the corpus writes it', () => {
    // ⚰️ THE FIRST DRAFT LOOKED FOR A BARE `ticker.new(…)` CALL AND FOUND NOTHING.
    // `26-spy-to-es` writes `t = is_spy ? ticker.new('AMEX','SPY', session.extended)
    // : ticker.new('NASDAQ','QQQ', session.extended)`, so the offer came back null
    // on the one script it was written for. `otherSymbolNameOf` already followed
    // both shapes; the diagnostic had to follow the same ones.
    const src = ['//@version=5', 'indicator("t")',
      'use = input.bool(true)',
      't = use ? ticker.new("AMEX", "SPY", session.extended) : ticker.new("NASDAQ", "QQQ", session.extended)',
      'plot(request.security(t, timeframe.period, close))', ''].join('\n')
    expect(translatePine(src).refusal.suggest).toBe('session.regular')
  })

  it('⛔ a request this door has NOTHING honest to say about stays silent', () => {
    // ⭐ THE DISCRIMINATOR. An offer on every refusal would be noise, and worse,
    // it would make the OFFERED roster meaningless. A symbol on another venue has
    // no rewrite that keeps the member's meaning — `BINANCE:BTCEUR` is not
    // `session.regular` away from anything — so the door says nothing extra.
    const src = ['//@version=5', 'indicator("t")',
      'plot(request.security("BINANCE:BTCEUR", timeframe.period, close))', ''].join('\n')
    const out = translatePine(src)
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:request')
    expect(out.refusal.suggest).toBe(null)
  })

  it('⛔ and a script the door TAKES is untouched by any of this', () => {
    // Non-vacuity: the diagnostic runs only on the refusal path, so a working
    // `request.security` must be byte-identical to what it was.
    const src = ['//@version=5', 'indicator("t")',
      'plot(request.security(syminfo.tickerid, "W", ta.sma(close, 10)))', ''].join('\n')
    const out = translatePine(src)
    expect(out.ok).toBe(true)
    expect((out.outputs.find((o) => o.formula) || {}).formula).toBe("tf(sma(close, 10), 'W')")
  })
})
