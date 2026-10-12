// Notebook P2a, Task 7 fix round 1 (M-3): two ADDITIVE keys on useJ2SelectedAccount, so a reader can
// tell "All Accounts is selected" apart from "no account picked yet" and "accounts failed to load".
// `accountId` is null in all three; only this hook owns the stored selection that tells them apart.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

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
  it('the accounts read error passes through as accountsError (and is absent when there is none)', () => {
    const err = new Error('500')
    ACCOUNTS_RET = { accounts: [], isLoading: false, error: err }
    expect(renderHook(() => useJ2SelectedAccount()).result.current.accountsError).toBe(err)
    ACCOUNTS_RET = { accounts: [], isLoading: false }
    expect(renderHook(() => useJ2SelectedAccount()).result.current.accountsError).toBeUndefined()
  })
})
