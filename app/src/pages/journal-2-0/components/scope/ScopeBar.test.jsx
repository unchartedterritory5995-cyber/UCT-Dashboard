import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useSearchParams } from 'react-router-dom'

// ── mocks (mock-prefixed so vi.mock hoisting can reference them) ──────────────
let mockAccountId = null
const mockSetAccount = vi.fn()
let mockAccounts = []

vi.mock('../../hooks/useJ2SelectedAccount', () => ({
  default: () => ({
    accountId: mockAccountId,
    account: null,
    accounts: mockAccounts,
    setAccount: mockSetAccount,
    isLoading: false,
  }),
}))

let mockSettings = { setups: [], mistakeTags: [], emotionTags: [] }
vi.mock('../../hooks/useJ2Settings', () => ({
  default: () => ({ settings: mockSettings, isLoading: false }),
}))

let mockIsTouch = false
vi.mock('../../../../hooks/useBreakpoint', () => ({
  useIsTouch: () => mockIsTouch,
}))

import ScopeBar from './ScopeBar'

// A probe that renders the live querystring so tests can assert URL writes.
function QsProbe() {
  const [params] = useSearchParams()
  return <div data-testid="qs">{params.toString()}</div>
}

function renderBar(props = {}, { route = '/journal' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ScopeBar surface="journal" {...props} />
      <QsProbe />
    </MemoryRouter>,
  )
}

// Emoji ranges (common blocks) — deliberately excludes basic punctuation/arrows
// so "·" and normal glyphs never false-positive.
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/u

beforeEach(() => {
  mockAccountId = null
  mockSetAccount.mockClear()
  mockAccounts = [
    { id: 'acc1', name: 'Robinhood' },
    { id: 'acc2', name: 'Fidelity' },
  ]
  mockSettings = {
    setups: ['VCP', 'Breakout'],
    mistakeTags: ['fomo', 'chasing'],
    emotionTags: ['calm'],
  }
  mockIsTouch = false
})

describe('ScopeBar — facets (desktop)', () => {
  it("renders the 6 facets for surface='journal'", () => {
    renderBar()
    // account · date · symbol · side · setup · tag
    expect(screen.getByLabelText('Account')).toBeInTheDocument()
    expect(screen.getByLabelText('From date')).toBeInTheDocument()
    expect(screen.getByLabelText('To date')).toBeInTheDocument()
    expect(screen.getByLabelText('Symbol starts-with filter')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Long' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Short' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Setup/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Tag/ })).toBeInTheDocument()
  })

  it('account dropdown lists All Accounts + each account', () => {
    renderBar()
    const select = screen.getByLabelText('Account')
    expect(within(select).getByText('All Accounts')).toBeInTheDocument()
    expect(within(select).getByText('Robinhood')).toBeInTheDocument()
    expect(within(select).getByText('Fidelity')).toBeInTheDocument()
  })

  it('typing a symbol writes sc_sym to the URL', async () => {
    const user = userEvent.setup()
    renderBar()
    await user.type(screen.getByLabelText('Symbol starts-with filter'), 'N')
    expect(screen.getByTestId('qs').textContent).toContain('sc_sym=N')
  })
})

describe('ScopeBar — date facet muting (Calendar)', () => {
  it('muted/disabled date inputs + explanatory note when dateApplies=false', () => {
    renderBar({ dateApplies: false })
    expect(screen.getByLabelText('From date')).toBeDisabled()
    expect(screen.getByLabelText('To date')).toBeDisabled()
    expect(
      screen.getByText(/calendar sets its own dates/i),
    ).toBeInTheDocument()
  })

  it('date inputs are enabled by default (dateApplies=true)', () => {
    renderBar()
    expect(screen.getByLabelText('From date')).not.toBeDisabled()
  })
})

describe('ScopeBar — loud active state (filters only, excluding account)', () => {
  it('a filter facet (setup) shows Clear + "N of M trades"', () => {
    renderBar({ resultCount: 5, totalCount: 20 }, { route: '/journal?sc_setup=VCP&sc_v=1' })
    expect(screen.getByRole('button', { name: /Clear/ })).toBeInTheDocument()
    expect(screen.getByText('5 of 20 trades')).toBeInTheDocument()
  })

  it('a mere account selection does NOT trigger Clear / gold / "N of M"', () => {
    mockAccountId = 'acc1'
    renderBar({ resultCount: 5, totalCount: 20 }, { route: '/journal' })
    expect(screen.queryByRole('button', { name: /Clear/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/of 20 trades/)).not.toBeInTheDocument()
  })

  it('"N of M" only shows when resultCount + totalCount are provided', () => {
    renderBar({}, { route: '/journal?sc_setup=VCP&sc_v=1' })
    // active (Clear present) but no counts passed → no "trades" line
    expect(screen.getByRole('button', { name: /Clear/ })).toBeInTheDocument()
    expect(screen.queryByText(/trades/)).not.toBeInTheDocument()
  })

  it('Clear wipes the scope facets from the URL (clearScope)', async () => {
    const user = userEvent.setup()
    renderBar({ resultCount: 5, totalCount: 20 }, { route: '/journal?sc_setup=VCP&sc_v=1' })
    expect(screen.getByTestId('qs').textContent).toContain('sc_setup=VCP')

    await user.click(screen.getByRole('button', { name: /Clear/ }))

    expect(screen.getByTestId('qs').textContent).not.toContain('sc_setup')
    expect(screen.queryByRole('button', { name: /Clear/ })).not.toBeInTheDocument()
  })
})

describe('ScopeBar — touch (mobile Sheet)', () => {
  it('renders a chip that opens a Sheet with the facets', async () => {
    mockIsTouch = true
    const user = userEvent.setup()
    renderBar()

    const chip = screen.getByRole('button', { name: /scope/i })
    expect(chip).toBeInTheDocument()
    // Sheet is closed → facets not mounted yet
    expect(screen.queryByLabelText('Account')).not.toBeInTheDocument()

    await user.click(chip)

    // Sheet open → facets now present
    expect(screen.getByLabelText('Account')).toBeInTheDocument()
    expect(screen.getByLabelText('Symbol starts-with filter')).toBeInTheDocument()
  })
})

describe('ScopeBar — shared-link account hydration', () => {
  it('mounting with ?sc_acct=acc2 while live account is acc1 calls setAccount once', () => {
    mockAccountId = 'acc1'
    renderBar({}, { route: '/journal?sc_acct=acc2&sc_v=1' })
    expect(mockSetAccount).toHaveBeenCalledTimes(1)
    expect(mockSetAccount).toHaveBeenCalledWith('acc2')
  })

  it('does NOT re-hydrate when sc_acct already matches the live account', () => {
    mockAccountId = 'acc2'
    renderBar({}, { route: '/journal?sc_acct=acc2&sc_v=1' })
    expect(mockSetAccount).not.toHaveBeenCalled()
  })
})

describe('ScopeBar — filtered export (A11)', () => {
  it('desktop: Export CSV downloads the scoped, server-authoritative URL', async () => {
    const user = userEvent.setup()
    let href = null
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function () {
        href = this.href
      })
    renderBar({}, { route: '/journal?sc_setup=VCP&sc_v=1' })

    await user.click(screen.getByRole('button', { name: /Export CSV/i }))

    expect(href).toContain('/api/j2/trades/export')
    expect(href).toContain('format=csv')
    // The active scope rides along (export == what's on screen).
    expect(href).toContain('setups=VCP')
    clickSpy.mockRestore()
  })

  it('desktop: Export JSON downloads with format=json + the scope', async () => {
    const user = userEvent.setup()
    let href = null
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function () {
        href = this.href
      })
    renderBar({}, { route: '/journal?sc_setup=VCP&sc_v=1' })

    await user.click(screen.getByRole('button', { name: /Export JSON/i }))

    expect(href).toContain('format=json')
    expect(href).toContain('setups=VCP')
    clickSpy.mockRestore()
  })

  it('mobile: export buttons live in the Sheet', async () => {
    mockIsTouch = true
    const user = userEvent.setup()
    renderBar()
    await user.click(screen.getByRole('button', { name: /scope/i }))
    expect(screen.getByRole('button', { name: /Export CSV/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Export JSON/i })).toBeInTheDocument()
  })
})

describe('ScopeBar — no emoji', () => {
  it('renders no emoji characters (icons are UIcon SVGs)', () => {
    const { container } = renderBar(
      { resultCount: 5, totalCount: 20 },
      { route: '/journal?sc_setup=VCP&sc_v=1' },
    )
    expect(container.textContent).not.toMatch(EMOJI_RE)
  })
})
