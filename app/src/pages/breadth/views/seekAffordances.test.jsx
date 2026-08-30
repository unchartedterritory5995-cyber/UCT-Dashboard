/**
 * "All sixteen views" is a claim, so this file measures it.
 *
 * Two facts have to stay true together, and only one of them is checkable by
 * looking at a single view:
 *
 *   1. every view that puts a per-session mark on screen offers it to the
 *      cursor — a date the reader can see but not reach is the dead text this
 *      whole wave exists to remove;
 *   2. every view that does NOT plot a session leaves the cursor alone — a
 *      fabricated affordance on a snapshot board (Rings, Tug, Meters, Radar,
 *      Treemap, Levels all render ONE row) is worse than none, because it
 *      teaches the reader that the tab's dates are unreliable.
 *
 * ⛔ THE ROSTER BELOW IS THE DECLARATION, AND IT IS CHECKED AGAINST `STYLES`
 * rather than trusted: a seventeenth style cannot land in either set silently,
 * and a view that gains or loses a mark fails by name.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

vi.mock('echarts-for-react', () => ({
  default: ({ option }) => <div data-testid="echart" data-series={JSON.stringify(option?.series?.length ?? 0)} />,
}))

const swrState = vi.hoisted(() => ({ data: null }))
vi.mock('swr', () => ({
  default: () => ({ data: swrState.data, isLoading: false, error: null }),
}))

import { STYLES, VIEW_CONFIG, optionDefaults } from './viewMetricConfig'
import { VIEW_COMPONENTS } from './viewRegistry'
import { SEEK_OUT_OF_WINDOW } from './breadthViewShared'
import { HM_METRICS } from '../heatmapMetrics'

const METRICS = HM_METRICS.filter(m => !m.isHeader)

// Real dates, newest-first, deep enough for every lens' own minimum.
const rows = Array.from({ length: 60 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 7, 28) - i * 86400000)
  return {
    date: day.toISOString().slice(0, 10),
    breadth_score: 50 + (i % 20), uct_exposure: 60, pct_above_5sma: 40 + (i % 30),
    pct_above_10sma: 45, pct_above_20ema: 50, pct_above_40sma: 52, pct_above_50sma: 40 + (i % 25),
    pct_above_100sma: 55, pct_above_200sma: 60, up_4pct_today: 30, down_4pct_today: 12,
    up_20pct_5d: 8, down_20pct_5d: 3, up_25pct_quarter: 40, down_25pct_quarter: 10,
    up_50pct_month: 5, down_50pct_month: 2, magna_up: 60, magna_down: 20,
    stage2_count: 300, stage4_count: 90, new_52w_highs: 40, new_52w_lows: 9,
    new_20d_highs: 120, new_20d_lows: 30, new_ath: 20, hvc_52w: 30, atr_ext_7: 12,
    advancing: 3000, declining: 1500, up_from_open: 2800, down_from_open: 1700,
    up_on_volume: 2000, down_on_volume: 1200, adv_decline: 1500, adv_decline_cum: 10000,
    up_vol_ratio: 1.8, ratio_5day: 1.4, ratio_10day: 1.2, hi_ratio: 1.2, lo_ratio: 0.3,
    sp500_close: 5000 + i * 3, qqq_close: 400 + i, spy_day_pct: 0.4, qqq_day_pct: 0.5,
    vix: 15 + (i % 6), vxn: 20, mcclellan_osc: 30 - i, cnn_fear_greed: 55,
    aaii_spread: 5, cboe_putcall: 0.8, universe_count: 5000, near_52w_high: 40,
    rsp_spy_ratio: 0.62 + i * 0.001, iwm_qqq_ratio: 0.55 + i * 0.001, is_ftd: 0,
    spy_above_10sma: 1, spy_above_20sma: 1, spy_above_50sma: 1, spy_above_200sma: 1,
    qqq_above_10sma: 1, qqq_above_20sma: 1, qqq_above_50sma: 1, qqq_above_200sma: 1,
  }
})
const WINDOW_DATES = new Set(rows.map(r => r.date))

// The Event Ledger's date is its "Last fired …" line, and that line only exists
// when a named event fired EARLIER in the window — the exact dead text this
// wave was built to remove. So its fixture puts a 90%-up-volume day five
// sessions back rather than today.
// `up_vol_ratio` is up volume / DOWN volume, so a 90% up-volume day needs a
// ratio of 9 or better — see `breadthEvents.upVolShare`.
const EVENT_ROWS = rows.map((r, i) => (i === 5 ? { ...r, up_vol_ratio: 20 } : r))
const rowsFor = (style) => (style === 'events' ? EVENT_ROWS : rows)

// Server-backed lenses. Both name a date: attribution its prior session (inside
// the window), the deck its historical matches (one in, one deliberately out).
const SERVED = {
  ok: true, date: rows[0].date, total: 80, min_weight_met: true,
  components: [{ key: 'vix', label: 'VIX (inverted)', weight: 10, points: 9, max_points: 10, present: true }],
  prev: { date: rows[1].date, total: 70,
          components: [{ key: 'vix', label: 'VIX (inverted)', weight: 10, points: 4, max_points: 10, present: true }] },
  reference_date: rows[0].date,
  analogues: [
    { date: rows[5].date, similarity: 92.4, forward_returns: { fwd_20d: 4.5 } },
    { date: '2025-03-11', similarity: 88.1, forward_returns: { fwd_20d: -2.1 } },
  ],
}

/**
 * ⭐ THE DECLARED ANSWER TO "which of the sixteen has a date to seek to?".
 *
 * `NO_SESSION_MARK` is not a to-do list. Each of those six renders a single
 * row's snapshot: Rings/Meters/Radar/Levels draw today's readings, Tug draws
 * today's pairs, the Treemap draws today's tiles (its `prevRow` feeds an arrow,
 * not a plotted session). There is no per-session mark on any of them, so there
 * is nothing honest for a cursor to attach to.
 */
const SEEKABLE = ['timeline', 'scoreboard', 'ribbon', 'ladder',
                  'clock', 'divergence', 'rotation', 'events', 'attribution', 'analogues']
const NO_SESSION_MARK = ['treemap', 'rings', 'tug', 'meters', 'radar', 'equalizer']

// Only these five plot a SERIES the pointer can trace, so only these five carry
// a hover readout (spec §1). Every one of them must also be seekable.
const HOVER_READOUT = ['ribbon', 'timeline', 'scoreboard', 'clock', 'divergence']

const propsFor = (style, { onSeek, canSeek }) => {
  const options = optionDefaults(style)
  const rows = rowsFor(style)
  if (VIEW_CONFIG[style].kind === 'lens') {
    return { rows, currentRow: rows[0], prevRow: rows[3], rowIdx: 0,
             onDrill: () => {}, onSeek, canSeek, options }
  }
  return {
    currentRow: rows[0], prevRow: rows[3], recentRows: rows.slice(0, 30), rows, rowIdx: 0,
    metrics: METRICS, normalize: () => 62, onDrill: () => {}, onSeek, canSeek,
    signalKey: null, notableKey: null, options,
    pctileByKey: {}, visibleKeys: new Set(METRICS.map(m => m.key)),
  }
}

const renderStyle = (style, handlers) => {
  const Component = VIEW_COMPONENTS[style]
  return render(<Component {...propsFor(style, handlers)} />)
}

const openWindow = { onSeek: vi.fn(), canSeek: (t) => (typeof t === 'number' || WINDOW_DATES.has(t)) }

afterEach(() => { swrState.data = null; vi.clearAllMocks() })

describe('the seekable roster covers the registry', () => {
  it('every registered style is declared exactly once, in exactly one set', () => {
    const declared = [...SEEKABLE, ...NO_SESSION_MARK]
    expect(new Set(declared).size, 'a style is declared twice').toBe(declared.length)
    expect([...declared].sort()).toEqual([...STYLES].sort())
  })

  it('every view carrying a hover readout is also seekable', () => {
    for (const s of HOVER_READOUT) expect(SEEKABLE).toContain(s)
  })
})

describe('every view with a session on screen offers it to the cursor', () => {
  it.each(SEEKABLE)('%s renders at least one seek affordance', (style) => {
    swrState.data = SERVED
    const onSeek = vi.fn(() => true)
    const { container } = renderStyle(style, { onSeek, canSeek: openWindow.canSeek })
    const marks = container.querySelectorAll('[data-seek-date]')
    expect(marks.length, `"${style}" put no date within reach`).toBeGreaterThan(0)
  })

  it.each(SEEKABLE)('%s moves the cursor to the date it names', (style) => {
    swrState.data = SERVED
    const onSeek = vi.fn(() => true)
    const { container } = renderStyle(style, { onSeek, canSeek: openWindow.canSeek })
    // The first mark whose date the window can actually reach — the deck
    // deliberately also names one it cannot.
    const mark = [...container.querySelectorAll('[data-seek-date]')]
      .find(el => WINDOW_DATES.has(el.getAttribute('data-seek-date')))
    expect(mark, `"${style}" named no reachable date`).toBeTruthy()
    fireEvent.click(mark)
    expect(onSeek, `clicking a mark in "${style}" moved nothing`).toHaveBeenCalledTimes(1)
    expect(WINDOW_DATES.has(onSeek.mock.calls[0][0])).toBe(true)
  })
})

describe('a view with no session on screen invents nothing', () => {
  it.each(NO_SESSION_MARK)('%s offers no date affordance', (style) => {
    const onSeek = vi.fn()
    const { container } = renderStyle(style, { onSeek, canSeek: openWindow.canSeek })
    expect(container.querySelectorAll('[data-seek-date], [data-seek-idx]').length,
           `"${style}" grew a seek affordance — either it now plots sessions `
           + '(move it to SEEKABLE) or it is offering a date it does not have').toBe(0)
  })
})

/**
 * 🔴 A DEAD LINK IS THE FAILURE MODE, NOT A MISSING ONE.
 *
 * With a window that can reach nothing, every seek BUTTON on the tab must be
 * disabled and carry the reason — and every delegated mark must refuse the
 * click rather than call through. The sweep is over all sixteen styles so a
 * view added later is covered the day it lands.
 */
describe('an unreachable date is refused, visibly', () => {
  const closedWindow = { canSeek: () => false }

  it.each(STYLES)('%s renders no live-looking link when nothing is reachable', (style) => {
    swrState.data = SERVED
    const onSeek = vi.fn()
    const { container } = renderStyle(style, { onSeek, canSeek: closedWindow.canSeek })

    for (const btn of container.querySelectorAll('button[data-seek-date]')) {
      expect(btn.disabled, `"${style}" left an enabled seek button on an unreachable date`).toBe(true)
      expect(btn.getAttribute('title')).toBe(SEEK_OUT_OF_WINDOW)
    }
    for (const mark of container.querySelectorAll('[data-seek-date]')) {
      fireEvent.click(mark)
    }
    expect(onSeek, `"${style}" seeks a date it was told it could not reach`).not.toHaveBeenCalled()
  })

  it('and the Analogue Deck is genuinely in that sweep, with a real refusal', () => {
    swrState.data = SERVED
    const onSeek = vi.fn()
    // The window holds rows[5] but not 2025-03-11 — one live card, one dead.
    const { container } = renderStyle('analogues', { onSeek, canSeek: openWindow.canSeek })
    const live = container.querySelector(`button[data-seek-date="${rows[5].date}"]`)
    const dead = container.querySelector('button[data-seek-date="2025-03-11"]')
    expect(live.disabled).toBe(false)
    expect(dead.disabled).toBe(true)
    expect(dead.getAttribute('title')).toBe(SEEK_OUT_OF_WINDOW)
    expect(dead.textContent).toBe('2025-03-11')   // the date is still READABLE
    fireEvent.click(dead)
    expect(onSeek).not.toHaveBeenCalled()
  })
})

describe('hover readouts', () => {
  it.each(HOVER_READOUT)('%s reports the session under the pointer', (style) => {
    const onSeek = vi.fn()
    const { container } = renderStyle(style, { onSeek, canSeek: openWindow.canSeek })
    const readout = container.querySelector(`[data-testid="${style}-readout"]`)
    expect(readout, `"${style}" renders no readout element`).toBeTruthy()
    expect(readout.textContent).toBe('')                    // silent until hovered

    const mark = [...container.querySelectorAll('[data-seek-date]')]
      .find(el => WINDOW_DATES.has(el.getAttribute('data-seek-date')))
    fireEvent.mouseOver(mark)
    const date = mark.getAttribute('data-seek-date')
    expect(readout.textContent, `"${style}" hovered without naming the session`).toContain(date)
    expect(readout.textContent.length, 'the readout named a date and no value').toBeGreaterThan(date.length)
    expect(readout.style.opacity).toBe('1')

    fireEvent.mouseLeave(mark.closest('[data-testid$="-readout"]') ?? mark.parentElement)
    expect(readout.style.opacity).toBe('0')
  })

  it('a view without a series has no readout to render', () => {
    for (const style of NO_SESSION_MARK) {
      const { container } = renderStyle(style, { onSeek: vi.fn(), canSeek: openWindow.canSeek })
      expect(container.querySelector('[data-testid$="-readout"]'), `"${style}" grew a readout`).toBeNull()
    }
  })
})
