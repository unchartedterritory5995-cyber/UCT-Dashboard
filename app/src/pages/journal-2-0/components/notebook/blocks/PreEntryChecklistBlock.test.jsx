import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// R-M2-1 (c), C-1: with no SPECIFIC account selected the settings served are the frozen legacy row, not
// the member's setups, so the block lists nothing and says why (Log Trade's own sentences).
const ALL_ACCOUNTS_LINE = 'Your pre-entry checklist shows here when one account is selected.'

const SETUPS_FIXTURE = { setups: ['VCP'], setupRules: { VCP: [{ id: 's1', label: 'Volume dry-up' }, { id: 's2', label: 'Tight closes' }] } }
let SETTINGS = SETUPS_FIXTURE
let SETTINGS_EXTRA = {}
let RULES = []
let RULES_EXTRA = {}
let ACCOUNT_EXTRA = {}
const rulesCalls = []
vi.mock('../../../hooks/useJ2Settings', () => ({ default: () => ({ settings: SETTINGS, ...SETTINGS_EXTRA }) }))
vi.mock('../../../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1', ...ACCOUNT_EXTRA }) }))
vi.mock('../../../hooks/useJournalRules', () => ({
  default: (accountId) => { rulesCalls.push(accountId); return { rules: RULES, ...RULES_EXTRA } },
}))

import PreEntryChecklistBlock from './PreEntryChecklistBlock'

const base = { setup: 'VCP', includeRules: 'yes', requireAll: 'no', checked: [] }

afterEach(() => {
  SETTINGS = SETUPS_FIXTURE
  SETTINGS_EXTRA = {}
  RULES = []
  RULES_EXTRA = {}
  ACCOUNT_EXTRA = {}
  rulesCalls.length = 0
})

describe('PreEntryChecklistBlock', () => {
  it('lists the setup checklist as named checkboxes and ticks through setParams only', () => {
    const setParams = vi.fn(() => true)
    render(<PreEntryChecklistBlock params={base} setParams={setParams} editable />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Volume dry-up' }))
    expect(setParams).toHaveBeenCalledWith({ checked: ['s1'] })
    expect(screen.getByText('0 of 2 ticked')).toBeTruthy()
  })
  it('requireAll no: no "not ticked" line (IR-S8)', () => {
    render(<PreEntryChecklistBlock params={base} setParams={vi.fn()} editable />)
    expect(screen.queryByText(/not ticked/)).toBeNull()
  })
  it('requireAll yes: the "not ticked" line, counted (IR-S8)', () => {
    render(<PreEntryChecklistBlock params={{ ...base, requireAll: 'yes', checked: ['s1'] }} setParams={vi.fn()} editable />)
    expect(screen.getByRole('status').textContent).toBe('1 checklist item not ticked.')
  })
  it('no setup picked: a named select of the member setups (R-T7-2: the pick never touches the ticks)', () => {
    const setParams = vi.fn(() => true)
    render(<PreEntryChecklistBlock params={{ ...base, setup: '' }} setParams={setParams} editable />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Setup for this trade' }), { target: { value: 'VCP' } })
    expect(setParams).toHaveBeenCalledWith({ setup: 'VCP' })
  })
  it('no setups yet: says what to do, never an empty box', () => {
    SETTINGS = { setups: [], setupRules: {} }
    render(<PreEntryChecklistBlock params={{ ...base, setup: '' }} setParams={vi.fn()} editable />)
    expect(screen.getByText(/You have no setups yet/)).toBeTruthy()
  })
  it('a reader sees the ticks, disabled', () => {
    render(<PreEntryChecklistBlock params={{ ...base, checked: ['s1'] }} setParams={vi.fn()} editable={false} />)
    const box = screen.getByRole('checkbox', { name: 'Volume dry-up' })
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(true)
  })
  it('includeRules yes with no before-entry rules says so, and points at no control that does not exist yet', () => {
    RULES = [{ id: 'r1', label: 'x', beforeEntry: false }]
    render(<PreEntryChecklistBlock params={base} setParams={vi.fn()} editable />)
    expect(screen.getByText('No rules are marked "before entry" yet, so none are listed here.')).toBeTruthy()
    expect(screen.queryByText(/My rules/)).toBeNull()
  })
  it('keyboard: Space on a focused checkbox ticks it through setParams', () => {
    const setParams = vi.fn(() => true)
    render(<PreEntryChecklistBlock params={base} setParams={setParams} editable />)
    const box = screen.getByRole('checkbox', { name: 'Tight closes' })
    box.focus()
    expect(document.activeElement).toBe(box)
    fireEvent.click(box)                               // jsdom's Space on a checkbox is a click
    expect(setParams).toHaveBeenCalledWith({ checked: ['s2'] })
  })

  // ── Beyond the brief: the record is the member's own, so nothing below may show a tick, a count or
  // a "you have none" the member's data does not say.

  it('settings still loading: says Loading, never "You have no setups yet"', () => {
    SETTINGS = undefined
    SETTINGS_EXTRA = { isLoading: true }
    render(<PreEntryChecklistBlock params={{ ...base, setup: '' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByText(/You have no setups yet/)).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
  it('settings failed to load: the block error sentence and Try again, never "no setups"', () => {
    const refresh = vi.fn()
    SETTINGS = undefined
    SETTINGS_EXTRA = { error: new Error('500'), refresh }
    render(<PreEntryChecklistBlock params={{ ...base, setup: '' }} setParams={vi.fn()} editable />)
    expect(screen.getByText("This block couldn't load. Your note is safe.")).toBeTruthy()
    expect(screen.queryByText(/You have no setups yet/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })
  it('rules still loading: no "No rules are marked" line, and it says the rules are loading', () => {
    RULES_EXTRA = { isLoading: true }
    render(<PreEntryChecklistBlock params={base} setParams={vi.fn()} editable />)
    expect(screen.queryByText(/No rules are marked "before entry" yet/)).toBeNull()
    expect(screen.getByText('Loading your before-entry rules…')).toBeTruthy()
  })
  it('rules failed to load: says so, never "No rules are marked"', () => {
    RULES_EXTRA = { error: new Error('500') }
    render(<PreEntryChecklistBlock params={base} setParams={vi.fn()} editable />)
    expect(screen.queryByText(/No rules are marked "before entry" yet/)).toBeNull()
    expect(screen.getByText("Your rules couldn't load, so none are listed here.")).toBeTruthy()
  })
  it('All Accounts selected: no setup, item or count from the legacy row; says one account is needed (C-1)', () => {
    ACCOUNT_EXTRA = { accountId: null, isLoading: false, isAllAccounts: true, accounts: [{ id: 'a1' }] }
    for (const includeRules of ['yes', 'no']) {
      const { unmount } = render(<PreEntryChecklistBlock params={{ ...base, includeRules }} setParams={vi.fn()} editable />)
      expect(screen.getByText(ALL_ACCOUNTS_LINE)).toBeTruthy()
      expect(screen.queryByRole('checkbox')).toBeNull()
      expect(screen.queryByText(/ticked$/)).toBeNull()
      expect(screen.queryByText(/No rules are marked "before entry" yet/)).toBeNull()
      unmount()
    }
    // and with no setup picked, the legacy row's setups are never offered as the member's own
    render(<PreEntryChecklistBlock params={{ ...base, setup: '' }} setParams={vi.fn()} editable />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByText(/You have no setups yet/)).toBeNull()
    expect(screen.getByText(ALL_ACCOUNTS_LINE)).toBeTruthy()
  })
  // M-3: the All Accounts sentence is true only for All Accounts. Each other "no account yet" state
  // reads its own honest line, and (C-1) none lists the legacy row's items.
  it.each([
    ['accounts still loading', { accountId: null, isLoading: true, isAllAccounts: false, accounts: [] }, 'Loading…'],
    ['accounts loaded, first pick not made yet', { accountId: null, isLoading: false, isAllAccounts: false, accounts: [{ id: 'a1' }] }, 'Loading…'],
    ['accounts failed to load', { accountId: null, isLoading: false, isAllAccounts: false, accounts: [], accountsError: new Error('500') },
      "Your accounts couldn't load, so your pre-entry checklist isn't shown."],
    ['no accounts at all', { accountId: null, isLoading: false, isAllAccounts: false, accounts: [] },
      'Your pre-entry checklist shows here once you have a Journal account.'],
  ])('M-3 %s: its own line, never the All Accounts sentence', (_name, account, line) => {
    ACCOUNT_EXTRA = account
    render(<PreEntryChecklistBlock params={base} setParams={vi.fn()} editable />)
    expect(screen.getByText(line)).toBeTruthy()
    expect(screen.queryByText(ALL_ACCOUNTS_LINE)).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByText(/No rules are marked "before entry" yet/)).toBeNull()
  })
  it('N-2: All Accounts with a failed re-poll but accounts on hand reads the All Accounts line, not "couldn\'t load"', () => {
    ACCOUNT_EXTRA = { accountId: null, isLoading: false, isAllAccounts: true, accounts: [{ id: 'a1' }], accountsError: new Error('500') }
    render(<PreEntryChecklistBlock params={base} setParams={vi.fn()} editable />)
    expect(screen.getByText(ALL_ACCOUNTS_LINE)).toBeTruthy()
    expect(screen.queryByText(/Your accounts couldn't load/)).toBeNull()
  })
  it('a before-entry rule is a named checkbox after the setup items, and ticks with its rule: id', () => {
    RULES = [{ id: 'r1', label: 'No trades in the first 5 minutes', beforeEntry: true }]
    const setParams = vi.fn(() => true)
    render(<PreEntryChecklistBlock params={{ ...base, checked: ['s1'] }} setParams={setParams} editable />)
    const names = screen.getAllByRole('checkbox').map((b) => b.closest('label').textContent)
    expect(names).toEqual(['Volume dry-up', 'Tight closes', 'No trades in the first 5 minutes'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'No trades in the first 5 minutes' }))
    expect(setParams).toHaveBeenCalledWith({ checked: ['s1', 'rule:r1'] })
    expect(screen.getByText('1 of 3 ticked')).toBeTruthy()
  })
  it('includeRules no: the rules are never fetched (null account), and no rules line', () => {
    RULES = [{ id: 'r1', label: 'Rule', beforeEntry: true }]
    render(<PreEntryChecklistBlock params={{ ...base, includeRules: 'no' }} setParams={vi.fn()} editable />)
    expect(rulesCalls.every((a) => a === null)).toBe(true)
    expect(rulesCalls.length).toBeGreaterThan(0)                    // non-vacuity: the hook was asked
    expect(screen.queryByRole('checkbox', { name: 'Rule' })).toBeNull()
    expect(screen.queryByText(/before entry/)).toBeNull()
  })
  it('a param the note never stored falls back to the block catalog default (includeRules yes, requireAll no)', () => {
    RULES = [{ id: 'r1', label: 'Rule one', beforeEntry: true }]
    render(<PreEntryChecklistBlock params={{ setup: 'VCP' }} setParams={vi.fn()} editable />)
    expect(screen.getByRole('checkbox', { name: 'Rule one' })).toBeTruthy()
    expect(rulesCalls).toContain('a1')
    expect(screen.queryByText(/not ticked/)).toBeNull()
  })
  it('a stale ticked id (a removed rule) never ticks a box or counts', () => {
    render(<PreEntryChecklistBlock params={{ ...base, requireAll: 'yes', checked: ['s1', 'rule:gone'] }} setParams={vi.fn()} editable />)
    expect(screen.getByText('1 of 2 ticked')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('1 checklist item not ticked.')
    expect(screen.getAllByRole('checkbox').filter((b) => b.checked)).toHaveLength(1)
  })
  it('every item ticked with requireAll yes: no warning line at all', () => {
    render(<PreEntryChecklistBlock params={{ ...base, requireAll: 'yes', checked: ['s1', 's2'] }} setParams={vi.fn()} editable />)
    expect(screen.getByText('2 of 2 ticked')).toBeTruthy()
    expect(screen.queryByText(/not ticked/)).toBeNull()
  })
  it('a picked setup with no checklist says so by name, and names the settings section exactly (M-2)', () => {
    SETTINGS = { setups: ['Flag'], setupRules: {} }
    render(<PreEntryChecklistBlock params={{ ...base, setup: 'Flag', includeRules: 'no' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('No checklist for Flag yet. Add its rules in Journal settings, under Trade setups.')).toBeTruthy()
    expect(screen.queryByText(/ticked$/)).toBeNull()
  })
  it('M-2: a setup the member has since deleted or renamed says it is gone, never "add its rules"', () => {
    SETTINGS = { setups: ['Flag'], setupRules: {} }
    render(<PreEntryChecklistBlock params={{ ...base, setup: 'VCP', includeRules: 'no' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('VCP is no longer one of your setups. Change setup to pick another.')).toBeTruthy()
    expect(screen.queryByText(/Add its rules/)).toBeNull()
  })
  it('M-2: a reader of a gone setup reads the fact without an instruction they cannot follow', () => {
    SETTINGS = { setups: ['Flag'], setupRules: {} }
    render(<PreEntryChecklistBlock params={{ ...base, setup: 'VCP', includeRules: 'no' }} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('VCP is no longer one of your setups.')).toBeTruthy()
  })
  it('Change setup writes { setup: "" } only and never touches the ticks; a reader has no such button', () => {
    const setParams = vi.fn(() => true)
    const { unmount } = render(<PreEntryChecklistBlock params={{ ...base, checked: ['s1'] }} setParams={setParams} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Change setup' }))
    expect(setParams).toHaveBeenCalledTimes(1)
    expect(setParams).toHaveBeenCalledWith({ setup: '' })
    unmount()
    render(<PreEntryChecklistBlock params={{ ...base, checked: ['s1'] }} setParams={vi.fn()} editable={false} />)
    expect(screen.queryByRole('button', { name: 'Change setup' })).toBeNull()
  })
  it('a reader with no setup picked reads a sentence, not a disabled picker', () => {
    render(<PreEntryChecklistBlock params={{ ...base, setup: '' }} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('No setup picked for this trade.')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
  })
  it('the checklist is a named group: "Pre-entry checklist for VCP"', () => {
    render(<PreEntryChecklistBlock params={base} setParams={vi.fn()} editable />)
    const group = screen.getByRole('group', { name: 'Pre-entry checklist for VCP' })
    expect(group.contains(screen.getByRole('checkbox', { name: 'Volume dry-up' }))).toBe(true)
  })
})

// ── R-T7-2 / I-2: a tick never drops an id that simply cannot be resolved right now. The member's
// rule ticks survive every state in which the rules are not listed.
describe('I-2: ticks the block cannot resolve right now are kept, never erased', () => {
  const start = { ...base, checked: ['s1', 'rule:r1'] }
  const tickTightCloses = (params) => {
    const setParams = vi.fn(() => true)
    render(<PreEntryChecklistBlock params={params} setParams={setParams} editable />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tight closes' }))
    expect(setParams).toHaveBeenCalledTimes(1)
    return setParams.mock.calls[0][0].checked
  }
  it.each([
    ['rules ready (control)', () => { RULES = [{ id: 'r1', label: 'Rule one', beforeEntry: true }] }],
    ['rules failed to load', () => { RULES_EXTRA = { error: new Error('500') } }],
    ['rules still loading', () => { RULES_EXTRA = { isLoading: true } }],
  ])('%s: ticking "Tight closes" keeps rule:r1', (_name, arrange) => {
    arrange()
    const written = tickTightCloses(start)
    expect(written).toContain('rule:r1')
    expect([...written].sort()).toEqual(['rule:r1', 's1', 's2'])
  })
  it('an unresolvable id is never shown or counted while it is kept', () => {
    RULES_EXTRA = { error: new Error('500') }
    render(<PreEntryChecklistBlock params={{ ...start, requireAll: 'yes' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('1 of 2 ticked')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('1 checklist item not ticked.')
  })
  it('includeRules no then yes: a setup tick made while rules were off keeps the rule tick, which shows again', () => {
    RULES = [{ id: 'r1', label: 'Rule one', beforeEntry: true }]
    const written = tickTightCloses({ ...start, includeRules: 'no' })
    expect([...written].sort()).toEqual(['rule:r1', 's1', 's2'])
    cleanup()
    render(<PreEntryChecklistBlock params={{ ...base, includeRules: 'yes', checked: written }} setParams={vi.fn()} editable />)
    expect(screen.getByRole('checkbox', { name: 'Rule one' }).checked).toBe(true)
    expect(screen.getByText('3 of 3 ticked')).toBeTruthy()
  })
  it('an account switch (other setup ids) keeps the first account\'s ticks, and switching back shows them', () => {
    SETTINGS = { setups: ['VCP'], setupRules: { VCP: [{ id: 'x1', label: 'Volume dry-up' }, { id: 'x2', label: 'Tight closes' }] } }
    RULES = [{ id: 'r9', label: 'Other rule', beforeEntry: true }]
    const written = tickTightCloses(start)
    expect([...written].sort()).toEqual(['rule:r1', 's1', 'x2'])
    cleanup()
    SETTINGS = SETUPS_FIXTURE
    RULES = [{ id: 'r1', label: 'Rule one', beforeEntry: true }]
    render(<PreEntryChecklistBlock params={{ ...base, checked: written }} setParams={vi.fn()} editable />)
    expect(screen.getByRole('checkbox', { name: 'Volume dry-up' }).checked).toBe(true)
    expect(screen.getByRole('checkbox', { name: 'Rule one' }).checked).toBe(true)
    expect(screen.getByText('2 of 3 ticked')).toBeTruthy()
  })
})

// ── Concern 4 (R-T7-2): changing setup keeps every tick; switching back restores that setup's ticks.
describe('concern 4: each setup keeps its own ticks', () => {
  const TWO = {
    setups: ['VCP', 'Flag'],
    setupRules: {
      VCP: [{ id: 's1', label: 'Volume dry-up' }, { id: 's2', label: 'Tight closes' }],
      Flag: [{ id: 'f1', label: 'Pole first' }],
    },
  }
  it('VCP -> Flag -> VCP restores s1; a rule tick still counts under Flag; a Flag tick does not erase VCP\'s ids', () => {
    SETTINGS = TWO
    RULES = [{ id: 'r1', label: 'Rule one', beforeEntry: true }]
    let params = { ...base, checked: ['s1', 'rule:r1'] }
    const setParams = vi.fn((patch) => { params = { ...params, ...patch }; return true })
    const { rerender } = render(<PreEntryChecklistBlock params={params} setParams={setParams} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Change setup' }))
    rerender(<PreEntryChecklistBlock params={params} setParams={setParams} editable />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Setup for this trade' }), { target: { value: 'Flag' } })
    rerender(<PreEntryChecklistBlock params={params} setParams={setParams} editable />)
    expect(params.checked).toEqual(['s1', 'rule:r1'])                      // neither write touched the ticks
    expect(screen.getByRole('checkbox', { name: 'Rule one' }).checked).toBe(true)
    expect(screen.getByText('1 of 2 ticked')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pole first' }))
    rerender(<PreEntryChecklistBlock params={params} setParams={setParams} editable />)
    expect([...params.checked].sort()).toEqual(['f1', 'rule:r1', 's1'])
    fireEvent.click(screen.getByRole('button', { name: 'Change setup' }))
    rerender(<PreEntryChecklistBlock params={params} setParams={setParams} editable />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Setup for this trade' }), { target: { value: 'VCP' } })
    rerender(<PreEntryChecklistBlock params={params} setParams={setParams} editable />)
    expect(screen.getByRole('checkbox', { name: 'Volume dry-up' }).checked).toBe(true)
    expect(screen.getByRole('checkbox', { name: 'Tight closes' }).checked).toBe(false)
    expect(screen.getByText('2 of 3 ticked')).toBeTruthy()
  })
})
