// The position sizing block's ONE read seam (R-M2-1 a). It hands the block DATA only: the hooks it
// composes also carry writes (save, setAccount), and a block may not hold a second write door (spec
// §P2 integrity rule), so the shape is pinned key by key through RETURN_KEYS.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const save = vi.fn()
const setAccount = vi.fn()
const refresh = vi.fn()
const refreshAccounts = vi.fn()
let SETTINGS_RET = {}
let ACCOUNT_RET = {}
let REGIME_RET = {}
let ACCOUNTS_RET = {}
// The legacy j2_settings row is what useJ2Settings serves whenever accountId is null.
vi.mock('./useJ2Settings', () => ({ default: () => ({ settings: { accountSize: 25000 }, isLoading: false, save, refresh, ...SETTINGS_RET }) }))
vi.mock('./useJ2SelectedAccount', () => ({
  default: () => ({ accountId: 'a1', isLoading: false, isAllAccounts: false, accounts: [{ id: 'a1', name: 'Main' }], setAccount, ...ACCOUNT_RET }),
}))
vi.mock('./useJ2Accounts', () => ({ default: () => ({ accounts: [{ id: 'a1', name: 'Main' }], isLoading: false, refresh: refreshAccounts, ...ACCOUNTS_RET }) }))
vi.mock('./useJ2CurrentRegime', () => ({ default: () => ({ regime: { regime: 'green', asOf: '2026-10-13' }, ...REGIME_RET }) }))

import usePositionSizingSources, { RETURN_KEYS } from './usePositionSizingSources'

afterEach(() => { SETTINGS_RET = {}; ACCOUNT_RET = {}; REGIME_RET = {}; ACCOUNTS_RET = {}; vi.clearAllMocks() })

describe('usePositionSizingSources', () => {
  it('returns data and read retries only: no save, no setAccount', () => {
    const { result } = renderHook(() => usePositionSizingSources())
    // RETURN_KEYS is the ONE copy of the shape: blockDoors.test.js's seam rail reads the same constant.
    expect(Object.keys(result.current).sort()).toEqual([...RETURN_KEYS].sort())
    expect(RETURN_KEYS.length).toBeGreaterThan(0)
    for (const v of Object.values(result.current)) expect([save, setAccount]).not.toContain(v)
    expect(result.current.settings).toEqual({ accountSize: 25000 })
    expect(result.current.settingsState).toBe('ready')
    expect(result.current.accountState).toBe('specific')
    expect(result.current.accountName).toBe('Main')
    expect(result.current.regime).toEqual({ regime: 'green', asOf: '2026-10-13' })
  })
  // C-1: the legacy row is never handed on when no specific account is selected, whatever the reason.
  it.each([
    ['All Accounts', { accountId: null, isAllAccounts: true }, 'all'],
    ['the first pick not made yet', { accountId: null, isAllAccounts: false }, 'pending'],
    ['accounts still loading', { accountId: null, isLoading: true, accounts: [] }, 'pending'],
    ['accounts failed', { accountId: null, accounts: [], accountsError: new Error('500') }, 'accounts-error'],
    ['no accounts at all', { accountId: null, accounts: [] }, 'no-accounts'],
    ['All Accounts stored, but no accounts at all', { accountId: null, isAllAccounts: true, accounts: [] }, 'no-accounts'],
    ['All Accounts, a failed re-poll, accounts on hand', { accountId: null, isAllAccounts: true, accountsError: new Error('500') }, 'all'],
  ])('C-1 %s: no settings, settingsState off, accountState %s', (_name, account, state) => {
    ACCOUNT_RET = account
    const { result } = renderHook(() => usePositionSizingSources())
    expect(result.current.settings).toBeUndefined()
    expect(result.current.settingsState).toBe('off')
    expect(result.current.accountState).toBe(state)
    expect(result.current.accountName).toBeUndefined()
  })
  it('N-1: "specific" is accountId != null, whatever isAllAccounts says', () => {
    ACCOUNT_RET = { accountId: 'a1', isAllAccounts: true }
    const { result } = renderHook(() => usePositionSizingSources())
    expect(result.current.accountState).toBe('specific')
    expect(result.current.settings).toEqual({ accountSize: 25000 })
  })
  it('settings: loading before the first answer, error when it failed, never ready without data', () => {
    SETTINGS_RET = { settings: undefined, isLoading: true }
    expect(renderHook(() => usePositionSizingSources()).result.current.settingsState).toBe('loading')
    SETTINGS_RET = { settings: undefined, error: new Error('500') }
    expect(renderHook(() => usePositionSizingSources()).result.current.settingsState).toBe('error')
  })
  it('the retries are re-reads: settings refresh and accounts refresh, never a write', () => {
    const { result } = renderHook(() => usePositionSizingSources())
    result.current.retrySettings()
    result.current.retryAccounts()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refreshAccounts).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
    expect(setAccount).not.toHaveBeenCalled()
  })
  // R-M2-2 M-1: the REAL useJ2Settings and useJ2Accounts return `refresh: () => mutate()`, a NEW function
  // every render, so these mocks do too (a getter, read on every spread). A stable module-level spy would
  // let an identity claim pass that production breaks.
  it('H14: the retries keep their identity across renders, though each render hands a NEW refresh', () => {
    SETTINGS_RET = { get refresh() { return () => refresh() } }
    ACCOUNTS_RET = { get refresh() { return () => refreshAccounts() } }
    const { result, rerender } = renderHook(() => usePositionSizingSources())
    const { retrySettings, retryAccounts } = result.current
    rerender()
    expect(result.current.retrySettings).toBe(retrySettings)
    expect(result.current.retryAccounts).toBe(retryAccounts)
    // and the stable retry still reaches the LATEST refresh
    retrySettings()
    retryAccounts()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refreshAccounts).toHaveBeenCalledTimes(1)
  })
})
