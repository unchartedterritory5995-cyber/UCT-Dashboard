// FREC MINE (wave 3 lane 13, product item #6): in a terminal panel the flow record's standouts and
// honest tape narrow to the member's own names; the chip writes `MINE` back into the panel's
// command; the public page never shows the chip and never reads the paid my-sets route.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'
import { PanelListContext, TerminalPanelContext } from '../components/terminal'
import FlowScoreboard from './FlowScoreboard'

vi.mock('../components/TickerPopup', () => ({ default: ({ children }) => <span>{children}</span> }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const pick = (sym, strike) => ({ sym, strike, cp: 'C', exp: '2026-11-20', grade: 'A', dateSaved: '2026-10-01', entry: 2, max_gain_pct: 10, current_gain_pct: 5, days_tracked: 3 })
const BOARD = {
  picks_tracked: 3, overall: {}, by_grade: [],
  recent_winners: [pick('NVDA', 150), pick('TSLA', 300)],
  recent_picks: [pick('NVDA', 150), pick('AMD', 90), pick('TSLA', 300)],
}
function serve(mySets) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn((url) => {
    calls.push(String(url))
    const body = String(url).includes('/api/calendar/my-sets') ? mySets
      : String(url).includes('/api/flow-scoreboard') ? BOARD : {}
    return Promise.resolve({ ok: true, status: 200, json: async () => body })
  }))
  return calls
}
function mount({ mine = false, inPanel = true } = {}) {
  const api = { publishRows: vi.fn(), publish: vi.fn(), openBoard: vi.fn(), codes: [], pageSize: 4, rerun: vi.fn() }
  const body = <FlowScoreboard embedded mine={mine} />
  render(
    <MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      {inPanel
        ? <PanelListContext.Provider value={api}><TerminalPanelContext.Provider value={{ code: 'FREC', density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider></PanelListContext.Provider>
        : body}
    </SWRConfig></MemoryRouter>,
  )
  return api
}
const tapeSyms = () => within(screen.getByRole('table', { name: 'Recent picks' })).getAllByRole('row').slice(1)
  .map((r) => r.textContent.match(/^[A-Z]+/)?.[0])

describe('FREC MINE', () => {
  it('the honest tape and the standouts list only the member\'s names', async () => {
    serve({ watchlist: ['NVDA'], flagged: ['AMD'], positions: [], uct20: [] })
    mount({ mine: true })
    await screen.findByRole('table', { name: 'Recent picks' })
    await screen.findByText(/your names only: 2 of them/)
    expect(tapeSyms()).toEqual(['NVDA', 'AMD'])
    expect(screen.queryByText('TSLA')).toBeNull()
    expect(screen.getByTestId('frec-mine').getAttribute('aria-pressed')).toBe('true')
  })

  it('the chip writes FREC MINE into this panel\'s command', async () => {
    serve({ watchlist: ['NVDA'], flagged: [], positions: [], uct20: [] })
    const api = mount()
    await screen.findByRole('table', { name: 'Recent picks' })
    expect(tapeSyms()).toEqual(['NVDA', 'AMD', 'TSLA'])
    fireEvent.click(screen.getByTestId('frec-mine'))
    expect(api.rerun).toHaveBeenCalledWith('FREC MINE')
  })

  it('none of yours on the tape says so and how "your names" is built', async () => {
    serve({ watchlist: ['ZZZ'], flagged: [], positions: [], uct20: [] })
    mount({ mine: true })
    const empty = await screen.findByTestId('frec-mine-empty')
    await within(empty).findByText('Nothing of yours is among the last 3 picks.')
    expect(empty.textContent).toMatch(/your watchlists/)
  })

  it('the public page shows no chip and never reads my-sets, even if asked for MINE', async () => {
    const calls = serve({ watchlist: ['NVDA'], flagged: [], positions: [], uct20: [] })
    mount({ mine: true, inPanel: false })
    await screen.findByRole('table', { name: 'Recent picks' })
    expect(screen.queryByTestId('frec-mine')).toBeNull()
    expect(tapeSyms()).toEqual(['NVDA', 'AMD', 'TSLA'])
    expect(calls.some((u) => u.includes('/api/calendar/my-sets'))).toBe(false)
  })
})
