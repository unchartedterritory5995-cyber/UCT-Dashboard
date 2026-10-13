// The My rules block (Notebook P2b, Task 8; spec §P2 item 2). It reads through hooks/useMyRulesSources
// (only the two Journal hooks behind it are stood in for, so the seam's states are the member's) and
// writes RULES through lib/blocks/rulesApi, never the note. Every case asserts what is on screen after
// the action settles (R-RC-2).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

const mutate = vi.fn()
let RULES
let RULES_RET
let ACCOUNT
vi.mock('../../../hooks/useJ2SelectedAccount', () => ({ default: () => ACCOUNT }))
vi.mock('../../../hooks/useJournalRules', () => ({
  default: (id, status) => (status === 'dismissed'
    ? { rules: [{ id: 'd1', label: 'No trades in the first minute', evidence: null, version: 1, changedAt: '2026-09-01T15:00:00+00:00', beforeEntry: false, status: 'dismissed' }], mutate }
    : { rules: RULES, mutate, ...RULES_RET }),
}))
import MyRulesBlock from './MyRulesBlock'

const realFetch = globalThis.fetch
const WAIT = { id: 'r1', label: 'Wait 15 minutes', evidence: null, version: 2, changedAt: '2026-10-02T15:00:00+00:00', beforeEntry: false, status: 'active' }
const answer = (status, body) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }))

beforeEach(() => {
  RULES = [WAIT]
  RULES_RET = {}
  ACCOUNT = { accountId: 'a1' }
  mutate.mockClear()
  globalThis.fetch = answer(200, { ...WAIT })
})
afterEach(() => { globalThis.fetch = realFetch })

const putBody = () => JSON.parse(globalThis.fetch.mock.calls[0][1].body)

describe('MyRulesBlock', () => {
  it('lists rules with their version line', () => {
    render(<MyRulesBlock params={{}} setParams={vi.fn()} editable />)
    expect(screen.getByText('Wait 15 minutes')).toBeTruthy()
    expect(screen.getByText('v2 · changed Oct 2')).toBeTruthy()
  })
  it('the before-entry switch saves the rule, never the note', async () => {
    const setParams = vi.fn()
    globalThis.fetch = answer(200, { ...WAIT, beforeEntry: true })
    render(<MyRulesBlock params={{}} setParams={setParams} editable />)
    const sw = screen.getByRole('switch', { name: "Check 'Wait 15 minutes' before entry" })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    await waitFor(() => expect(mutate).toHaveBeenCalled())
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/trader-blocks/rules/r1', expect.objectContaining({ method: 'PUT' }))
    expect(putBody()).toEqual({ beforeEntry: true })
    expect(setParams).not.toHaveBeenCalled()
  })
  it('a rule already checked before entry shows the switch on, and switching it off sends false', async () => {
    RULES = [{ ...WAIT, beforeEntry: true }]
    render(<MyRulesBlock params={{}} setParams={vi.fn()} editable />)
    const sw = screen.getByRole('switch', { name: "Check 'Wait 15 minutes' before entry" })
    expect(sw.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sw)
    await waitFor(() => expect(mutate).toHaveBeenCalled())
    expect(putBody()).toEqual({ beforeEntry: false })
  })
  it('no rules: says how to make one', () => {
    RULES = []
    render(<MyRulesBlock params={{}} setParams={vi.fn()} editable />)
    expect(screen.getByText(/You have no rules yet/)).toBeTruthy()
    expect(screen.getByText('You have no rules yet. Turn a recurring mistake into a rule from Insights, then it shows here.')).toBeTruthy()
  })
  it('Edit opens the form with the words; Save sends the rule\'s words and the note, then re-reads the list', async () => {
    const setParams = vi.fn()
    RULES = [{ ...WAIT, evidence: 'FOMO cost $900' }]
    render(<MyRulesBlock params={{}} setParams={setParams} editable />)
    fireEvent.click(screen.getByRole('button', { name: "Edit 'Wait 15 minutes'" }))
    const form = screen.getByRole('form', { name: "Edit 'Wait 15 minutes'" })
    expect(within(form).getByLabelText('Rule').value).toBe('Wait 15 minutes')
    expect(within(form).getByLabelText('Why').value).toBe('FOMO cost $900')
    expect(within(form).getByLabelText('What changed?').value).toBe('')
    expect(document.activeElement).toBe(within(form).getByLabelText('Rule'))
    fireEvent.change(within(form).getByLabelText('Rule'), { target: { value: 'Wait 20 minutes' } })
    fireEvent.change(within(form).getByLabelText('What changed?'), { target: { value: 'Fifteen was not enough' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mutate).toHaveBeenCalled())
    expect(putBody()).toEqual({ label: 'Wait 20 minutes', evidence: 'FOMO cost $900', changeNote: 'Fifteen was not enough' })
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull())
    expect(setParams).not.toHaveBeenCalled()
    // focus comes back to the rule's Edit button, never lost to the page
    expect(document.activeElement).toBe(screen.getByRole('button', { name: "Edit 'Wait 15 minutes'" }))
  })
  it('a blank Why is no evidence (null), never an empty string the server would read as new words', async () => {
    render(<MyRulesBlock params={{}} setParams={vi.fn()} editable />)
    fireEvent.click(screen.getByRole('button', { name: "Edit 'Wait 15 minutes'" }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(putBody()).toEqual({ label: 'Wait 15 minutes', evidence: null, changeNote: null })
  })
  it('R-M1-1: a dismissed rule answers 404, and the block SAYS so in words, then re-reads the list', async () => {
    globalThis.fetch = answer(404, { detail: 'Not found' })
    render(<MyRulesBlock params={{}} setParams={vi.fn()} editable />)
    fireEvent.click(screen.getByRole('button', { name: "Edit 'Wait 15 minutes'" }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('This rule was dismissed. Restore it to edit it.')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('This rule was dismissed. Restore it to edit it.')
    expect(screen.queryByText(/404|Not found/)).toBeNull()
    expect(mutate).toHaveBeenCalled()
    expect(screen.queryByRole('form')).toBeNull()
  })
  it('the 404 sentence outlives the rule\'s row: once the re-read drops the rule, it still shows', async () => {
    globalThis.fetch = answer(404, { detail: 'Not found' })
    const { rerender } = render(<MyRulesBlock params={{}} setParams={vi.fn()} editable />)
    fireEvent.click(screen.getByRole('switch', { name: "Check 'Wait 15 minutes' before entry" }))
    expect(await screen.findByText('This rule was dismissed. Restore it to edit it.')).toBeTruthy()
    RULES = []
    rerender(<MyRulesBlock params={{}} setParams={vi.fn()} editable />)
    expect(screen.getByText('This rule was dismissed. Restore it to edit it.')).toBeTruthy()
    expect(screen.getByText(/You have no rules yet/)).toBeTruthy()
  })
  it('a 400 shows the server\'s sentence and keeps the form open with the member\'s words', async () => {
    globalThis.fetch = answer(400, { detail: 'A rule needs words.' })
    render(<MyRulesBlock params={{}} setParams={vi.fn()} editable />)
    fireEvent.click(screen.getByRole('button', { name: "Edit 'Wait 15 minutes'" }))
    fireEvent.change(screen.getByLabelText('Rule'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('A rule needs words.')).toBeTruthy()
    expect(screen.getByLabelText('Rule').value).toBe('   ')
    expect(mutate).not.toHaveBeenCalled()
  })
  it('Cancel closes the form and writes nothing', () => {
    render(<MyRulesBlock params={{}} setParams={vi.fn()} editable />)
    fireEvent.click(screen.getByRole('button', { name: "Edit 'Wait 15 minutes'" }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form')).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
  it('a reader\'s view: the rules and their lines show; no Edit, and the switch cannot be moved', () => {
    render(<MyRulesBlock params={{}} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('Wait 15 minutes')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull()
    expect(screen.getByRole('switch', { name: "Check 'Wait 15 minutes' before entry" }).disabled).toBe(true)
    // CONTROL: the same rule in an editable note can be moved
    render(<MyRulesBlock params={{}} setParams={vi.fn()} editable />)
    expect(screen.getAllByRole('switch').some((s) => !s.disabled)).toBe(true)
  })
  it('loading says so, and a failed read offers Try again, which re-reads', () => {
    RULES_RET = { isLoading: true, rules: [] }
    const { unmount } = render(<MyRulesBlock params={{}} setParams={vi.fn()} editable />)
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByText(/You have no rules yet/)).toBeNull()
    unmount()
    RULES_RET = { error: new Error('500'), rules: [] }
    render(<MyRulesBlock params={{}} setParams={vi.fn()} editable />)
    expect(screen.queryByText(/You have no rules yet/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mutate).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['All Accounts', { accountId: null, isAllAccounts: true, accounts: [{ id: 'a1' }] }, 'Your rules show here when one account is selected.'],
    ['no accounts', { accountId: null, accounts: [] }, 'Your rules show here once you have a Journal account.'],
    ['accounts failed', { accountId: null, accounts: [], accountsError: new Error('500') }, "Your accounts couldn't load, so your rules aren't shown."],
  ])('C-1, %s: its own sentence, never "You have no rules yet"', (_name, account, line) => {
    ACCOUNT = account
    render(<MyRulesBlock params={{}} setParams={vi.fn()} editable />)
    expect(screen.getByText(line)).toBeTruthy()
    expect(screen.queryByText(/You have no rules yet/)).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })
  it('"All rules" (the block\'s one setting) lists dismissed rules after, marked and read-only', () => {
    render(<MyRulesBlock params={{ which: 'all' }} setParams={vi.fn()} editable />)
    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => li.querySelector('[data-rule-label]').textContent)).toEqual(['Wait 15 minutes', 'No trades in the first minute'])
    expect(within(items[1]).getByText('Dismissed · v1 · made Sep 1')).toBeTruthy()
    expect(within(items[1]).queryByRole('switch')).toBeNull()
    expect(within(items[1]).queryByRole('button')).toBeNull()
    // CONTROL: the default lists the active rule only
    render(<MyRulesBlock params={{}} setParams={vi.fn()} editable />)
    expect(screen.getAllByText('No trades in the first minute')).toHaveLength(1)
  })
})
