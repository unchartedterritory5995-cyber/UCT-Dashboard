// STAT's pure half: the route's answer -> the view, and every sentence the panel draws. Every number
// is invented (__fixtures__/stockStatsFixture.js) in the route's real shape.
import { describe, it, expect } from 'vitest'
import {
  COMPUTING_POLL_MS, HELD_POLL_MS, STAT_CODE, adrText, afterCell, atrText, avgVolumeText, betaText, captureText, changeText,
  correctionsLine, daysText, deepestLine, drawdownsLine, fellCell, highFirstCell, highLine, isComputing, moveCell, periodCell,
  pointsText, range52Text, realizedText, recoveredCell, relVolumeText, sectorLabel, shortText, statRead, statUrl, timesText,
} from './stockStatsModel'
import { STAT_OK, statAnswer } from './__fixtures__/stockStatsFixture'

const view = (body = statAnswer()) => statRead(body)

describe('reading the answer', () => {
  it('names the code and the one route, and asks again sooner only while the corrections are being worked out', () => {
    expect(STAT_CODE).toBe('STAT')
    expect(statUrl('BRK.B')).toBe('/api/research/stock-stats/BRK.B')
    expect(statUrl('A B')).toBe('/api/research/stock-stats/A%20B')
    expect(COMPUTING_POLL_MS).toBeLessThan(HELD_POLL_MS)
    const v = view()
    expect(v.state).toBe('ok')
    expect(isComputing(v)).toBe(false)
    const b = statAnswer()
    b.corrections = { state: 'computing', index: 'S&P 500', first: '2004-01-02', as_of: '2026-11-20' }
    expect(isComputing(view(b))).toBe(true)
    expect(isComputing({ state: 'busy' })).toBe(false)
  })

  it('every non-ok status is its own state, and anything else is a failed read', () => {
    expect(statRead({ status: 'not_held', detail: 'UCT holds no daily prices for ZZQA.' })).toEqual({ state: 'not_held', detail: 'UCT holds no daily prices for ZZQA.' })
    expect(statRead({ status: 'busy' })).toEqual({ state: 'busy', detail: null })
    expect(statRead({ status: 'unavailable', detail: 'x' }).state).toBe('unavailable')
    expect(statRead({ status: 'refused' }).state).toBe('unavailable')
    for (const b of [null, [], 'ok', { status: 'computing' }, {}]) expect(statRead(b).state).toBe('failed')
  })

  it('reads each section with its own as-of, and a missing number stays missing', () => {
    const v = view()
    expect([v.volatility.asOf, v.beta.asOf, v.returns.asOf, v.drawdowns.asOf, v.corrections.asOf]).toEqual(Array(5).fill('2026-11-20'))
    expect(v.dataThrough).toBe('2026-11-20')
    expect(v.volatility.atr).toEqual({ state: 'ok', period: 14, value: STAT_OK.volatility.atr.value, pct: STAT_OK.volatility.atr.pct })
    const b = statAnswer()
    b.volatility.atr = { state: 'ok', value: null }
    b.volatility.volume.rel = null
    b.returns.periods[0] = { key: '1W', label: '1 week', state: 'ok', return_pct: 'x' }
    const w = view(b)
    expect(w.volatility.atr.state).toBe('missing')
    expect(w.volatility.volume.rel).toBeNull()
    expect(w.returns.periods[0].state).toBe('missing')
  })
})

describe('too little history is words, never zero', () => {
  it('a block that needs more sessions, or prices back to a day, says which', () => {
    expect(shortText({ state: 'short', needed: 15, held: 9, unit: 'sessions' })).toBe('Needs 15 sessions; UCT holds 9.')
    expect(shortText({ state: 'short', needed: 200, held: 149, unit: 'returns' })).toBe('Needs 200 daily returns on days both traded; UCT holds 149.')
    expect(shortText({ state: 'short', neededFrom: '2025-11-20', heldFrom: '2026-02-03' })).toBe("Needs prices back to Nov 20, 2025; UCT's start Feb 3, 2026.")
    expect(shortText({ state: 'missing' })).toBe('Not in the answer.')
    const b = statAnswer()
    b.volatility.atr = { state: 'short', needed: 15, held: 9, unit: 'sessions' }
    b.volatility.range_52w = { state: 'short', needed: 252, held: 9, unit: 'sessions' }
    b.volatility.days_1y = { state: 'short', needed_from: '2025-11-20', held_from: '2026-02-03' }
    b.returns.periods[7] = { key: '5Y', label: '5 years', state: 'short', needed_from: '2021-11-20', held_from: '2026-02-03' }
    const v = view(b)
    expect(atrText(v.volatility.atr)).toBe('Needs 15 sessions; UCT holds 9.')
    expect(range52Text(v.volatility.range52)).toBe('Needs 252 sessions; UCT holds 9.')
    expect(daysText(v.volatility.days)).toContain('Needs prices back to Nov 20, 2025')
    expect(periodCell(v.returns.periods[7])).toEqual({ kind: 'short', text: 'n/a', sub: "Needs prices back to Nov 20, 2021; UCT's start Feb 3, 2026.", sign: null })
  })
})

describe('section 1: volatility and range', () => {
  const v = view().volatility
  it('says each number with its unit', () => {
    expect(atrText(v.atr)).toBe('$4.23 (3.20% of the close)')
    expect(realizedText(v.realized)).toBe('20 days 38.5%, 60 days 36.3%, annualized')
    expect(adrText(v.adr)).toBe('2.44% ($3.00) over 21 sessions')
    expect(range52Text(v.range52)).toBe('$89.32 to $181.17: 27.0% below the high, 48.1% above the low')
    expect(avgVolumeText(v.volume)).toBe('23.0M a day over 20 sessions, 24.3M over 50')
    expect(relVolumeText(v.volume)).toBe('0.5x on Nov 20, 2026 (11.1M shares), against the 30 sessions before')
    expect(daysText(v.days)).toBe('50.6% up, 48.6% down (127 and 122 of 251 sessions)')
  })
  it('volume that is not held is said', () => {
    expect(avgVolumeText({ avg20: null, avg50: null })).toBe('Not enough sessions with volume held.')
    expect(relVolumeText({ rel: null, relBase: 30 })).toBe('Needs 31 sessions with volume held.')
  })
})

describe('section 2: beta and correlation', () => {
  const b = view().beta
  it('beta and correlation against SPY and the sector fund, and the captures with their day counts', () => {
    expect(betaText(b.spy)).toMatch(/^\d+\.\d{2}, correlation -?\d\.\d{2}$/)
    expect(sectorLabel(b.sector)).toBe('Beta vs Technology (XLK)')
    expect(captureText(b.spy, 'up')).toMatch(/^\d+% \(on \d+ up days\)$/)
    expect(captureText(b.spy, 'down')).toMatch(/^\d+% \(on \d+ down days\)$/)
  })
  it('a fund, a stock with no sector, an unmapped sector and a fund not held each say so', () => {
    expect(betaText({ state: 'fund' })).toBe('A fund has no sector fund of its own.')
    expect(betaText({ state: 'no_sector' })).toBe('No sector is held for this stock.')
    expect(betaText({ state: 'not_mapped', sector: 'Shipping' })).toBe("Its sector (Shipping) has no sector fund in UCT's list.")
    expect(betaText({ state: 'not_held', symbol: 'SPY' })).toBe('UCT holds no prices for SPY on this server.')
    expect(sectorLabel({ state: 'fund', symbol: null })).toBe('Beta vs its sector fund')
    expect(betaText({ state: 'short', needed: 200, held: 12, unit: 'returns' })).toBe('Needs 200 daily returns on days both traded; UCT holds 12.')
    expect(captureText({ state: 'ok', upCapture: null, upDays: 4 }, 'up')).toBe('Too few up days for SPY (4).')
  })
  it('a benchmark read that failed says it could not be read just now and is tried again; a fund not held keeps its words', () => {
    const body = statAnswer()
    body.beta.spy = { symbol: 'SPY', state: 'unavailable', reason: 'read_failed' }
    body.beta.sector = { symbol: 'XLK', sector: 'Technology', state: 'unavailable', reason: 'read_failed' }
    const failed = view(body).beta
    expect(failed.spy).toEqual({ state: 'unavailable', symbol: 'SPY', sector: null })
    const spyWords = 'Prices for SPY could not be read just now. The server tries again on its own.'
    expect(betaText(failed.spy)).toBe(spyWords)
    expect(captureText(failed.spy, 'up')).toBe(spyWords)
    expect(captureText(failed.spy, 'down')).toBe(spyWords)
    expect(betaText(failed.sector)).toBe('Prices for XLK could not be read just now. The server tries again on its own.')
    expect(sectorLabel(failed.sector)).toBe('Beta vs Technology (XLK)')
    for (const p of [failed.spy, failed.sector]) expect(betaText(p)).not.toContain('holds no prices')
    body.beta.spy = { symbol: 'SPY', state: 'not_held' }
    const notHeld = view(body).beta.spy
    expect(betaText(notHeld)).toBe('UCT holds no prices for SPY on this server.')
    expect(captureText(notHeld, 'up')).toBe('UCT holds no prices for SPY on this server.')
  })
})

describe('section 3: returns', () => {
  const r = view().returns
  it('each period with its sign and the yearly rate on 3 and 5 years', () => {
    expect(periodCell(r.periods[0])).toEqual({ kind: 'value', text: '+5.0%', sign: 'up', sub: null })
    expect(periodCell(r.periods[4])).toEqual({ kind: 'value', text: '-9.9%', sign: 'down', sub: null })
    expect(periodCell(r.periods[6])).toEqual({ kind: 'value', text: '-27.8%', sign: 'down', sub: '-10.3% a year' })
  })
  it('a best or worst move says its day, or its week, and carries the mark', () => {
    expect(moveCell({ date: '2026-03-05', returnPct: 7.89, check: false })).toEqual({ text: '+7.9%', sign: 'up', check: false, sub: 'Mar 5, 2026' })
    expect(moveCell({ date: '2026-03-06', from: '2026-03-02', returnPct: -12.5, check: true }, true))
      .toEqual({ text: '-12.5%', sign: 'down', check: true, sub: 'week of Mar 2, 2026' })
    expect(moveCell(null).text).toBe('n/a')
  })
})

describe('section 4: its own drawdowns', () => {
  const d = view().drawdowns
  it('the summary, the deepest and how far below its high it is now', () => {
    expect(drawdownsLine(d, 'NVDA')).toMatch(/^12 declines of 20% or more since Jan 2, 2004\. Median depth -\d+\.\d%; median recovery [\d,]+ sessions from the low \(\d+ recovered\)\.$/)
    expect(deepestLine(d)).toMatch(/^Max drawdown -\d+\.\d%, \w{3} \d+, \d{4} to \w{3} \d+, \d{4}, (regained \w{3} \d+, \d{4}|not regained yet)\.$/)
    expect(highLine(d)).toMatch(/^Now \d+\.\d% below its highest close in the prices held \(\$[\d,.]+ on \w{3} \d+, \d{4}\)\.$/)
    expect(highLine({ high: { close: 50, date: '2026-11-20', fromHighPct: 0 } })).toBe('At its highest close in the prices held ($50.00).')
    expect(drawdownsLine({ total: 0, minDepthPct: 20, first: '2026-01-05' }, 'ZZQA')).toBe('No decline of 20% or more in ZZQA since Jan 5, 2026 in the prices UCT holds.')
  })
  it('one not regained yet says how far below the peak it is now', () => {
    expect(recoveredCell({ ongoing: true, recovered: null, belowNowPct: -12.34 })).toEqual({ main: 'Not yet', sub: 'now -12.3% from the peak' })
    expect(recoveredCell({ ongoing: false, recovered: '2024-04-30', sessionsToRecover: 57 })).toEqual({ main: 'Apr 30, 2024', sub: '57 sessions from the low' })
  })
})

describe('section 5: every market correction', () => {
  const c = view().corrections
  it('the summary line counts falls, highs and the months after', () => {
    expect(correctionsLine(c, 'NVDA')).toBe('In 18 S&P 500 declines of 10% or more inside NVDA\'s history, it fell less than the index in 0 and more in 18 (median 1.8x as far). '
      + 'It was back at its 52-week high before the index regained its peak in 10 of 17. It beat the index in the 3 months after the low in 12 of 18 (median +10.6 pts).')
    expect(correctionsLine({ summary: { count: 0 }, first: '2026-01-05' }, 'ZZQA')).toBe("No S&P 500 correction or bear market falls inside ZZQA's price history (from Jan 5, 2026).")
  })
  it('each cell in words', () => {
    const e = (stock) => ({ stock: { drawdownPct: -52.06, ratio: 2.03, newHigh: {}, after: {}, ...stock } })
    expect(fellCell(e({}))).toEqual({ main: '-52.1%', sub: '2.0x the index' })
    expect(highFirstCell(e({ newHigh: { state: 'first', lead: 41, date: '2024-06-07' } }))).toEqual({ kind: 'yes', main: 'Yes', sub: '41 sessions before the index' })
    expect(highFirstCell(e({ newHigh: { state: 'first', lead: null, date: '2024-06-07' } })).sub).toBe('on Jun 7, 2024, index not back yet')
    expect(highFirstCell(e({ newHigh: { state: 'after', lead: -6 } }))).toEqual({ kind: 'no', main: 'No', sub: '6 sessions after the index' })
    expect(highFirstCell(e({ newHigh: { state: 'same_day', date: '2024-06-07' } })).main).toBe('Same day')
    expect(highFirstCell(e({ newHigh: { state: 'index_only' } }))).toEqual({ kind: 'no', main: 'No', sub: 'not back yet' })
    expect(highFirstCell(e({ newHigh: { state: 'neither' } })).main).toBe('Not yet')
    expect(highFirstCell(e({ newHigh: { state: 'short' } })).sub).toBe('under a year of prices before the peak')
    expect(afterCell(e({ after: { state: 'ok', returnPct: 30.17, indexReturnPct: 15.23 } }))).toEqual({ kind: 'value', main: '+30.2%', sign: 'up', sub: 'index +15.2%' })
    expect(afterCell(e({ after: { state: 'not_yet', months: 3 } }))).toEqual({ kind: 'notyet', main: 'Not yet', sub: '3 months have not passed', sign: null })
    expect(afterCell(e({ after: { state: 'gap' } })).main).toBe('n/a')
  })
})

describe('the shared words', () => {
  it('signs, points and multiples', () => {
    expect(changeText(0)).toBe('+0.0%')
    expect(changeText(null)).toBe('n/a')
    expect(pointsText(13)).toBe('+13.0 pts')
    expect(pointsText(-0.01)).toBe('0.0 pts')
    expect(pointsText(null)).toBe('n/a')
    expect(timesText(1.52)).toBe('1.5x')
    expect(timesText(12.3)).toBe('12x')
    expect(timesText(null)).toBe('n/a')
  })
})
