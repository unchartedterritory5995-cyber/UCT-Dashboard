import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, useSearchParams } from 'react-router-dom'

// ── mock the live-account hook ───────────────────────────────────────────────
// `mock`-prefixed so vitest's vi.mock hoisting allows referencing them here.
let mockAccountId = null
const mockSetAccount = vi.fn()

vi.mock('./useJ2SelectedAccount', () => ({
  default: () => ({
    accountId: mockAccountId,
    account: null,
    accounts: [],
    setAccount: mockSetAccount,
    isLoading: false,
  }),
}))

import useScope from './useScope'

// Harness exposes the hook API PLUS the live searchParams so tests can assert
// what got written to the URL. Both `useScope` and this `useSearchParams` read
// the SAME router context, so `params` always reflects the latest write.
function useHarness() {
  const api = useScope()
  const [params] = useSearchParams()
  return { ...api, params }
}

function setup(initialEntry = '/journal') {
  const wrapper = ({ children }) => (
    <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
  )
  return renderHook(() => useHarness(), { wrapper })
}

beforeEach(() => {
  mockAccountId = null
  mockSetAccount.mockClear()
})

describe('useScope — setFacet scalar', () => {
  it("setFacet('symbol','NVDA') writes sc_sym and updates scope.symbol", () => {
    const { result } = setup('/journal')
    act(() => result.current.setFacet('symbol', 'NVDA'))
    expect(result.current.params.get('sc_sym')).toBe('NVDA')
    expect(result.current.scope.symbol).toBe('NVDA')
  })

  it("setFacet('from', …) preserves an unrelated param (j2tab)", () => {
    const { result } = setup('/journal?j2tab=journal')
    act(() => result.current.setFacet('from', '2026-05-01'))
    expect(result.current.params.get('j2tab')).toBe('journal')
    expect(result.current.params.get('sc_from')).toBe('2026-05-01')
    expect(result.current.scope.from).toBe('2026-05-01')
  })
})

describe('useScope — toggleMember (array facet)', () => {
  it('adds a setup, then removes it on a second toggle', () => {
    const { result } = setup('/journal')

    act(() => result.current.toggleMember('setups', 'VCP'))
    expect(result.current.params.get('sc_setup')).toBe('VCP')
    expect(result.current.scope.setups).toContain('VCP')

    act(() => result.current.toggleMember('setups', 'VCP'))
    expect(result.current.params.get('sc_setup')).toBeNull()
    expect(result.current.scope.setups).not.toContain('VCP')
  })
})

describe('useScope — clearScope', () => {
  it('wipes all sc_* params but keeps j2tab and does NOT call setAccount', () => {
    mockAccountId = 'acc-9'
    const { result } = setup('/journal?j2tab=journal&sc_sym=NVDA&sc_setup=VCP&sc_v=1')
    // sanity: the scoped facet is live before clearing
    expect(result.current.scope.symbol).toBe('NVDA')

    act(() => result.current.clearScope())

    expect(result.current.params.get('sc_sym')).toBeNull()
    expect(result.current.params.get('sc_setup')).toBeNull()
    expect(result.current.params.get('sc_v')).toBeNull()
    expect(result.current.params.get('sc_acct')).toBeNull()
    expect(result.current.params.get('j2tab')).toBe('journal')
    // clearing filters must NOT switch accounts
    expect(mockSetAccount).not.toHaveBeenCalled()
    // …and a subsequent read still reflects the live account
    expect(result.current.scope.acct).toBe('acc-9')
  })
})

describe('useScope — apiParams (snake_case + account reconciliation)', () => {
  it('emits snake_case keys for URL facets', () => {
    const { result } = setup('/journal?sc_from=2026-01-01&sc_sym=NVDA&sc_v=1')
    expect(result.current.apiParams.date_from).toBe('2026-01-01')
    expect(result.current.apiParams.symbol).toBe('NVDA')
  })

  it('omits account_id when the live account is null (all accounts)', () => {
    mockAccountId = null
    const { result } = setup('/journal')
    expect('account_id' in result.current.apiParams).toBe(false)
  })

  it("omits account_id when the live account is the '_all_' sentinel", () => {
    mockAccountId = '_all_'
    const { result } = setup('/journal')
    expect('account_id' in result.current.apiParams).toBe(false)
  })

  it('includes account_id from the live account when a real account is selected', () => {
    mockAccountId = 'acc-123'
    const { result } = setup('/journal')
    expect(result.current.apiParams.account_id).toBe('acc-123')
  })
})

describe('useScope — account reconciliation', () => {
  it('scope.acct follows the live account from the mocked hook', () => {
    mockAccountId = 'acc-1'
    const { result, rerender } = setup('/journal')
    expect(result.current.scope.acct).toBe('acc-1')

    // account switches elsewhere → the hook re-reads the live account
    mockAccountId = 'acc-2'
    act(() => rerender())
    expect(result.current.scope.acct).toBe('acc-2')
  })

  it("setFacet('acct', id) drives the account via setAccount and writes sc_acct", () => {
    const { result } = setup('/journal')
    act(() => result.current.setFacet('acct', 'acc-5'))
    expect(mockSetAccount).toHaveBeenCalledWith('acc-5')
    expect(result.current.params.get('sc_acct')).toBe('acc-5')
  })
})

describe('useScope — isActive / activeCount', () => {
  it('inactive on a bare scope, active once a facet is set', () => {
    const { result } = setup('/journal')
    expect(result.current.isActive).toBe(false)
    expect(result.current.activeCount).toBe(0)

    act(() => result.current.setFacet('symbol', 'NVDA'))
    expect(result.current.isActive).toBe(true)
    expect(result.current.activeCount).toBe(1)
  })
})
