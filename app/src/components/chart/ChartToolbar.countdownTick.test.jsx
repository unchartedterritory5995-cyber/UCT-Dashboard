// ⭐ THE BAR-CLOSE COUNTDOWN TICKS ALONE (2026-11-25, the next-row key task; ChartToolbar `BarCloseCountdown`).
//
// The countdown's once-a-second tick was state of the whole toolbar: every second, on every intraday chart, all of
// ChartToolbar rendered again with no prop changed, and with the countdown hidden too (`hideCountdown`). A chart
// switch's frame could wait behind it (the 40 ms breakdown: toolbar renders after the frame, no prop changed).
// The toolbar's renders are counted through a hook it calls once per render (`useUserDefinitions`, wrapped, not
// replaced).
//   1. shown: the countdown reads the time to the bar's close and steps once a second, and the toolbar does not render
//      again for it (before: once per tick);
//   2. hidden: no countdown, and the toolbar does not render again as the seconds pass (before: once per tick);
//   3. a daily chart shows no countdown;
//   4. a timeframe change restarts it on the new period, as before.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import ChartToolbar from './ChartToolbar'
import { mergeChartSettings } from './chartDefaults'
import { AuthContext } from '../../context/AuthContext'

const H = vi.hoisted(() => ({ renders: 0 }))
vi.mock('../../hooks/useUserDefinitions', async (orig) => {
  const real = await orig()
  return { ...real, useUserDefinitions: (...a) => { H.renders += 1; return real.useUserDefinitions(...a) } }
})

const toolbar = (tf, hideCountdown = false) => (
  <AuthContext.Provider value={{ isPaid: true, user: null, loading: false }}>
    <ChartToolbar activeTool="cursor" setActiveTool={() => {}} chartSettings={mergeChartSettings({})}
      onUpdateSettings={() => {}} tf={tf} hideCountdown={hideCountdown} />
  </AuthContext.Provider>
)
const shown = (c) => c.querySelector('[title="Time until bar closes"]')?.textContent ?? null
const tickSeconds = async (n) => { for (let i = 0; i < n; i++) await act(async () => { vi.advanceTimersByTime(1000) }) }

describe('the bar-close countdown ticks alone', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-24T15:00:17Z'))   // 17 s into a 1-minute bar and into a 5-minute bar
    H.renders = 0
  })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('1. shown: it reads the time to the close and steps once a second; the toolbar does not render for it', async () => {
    const { container } = render(toolbar('1'))
    await tickSeconds(0)
    expect(shown(container)).toBe('00:43')
    const settled = H.renders
    expect(settled).toBeGreaterThan(0)
    await tickSeconds(1)
    expect(shown(container)).toBe('00:42')
    await tickSeconds(4)
    expect(shown(container)).toBe('00:38')
    expect(H.renders - settled, 'toolbar renders for 5 ticks').toBe(0)
  })

  it('2. hidden: no countdown, and the seconds passing render nothing', async () => {
    const { container } = render(toolbar('5', true))
    await tickSeconds(0)
    const settled = H.renders
    await tickSeconds(5)
    expect(shown(container)).toBe(null)
    expect(H.renders - settled, 'toolbar renders for 5 seconds hidden').toBe(0)
  })

  it('3. a daily chart shows no countdown', async () => {
    const { container } = render(toolbar('D'))
    await tickSeconds(3)
    expect(shown(container)).toBe(null)
  })

  it('4. a timeframe change restarts it on the new period', async () => {
    const { container, rerender } = render(toolbar('1'))
    await tickSeconds(2)
    expect(shown(container)).toBe('00:41')
    rerender(toolbar('5'))
    await tickSeconds(0)
    expect(shown(container)).toBe('04:41')
    await tickSeconds(1)
    expect(shown(container)).toBe('04:40')
  })
})
