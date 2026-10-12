// The checklist's ONE read seam (Notebook P2a, Task 7). It hands a block body DATA only: the three
// Journal hooks it composes also carry writes (save / create / dismiss), and a block may not hold a
// second write door (spec §P2 integrity rule), so the seam's return shape is pinned key by key.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const save = vi.fn()
const create = vi.fn()
const dismiss = vi.fn()
const refresh = vi.fn()
let SETTINGS_RET = {}
let RULES_RET = {}
let ACCOUNT_RET = {}
const rulesCalls = []
vi.mock('./useJ2Settings', () => ({ default: () => ({ settings: { setups: ['VCP'] }, save, refresh, ...SETTINGS_RET }) }))
vi.mock('./useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1', setAccount: vi.fn(), isLoading: false, ...ACCOUNT_RET }) }))
vi.mock('./useJournalRules', () => ({
  default: (id) => { rulesCalls.push(id); return { rules: [{ id: 'r1' }], create, dismiss, isLoading: false, ...RULES_RET } },
}))

import useChecklistSources, { RETURN_KEYS } from './useChecklistSources'

afterEach(() => { SETTINGS_RET = {}; RULES_RET = {}; ACCOUNT_RET = {}; rulesCalls.length = 0 })

describe('useChecklistSources', () => {
  it('returns data and a read retry only: no save, create, dismiss or setAccount', () => {
    const { result } = renderHook(() => useChecklistSources({ wantRules: true }))
    // RETURN_KEYS is the ONE copy of the shape: blockDoors.test.js's seam rail reads the same constant
    // and requires the hook's literal return to carry exactly these keys.
    expect(Object.keys(result.current).sort()).toEqual([...RETURN_KEYS].sort())
    expect(RETURN_KEYS.length).toBeGreaterThan(0)
    for (const v of Object.values(result.current)) {
      expect([save, create, dismiss]).not.toContain(v)
    }
    expect(result.current.settings).toEqual({ setups: ['VCP'] })
    expect(result.current.rules).toEqual([{ id: 'r1' }])
    expect(result.current.settingsState).toBe('ready')
    expect(result.current.rulesState).toBe('ready')
  })
  it('asks for the rules of the selected account only when they are wanted', () => {
    renderHook(() => useChecklistSources({ wantRules: true }))
    expect(rulesCalls).toContain('a1')
    rulesCalls.length = 0
    const { result } = renderHook(() => useChecklistSources({ wantRules: false }))
    expect(rulesCalls.length).toBeGreaterThan(0)
    expect(rulesCalls.every((id) => id === null)).toBe(true)
    expect(result.current.rules).toEqual([])
    expect(result.current.rulesState).toBe('off')
  })
  it('settings: loading before the first answer, error when it failed, never "ready" without data', () => {
    SETTINGS_RET = { settings: undefined, isLoading: true }
    expect(renderHook(() => useChecklistSources({ wantRules: false })).result.current.settingsState).toBe('loading')
    SETTINGS_RET = { settings: undefined, error: new Error('500') }
    expect(renderHook(() => useChecklistSources({ wantRules: false })).result.current.settingsState).toBe('error')
    SETTINGS_RET = { settings: undefined }
    expect(renderHook(() => useChecklistSources({ wantRules: false })).result.current.settingsState).toBe('loading')
  })
  it('rules: loading and error are their own states', () => {
    RULES_RET = { isLoading: true, rules: [] }
    expect(renderHook(() => useChecklistSources({ wantRules: true })).result.current.rulesState).toBe('loading')
    RULES_RET = { error: new Error('500'), rules: [] }
    expect(renderHook(() => useChecklistSources({ wantRules: true })).result.current.rulesState).toBe('error')
  })
  it('All Accounts selected: "no-account", and no rules', () => {
    ACCOUNT_RET = { accountId: null, isLoading: false, isAllAccounts: true, accounts: [{ id: 'a1' }] }
    const { result } = renderHook(() => useChecklistSources({ wantRules: true }))
    expect(result.current.rulesState).toBe('no-account')
    expect(result.current.rules).toEqual([])
  })
  // M-3: "no-account" means All Accounts and nothing else.
  it.each([
    ['accounts loading', { accountId: null, isLoading: true, isAllAccounts: true, accounts: [] }, 'loading'],
    ['accounts loaded, first pick pending', { accountId: null, isLoading: false, isAllAccounts: false, accounts: [{ id: 'a1' }] }, 'loading'],
    ['accounts failed', { accountId: null, isLoading: false, isAllAccounts: true, accounts: [], accountsError: new Error('500') }, 'accounts-error'],
    ['no accounts at all', { accountId: null, isLoading: false, isAllAccounts: false, accounts: [] }, 'no-accounts'],
    // R-T7-3 N-2: a failed poll keeps SWR's last accounts, so an error with accounts on hand is not
    // "accounts couldn't load"; the selection decides (AccountSelector.jsx's own precedent)
    ['All Accounts, a failed re-poll, accounts on hand', { accountId: null, isLoading: false, isAllAccounts: true, accounts: [{ id: 'a1' }], accountsError: new Error('500') }, 'no-account'],
  ])('M-3 %s: %s', (_name, account, state) => {
    ACCOUNT_RET = account
    const { result } = renderHook(() => useChecklistSources({ wantRules: true }))
    expect(result.current.rulesState).toBe(state)
    expect(result.current.rules).toEqual([])
  })
  // R-M2-1 (c), the C-1 class: with no SPECIFIC account selected, useJ2Settings reads the frozen legacy
  // j2_settings row, which is not any account's setups. The seam never hands it on as the member's own:
  // settings are absent and settingsState says WHY (the same reason rulesState carries), whether or not
  // rules are wanted. Each mock below serves the legacy row ({ setups: ['VCP'] }).
  it.each([
    ['All Accounts', { accountId: null, isLoading: false, isAllAccounts: true, accounts: [{ id: 'a1' }] }, 'no-account'],
    ['the first pick not made yet', { accountId: null, isLoading: false, isAllAccounts: false, accounts: [{ id: 'a1' }] }, 'loading'],
    ['accounts still loading', { accountId: null, isLoading: true, isAllAccounts: false, accounts: [] }, 'loading'],
    ['accounts failed', { accountId: null, isLoading: false, isAllAccounts: false, accounts: [], accountsError: new Error('500') }, 'accounts-error'],
    ['no accounts at all', { accountId: null, isLoading: false, isAllAccounts: false, accounts: [] }, 'no-accounts'],
    ['All Accounts, a failed re-poll, accounts on hand', { accountId: null, isLoading: false, isAllAccounts: true, accounts: [{ id: 'a1' }], accountsError: new Error('500') }, 'no-account'],
  ])('C-1 %s: the legacy settings row is never handed on as ready', (_name, account, state) => {
    ACCOUNT_RET = account
    for (const wantRules of [true, false]) {
      const { result } = renderHook(() => useChecklistSources({ wantRules }))
      expect(result.current.settings, `wantRules ${wantRules}`).toBeUndefined()
      expect(result.current.settingsState, `wantRules ${wantRules}`).toBe(state)
      if (wantRules) expect(result.current.rulesState).toBe(state)
    }
  })
  it('C-1 control: one account selected hands its settings on as ready', () => {
    const { result } = renderHook(() => useChecklistSources({ wantRules: false }))
    expect(result.current.settings).toEqual({ setups: ['VCP'] })
    expect(result.current.settingsState).toBe('ready')
  })
  it('retrySettings re-reads the settings (the hook\'s own refresh), nothing else', () => {
    const { result } = renderHook(() => useChecklistSources({ wantRules: false }))
    result.current.retrySettings()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
  })
})
