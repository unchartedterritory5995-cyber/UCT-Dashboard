// COV-12 / FT-067 — the congressional trades panel, asserted on rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import DepthTab from './DepthTab'
import CongressTradesPanel, { congressUrl } from './CongressTradesPanel'
import OwnershipTab from '../tabs/OwnershipTab'
import { AuthContext } from '../../../context/AuthContext'

vi.mock('../hooks/useOwnership', () => ({
  default: () => ({ data: { sym: 'AAPL', institutional: {}, short: {}, share_counts: {}, insider: [] }, isLoading: false, error: null, paywalled: false, mutate: () => {} }),
}))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false }) }))

const trade = (o) => ({
  chamber: 'house', chamber_label: 'House', symbol: 'AAPL', member: 'Jane Doe', district: 'CA11', owner: 'Spouse',
  type: 'Purchase', side: 'buy', amount: '$1,001 - $15,000', transaction_date: '2026-09-01', disclosure_date: '2026-09-20',
  lag_days: 19, link: 'https://disclosures-clerk.house.gov/x.pdf', ...o,
})
const OK = {
  ticker: 'AAPL', state: 'ok', source: 'STOCK Act periodic transaction reports, as served by FMP',
  basis: 'Members of Congress must disclose a trade within 45 days of making it, so a disclosure can arrive weeks after the trade.',
  chambers: { senate: { state: 'ok', rows: 1, at_cap: false }, house: { state: 'ok', rows: 1, at_cap: false } },
  trades: [
    trade({ disclosure_date: '2026-10-01', chamber: 'senate', chamber_label: 'Senate', member: 'Sam Senator', district: 'RI', type: 'Sale (Partial)', side: 'sell', amount: '$15,001 - $50,000' }),
    trade({}),
  ],
  counts: { buys: 1, sells: 1, other: 0, members: 2 }, newest_disclosure: '2026-10-01',
}
let body
beforeEach(() => {
  body = OK
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const wrap = (el) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{el}</SWRConfig>)
const renderTab = (flags = { congress_trades_enabled: true }) => wrap(<DepthTab sym="aapl" flags={flags} />)

describe('CongressTradesPanel', () => {
  it('is not rendered in Depth when its flag is off', () => {
    renderTab({ ftd_dataset_enabled: true })
    expect(screen.queryByTestId('congress-panel')).not.toBeInTheDocument()
  })

  it('reads its own route, lists both chambers newest disclosure first, ranges as filed, and states the lag', async () => {
    renderTab()
    const s = (await screen.findByTestId('congress-summary')).textContent
    expect(s).toContain('2 disclosed trades in AAPL by 2 members of Congress: 1 buy, 1 sale. Newest disclosure 2026-10-01.')
    const rows = screen.getAllByTestId('congress-row')
    expect(rows[0].textContent).toContain('Sam Senator (Senate · RI)')
    expect(rows[0].textContent).toContain('Sale (Partial)')
    expect(rows[0].textContent).toContain('$15,001 - $50,000')
    expect(rows[1].textContent).toContain('Jane Doe (House · CA11)')
    expect(screen.getAllByRole('link', { name: 'Report' })[0].getAttribute('href')).toMatch(/^https:/)
    expect(screen.getByTestId('congress-basis').textContent).toMatch(/within 45 days/)
    expect(global.fetch.mock.calls[0][0]).toBe(congressUrl('AAPL'))
    expect(congressUrl('AAPL')).toBe('/api/research/congress-trades/AAPL')
  })

  it('nothing disclosed reads as a sentence, never as a failure', async () => {
    body = { state: 'none_disclosed', reason: 'No congressional trades disclosed for AAPL in the Senate or House records FMP holds.', basis: 'b', source: 's' }
    renderTab()
    expect((await screen.findByTestId('congress-none')).textContent).toMatch(/^No congressional trades disclosed for AAPL/)
    expect(screen.queryByTestId('congress-unavailable')).toBeNull()
  })

  it('one chamber missing says which, keeps the other, and never reads as none', async () => {
    body = { ...OK, state: 'partial', reason: 'The House records could not be read just now, so this shows the other chamber only.', trades: [OK.trades[0]], counts: { buys: 0, sells: 1, other: 0, members: 1 } }
    renderTab()
    expect((await screen.findByTestId('congress-partial')).textContent).toMatch(/The House records could not be read just now/)
    expect(screen.getAllByTestId('congress-row')).toHaveLength(1)
    expect(screen.queryByTestId('congress-none')).toBeNull()
  })

  it('at the vendor cap it says older disclosures may be missing', async () => {
    body = { ...OK, chambers: { ...OK.chambers, senate: { state: 'ok', rows: 100, at_cap: true } } }
    renderTab()
    expect((await screen.findByTestId('congress-cap')).textContent).toMatch(/up to 100 disclosures per chamber/)
  })
})

// A failed read is an error with a working Retry, never an empty or "nothing disclosed" state.
describe('CongressTradesPanel — a failed read', () => {
  it('a 500 reads as unavailable with Retry, and Retry reads again', async () => {
    const good = body
    let calls = 0
    global.fetch = vi.fn(() => {
      calls += 1
      return calls === 1
        ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ detail: 'down' }) })
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(good) })
    })
    renderTab()
    const err = await screen.findByTestId('congress-unavailable')
    expect(err.textContent).toMatch(/unavailable right now/)
    expect(screen.queryByTestId('congress-none')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findAllByTestId('congress-summary')).not.toHaveLength(0)
  })

  it('both chambers failing on the server is an error with Retry, not "none"', async () => {
    body = { state: 'unavailable', reason: 'Neither the Senate nor the House records could be read just now.', basis: 'b', source: 's', trades: [] }
    renderTab()
    const err = await screen.findByTestId('congress-unavailable')
    expect(err.textContent).toMatch(/Neither the Senate nor the House records could be read just now\. That is not the same as no trades\./)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('a 404 says the switch is off, with no Retry', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ detail: 'Not Found' }) }))
    wrap(<CongressTradesPanel sym="aapl" />)
    expect((await screen.findByTestId('congress-off')).textContent).toMatch(/isn't switched on/)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })
})

describe('Ownership tab — beside insiders and 13F', () => {
  const ownership = (researchDepth) => wrap(
    <AuthContext.Provider value={{ researchDepth }}>
      <OwnershipTab sym="aapl" />
    </AuthContext.Provider>,
  )

  it('shows the congressional trades panel when its switch is on', async () => {
    ownership({ congress_trades_enabled: true })
    expect(await screen.findByTestId('congress-summary')).toBeInTheDocument()
  })

  it('shows nothing and reads nothing when it is off', () => {
    ownership({})
    expect(screen.queryByTestId('congress-panel')).toBeNull()
    expect(global.fetch.mock.calls.filter(([u]) => String(u).includes('congress'))).toHaveLength(0)
  })
})
