// Notebook simplify, task 1: on the Notebook, on the desktop tier, the Journal header is the six section tabs and
// Help only, and the page title reads "Notebook". Every other Journal page, and the touch tier, keep today's header.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../context/AuthContext', () => ({
  useIsPaid: () => true,
  useAuth: () => ({ isPaid: true }),
}))
vi.mock('./hooks/useJ2Settings', () => ({
  default: () => ({
    settings: { setups: [] }, isLoading: false, error: null, save: vi.fn(),
    accountName: 'Default', noSpecificAccount: false,
  }),
}))
vi.mock('./hooks/useBrokerSync', () => ({ default: () => {} }))
vi.mock('./hooks/useInstantFills', () => ({ default: () => {} }))
vi.mock('./components/accounts/AccountSelector', () => ({
  default: () => <div data-testid="account-selector" />,
}))
vi.mock('./components/PortfolioSettingsModal', () => ({ default: () => null }))
vi.mock('./components/accounts/NewAccountModal', () => ({ default: () => null }))
vi.mock('./components/GenerateReportModal', () => ({ default: () => null }))
vi.mock('./components/ShortcutCheatSheet', () => ({ default: () => null }))
vi.mock('./hooks/useJ2SelectedAccount', () => ({
  default: () => ({
    accountId: 'a1', account: { id: 'a1', name: 'Default' }, accounts: [{ id: 'a1', name: 'Default' }],
    setAccount: vi.fn(), isLoading: false,
  }),
}))
vi.mock('./components/AddPositionModal', () => ({ default: () => null }))
vi.mock('./components/AddTradeModal', () => ({ default: () => null }))

import JournalLayout from './JournalLayout'

// useMediaQuery seeds from matchMedia at mount: answer the desktop query true, everything else false.
function setViewport(desktop) {
  window.matchMedia = (q) => ({
    matches: desktop && /min-width:\s*1025px/.test(String(q)) && !/max-width/.test(String(q)),
    media: String(q), onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false },
  })
}

function renderAt(route) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/journal" element={<JournalLayout />}>
          <Route index element={<div />} />
          <Route path="notebook" element={<div />} />
          <Route path="notebook/research/:symbol" element={<div />} />
          <Route path="trades" element={<div />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const LOG = () => screen.queryByRole('button', { name: /log trade/i })
const REPORT = () => screen.queryByRole('button', { name: 'Generate report' })
const GEAR = () => screen.queryByRole('button', { name: 'Open Portfolio Settings' })
const MORE = () => screen.queryByRole('button', { name: 'More' })
const HELP = () => screen.queryByRole('button', { name: 'Help' })
const ACCOUNT = () => screen.queryByTestId('account-selector')

let original
beforeEach(() => {
  original = window.matchMedia
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})
afterEach(() => { window.matchMedia = original })

describe('quiet Journal header on the desktop Notebook', () => {
  it('shows the six section tabs and Help only; the title reads Notebook', () => {
    setViewport(true)
    renderAt('/journal/notebook')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Notebook$/)
    expect(HELP()).not.toBeNull()
    expect(LOG()).toBeNull()
    expect(ACCOUNT()).toBeNull()
    expect(REPORT()).toBeNull()
    expect(GEAR()).toBeNull()
    expect(MORE()).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Journal sections' }).querySelectorAll('a,button')).toHaveLength(6)
  })

  it('a sub-route of the Notebook is quiet too', () => {
    setViewport(true)
    renderAt('/journal/notebook/research/NVDA')
    expect(LOG()).toBeNull()
    expect(GEAR()).toBeNull()
  })

  it('CONTROL: off the Notebook the header is unchanged and the title stays Trade Journal', () => {
    setViewport(true)
    renderAt('/journal/trades')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Trade Journal')
    for (const get of [LOG, ACCOUNT, REPORT, GEAR, MORE, HELP]) expect(get()).not.toBeNull()
  })

  it('CONTROL: on the touch tier the Notebook header keeps every control (the phone fold still has them)', () => {
    setViewport(false)
    renderAt('/journal/notebook')
    for (const get of [LOG, ACCOUNT, REPORT, GEAR, MORE, HELP]) expect(get()).not.toBeNull()
  })
})
