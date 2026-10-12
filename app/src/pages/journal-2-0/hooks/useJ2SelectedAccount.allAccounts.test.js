// Notebook P2a, Task 7 fix round 1 (M-3): two ADDITIVE keys on useJ2SelectedAccount, so a reader can
// tell "All Accounts is selected" apart from "no account picked yet" and "accounts failed to load".
// `accountId` is null in all three; only this hook owns the stored selection that tells them apart.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

let ACCOUNTS_RET = { accounts: [], isLoading: true }
vi.mock('./useJ2Accounts', () => ({ default: () => ACCOUNTS_RET }))

import useJ2SelectedAccount from './useJ2SelectedAccount'

const KEY = 'uct.j2.selectedAccountId'
afterEach(() => { localStorage.removeItem(KEY); ACCOUNTS_RET = { accounts: [], isLoading: true } })

describe('useJ2SelectedAccount: isAllAccounts and accountsError', () => {
  it('All Accounts stored: accountId null and isAllAccounts true', () => {
    localStorage.setItem(KEY, '_all_')
    ACCOUNTS_RET = { accounts: [{ id: 'a1' }], isLoading: false }
    const { result } = renderHook(() => useJ2SelectedAccount())
    expect(result.current.accountId).toBeNull()
    expect(result.current.isAllAccounts).toBe(true)
  })
  it('nothing stored yet (before the first pick): accountId null but isAllAccounts false', () => {
    ACCOUNTS_RET = { accounts: [], isLoading: true }
    const { result } = renderHook(() => useJ2SelectedAccount())
    expect(result.current.accountId).toBeNull()
    expect(result.current.isAllAccounts).toBe(false)
  })
  it('one account selected: isAllAccounts false', () => {
    localStorage.setItem(KEY, 'a1')
    ACCOUNTS_RET = { accounts: [{ id: 'a1' }], isLoading: false }
    const { result } = renderHook(() => useJ2SelectedAccount())
    expect(result.current.accountId).toBe('a1')
    expect(result.current.isAllAccounts).toBe(false)
  })
  // R-T7-3 N-1: isAllAccounts is hook STATE, never a live storage read, so it can never disagree
  // with accountId. Tab A on All Accounts; tab B picks a2 (storage changes in tab A, no in-tab event).
  it('N-1 tab A / tab B: until the storage event lands, tab A stays consistently on All Accounts', () => {
    localStorage.setItem(KEY, '_all_')
    ACCOUNTS_RET = { accounts: [{ id: 'a1' }, { id: 'a2' }], isLoading: false }
    const { result, rerender } = renderHook(() => useJ2SelectedAccount())
    localStorage.setItem(KEY, 'a2')                          // tab B's write, seen by tab A's storage
    rerender()
    expect(result.current.accountId).toBeNull()
    expect(result.current.isAllAccounts).toBe(true)          // never "null and not All Accounts"
  })
  // R-T7-4: no cross-tab live sync. A selection made in another tab does NOT move this tab (the
  // behaviour every caller had before P2a); this tab keeps its own, consistent selection.
  it('R-T7-4: a storage event from another tab does NOT change this tab\'s accountId', () => {
    localStorage.setItem(KEY, '_all_')
    ACCOUNTS_RET = { accounts: [{ id: 'a1' }, { id: 'a2' }], isLoading: false }
    const { result } = renderHook(() => useJ2SelectedAccount())
    localStorage.setItem(KEY, 'a2')
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'a2', oldValue: '_all_' })) })
    expect(result.current.accountId).toBeNull()
    expect(result.current.isAllAccounts).toBe(true)
  })
  it('in-tab: setAccount(null) in another hook instance means All Accounts in this one', () => {
    localStorage.setItem(KEY, 'a1')
    ACCOUNTS_RET = { accounts: [{ id: 'a1' }], isLoading: false }
    const a = renderHook(() => useJ2SelectedAccount())
    const b = renderHook(() => useJ2SelectedAccount())
    expect(a.result.current.accountId).toBe('a1')
    act(() => { b.result.current.setAccount(null) })
    expect(a.result.current.accountId).toBeNull()
    expect(a.result.current.isAllAccounts).toBe(true)
    act(() => { b.result.current.setAccount('a1') })
    expect(a.result.current.accountId).toBe('a1')
    expect(a.result.current.isAllAccounts).toBe(false)
  })
  it('the accounts read error passes through as accountsError (and is absent when there is none)', () => {
    const err = new Error('500')
    ACCOUNTS_RET = { accounts: [], isLoading: false, error: err }
    expect(renderHook(() => useJ2SelectedAccount()).result.current.accountsError).toBe(err)
    ACCOUNTS_RET = { accounts: [], isLoading: false }
    expect(renderHook(() => useJ2SelectedAccount()).result.current.accountsError).toBeUndefined()
  })
})
