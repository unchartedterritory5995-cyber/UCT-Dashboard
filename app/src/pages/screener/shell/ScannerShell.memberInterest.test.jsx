// D-9 (UC-1) on the Screener: which loaded result rows the member already follows.
// Same harness as ScannerShell.test.jsx; the gate rides a real AuthContext value.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

const { META, SAVED, scanMock, metaMock } = vi.hoisted(() => ({
  META: {
    categories: [{ key: 'descriptive', label: 'Descriptive' }],
    filters: [{ key: 'price', label: 'Price', category: 'descriptive', type: 'range', allow_custom: true, presets: [{ label: 'Any' }] }],
    views: [{ key: 'overview', label: 'Overview', columns: ['ticker', 'company', 'price', 'chg_pct_1d'] }],
  },
  SAVED: { saved: [], starters: [], create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  scanMock: vi.fn(),
  metaMock: vi.fn(),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../hooks/useScreenerMeta', () => ({ default: metaMock }))
vi.mock('../hooks/useScreenerScan', () => ({ default: scanMock }))
vi.mock('../hooks/useSavedScreens', () => ({ default: () => SAVED }))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../components/TickerPopup', () => ({ default: ({ children }) => <span>{children}</span> }))
vi.mock('../../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ longPressProps: () => ({}), menu: null, closeMenu: () => {} }),
}))
vi.mock('../../../components/PatternFeedbackChip', () => ({ default: () => null }))

import ScannerShell from './ScannerShell'
import { AuthContext } from '../../../context/AuthContext'

const READY = { result: { total: 3, rows: [{ ticker: 'AAA', price: 10 }, { ticker: 'BBB', price: 20 }, { ticker: 'CCC', price: 30 }],
  page: 1, snapshot_date: '2026-08-21' }, isLoading: false, error: null }

let interest
beforeEach(() => {
  interest = { entities: { CCC: { because: ['uct20'] }, AAA: { because: ['flagged'] } } }
  global.fetch = vi.fn((url) => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(String(url).startsWith('/api/member/interest') ? interest : {}),
  }))
  scanMock.mockReset(); scanMock.mockReturnValue(READY)
  metaMock.mockReset(); metaMock.mockReturnValue({ meta: META, isLoading: false, error: undefined, retry: vi.fn() })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const mount = (on) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <AuthContext.Provider value={{ memberInterestSurfaces: { member_interest_screener_enabled: on } }}>
      <ScannerShell />
    </AuthContext.Provider>
  </SWRConfig>,
)
const interestCalls = () => global.fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/member/interest'))

describe('ScannerShell: member interest (D-9)', () => {
  it('gate off: no line and no /api/member/interest request', async () => {
    mount(false)
    await new Promise((r) => setTimeout(r, 25))
    expect(interestCalls()).toHaveLength(0)
    expect(screen.queryByTestId('member-interest-screener')).not.toBeInTheDocument()
  })

  it('gate on: names the followed rows in result order, with reasons; rows are not re-ordered', async () => {
    mount(true)
    const line = await screen.findByTestId('member-interest-screener')
    expect(line.textContent).toContain('You follow 2 names in these results: AAA (flagged by you); CCC (on the UCT 20).')
  })

  it('gate on, nothing followed: nothing renders', async () => {
    interest = { entities: {} }
    mount(true)
    await vi.waitFor(() => expect(interestCalls().length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 25))
    expect(screen.queryByTestId('member-interest-screener')).not.toBeInTheDocument()
  })
})
