import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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
  it('no setup picked: a named select of the member setups', () => {
    const setParams = vi.fn(() => true)
    render(<PreEntryChecklistBlock params={{ ...base, setup: '' }} setParams={setParams} editable />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Setup for this trade' }), { target: { value: 'VCP' } })
    expect(setParams).toHaveBeenCalledWith({ setup: 'VCP', checked: [] })
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
  it('includeRules yes with no before-entry rules says how to mark one', () => {
    RULES = [{ id: 'r1', label: 'x', beforeEntry: false }]
    render(<PreEntryChecklistBlock params={base} setParams={vi.fn()} editable />)
    expect(screen.getByText(/No rules are marked "before entry" yet/)).toBeTruthy()
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
  it('All Accounts selected: says rules need one account, never "No rules are marked"', () => {
    ACCOUNT_EXTRA = { accountId: null, isLoading: false }
    render(<PreEntryChecklistBlock params={base} setParams={vi.fn()} editable />)
    expect(screen.queryByText(/No rules are marked "before entry" yet/)).toBeNull()
    expect(screen.getByText('Your before-entry rules show here when one account is selected.')).toBeTruthy()
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
  it('a picked setup with no checklist says so by name', () => {
    SETTINGS = { setups: ['Flag'], setupRules: {} }
    render(<PreEntryChecklistBlock params={{ ...base, setup: 'Flag', includeRules: 'no' }} setParams={vi.fn()} editable />)
    expect(screen.getByText('No checklist for Flag yet. Add its rules in Journal settings, under Setups.')).toBeTruthy()
    expect(screen.queryByText(/ticked$/)).toBeNull()
  })
  it('Change setup clears the setup and its ticks through setParams; a reader has no such button', () => {
    const setParams = vi.fn(() => true)
    const { unmount } = render(<PreEntryChecklistBlock params={{ ...base, checked: ['s1'] }} setParams={setParams} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Change setup' }))
    expect(setParams).toHaveBeenCalledWith({ setup: '', checked: [] })
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
