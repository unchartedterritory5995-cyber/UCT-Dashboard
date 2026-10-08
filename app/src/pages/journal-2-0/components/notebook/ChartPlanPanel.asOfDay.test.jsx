// @vitest-environment jsdom
// Finish program, lane FE, finding I4 — "what happened next" starts from the note's EASTERN
// trading day, the same day the chart block itself is frozen at.
//
// The panel used to floor the note's moment to a UTC day. A plan written at 9 pm Eastern is
// already "tomorrow" in UTC, so tomorrow's bar was shown as known context and a stop hit on
// the first session after the plan was never reported. Every case here is an EVENING one:
// a noon capture cannot tell the two implementations apart.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import * as panelModule from './ChartPlanPanel'
import { tsToAnchorDay } from './ChartEmbed'
import { etDayOf, todayET } from '../../lib/calendar'
import { _resetBoundAlertSync } from '../../../../components/chart/useBoundDrawingAlerts'

const ChartPlanPanel = panelModule.default
const { noteAsOfDay, windowAfterNote } = panelModule

vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: () => ({ setData: () => {}, update: () => {}, createPriceLine: () => {} }),
    timeScale: () => ({ setVisibleRange: () => {} }),
    remove: () => {},
  }),
  createSeriesMarkers: () => ({ setMarkers: () => {} }),
  CandlestickSeries: {}, LineStyle: { Dashed: 2 }, ColorType: { Solid: 'solid' },
}))
// ChartEmbed pulls the whole chart pane in; this file only wants its day function.
vi.mock('../../../../components/chart/pane/ChartPane', () => ({ default: () => null }))

const day = (t, o, h, l, c) => ({ t, o, h, l, c })
const attrsAt = (capturedAt, params = {}) => ({
  widgetId: 'chart', embedId: 'emb-1', params: { symbol: 'NVDA', tf: 'D', ...params },
  annotations: [], ta: null, capturedAt,
})

describe('the Eastern day of a moment — one authority (lib/calendar.js)', () => {
  it('an evening in summer and in winter both belong to the day the trader is living', () => {
    expect(etDayOf(Date.parse('2026-07-15T21:00:00-04:00'))).toBe('2026-07-15')   // 01:00Z on the 16th
    expect(etDayOf(Date.parse('2026-01-15T19:30:00-05:00'))).toBe('2026-01-15')   // 00:30Z on the 16th
    expect(etDayOf(Date.parse('2026-07-15T19:30:00-04:00'))).toBe('2026-07-15')   // control: not yet UTC midnight
  })

  it('across both daylight-saving changes of 2026', () => {
    // spring forward, 8 Mar 2026: Saturday evening is EST, Sunday evening is EDT
    expect(etDayOf(Date.parse('2026-03-08T04:30:00Z'))).toBe('2026-03-07')   // Sat 23:30 EST
    expect(etDayOf(Date.parse('2026-03-09T03:30:00Z'))).toBe('2026-03-08')   // Sun 23:30 EDT
    expect(etDayOf(Date.parse('2026-03-09T04:30:00Z'))).toBe('2026-03-09')   // Mon 00:30 EDT
    // fall back, 1 Nov 2026: Saturday evening is EDT, Sunday evening is EST
    expect(etDayOf(Date.parse('2026-11-01T03:30:00Z'))).toBe('2026-10-31')   // Sat 23:30 EDT
    expect(etDayOf(Date.parse('2026-11-02T04:30:00Z'))).toBe('2026-11-01')   // Sun 23:30 EST
    expect(etDayOf(Date.parse('2026-11-02T05:30:00Z'))).toBe('2026-11-02')   // Mon 00:30 EST
  })

  it('reads epoch seconds, epoch milliseconds and a day string; refuses rubbish', () => {
    const ms = Date.parse('2026-07-15T21:00:00-04:00')
    expect(etDayOf(ms / 1000)).toBe('2026-07-15')
    expect(etDayOf('2026-07-15T21:00:00')).toBe('2026-07-15')
    expect(etDayOf(NaN)).toBeNull()
    expect(etDayOf(undefined)).toBeNull()
    expect(etDayOf('soon')).toBeNull()
  })

  it('the chart block and "today" answer through the same function', () => {
    const ms = Date.parse('2026-01-15T19:30:00-05:00')
    expect(tsToAnchorDay(ms)).toBe(etDayOf(ms))
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T01:00:00Z'))
    expect(todayET()).toBe('2026-07-15')
    vi.useRealTimers()
  })
})

describe('the note’s as-of day', () => {
  it('a capture at 9 pm Eastern is that Eastern day, never the next one', () => {
    expect(noteAsOfDay(attrsAt('2026-03-13T01:00:00Z'))).toBe('2026-03-12')
  })
  it('params.to wins over the capture time, as a day string or as seconds', () => {
    expect(noteAsOfDay(attrsAt('2026-03-20T15:00:00Z', { to: '2026-03-12' }))).toBe('2026-03-12')
    expect(noteAsOfDay(attrsAt('2026-03-20T15:00:00Z', { to: Date.parse('2026-03-13T01:00:00Z') / 1000 }))).toBe('2026-03-12')
  })
  it('a chart that tracks now (to: null) has no as-of day', () => {
    expect(noteAsOfDay(attrsAt('2026-03-13T01:00:00Z', { to: null }))).toBeNull()
  })
})

describe('windowAfterNote — daily bars are compared by day', () => {
  const BARS = [
    day('2026-03-10', 100, 101, 99, 100),
    day('2026-03-11', 100, 101, 99, 100.5),
    day('2026-03-12', 100.5, 102, 100, 101.6),   // the evening plan was written after this close
    day('2026-03-13', 101.6, 102, 95, 96),        // the first session after it: the stop is hit
    day('2026-03-16', 96, 97, 94, 95),
  ]
  it('the first bar after an evening plan is the NEXT session', () => {
    const w = windowAfterNote(BARS, { day: '2026-03-12', sec: null, daily: true })
    expect(w.bars[w.startIdx - 1].t).toBe('2026-03-12')
    expect(w.bars[w.startIdx].t).toBe('2026-03-13')
  })
  it('a weekend plan (Sunday evening of the spring change) starts on Monday', () => {
    const w = windowAfterNote(BARS, { day: '2026-03-15', sec: null, daily: true })
    expect(w.bars[w.startIdx - 1].t).toBe('2026-03-13')
    expect(w.bars[w.startIdx].t).toBe('2026-03-16')
  })
  it('says so when nothing has printed after the note, or no history reaches it', () => {
    expect(windowAfterNote(BARS, { day: '2026-03-16', sec: null, daily: true }).error).toMatch(/Nothing has printed/)
    expect(windowAfterNote(BARS, { day: '2026-03-01', sec: null, daily: true }).error).toMatch(/No bar history/)
    expect(windowAfterNote(BARS, { day: null, sec: null, daily: true }).error).toMatch(/tracks now/)
  })
  it('intraday bars keep the exact moment', () => {
    const t0 = Date.parse('2026-03-12T19:00:00Z') / 1000
    const bars = [0, 1, 2, 3].map((i) => ({ t: t0 + i * 1800, o: 1, h: 1, l: 1, c: 1 }))
    const w = windowAfterNote(bars, { day: '2026-03-12', sec: t0 + 1800 + 60, daily: false })
    expect(w.bars[w.startIdx].t).toBe(t0 + 3600)
  })
})

describe('through the replay itself', () => {
  const realFetch = global.fetch
  beforeEach(() => {
    _resetBoundAlertSync()
    global.fetch = vi.fn(async (url) => {
      const ok = (data) => ({ ok: true, status: 200, json: async () => data })
      if (url === '/api/j2/chart-plan/size') {
        return ok({ plan: { entry: 101.5, stop: 97, target: 120, shares: null, side: 'long', roles: {}, setup: null }, account: null, compass: null })
      }
      if (String(url).startsWith('/api/bars/')) {
        return ok({ bars: [
          day('2026-03-11', 100, 101, 99, 100.5),
          day('2026-03-12', 100.5, 102, 100, 101.6),
          day('2026-03-13', 101.6, 102, 95, 96),
          day('2026-03-16', 98, 99, 97.5, 98.5),   // stays above the stop: only the 13th hits it
        ] })
      }
      return ok([])
    })
  })
  afterEach(() => { global.fetch = realFetch; vi.useRealTimers() })

  // The answer for an evening plan must not depend on WHEN the member opens the replay. The
  // note and the bars are fixed in March 2026; only "now" moves. Each instant is the wall
  // clock, faked for Date alone (timers stay real, so findBy still polls): the hours of an
  // Eastern day around the 9 pm the test is about, and a day either side of both 2026
  // daylight-saving changes. (Landing, 2026-10-07: this test failed once in a full-suite
  // run between 8 and 9 pm Eastern and passed alone; the matrix is what says whether the
  // hour had anything to do with it.)
  const NOWS = [
    ['10:00 Eastern', '2026-10-07T14:00:00Z'],
    ['16:30 Eastern', '2026-10-07T20:30:00Z'],
    ['20:30 Eastern', '2026-10-08T00:30:00Z'],
    ['21:00 Eastern', '2026-10-08T01:00:00Z'],
    ['23:30 Eastern', '2026-10-08T03:30:00Z'],
    ['00:30 Eastern', '2026-10-08T04:30:00Z'],
    ['the day before the spring change, 9 pm', '2026-03-08T02:00:00Z'],
    ['the day of the spring change, 9 pm', '2026-03-09T01:00:00Z'],
    ['the day after the spring change, 9 pm', '2026-03-10T01:00:00Z'],
    ['the day before the autumn change, 9 pm', '2026-11-01T01:00:00Z'],
    ['the day of the autumn change, 9 pm', '2026-11-02T02:00:00Z'],
    ['the day after the autumn change, 9 pm', '2026-11-03T02:00:00Z'],
    ['the evening the plan was written', '2026-03-13T01:30:00Z'],
    ['the next session, mid-morning', '2026-03-13T15:00:00Z'],
  ]
  it.each(NOWS)('opened at %s: the stop hit on the first session after the plan is reported', async (_label, now) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ChartPlanPanel attrs={attrsAt('2026-03-13T01:00:00Z')} noteId="n1" open={false} replayOpen
          onCloseReplay={vi.fn()} updateAttributes={vi.fn()} />
      </SWRConfig>,
    )
    expect(await screen.findByText('At the note — step forward')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Step forward one bar' }))
    expect(await screen.findByText('1 bar after the note · stop hit')).toBeInTheDocument()
  })

  it('a stop hit on the first session after a 9 pm Eastern plan IS reported', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ChartPlanPanel attrs={attrsAt('2026-03-13T01:00:00Z')} noteId="n1" open={false} replayOpen
          onCloseReplay={vi.fn()} updateAttributes={vi.fn()} />
      </SWRConfig>,
    )
    expect(await screen.findByText('At the note — step forward')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Step forward one bar' }))
    expect(await screen.findByText('1 bar after the note · stop hit')).toBeInTheDocument()
  })
})
