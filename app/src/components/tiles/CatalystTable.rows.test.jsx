// WIRE's catalyst rail (CatalystTable, compact) publishes the rows the member sees (completeness
// audit 2026-10-07, column g): each visible row, in order, loads its name (`$SYM`); the names are
// the board list. Outside a terminal panel (the Dashboard's copies) nothing is published.
import { render, cleanup, act, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { AuthContext } from '../../context/AuthContext'
import { HubProvider } from '../../hub/HubContext'
import { _reset as resetCursors } from '../../hub/useHubCursor'
import { PanelListContext } from '../terminal'

vi.mock('../voice/ReadAloudButton', () => ({ default: () => null }))
import CatalystTable from './CatalystTable'

const json = (body, ok = true, status = 200) => Promise.resolve({ ok, status, json: () => Promise.resolve(body) })
const HEALTHY = {
  rows: [
    { ticker: 'AMD', tag: 'Gapper', grade: 'B', price: 150, gap_pct: -1.1, vol_x: 1.4, thesis_text: 'gap' },
    { ticker: 'NVDA', tag: 'Earnings', grade: 'A', price: 120, gap_pct: 3.2, vol_x: 2.1, thesis_text: 'beat' },
  ],
  market_date: '2026-09-11',
  refreshed_at: Math.floor(Date.now() / 1000),
}
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (u.startsWith('/api/catalysts/today')) return json(HEALTHY)
    if (u.startsWith('/api/catalysts/my-feedback')) return json({ items: {} })
    if (u.startsWith('/api/watchlists')) return json([])
    return json({})
  }))
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetCursors() })

async function mount(api) {
  stubFetch()
  const tile = <CatalystTable compact datePicker title="PRE MARKET MOVERS" />
  render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: null, plan: null }}>
        <HubProvider>
          {api ? <PanelListContext.Provider value={api}>{tile}</PanelListContext.Provider> : tile}
        </HubProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
  await act(async () => { await new Promise((r) => setTimeout(r, 250)) })
}

describe('WIRE catalyst rail rows', () => {
  it('one `$SYM` row per visible row in the rail\'s order (gainers first), the names as its list', async () => {
    const api = { publishRows: vi.fn(), publish: vi.fn(), openBoard: vi.fn(), codes: [{ code: 'GP', label: 'Chart' }], pageSize: 4 }
    await mount(api)
    expect(api.publishRows).toHaveBeenLastCalledWith(['$NVDA', '$AMD'])
    expect(api.publish).toHaveBeenLastCalledWith({ syms: ['NVDA', 'AMD'], label: 'PRE MARKET MOVERS' })
    expect(screen.getByTestId('catalysts-board-open')).toHaveTextContent('Open 2')
  })

  it('CONTROL: outside a terminal panel there is no "Board of" control and nothing to publish to', async () => {
    await mount(null)
    expect(document.querySelectorAll('[data-catalyst-row-id]').length).toBe(2)
    expect(screen.queryByTestId('catalysts-board')).toBeNull()
  })
})

describe('catalyst rail tickers load the linked panels (wave 3 #3)', () => {
  it('in a terminal panel a ticker runs `$SYM`; outside one it is the app ticker chip', async () => {
    const api = { run: vi.fn(), publishRows: vi.fn(), publish: vi.fn(), openBoard: vi.fn(), codes: [], pageSize: 4 }
    await mount(api)
    screen.getByRole('button', { name: 'Load AMD' }).click()
    expect(api.run).toHaveBeenCalledWith('$AMD')
    cleanup()
    await mount(null)
    expect(screen.queryByRole('button', { name: 'Load AMD' })).toBeNull()
  })
})
