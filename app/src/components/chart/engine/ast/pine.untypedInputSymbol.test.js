// ─── ⭐⭐ RS RATING L2 — AN UNTYPED `input('SPY')` USED AS A REQUEST SYMBOL FOLDS ───
//
// Pine types an untyped `input(defval, …)` by its default's literal type
// (Pine v5 reference, `input`: "the type of the input is determined by the type of
// `defval`"), so `t = input('SPY', title='T')` is a string input whose default is
// 'SPY' — the same fold `input.symbol('SPY')` / `input.string('SPY')` already get
// (`pine.js::symbolInputDefaultOf`, the ONE reader `otherSymbolOf` and
// `rawSymbolSpellingOf` both ask). Every rule has a case that folds and a control
// that keeps refusing.

import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'

const pine = (lines) => ['//@version=5', "indicator('m', overlay=true)", ...lines].join('\n')
const tr = (lines) => translatePine(pine(lines), { strict: true })
const firstAst = (t) => (t.outputs || []).map((o) => o && o.ast).find(Boolean)

describe('L2 — an untyped input() symbol folds to its default', () => {
  it("`t = input('SPY', title='T')` reads SPY exactly as `input.symbol('SPY')` does", () => {
    const untyped = tr(["t = input('SPY', title='T')", 'plot(request.security(t, timeframe.period, close))'])
    const typed = tr(["t = input.symbol('SPY', title='T')", 'plot(request.security(t, timeframe.period, close))'])
    expect(typed.refusal || null).toBe(null)
    expect(untyped.refusal || null).toBe(null)
    expect(firstAst(untyped)).toEqual(firstAst(typed))
    expect(untyped.otherSymbols).toEqual([{ ticker: 'SPY', spellings: [''] }])
    expect(untyped.otherSymbols).toEqual(typed.otherSymbols)
  })

  it('the venue the default spells travels with it (`input("NASDAQ:AAPL")`)', () => {
    const t = tr(["s = input('NASDAQ:AAPL', title='S')", 'plot(request.security(s, timeframe.period, close))'])
    expect(t.otherSymbols).toEqual([{ ticker: 'AAPL', spellings: ['NASDAQ'] }])
  })

  it('the fold is recorded as a frozen input, never silent', () => {
    const t = tr(["t = input('SPY', title='T')", 'plot(request.security(t, timeframe.period, close))'])
    const folded = (t.outputs || []).flatMap((o) => (o && o.inputsFolded) || [])
    expect(folded.some((e) => e && e.call === 'input' && e.folded === "'SPY'")).toBe(true)
  })

  it('CONTROL: a symbol that is not constant keeps refusing', () => {
    const t = tr(["t = close > open ? 'SPY' : 'QQQ'", 'plot(request.security(t, timeframe.period, close))'])
    expect(t.otherSymbols || []).toEqual([])
    const refused = !!t.refusal || (t.outputs || []).every((o) => !o || !o.ast)
    expect(refused).toBe(true)
  })

  it('CONTROL: an untyped input whose default is not a string (a number) names no symbol', () => {
    const t = tr(['t = input(4200, title="T")', 'plot(request.security(t, timeframe.period, close))'])
    expect(t.otherSymbols || []).toEqual([])
  })

  it('CONTROL: an untyped input with a `type=` other than a string is not read as one', () => {
    const t = tr(["t = input('SPY', type=input.resolution)", 'plot(request.security(t, timeframe.period, close))'])
    expect(t.otherSymbols || []).toEqual([])
  })
})

describe('L2 — the default is followed like any symbol argument', () => {
  it('a default that names a constant string binding folds through it (`s0 = "SPY"`, `input(s0)`)', () => {
    const t = tr(["s0 = 'SPY'", 't = input(s0, title="T")', 'plot(request.security(t, timeframe.period, close))'])
    expect(t.otherSymbols).toEqual([{ ticker: 'SPY', spellings: [''] }])
  })
})
