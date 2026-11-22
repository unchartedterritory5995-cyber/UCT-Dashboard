// FCTX's pure half: reading the route's answer and putting it into words. Every value is invented
// (__fixtures__/factorExposureFixture.js is an invented walk run through the real server code).
import { describe, it, expect } from 'vitest'
import {
  FCTX_CODE, FCTX_WHAT, HELD_POLL_MS, barOf, barScale, basisText, changeText, checkText, constantText, factorRows, fctxRead,
  fctxUrl, fitRows, fitThenRows, fundRows, fundStateText, fundsNote, loadingCell, marketVsOneText, signMeaning, signedNum,
  tText, unstableText, windowShortText, windowText,
} from './factorExposureModel'
import { fctxAnswer } from './__fixtures__/factorExposureFixture'

const METHOD = { window: 252, min: 200, tBar: 2, vifUnstable: 5, fundMinCloses: 201, index: 'S&P 500', maxLagDays: 10 }

describe('fctxRead', () => {
  it('the code, the url and the poll', () => {
    expect(FCTX_CODE).toBe('FCTX')
    expect(FCTX_WHAT).toBe('The factor exposure')
    expect(fctxUrl('BRK.B')).toBe('/api/research/factor-exposure/BRK.B')
    expect(fctxUrl('A B')).toBe('/api/research/factor-exposure/A%20B')
    expect(HELD_POLL_MS).toBe(1800000)
  })

  it('every status the route answers, and anything else is a failed read', () => {
    expect(fctxRead({ status: 'not_held', detail: 'UCT holds no daily prices for ZZQA.' })).toEqual({ state: 'not_held', detail: 'UCT holds no daily prices for ZZQA.' })
    expect(fctxRead({ status: 'busy', detail: 'x' })).toEqual({ state: 'busy', detail: 'x' })
    expect(fctxRead({ status: 'unavailable', reason: 'no_market_fund', detail: 'The market fund (SPY or IVV) is not held.' }).state).toBe('unavailable')
    expect(fctxRead({ status: 'refused' }).state).toBe('unavailable')
    for (const b of [null, [], 'ok', { status: 'computing' }, { items: [] }]) expect(fctxRead(b)).toEqual({ state: 'failed' })
  })

  it('reads the whole answer: both windows, the change, the two readings, the factors and the funds', () => {
    const v = fctxRead(fctxAnswer())
    expect(v.state).toBe('ok')
    expect(v.dataThrough).toBe('2026-11-20')
    expect(v.sessionsRead).toBe(563)
    expect(v.method).toMatchObject({ window: 252, min: 200, tBar: 2, vifUnstable: 5 })
    expect(v.now.state).toBe('ok')
    expect(v.now.returns).toBe(252)
    expect(v.now.loadings.map((r) => r.key)).toEqual(['market', 'size', 'growth', 'momentum', 'quality', 'lowvol'])
    expect(v.now.loadings[0].side).toBe('more')
    expect(v.then.state).toBe('ok')
    expect(Object.keys(v.change)).toEqual(['market', 'size', 'growth', 'momentum', 'quality', 'lowvol'])
    expect(v.reading.text).toBe('NVDA trades like a high-momentum growth stock with more market sensitivity than the S&P 500.')
    expect(v.reading.basis.map((b) => b.key)).toEqual(['market', 'growth', 'momentum'])
    expect(v.factors.map((f) => f.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok'])
    expect(v.checks.map((c) => c.symbol)).toEqual(['SPY', 'IWM', 'IWF', 'IWD', 'MTUM', 'QUAL', 'USMV'])
  })

  it('a short or singular window and an unknown factor are read as such, never as numbers', () => {
    const b = fctxAnswer()
    b.now = { state: 'short', needed: 200, held: 150, unit: 'returns' }
    b.then = { state: 'singular', returns: 230, from: '2025-01-02', to: '2025-11-20' }
    b.reading = null
    b.factors.push({ key: 'carry', name: 'Carry', state: 'ok' })
    const v = fctxRead(b)
    expect(v.now).toEqual({ state: 'short', needed: 200, held: 150 })
    expect(v.then).toEqual({ state: 'singular', returns: 230, from: '2025-01-02', to: '2025-11-20' })
    expect(v.reading).toBeNull()
    expect(v.factors.map((f) => f.key)).not.toContain('carry')
    expect(windowShortText(v.now, METHOD)).toBe('Needs 200 common sessions; UCT holds 150.')
    expect(windowShortText({ state: 'short', needed: 200, held: 0 }, METHOD)).toBe('Needs 200 common sessions; UCT holds none.')
    expect(windowShortText(v.then, METHOD)).toContain('move together too closely')
  })
})

describe('words', () => {
  it('a signed number, a t, and a loading cell with its uncertainty', () => {
    expect(signedNum(1.528)).toBe('+1.53')
    expect(signedNum(-0.104)).toBe('-0.10')
    expect(signedNum(-0.004)).toBe('0.00')
    expect(signedNum(null)).toBe('n/a')
    expect(tText(14.7)).toBe('t 14.7')
    expect(tText(null)).toBe('no t')
    expect(loadingCell({ loading: 0.97, t: 6.19, clears: true })).toEqual({ main: '+0.97', sub: 't 6.2, above 2' })
    expect(loadingCell({ loading: 0.125, t: 0.72, clears: false })).toEqual({ main: '+0.13', sub: 't 0.7, too uncertain' })
    expect(loadingCell({ loading: 1, t: null, clears: false })).toEqual({ main: '+1.00', sub: 'no t: an exact fit' })
    expect(loadingCell(null)).toEqual({ main: 'n/a', sub: 'not in the model' })
  })

  it('a change says whether it is beyond the noise', () => {
    expect(changeText({ change: 0.82, t: 3.4, clears: true })).toBe('change +0.82, beyond the noise (t 3.4)')
    expect(changeText({ change: -0.1, t: -0.6, clears: false })).toBe('change -0.10, within the noise (t -0.6)')
    expect(changeText(null)).toBeNull()
  })

  it('the bars share one scale, rounded up to a half and at least 1, and grow from the middle', () => {
    const v = fctxRead(fctxAnswer())
    expect(barScale(v)).toBe(2)
    expect(barScale({ now: { state: 'short' }, then: { state: 'short' } })).toBe(1)
    expect(barOf(1, 2)).toEqual({ dir: 'pos', width: 25 })
    expect(barOf(-0.5, 1)).toEqual({ dir: 'neg', width: 25 })
    expect(barOf(5, 2)).toEqual({ dir: 'pos', width: 50 })
    expect(barOf(0, 2)).toEqual({ dir: null, width: 0 })
    expect(barOf(null, 2)).toEqual({ dir: null, width: 0 })
  })

  it('the table rows: every factor in either window with its sign meaning and the change', () => {
    const v = fctxRead(fctxAnswer())
    const rows = factorRows(v)
    expect(rows.map((r) => r.key)).toEqual(['market', 'size', 'growth', 'momentum', 'quality', 'lowvol'])
    expect(signMeaning(rows[2])).toBe('+ growth, - value')
    expect(signMeaning(rows[1])).toBe('+ small caps, - large caps')
    expect(signMeaning(rows[0])).toBeNull()
    expect(rows[3].change.clears).toBe(true)
  })

  it('the basis names the loadings read and those too uncertain to read', () => {
    const v = fctxRead(fctxAnswer())
    expect(basisText(v.reading, METHOD)).toBe('Built only from the loadings with a t-statistic above 2: market, growth vs value, momentum. Too uncertain to read: size, quality, low volatility.')
    expect(basisText({ basis: [], uncertain: ['market', 'size'], exact: false }, METHOD)).toBe('No loading has a t-statistic above 2. Too uncertain to read: market, size.')
    expect(basisText({ basis: [], uncertain: [], exact: true }, METHOD)).toBe('An exact fit leaves nothing to test, so no loading is read.')
    expect(basisText(null, METHOD)).toBeNull()
  })

  it('the market against 1 and the constant say their uncertainty', () => {
    expect(marketVsOneText({ tVsOne: 5.1, side: 'more' }, METHOD)).toBe('t 5.1 against 1: more sensitive to the market than the S&P 500.')
    expect(marketVsOneText({ tVsOne: 0.4, side: 'same' }, METHOD)).toBe("t 0.4 against 1: not distinguishable from the S&P 500's own sensitivity.")
    expect(marketVsOneText({ tVsOne: -9, side: null }, METHOD)).toContain('under 2, so it is not read')
    expect(marketVsOneText({ tVsOne: null }, METHOD)).toBe('No t can be worked out (an exact fit).')
    expect(constantText({ yearlyPct: 21.4, dailyPct: 0.085, t: 1.3, clears: false }, METHOD)).toBe('+21.4% a year (+0.085% a day); t 1.3, too uncertain to read')
    expect(constantText({ yearlyPct: null }, METHOD)).toBe('n/a')
  })

  it('the fit pairs, now and a year earlier, and the warnings only when they apply', () => {
    const v = fctxRead(fctxAnswer())
    const now = Object.fromEntries(fitRows(v.now, METHOD).map(([label, value]) => [label, value]))
    expect(now['Explained by the factors']).toMatch(/^57\.1% of its daily variance \(R-squared 0\.57, adjusted 0\.56\)$/)
    expect(now['Its own part']).toBe('42.9%: moves the factors do not explain')
    expect(now['Largest variance inflation']).toMatch(/^1\.1 \(quality\), under 5$/)
    expect(now['Beta to the market alone']).toContain('holds the style spreads fixed')
    expect(fitThenRows(v.then).map(([label]) => label)).toEqual(['Explained by the factors', 'Its own part', 'Volatility, a year'])
    expect(fitRows({ state: 'short' }, METHOD)).toEqual([])
    expect(unstableText(v.now, METHOD)).toBeNull()
    const shaky = { ...v.now, unstable: true, maxVif: { key: 'momentum', value: 6.34 } }
    expect(unstableText(shaky, METHOD)).toBe('The factors overlap: the largest variance inflation factor is 6.3 (momentum), above 5, so these loadings are unstable: a small change in the sessions can move them a lot. Read them with care.')
    expect(checkText(v)).toBeNull()
    expect(checkText({ ...v, now: { ...v.now, check: ['2026-06-02'] } })).toContain('more than 40% on Jun 2, 2026')
  })

  it('a window under 252 sessions says so; the funds say an alternative and a factor left out', () => {
    expect(windowText({ state: 'ok', returns: 230, from: '2025-12-01', to: '2026-11-20', full: false }, METHOD))
      .toBe('230 sessions, Dec 1, 2025 to Nov 20, 2026: fewer than 252, above the 200 minimum')
    const b = fctxAnswer()
    b.factors[2] = { ...b.factors[2], state: 'substituted', funds: ['VUG', 'VTV'] }
    b.factors[3] = { ...b.factors[3], state: 'dropped', funds: null }
    b.fund_checks.push({ symbol: 'VUG', state: 'ok', closes: 563, first: '2024-09-04', last: '2026-11-20', full: true },
      { symbol: 'VTV', state: 'ok', closes: 563, first: '2024-09-04', last: '2026-11-20', full: true },
      { symbol: 'SPMO', state: 'not_held', closes: 0 })
    b.fund_checks.find((c) => c.symbol === 'MTUM').state = 'stale'
    b.fund_checks.find((c) => c.symbol === 'IWD').state = 'short'
    b.fund_checks.find((c) => c.symbol === 'IWD').needed = 201
    const v = fctxRead(b)
    const rows = fundRows(v)
    expect(rows[2].funds).toEqual(['VUG', 'VTV'])
    expect(fundStateText(rows[2])).toBe('stands in for IWF minus IWD, which is not held with enough history')
    expect(rows[2].held.map((h) => h.symbol)).toEqual(['VUG', 'VTV', 'IWF', 'IWD'])
    expect(rows[2].held[3].words).toMatch(/^only [\d,]+ closes \(needs 201\)$/)
    expect(fundStateText(rows[3])).toBe('left out: neither MTUM nor SPMO is held with enough history')
    expect(rows[3].held.map((h) => [h.symbol, h.ok])).toEqual([['MTUM', false], ['SPMO', false]])
    expect(rows[3].held[1].words).toBe('not held on this server')
    expect(rows[3].held[0].words).toMatch(/more than 10 days old$/)
    expect(rows[0].held).toEqual([{ symbol: 'SPY', words: '564 closes read, through Nov 20, 2026', ok: true }])
    expect(fundsNote(v)).toBe('Alternative funds used: VUG and VTV for IWF and IWD. Left out of the model, no fund held with enough history: momentum.')
    expect(fundsNote(fctxRead(fctxAnswer()))).toBeNull()
  })
})
