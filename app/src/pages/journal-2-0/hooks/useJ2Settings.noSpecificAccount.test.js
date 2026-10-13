// R-M2-1 (b): ONE meaning of `isAllAccounts`. useJ2SelectedAccount owns it ("the member chose All
// Accounts"); useJ2Settings no longer returns a key of that name. What useJ2Settings does know is
// whether a SPECIFIC account is selected (accountId == null also before the first pick and while the
// accounts will not load), and it says so under its own name, `noSpecificAccount`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const SEL = vi.hoisted(() => ({ accountId: 'a1', extra: {} }))
vi.mock('./useJ2SelectedAccount', () => ({
  default: () => ({ accountId: SEL.accountId, account: SEL.accountId ? { id: SEL.accountId, name: 'Main' } : null,
    isLoading: false, isAllAccounts: false, accounts: [{ id: 'a1', name: 'Main' }], ...SEL.extra }),
}))
vi.mock('swr', () => ({ default: () => ({ data: { accountSize: 50000 }, error: undefined, isLoading: false, mutate: vi.fn() }) }))

import useJ2Settings from './useJ2Settings'

afterEach(() => { SEL.accountId = 'a1'; SEL.extra = {} })

describe('useJ2Settings: noSpecificAccount, and no second isAllAccounts', () => {
  it('a specific account selected: noSpecificAccount is false', () => {
    const { result } = renderHook(() => useJ2Settings())
    expect(result.current.accountId).toBe('a1')
    expect(result.current.noSpecificAccount).toBe(false)
  })
  it('no specific account (All Accounts, no pick yet, accounts failing): noSpecificAccount is true', () => {
    SEL.accountId = null
    const { result } = renderHook(() => useJ2Settings())
    expect(result.current.noSpecificAccount).toBe(true)
  })
  it('the name isAllAccounts belongs to useJ2SelectedAccount alone: useJ2Settings does not return it', () => {
    SEL.accountId = null
    const { result } = renderHook(() => useJ2Settings())
    expect(Object.keys(result.current)).not.toContain('isAllAccounts')
    expect(Object.keys(result.current)).toContain('noSpecificAccount')          // non-vacuity: the keys were read
  })
  // R-M2-2 M-2: WHY no specific account is selected, for the Settings banner's sentence. Null with one.
  it.each([
    ['one account selected', 'a1', {}, null],
    ['All Accounts chosen', null, { isAllAccounts: true }, 'all'],
    ['the first pick not made yet', null, {}, 'pending'],
    ['accounts still loading', null, { isLoading: true, accounts: [] }, 'pending'],
    ['accounts failed', null, { accounts: [], accountsError: new Error('500') }, 'accounts-error'],
    ['no accounts at all, All Accounts stored', null, { isAllAccounts: true, accounts: [] }, 'no-accounts'],
    ['All Accounts, a failed re-poll, accounts on hand', null, { isAllAccounts: true, accountsError: new Error('500') }, 'all'],
  ])('noAccountReason, %s', (_name, accountId, extra, reason) => {
    SEL.accountId = accountId
    SEL.extra = extra
    const { result } = renderHook(() => useJ2Settings())
    expect(result.current.noAccountReason).toBe(reason)
    expect(result.current.noSpecificAccount).toBe(reason != null)
  })
})
