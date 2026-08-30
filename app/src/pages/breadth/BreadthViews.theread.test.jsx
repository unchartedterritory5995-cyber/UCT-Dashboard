/**
 * The Read, mounted on the real container.
 *
 * ⛔ `TheReadStrip.test.jsx` IS STRUCTURALLY BLIND TO A SEVERED WIRE — it
 * renders the strip itself, so it stays green whether or not anything on the
 * Views tab ever renders one. This file mounts `BreadthViews` and reads the
 * document, which is the only way to see that the strip is actually on screen,
 * that it is on screen in BOTH layouts, and that having it on screen costs no
 * request.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: vi.fn(), loading: false }),
  parsePref: (v) => v,
}))

import BreadthViews from './BreadthViews'

const N = 60
const ROWS = Array.from({ length: N }, (_, i) => ({
  date: new Date(Date.UTC(2026, 7, 28) - i * 86400000).toISOString().slice(0, 10),
  pct_above_50sma: 52.1 + i * 0.215, pct_above_200sma: 60, pct_above_5sma: 40,
  pct_above_10sma: 45, pct_above_20ema: 50, pct_above_40sma: 52, pct_above_100sma: 55,
  sp500_close: 5000 + (N - 1 - i) * 5, qqq_close: 400 + (N - 1 - i),
  breadth_score: 88 - i * 0.3, uct_exposure: 60, vix: 16 + i * 0.1, mcclellan_osc: 10,
  advancing: 3000, declining: 1500, up_vol_ratio: 1.8,
  new_52w_highs: 10 + i, new_52w_lows: 5 + i, up_4pct_today: 200, down_4pct_today: 90,
  is_ftd: i === 18 ? 1 : 0, rsp_spy_ratio: 0.62 + (N - 1 - i) * 0.0002,
  iwm_qqq_ratio: 0.55, vxn: 20,
}))

let fetchSpy
beforeEach(() => {
  localStorage.clear()
  fetchSpy = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }))
  globalThis.fetch = fetchSpy
})

const monitorCalls = () =>
  fetchSpy.mock.calls.filter(c => String(c[0]).includes('/api/breadth-monitor/'))

describe('The Read is on the Views tab', () => {
  it('renders above the visualization, with clauses, on a plain mount', () => {
    render(<BreadthViews rows={ROWS} onDrill={() => {}} />)
    const strip = screen.getByTestId('the-read')
    expect(strip.textContent).toContain('The Read')
    expect(screen.getByTestId('the-read-clause-regime').textContent).toContain('Distribution')
    expect(screen.getByTestId('the-read-clause-events').textContent).toContain('18 sessions ago')
  })

  it('is still there in compare mode — one read over four panes', () => {
    render(<BreadthViews rows={ROWS} onDrill={() => {}} />)
    fireEvent.click(screen.getByTestId('layout-compare'))
    expect(screen.getByTestId('compare-grid')).toBeTruthy()
    expect(screen.getByTestId('the-read')).toBeTruthy()
  })

  it('follows the cursor', () => {
    render(<BreadthViews rows={ROWS} onDrill={() => {}} />)
    const before = screen.getByTestId('the-read-clause-regime').textContent
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))
    expect(screen.getByTestId('the-read-clause-regime').textContent).not.toBe(before)
  })

  it('costs NO request — the whole tab mounts and asks for nothing', () => {
    // The default style is the Treemap; neither it nor the strip fetches. If
    // The Read ever grew a fetcher this is where a member would pay for it,
    // once per page view.
    render(<BreadthViews rows={ROWS} onDrill={() => {}} />)
    expect(screen.getByTestId('the-read')).toBeTruthy()
    expect(monitorCalls()).toHaveLength(0)
  })

  it('CONTROL: the same counter sees the lens that DOES fetch', () => {
    // Without this, "0 requests" above could be a spy that was never wired up.
    render(<BreadthViews rows={ROWS} onDrill={() => {}} />)
    cleanup()
    localStorage.setItem('uct.breadth.views.v2', JSON.stringify({
      viewStyle: 'attribution', byView: {}, layout: 'single',
    }))
    render(<BreadthViews rows={ROWS} onDrill={() => {}} />)
    expect(monitorCalls().length).toBeGreaterThan(0)
    expect(String(monitorCalls()[0][0])).toContain('/score-components/')
  })
})
