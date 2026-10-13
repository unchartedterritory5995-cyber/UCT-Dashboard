// The My rules block's ONE read seam (Notebook P2b, Task 8; ruling R-PF-B8). It hands a block body
// DATA and one re-read: the hooks it composes also carry writes (create / dismiss), and a block may
// not hold a second write door (spec §P2 integrity rule), so its return shape is pinned key by key.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const create = vi.fn()
const dismiss = vi.fn()
const mutate = vi.fn()
const mutateDismissed = vi.fn()
let ACCOUNT_RET = {}
let ACTIVE_RET = {}
let DISMISSED_RET = {}
const calls = []
vi.mock('./useJ2SelectedAccount', () => ({
  default: () => ({ accountId: 'a1', setAccount: vi.fn(), isLoading: false, accounts: [{ id: 'a1' }], ...ACCOUNT_RET }),
}))
vi.mock('./useJournalRules', () => ({
  default: (id, status = 'active') => {
    calls.push([id, status])
    return status === 'dismissed'
      ? { rules: [{ id: 'd1', status: 'dismissed' }], mutate: mutateDismissed, create, dismiss, isLoading: false, ...DISMISSED_RET }
      : { rules: [{ id: 'r1', status: 'active' }], mutate, create, dismiss, isLoading: false, ...ACTIVE_RET }
  },
}))

import useMyRulesSources, { RETURN_KEYS } from './useMyRulesSources'

beforeEach(() => {
  ACCOUNT_RET = {}; ACTIVE_RET = {}; DISMISSED_RET = {}
  calls.length = 0
  mutate.mockClear(); mutateDismissed.mockClear()
})

describe('useMyRulesSources', () => {
  it('returns data and one re-read only: no create, dismiss or setAccount', () => {
    const { result } = renderHook(() => useMyRulesSources())
    // RETURN_KEYS is the ONE copy of the shape: blockDoors.test.js's seam rail reads the same constant.
    expect(Object.keys(result.current).sort()).toEqual([...RETURN_KEYS].sort())
    expect(RETURN_KEYS.length).toBeGreaterThan(0)
    for (const v of Object.values(result.current)) expect([create, dismiss, mutate]).not.toContain(v)
    expect(result.current.rules).toEqual([{ id: 'r1', status: 'active' }])
    expect(result.current.rulesState).toBe('ready')
  })
  it('refresh re-reads the list (SWR mutate with no argument), and keeps one identity', () => {
    const { result, rerender } = renderHook(() => useMyRulesSources())
    const first = result.current.refresh
    rerender()
    expect(result.current.refresh).toBe(first)
    result.current.refresh()
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith()
    expect(mutateDismissed).not.toHaveBeenCalled()
  })
  it('"active" asks for the selected account\'s active rules and never the dismissed ones', () => {
    renderHook(() => useMyRulesSources({ which: 'active' }))
    expect(calls).toContainEqual(['a1', 'active'])
    expect(calls.filter(([, s]) => s === 'dismissed').every(([id]) => id === null)).toBe(true)
  })
  it('"all" adds the dismissed rules after the active ones, and refresh re-reads both', () => {
    const { result } = renderHook(() => useMyRulesSources({ which: 'all' }))
    expect(calls).toContainEqual(['a1', 'dismissed'])
    expect(result.current.rules.map((r) => r.id)).toEqual(['r1', 'd1'])
    result.current.refresh()
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutateDismissed).toHaveBeenCalledTimes(1)
  })
  it('loading and failed are their own states, with no rules handed on', () => {
    ACTIVE_RET = { isLoading: true, rules: [] }
    expect(renderHook(() => useMyRulesSources()).result.current.rulesState).toBe('loading')
    ACTIVE_RET = { error: new Error('500'), rules: [] }
    const { result } = renderHook(() => useMyRulesSources())
    expect(result.current.rulesState).toBe('error')
    expect(result.current.rules).toEqual([])
    ACTIVE_RET = {}
    DISMISSED_RET = { error: new Error('500') }
    expect(renderHook(() => useMyRulesSources({ which: 'all' })).result.current.rulesState).toBe('error')
    // CONTROL: the dismissed list's failure is no failure when it was never asked for
    expect(renderHook(() => useMyRulesSources({ which: 'active' })).result.current.rulesState).toBe('ready')
  })
  it.each([
    ['All Accounts', { accountId: null, isAllAccounts: true, accounts: [{ id: 'a1' }] }, 'no-account'],
    ['accounts loading', { accountId: null, isLoading: true, accounts: [] }, 'loading'],
    ['no accounts at all', { accountId: null, accounts: [] }, 'no-accounts'],
    ['accounts failed', { accountId: null, accounts: [], accountsError: new Error('500') }, 'accounts-error'],
  ])('C-1, %s: "%s" and no rules, never a false "you have none"', (_name, account, state) => {
    ACCOUNT_RET = account
    const { result } = renderHook(() => useMyRulesSources())
    expect(result.current.rulesState).toBe(state)
    expect(result.current.rules).toEqual([])
  })
})
