// MOST MINE (wave 3 lane 13, #6): the movers list narrowed to the member's own names, the chip that
// writes MINE back into the command, and the empty answer that says how "your names" is built.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

const clock = vi.hoisted(() => ({ state: { isOpen: true, isPremarket: false, isExtended: false, isHalfDay: false } }))
const live = vi.hoisted(() => ({ prices: {}, asked: [] }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => clock.state }))
vi.mock('../../../hooks/useLivePrices', () => ({
  default: (tickers) => { live.asked.push(tickers); return { prices: live.prices, isLoading: false, error: null } },
}))

import MoversPanel, { moversCommand } from './MoversPanel'
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

const MY_SETS = { watchlist: ['CCC'], flagged: ['eee'], positions: [], uct20: [] }

describe('MOST MINE', () => {
  it('lists only the member\'s names when MINE is on', async () => {
    ok({ '/api/calendar/my-sets': MY_SETS })
    renderPanel({ mine: true })
    await screen.findByTestId('terminal-movers-table')
    expect(symsInTable()).toEqual(['CCC', 'EEE'])
    expect(screen.getByTestId('terminal-movers-mine').getAttribute('aria-pressed')).toBe('true')
  })

  it('without MINE every mover is listed and the chip is off (and my-sets is never read)', async () => {
    ok({ '/api/calendar/my-sets': MY_SETS })
    renderPanel()
    await screen.findByTestId('terminal-movers-table')
    expect(symsInTable()).toEqual(['AAA', 'CCC', 'BBB', 'EEE'])
    expect(screen.getByTestId('terminal-movers-mine').getAttribute('aria-pressed')).toBe('false')
    expect(globalThis.fetch.mock.calls.map((c) => String(c[0]))).not.toContain('/api/calendar/my-sets')
  })

  it('the chip writes MINE into this panel\'s command, keeping the lens', async () => {
    ok({ '/api/calendar/my-sets': MY_SETS })
    const onRun = vi.fn()
    renderPanel({ lens: 'up', onRun })
    await screen.findByTestId('terminal-movers-table')
    fireEvent.click(screen.getByTestId('terminal-movers-mine'))
    expect(onRun).toHaveBeenCalledWith('MOST UP MINE', { here: true })
    expect(moversCommand('all', false)).toBe('MOST')
    expect(moversCommand('volume', true)).toBe('MOST RVOL MINE')
  })

  it('none of yours moving says so, and how "your names" is built', async () => {
    ok({ '/api/calendar/my-sets': { watchlist: ['ZZZ'], flagged: [], positions: [], uct20: [] } })
    renderPanel({ mine: true })
    const empty = await screen.findByText('Nothing of yours is on the movers list right now.')
    expect(empty.closest('[data-testid="terminal-movers-mine-empty"]').textContent).toMatch(/your watchlists/)
  })
})
