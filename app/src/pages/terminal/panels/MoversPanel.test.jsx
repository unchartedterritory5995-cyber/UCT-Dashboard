// MOST — rendered text and real behaviour against a fake network. The three list routes are served
// by a fake `fetch`; the live store and the market clock are the only hooks stood in for (they poll
// a 2 s store and a 60 s clock, neither of which a test should wait on).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

const clock = vi.hoisted(() => ({ state: { isOpen: true, isPremarket: false, isExtended: false, isHalfDay: false } }))
const live = vi.hoisted(() => ({ prices: {}, asked: [] }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => clock.state }))
vi.mock('../../../hooks/useLivePrices', () => ({
  default: (tickers) => { live.asked.push(tickers); return { prices: live.prices, isLoading: false, error: null } },
}))

import MoversPanel from './MoversPanel'
import { CATALYSTS_URL, MOVERS_URL, VOLUME_URL, sessionOf } from './moversModel'

const MOVERS = { ripping: [{ sym: 'AAA', pct: '+12.50%' }, { sym: 'BBB', pct: '+4.00%' }], drilling: [{ sym: 'CCC', pct: '-8.25%' }] }
const CATALYSTS = { rows: [{ ticker: 'AAA', tag: 'Earnings', thesis_text: 'Beat and **raised** guidance.', gap_pct: 11, vol_x: 6.5, price: 50 }] }
const VOLUME = { active: true, rows: [
  { sym: 'AAA', price: 51, pct: 12, rvol: 4, rvol_day: 3.2, lit: true },
  { sym: 'EEE', price: 30, pct: -1.5, rvol: 5, rvol_day: 2.5, lit: true },
] }

const realFetch = globalThis.fetch
function serve(routes) {
  globalThis.fetch = vi.fn(async (url) => {
    const hit = routes[String(url)]
    if (hit === undefined) return new Response('{}', { status: 404 })
    if (typeof hit === 'number') return new Response('{"detail":"x"}', { status: hit })
    return new Response(JSON.stringify(hit), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}
const ok = (over = {}) => serve({ [MOVERS_URL]: MOVERS, [CATALYSTS_URL]: CATALYSTS, [VOLUME_URL]: VOLUME, ...over })

function renderPanel(props = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MoversPanel {...props} />
    </SWRConfig>,
  )
}
const symsInTable = () => within(screen.getByTestId('terminal-movers-table'))
  .getAllByRole('row').slice(1).map((r) => r.getAttribute('data-testid')?.replace('terminal-movers-row-', '')).filter(Boolean)

beforeEach(() => {
  clock.state = { isOpen: true, isPremarket: false, isExtended: false, isHalfDay: false }
  live.prices = {
    AAA: { price: 52.1, change_pct: 13.2, volume: 4_200_000 },
    BBB: { price: 7.5, change_pct: 4.1, volume: 300_000 },
    CCC: { price: 3.2, change_pct: -8.3, volume: 1_500_000 },
  }
  live.asked = []
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

describe('MOST', () => {
  it('lists every mover with last, % change, volume and volume vs average, and subscribes them live', async () => {
    ok()
    renderPanel()
    await screen.findByTestId('terminal-movers-table')
    expect(symsInTable()).toEqual(['AAA', 'CCC', 'BBB', 'EEE'])   // biggest move either way first
    const aaa = screen.getByTestId('terminal-movers-row-AAA')
    expect(aaa.textContent).toContain('52.10')
    expect(aaa.textContent).toContain('+13.20%')
    expect(aaa.textContent).toContain('4.2M')
    expect(aaa.textContent).toContain('3.2×')
    expect(screen.getByTestId('terminal-movers-row-BBB').textContent).toContain('300K')
    // a name with no figure says so with a dash, never 0×
    expect(screen.getByTestId('terminal-movers-row-BBB').textContent).toContain('—')
    expect(live.asked.at(-1)).toEqual(['AAA', 'BBB', 'CCC', 'EEE'])
    expect(screen.getByTestId('terminal-movers-session').textContent).toBe('Live')
  })

  it('lenses, sort and the price / volume floors change what is listed', async () => {
    ok()
    renderPanel()
    await screen.findByTestId('terminal-movers-table')
    // Wave 3 (MOST P2 #17, #13): the All lens says it sorts by the size of the move, and Last names its unit
    const pctHead = screen.getByTestId('terminal-movers-sort-pct').closest('th')
    expect(pctHead.getAttribute('aria-sort')).toBe('other')
    expect(pctHead.textContent).toMatch(/% Chg ▼ by size/)
    expect(screen.getByTestId('terminal-movers-sort-last').textContent).toBe('Last ($)')
    fireEvent.click(screen.getByTestId('terminal-movers-lens-down'))
    expect(symsInTable()).toEqual(['CCC', 'EEE'])
    expect(screen.queryByTestId('terminal-movers-by-size')).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-movers-lens-volume'))
    expect(symsInTable()).toEqual(['AAA', 'EEE'])
    fireEvent.click(screen.getByTestId('terminal-movers-lens-up'))
    expect(symsInTable()).toEqual(['AAA', 'BBB'])
    fireEvent.click(screen.getByTestId('terminal-movers-sort-pct'))
    expect(symsInTable()).toEqual(['BBB', 'AAA'])
    fireEvent.click(screen.getByTestId('terminal-movers-lens-all'))
    fireEvent.change(screen.getByTestId('terminal-movers-min-price'), { target: { value: '5' } })
    expect(symsInTable()).toEqual(['AAA', 'BBB', 'EEE'])
    fireEvent.change(screen.getByTestId('terminal-movers-min-volume'), { target: { value: '1000000' } })
    expect(symsInTable()).toEqual(['AAA'])
  })

  it('the lens a member typed (MOST DOWN) is the one it opens on', async () => {
    ok()
    renderPanel({ lens: 'down' })
    await screen.findByTestId('terminal-movers-table')
    expect(symsInTable()).toEqual(['CCC', 'EEE'])
    expect(screen.getByTestId('terminal-movers-lens-down').getAttribute('aria-pressed')).toBe('true')
  })

  it('a row click LOADS the name into the linked group (keepFunction), and row numbers publish the same', async () => {
    ok()
    const onRun = vi.fn()
    const onRows = vi.fn()
    renderPanel({ onRun, onRows })
    await screen.findByTestId('terminal-movers-table')
    fireEvent.click(screen.getByTitle('Load CCC into the linked panels'))
    expect(onRun).toHaveBeenCalledWith('$CCC', { keepFunction: true })
    expect(onRows).toHaveBeenLastCalledWith(['$AAA', '$CCC', '$BBB', '$EEE'])
  })

  it('the why link opens the catalyst board\'s story inline, and offers MOVE for the full one', async () => {
    ok()
    const onRun = vi.fn()
    renderPanel({ onRun })
    await screen.findByTestId('terminal-movers-table')
    expect(screen.queryByTestId('terminal-movers-why-BBB')).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-movers-why-AAA'))
    expect(screen.getByTestId('terminal-movers-thesis-AAA').textContent).toContain('Beat and raised guidance.')
    fireEvent.click(screen.getByText('Open AAA MOVE'))
    expect(onRun).toHaveBeenCalledWith('AAA MOVE', { next: true })
  })

  it('outside the regular session it never says Live, and names the basis it is showing', async () => {
    clock.state = { isOpen: false, isPremarket: true, isExtended: false }
    ok()
    renderPanel()
    await screen.findByTestId('terminal-movers-table')
    expect(screen.getByTestId('terminal-movers-session').textContent).toBe('Pre-market')
    expect(screen.getByTestId('terminal-movers').textContent).toContain("against yesterday's close")
    cleanup()
    clock.state = { isOpen: false, isPremarket: false, isExtended: false }
    ok()
    renderPanel()
    await screen.findByTestId('terminal-movers-table')
    expect(screen.getByTestId('terminal-movers-session').textContent).toBe('Last session')
    expect(screen.getByTestId('terminal-movers').textContent).toContain('not a live list')
  })

  it('after hours adds the after-hours column; the regular session does not show it', async () => {
    clock.state = { isOpen: false, isPremarket: false, isExtended: true }
    live.prices = { AAA: { price: 40, change_pct: 10, day_close: 40, ext_price: 42, ext_session: 'post', volume: 1e6 } }
    ok()
    renderPanel()
    await screen.findByTestId('terminal-movers-table')
    expect(screen.getByTestId('terminal-movers-sort-ah')).toBeTruthy()
    expect(screen.getByTestId('terminal-movers-row-AAA').textContent).toContain('+5.00%')
    expect(sessionOf(clock.state)).toBe('post')
  })

  it('a failed movers read is an error with a retry, not an empty tape; a 402 is a plan, not an outage', async () => {
    serve({ [MOVERS_URL]: 500, [CATALYSTS_URL]: CATALYSTS, [VOLUME_URL]: VOLUME })
    renderPanel()
    const err = await screen.findByTestId('terminal-movers-error')
    expect(err.textContent).toContain('could not be read just now')
    expect(err.textContent).toContain('not the same as a quiet tape')
    expect(screen.getByText('Retry')).toBeTruthy()
    cleanup()
    serve({ [MOVERS_URL]: 402 })
    renderPanel()
    expect((await screen.findByTestId('terminal-movers-error')).textContent).toContain('needs a paid plan')
    expect(screen.queryByText('Retry')).toBeNull()
  })

  it('a failed side source is NAMED and the list still renders from the rest', async () => {
    ok({ [VOLUME_URL]: 402, [CATALYSTS_URL]: 500 })
    renderPanel()
    await screen.findByTestId('terminal-movers-table')
    const text = screen.getByTestId('terminal-movers').textContent
    expect(text).toContain('The volume scanner needs a paid plan.')
    expect(text).toContain('The catalyst board could not be read just now.')
    expect(symsInTable()).toEqual(['AAA', 'CCC', 'BBB'])
  })

  it('an empty tape says so in words, and an over-tight filter says what to loosen', async () => {
    ok({ [MOVERS_URL]: { ripping: [], drilling: [] }, [CATALYSTS_URL]: { rows: [] }, [VOLUME_URL]: { active: true, rows: [] } })
    renderPanel()
    expect((await screen.findByTestId('terminal-movers-empty')).textContent).toContain('Nothing is on the movers list right now.')
    cleanup()
    ok()
    renderPanel()
    await screen.findByTestId('terminal-movers-table')
    fireEvent.change(screen.getByTestId('terminal-movers-min-volume'), { target: { value: '5000000' } })
    expect(screen.getByTestId('terminal-movers-empty').textContent).toContain('loosen the filters')
  })

  it('shows the loading skeleton while the first read is in flight', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {}))
    renderPanel()
    expect(screen.getByTestId('terminal-movers-loading')).toBeTruthy()
  })
})
