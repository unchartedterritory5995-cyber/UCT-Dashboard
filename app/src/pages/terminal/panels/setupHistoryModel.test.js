// SETH's pure half: the two answers -> the panel's views, and the words. Every value is invented
// (__fixtures__/setupHistoryFixture.js) in the routes' real shape.
import { describe, it, expect } from 'vitest'
import {
  SETH_CODE, SETH_HORIZONS, SETH_PHASES, SETH_URL, STOCK_COMPUTING_POLL_MS, STUDY_COMPUTING_POLL_MS, STUDY_WAITING_POLL_MS, HELD_POLL_MS,
  changeText, countText, cutLine, excessCell, hitText, phaseShort, pointsText, rangeText, sethRead, sethStockRead, sethStockUrl,
  signOf, signalPhaseText, stockLine, stockPollMs, studyLine, studyPollMs, tooFewText, universeLine,
} from './setupHistoryModel'
import { HINDSIGHT, setupHistoryAnswer, setupStockAnswer } from './__fixtures__/setupHistoryFixture'

describe('reading the study', () => {
  it('names the code, the routes and the horizons', () => {
    expect(SETH_CODE).toBe('SETH')
    expect(SETH_URL).toBe('/api/research/setup-history')
    expect(sethStockUrl('BRK.B')).toBe('/api/research/setup-history/BRK.B')
    expect(SETH_HORIZONS).toEqual([5, 20, 60])
    expect(SETH_PHASES).toEqual(['correction', 'after_low', 'uptrend', 'all'])
  })

  it('reads every setup with its four phase groups in order, each horizon with the count it rests on', () => {
    const v = sethRead(setupHistoryAnswer())
    expect(v.state).toBe('ok')
    expect(v.setups.map((s) => s.id)).toEqual(['breakout', 'pullback_21ema', 'gap_up', 'reclaim_50'])
    const b = v.setups[0]
    expect(b.groups.map((g) => g.phase)).toEqual(SETH_PHASES)
    const c = b.groups[0].horizons[20]
    expect(c.n).toBe(609)
    expect(c.below).toBe(false)
    expect(typeof c.winRate).toBe('number')
    expect(v.minSignals).toBe(30)
    expect(v.phases.hindsight).toBe(HINDSIGHT)
    expect(v.universe.caveat).toContain("today's names against yesterday's prices")
    expect(v.window).toEqual({ from: '2028-06-06', to: '2031-06-06', firstDay: '2028-06-07', years: 3 })
    expect(v.dropped).toHaveLength(2)
  })

  it('a group under the floor keeps its count and has no rate, never a 0', () => {
    const v = sethRead(setupHistoryAnswer())
    const thin = v.setups[3].groups[0].horizons[20]
    expect(thin.n).toBe(18)
    expect(thin.below).toBe(true)
    expect(thin.winRate).toBeNull()
    expect(thin.avgPct).toBeNull()
    expect(thin.excessPct).toBeNull()
    expect(tooFewText(thin.n, v.minSignals)).toBe('Too few signals: 18 (30 needed).')
  })

  it('a capped setup says so; computing, waiting, unavailable and a wrong shape are each their own state', () => {
    expect(sethRead(setupHistoryAnswer({ capped: true })).setups[0]).toMatchObject({ state: 'capped', groups: [] })
    expect(sethRead({ status: 'computing' })).toEqual({ state: 'computing' })
    expect(sethRead({ status: 'waiting', detail: 'later' })).toEqual({ state: 'waiting', detail: 'later' })
    expect(sethRead({ status: 'unavailable', reason: 'index_not_held' })).toMatchObject({ state: 'unavailable', reason: 'index_not_held' })
    for (const b of [null, [], { status: 'ok' }, { status: 'nope' }]) expect(sethRead(b).state).toBe('failed')
  })

  it('asks again soon while building, slowly while waiting, and every half hour once held', () => {
    expect(studyPollMs({ state: 'computing' })).toBe(STUDY_COMPUTING_POLL_MS)
    expect(studyPollMs({ state: 'waiting' })).toBe(STUDY_WAITING_POLL_MS)
    expect(studyPollMs(sethRead(setupHistoryAnswer()))).toBe(HELD_POLL_MS)
  })
})

describe('reading one stock', () => {
  it('reads the signals newest first with their names and phases, and the universe line per setup and phase', () => {
    const v = sethStockRead(setupStockAnswer())
    expect(v.state).toBe('ok')
    expect(v.signals.map((r) => r.setup)).toEqual(['breakout', 'pullback_21ema', 'gap_up', 'reclaim_50'])
    expect(v.signals[0]).toMatchObject({ name: 'Breakout to a new 52-week high', phase: 'uptrend' })
    expect(v.signals[0].returns).toEqual({ 5: 2.31, 20: null, 60: null })
    expect(v.signals[3].phase).toBeNull()
    expect(v.universe.pairs.map((p) => p.key)).toEqual(['breakout|uptrend', 'pullback_21ema|after_low', 'gap_up|correction', 'reclaim_50|all'])
    expect(v.universe.pairs[3].horizons[20]).toMatchObject({ n: 12, below: true, winRate: null })
    expect(v.universe.note).toContain('survivorship')
  })

  it('a cut list says from which end; not held, computing and unavailable are their own states', () => {
    const v = sethStockRead(setupStockAnswer({ cut: true }))
    expect(v.cut).toBe('oldest')
    expect(cutLine(v)).toBe('Showing the newest 4 of 412; the oldest 408 are not shown.')
    expect(cutLine(sethStockRead(setupStockAnswer()))).toBeNull()
    expect(sethStockRead({ status: 'not_held', detail: 'none' })).toEqual({ state: 'not_held', detail: 'none' })
    expect(sethStockRead({ status: 'computing' }).state).toBe('computing')
    expect(sethStockRead({ status: 'failed', reason: 'busy' }).state).toBe('unavailable')
    expect(sethStockRead({ status: 'ok' }).state).toBe('failed')
  })

  it('the universe line says when the study is not held yet, and the panel asks again while it builds', () => {
    const waiting = sethStockRead(setupStockAnswer({ universe: 'waiting' }))
    expect(waiting.universe).toMatchObject({ state: 'waiting', pairs: [] })
    expect(stockPollMs(sethStockRead(setupStockAnswer({ universe: 'computing' })))).toBe(STUDY_COMPUTING_POLL_MS)
    expect(stockPollMs({ state: 'computing' })).toBe(STOCK_COMPUTING_POLL_MS)
    expect(stockPollMs(waiting)).toBe(HELD_POLL_MS)
  })
})

describe('the words', () => {
  it('signs, points, hit rates and ranges; a missing number is n/a, never 0', () => {
    expect(changeText(3.94)).toBe('+3.9%')
    expect(changeText(-12)).toBe('-12.0%')
    expect(changeText(null)).toBe('n/a')
    expect(pointsText(0.94)).toBe('+0.9 pts')
    expect(pointsText(-1.44)).toBe('-1.4 pts')
    expect(pointsText(0.01)).toBe('0.0 pts')
    expect(pointsText(null)).toBe('n/a')
    expect(hitText(57.6)).toBe('58%')
    expect(hitText(null)).toBe('n/a')
    expect(rangeText({ worstPct: -48.21, bestPct: 312 })).toBe('-48.2% / +312.0%')
    expect(signOf(0)).toBeNull()
    expect(signOf(-1)).toBe('down')
    expect(countText(12345)).toBe('12,345')
  })

  it('the same-day cell says why it is empty', () => {
    expect(excessCell({ excessPct: 0.42, matched: 120 })).toEqual({ text: '+0.4 pts', sign: 'up', sub: '120 matched' })
    expect(excessCell({ excessPct: null, excessWhy: 'no_unoccupied_cell' }).sub).toBe('no other stock moved alike that day')
    expect(excessCell({ excessPct: null, excessWhy: 'no_measurable_cell' }).sub).toBe('day move not measurable')
    expect(excessCell({ excessPct: null, excessWhy: 'below_floor' })).toEqual({ text: 'n/a', sign: null, sub: null })
  })

  it('the phases in short words, and a signal day with no phase said plainly', () => {
    expect(phaseShort('after_low')).toBe('First 3 months after a low')
    expect(phaseShort('all')).toBe('All days')
    expect(signalPhaseText(null)).toBe('No phase (outside the index history held)')
    expect(signalPhaseText('correction')).toBe('In a correction')
  })

  it('the ledes', () => {
    const v = sethRead(setupHistoryAnswer())
    expect(studyLine(v)).toBe('How 4 setups acted across 3,388 stocks from Jun 7, 2028 to Jun 6, 2031, by the S&P 500\'s phase on the signal day.')
    expect(universeLine(v)).toBe("3,390 of 3,412 stocks in UCT's stock universe ($300M market value and up), less the funds it lists have stored prices; 22 have none.")
    const s = sethStockRead(setupStockAnswer())
    expect(stockLine(s)).toBe('had 4 signals of the 4 setups over its held history (Mar 3, 2014 to Jun 6, 2031), newest first.')
    expect(stockLine({ ...s, total: 0 })).toBe('had no signal of the 4 setups in the prices UCT holds (Mar 3, 2014 to Jun 6, 2031).')
  })
})
