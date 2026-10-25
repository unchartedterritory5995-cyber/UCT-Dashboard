// Wave 9 Task 9.16: the routine editor. Every assertion reads what the member SEES (text, roles, names, values) or what
// the server is SENT (method, path, If-Match, body), never component state. `fetch` is a fake routines server.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react'
import RoutineEditorSheet from './RoutineEditorSheet'
import { openRoutineEditor } from './openRoutineEditor'
import { installServer, routine, STARTERS } from './__fixtures__/toolsServer'

const bp = vi.hoisted(() => ({ touch: false }))
vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => false, useIsTouch: () => bp.touch, useIsTablet: () => false, useIsDesktop: () => !bp.touch,
  useHasCoarsePointer: () => bp.touch, useHasNoHover: () => bp.touch,
}))

const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true })
const S_CAP = 'You have 30 routines. Archive one in My tools to make room.'
const S_CONFLICT = 'Changed in another tab. Reload to see the newer version.'

let net
beforeEach(() => {
  bp.touch = false
  setOnline(true)
  net = installServer({ tools: { r1: routine() } })
})
afterEach(() => { cleanup(); setOnline(true) })

function mount(props = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(<RoutineEditorSheet onClose={onClose} onSaved={onSaved} zone="America/Chicago" {...props} />)
  return { onClose, onSaved }
}
const itemInputs = () => screen.queryAllByRole('textbox', { name: /^Item \d+$/ })
const itemValues = () => itemInputs().map((i) => i.value)
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))
const lastBody = (method, path) => { const c = net.sent(method, path); return c[c.length - 1]?.body }
const live = () => screen.getByTestId('tool-editor-live')

describe('a new routine', () => {
  it('create_from_starter_premarket_items_exact', async () => {
    const { onSaved, onClose } = mount()
    expect(await screen.findByRole('heading', { name: 'New routine' })).toBeTruthy()
    const chips = await screen.findByRole('group', { name: 'Start from' })
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(STARTERS.map((s) => s.name))
    fireEvent.click(within(chips).getByRole('button', { name: 'Pre-market routine' }))
    expect(screen.getByRole('textbox', { name: 'Name' }).value).toBe('Pre-market routine')
    expect(itemValues()).toEqual(STARTERS[0].items.map((i) => i.text))
    save()
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    const body = lastBody('POST', '/api/j2/routines')
    expect(body.name).toBe('Pre-market routine')
    expect(body.items).toEqual(STARTERS[0].items)                 // exactly the starter: words, negatives, suggestions
    expect(body.schedule).toEqual({ kind: 'every' })
    expect(body.settings).toEqual({ done_share: 1, strict: false, reminder: null })
    expect(body).not.toHaveProperty('sourceTemplateKey')
    expect(onSaved.mock.calls[0][0]).toMatchObject({ id: 'r-new', name: 'Pre-market routine' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('a starter with negatives and suggestions keeps them exactly', async () => {
    mount()
    fireEvent.click(within(await screen.findByRole('group', { name: 'Start from' })).getByRole('button', { name: 'Rules I keep' }))
    save()
    await waitFor(() => expect(net.sent('POST', '/api/j2/routines')).toHaveLength(1))
    expect(lastBody('POST', '/api/j2/routines').items).toEqual(STARTERS[3].items)
  })

  it('opened with starter: premarket, the form starts from it and Escape closes without asking', async () => {
    const { onClose } = mount({ starter: 'premarket' })
    await waitFor(() => expect(itemValues()).toEqual(STARTERS[0].items.map((i) => i.text)))
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: 'Keep your changes?' })).toBeNull()
  })

  it('import_day_rules_fills_items', async () => {
    mount()
    await screen.findByRole('group', { name: 'Start from' })
    fireEvent.click(screen.getByRole('button', { name: 'Import my day rules' }))
    await waitFor(() => expect(itemValues()).toEqual(['Stop on every trade', 'No trades in the first 5 minutes']))
    expect(net.sent('GET', '/api/j2/routines/import-day-rules')).toHaveLength(1)
    await waitFor(() => expect(live()).toHaveTextContent('Added 2 rules from your day notes.'))
    // a second import adds after what is there, and never past 25 items
    fireEvent.change(itemInputs()[0], { target: { value: 'Mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import my day rules' }))
    await waitFor(() => expect(itemValues()).toEqual(['Mine', 'No trades in the first 5 minutes', 'Stop on every trade']))
  })

  it('an import with no rules says so and adds nothing', async () => {
    net = installServer({ labels: [] })
    mount()
    await screen.findByRole('group', { name: 'Start from' })
    fireEvent.click(screen.getByRole('button', { name: 'Import my day rules' }))
    await waitFor(() => expect(live()).toHaveTextContent('Your day notes have no rules to import yet.'))
    expect(itemValues()).toEqual([''])
  })

  it('negative_and_suggest_options', async () => {
    mount()
    await screen.findByRole('group', { name: 'Start from' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Rules' } })
    fireEvent.change(itemInputs()[0], { target: { value: 'Max trades' } })
    const neg = screen.getAllByRole('switch', { name: "Counts when it didn't happen" })[0]
    expect(neg.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(neg)
    expect(neg.getAttribute('aria-checked')).toBe('true')
    const suggest = screen.getByRole('combobox', { name: 'Suggest from my trades' })
    expect([...suggest.options].map((o) => o.textContent)).toEqual([
      'Off', 'Stop on every trade', 'Max trades in a day', 'Stayed under my daily loss limit',
      'No trade soon after a loss', 'No revenge trades',
    ])
    fireEvent.change(suggest, { target: { value: 'max_trades' } })
    const most = screen.getByRole('combobox', { name: 'Most trades in a day' })
    expect(most.value).toBe('3')
    fireEvent.change(most, { target: { value: '5' } })
    expect(screen.getByText('From your trades it suggests a tick when: Max 5 trades. You still tick it.')).toBeTruthy()
    fireEvent.change(suggest, { target: { value: 'no_trade_after_loss' } })
    expect(screen.getByRole('combobox', { name: 'Minutes after a loss' }).value).toBe('10')
    expect(screen.getByText('From your trades it suggests a tick when: No trade within 10 min of a loss. You still tick it.')).toBeTruthy()
    fireEvent.change(suggest, { target: { value: 'max_trades' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Most trades in a day' }), { target: { value: '5' } })
    save()
    await waitFor(() => expect(net.sent('POST', '/api/j2/routines')).toHaveLength(1))
    expect(lastBody('POST', '/api/j2/routines').items).toEqual([
      { text: 'Max trades', negative: true, suggest: { rule: 'max_trades', n: 5 } },
    ])
  })

  it('items: add, rename, reorder and remove, at most 25', async () => {
    mount()
    await screen.findByRole('group', { name: 'Start from' })
    fireEvent.change(itemInputs()[0], { target: { value: 'A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add an item' }))
    expect(document.activeElement).toBe(itemInputs()[1])        // focus goes to the new item
    fireEvent.change(itemInputs()[1], { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move item 2 up' }))
    expect(itemValues()).toEqual(['B', 'A'])
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move item 1 up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove item 1' }))
    expect(itemValues()).toEqual(['A'])
    for (let i = 0; i < 30; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Add an item' }))
    expect(itemInputs()).toHaveLength(25)
    const add = screen.getByRole('button', { name: 'Add an item' })
    expect(add.getAttribute('aria-disabled')).toBe('true')
    expect(add.hasAttribute('disabled')).toBe(false)              // aria-disabled plus a guard, never `disabled`
    expect(screen.getByText('A routine can hold up to 25 items.')).toBeTruthy()
  })

  it('schedule_weekdays_toggles', async () => {
    mount()
    await screen.findByRole('group', { name: 'Start from' })
    expect(screen.getByRole('radio', { name: 'Every trading day' }).checked).toBe(true)
    expect(screen.queryByRole('group', { name: 'Weekdays' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Chosen weekdays' }))
    const days = screen.getByRole('group', { name: 'Weekdays' })
    expect(within(days).getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['Mon', 'true'], ['Tue', 'true'], ['Wed', 'true'], ['Thu', 'true'], ['Fri', 'true'],
    ])
    fireEvent.click(within(days).getByRole('button', { name: 'Tue' }))
    fireEvent.click(within(days).getByRole('button', { name: 'Thu' }))
    expect(within(days).getByRole('button', { name: 'Tue' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'MWF' } })
    fireEvent.change(itemInputs()[0], { target: { value: 'x' } })
    save()
    await waitFor(() => expect(net.sent('POST', '/api/j2/routines')).toHaveLength(1))
    expect(lastBody('POST', '/api/j2/routines').schedule).toEqual({ kind: 'weekdays', days: [0, 2, 4] })
  })

  it('no weekday chosen is refused beside the schedule, and nothing is sent', async () => {
    mount()
    await screen.findByRole('group', { name: 'Start from' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'N' } })
    fireEvent.change(itemInputs()[0], { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Only days I trade' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Chosen weekdays' }))
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) fireEvent.click(screen.getByRole('button', { name: d }))
    save()
    expect(await screen.findByText('Pick at least one weekday.')).toBeTruthy()
    expect(net.sent('POST', '/api/j2/routines')).toHaveLength(0)
  })

  it('reminder_off_by_default_shows_local_time_line', async () => {
    mount()
    await screen.findByRole('group', { name: 'Start from' })
    const remind = screen.getByRole('switch', { name: 'Remind me' })
    expect(remind.getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByRole('combobox', { name: 'Reminder time (ET)' })).toBeNull()
    fireEvent.click(remind)
    const time = screen.getByRole('combobox', { name: 'Reminder time (ET)' })
    expect(time.value).toBe('09:00')
    expect(time.options).toHaveLength(288)                         // every 5 minutes of the day
    expect(screen.getByText('9:00 ET · 8:00 your time')).toBeTruthy()
    expect(screen.getByText('Through the alert bell only.')).toBeTruthy()
    fireEvent.change(time, { target: { value: '15:45' } })
    expect(screen.getByText('15:45 ET · 14:45 your time')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'R' } })
    fireEvent.change(itemInputs()[0], { target: { value: 'x' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Counts as done with' }), { target: { value: '0.75' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Count skipped days as not done' }))
    save()
    await waitFor(() => expect(net.sent('POST', '/api/j2/routines')).toHaveLength(1))
    expect(lastBody('POST', '/api/j2/routines').settings).toEqual({
      done_share: 0.75, strict: true, reminder: { on: true, time_et: '15:45' },
    })
  })

  it('count_cap_sentence', async () => {
    const { onClose } = mount({ starter: 'premarket' })
    await waitFor(() => expect(itemInputs()).toHaveLength(5))
    net.refuseNext('POST', '/api/j2/routines', 409, { code: 'count_cap', message: S_CAP })
    save()
    expect(await screen.findByText(S_CAP)).toBeTruthy()
    await waitFor(() => expect(live()).toHaveTextContent(S_CAP))
    expect(itemInputs()).toHaveLength(5)                          // the draft stays
    expect(onClose).not.toHaveBeenCalled()
  })

  it('field_refusal_beside_field', async () => {
    mount({ starter: 'premarket' })
    await waitFor(() => expect(itemInputs()).toHaveLength(5))
    const S = 'SERVER: A name can be at most 80 characters, from the server.'
    net.refuseNext('POST', '/api/j2/routines', 400, { code: 'invalid', message: S })
    save()
    const name = screen.getByRole('textbox', { name: 'Name' })
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'))
    const err = document.getElementById(name.getAttribute('aria-describedby').split(' ').find((id) => document.getElementById(id)?.textContent === S))
    expect(err).toBeTruthy()
    expect(name.closest('[data-field-box]').contains(err)).toBe(true)    // beside the field, not only in the footer
    expect(document.activeElement).toBe(name)
    // an item refusal lands by the items
    const S2 = 'SERVER: An item can be at most 200 characters.'
    net.refuseNext('POST', '/api/j2/routines', 400, { code: 'invalid', message: S2 })
    save()
    const items = await screen.findByRole('group', { name: 'Items' })
    await waitFor(() => expect(within(items).getByText(S2)).toBeTruthy())
  })

  it('client-side limits are refused before any request', async () => {
    mount()
    await screen.findByRole('group', { name: 'Start from' })
    save()
    expect(await screen.findByText('Give the routine a name.')).toBeTruthy()
    expect(screen.getByText('Add at least one item.')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'x'.repeat(81) } })
    fireEvent.change(itemInputs()[0], { target: { value: 'y'.repeat(201) } })
    save()
    expect(await screen.findByText('A name can be at most 80 characters.')).toBeTruthy()
    expect(screen.getByText('An item can be at most 200 characters.')).toBeTruthy()
    expect(net.sent('POST')).toHaveLength(0)
  })

  it('offline: Save says so and sends nothing', async () => {
    mount({ starter: 'premarket' })
    await waitFor(() => expect(itemInputs()).toHaveLength(5))
    setOnline(false)
    save()
    await waitFor(() => expect(live()).toHaveTextContent("You're offline. Try again when you're back online."))
    expect(net.sent('POST', '/api/j2/routines')).toHaveLength(0)
  })
})

describe('editing a routine', () => {
  it('save_sends_if_match_and_conflict_keeps_draft', async () => {
    const { onSaved, onClose } = mount({ routineId: 'r1' })
    expect(await screen.findByRole('heading', { name: 'Edit routine' })).toBeTruthy()
    const name = await screen.findByRole('textbox', { name: 'Name' })
    expect(name.value).toBe('Pre-market routine')
    expect(screen.queryByRole('group', { name: 'Start from' })).toBeNull()   // the starters are for new routines only
    // another tab saved meanwhile
    net.store.set('r1', routine({ name: 'Morning prep', etag: 8 }))
    fireEvent.change(name, { target: { value: 'My prep' } })
    save()
    expect(await screen.findByText(S_CONFLICT)).toBeTruthy()
    const put = net.sent('PUT', '/api/j2/routines/r1')
    expect(put).toHaveLength(1)
    expect(put[0].headers['If-Match']).toBe('7')
    expect(put[0].body.items).toEqual([
      { id: 'i1', text: 'Read the morning wire', negative: false, suggest: null },
      { id: 'i2', text: 'No revenge trades', negative: true, suggest: { rule: 'no_revenge' } },
    ])
    expect(screen.getByRole('textbox', { name: 'Name' }).value).toBe('My prep')     // the draft is kept
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name' }).value).toBe('Morning prep'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'My prep' } })
    save()
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(net.sent('PUT', '/api/j2/routines/r1')[1].headers['If-Match']).toBe('8')
  })

  it('a reminder kept on the routine is shown on, with its time', async () => {
    net = installServer({ tools: { r1: routine({ schedule: { kind: 'weekdays', days: [0, 2] }, settings: { done_share: 0.5, strict: true, reminder: { on: true, time_et: '08:30' } } }) } })
    mount({ routineId: 'r1' })
    await screen.findByRole('textbox', { name: 'Name' })
    expect(screen.getByRole('switch', { name: 'Remind me' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('combobox', { name: 'Reminder time (ET)' }).value).toBe('08:30')
    expect(screen.getByText('8:30 ET · 7:30 your time')).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Chosen weekdays' }).checked).toBe(true)
    expect(screen.getByRole('button', { name: 'Tue' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('combobox', { name: 'Counts as done with' }).value).toBe('0.5')
    expect(screen.getByRole('switch', { name: 'Count skipped days as not done' }).getAttribute('aria-checked')).toBe('true')
    // turning it off keeps the time on the routine, off
    fireEvent.click(screen.getByRole('switch', { name: 'Remind me' }))
    save()
    await waitFor(() => expect(net.sent('PUT', '/api/j2/routines/r1')).toHaveLength(1))
    expect(lastBody('PUT', '/api/j2/routines/r1').settings.reminder).toEqual({ on: false, time_et: '08:30' })
  })

  it('Save with nothing changed closes without a request', async () => {
    const { onClose } = mount({ routineId: 'r1' })
    await screen.findByRole('textbox', { name: 'Name' })
    save()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(net.sent('PUT')).toHaveLength(0)
  })

  it('Escape asks "Keep your changes?" only when something changed, and Escape there goes back one level', async () => {
    const { onClose } = mount({ routineId: 'r1' })
    const name = await screen.findByRole('textbox', { name: 'Name' })
    fireEvent.change(name, { target: { value: 'Changed' } })
    fireEvent.keyDown(name, { key: 'Escape' })
    expect(await screen.findByRole('heading', { name: 'Keep your changes?' })).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })                 // back one level, to the form
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Keep your changes?' })).toBeNull())
    expect(screen.getByRole('textbox', { name: 'Name' }).value).toBe('Changed')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' })
    fireEvent.click(await screen.findByRole('button', { name: 'Discard them' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(net.sent('PUT')).toHaveLength(0)
  })

  it('"Save them" from the question saves, and "Keep editing" goes back to the form', async () => {
    const { onSaved } = mount({ routineId: 'r1' })
    const name = await screen.findByRole('textbox', { name: 'Name' })
    fireEvent.change(name, { target: { value: 'Changed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save them' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(lastBody('PUT', '/api/j2/routines/r1').name).toBe('Changed')
  })

  it('Save is aria-disabled with a guard while saving: a second press sends nothing more', async () => {
    let release
    const real = globalThis.fetch
    globalThis.fetch = vi.fn((url, init) => (init?.method === 'PUT' ? new Promise((r) => { release = () => r(real(url, init)) }) : real(url, init)))
    mount({ routineId: 'r1' })
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: 'Changed' } })
    save()
    const btn = await screen.findByRole('button', { name: 'Saving…' })
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(btn.hasAttribute('disabled')).toBe(false)
    fireEvent.click(btn)
    expect(globalThis.fetch.mock.calls.filter(([, i]) => i?.method === 'PUT')).toHaveLength(1)
    await act(async () => { release() })
  })
})

describe('managing a routine from its editor', () => {
  it('Used in lists its notes; archive says what happens and the form turns read-only with Restore', async () => {
    mount({ routineId: 'r1' })
    await screen.findByRole('textbox', { name: 'Name' })
    fireEvent.click(screen.getByRole('button', { name: 'Used in 2 notes' }))
    expect(await screen.findByRole('heading', { name: '“Pre-market routine” is in 2 notes' })).toBeTruthy()
    expect(await screen.findByRole('link', { name: /Note 1/ })).toBeTruthy()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })               // back one level
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Used in 2 notes' })))
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    expect(await screen.findByText('It stays in your 2 notes. Its history is kept.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Archive routine' }))
    expect(await screen.findByText('Archived routine, history only')).toBeTruthy()
    expect(net.sent('POST', '/api/j2/routines/r1/archive')).toHaveLength(1)
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()          // history only: nothing to edit
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(await screen.findByRole('textbox', { name: 'Name' })).toBeTruthy()
    expect(net.sent('POST', '/api/j2/routines/r1/unarchive')).toHaveLength(1)   // the block layer's one restore write
  })

  it('Duplicate and Archive wait for a clean form', async () => {
    mount({ routineId: 'r1' })
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: 'Changed' } })
    const dup = screen.getByRole('button', { name: 'Duplicate' })
    expect(dup.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(dup)
    expect(net.sent('POST', '/api/j2/routines/r1/duplicate')).toHaveLength(0)
    expect(screen.getByText('Save or discard your changes first.')).toBeTruthy()
    const arch = screen.getByRole('button', { name: 'Archive' })
    expect(arch.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(arch)
    expect(screen.queryByRole('button', { name: 'Archive routine' })).toBeNull()
    expect(net.sent('POST', '/api/j2/routines/r1/archive')).toHaveLength(0)
  })

  it('Duplicate makes a copy and opens it', async () => {
    mount({ routineId: 'r1' })
    await screen.findByRole('textbox', { name: 'Name' })
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name' }).value).toBe('Pre-market routine copy'))
    await waitFor(() => expect(live()).toHaveTextContent('Made a copy. You are editing “Pre-market routine copy”.'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Copy 2' } })
    save()
    await waitFor(() => expect(net.sent('PUT', '/api/j2/routines/r1-copy')).toHaveLength(1))
  })

  it('delete needs the name typed (the My tools pattern), then Undo brings it back archived', async () => {
    net = installServer({ tools: { r1: routine({ archived: true }) } })
    mount({ routineId: 'r1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete permanently' }))
    expect(await screen.findByRole('heading', { name: 'Delete “Pre-market routine” permanently?' })).toBeTruthy()
    const field = screen.getByRole('textbox', { name: 'Type Pre-market routine to confirm' })
    expect(document.activeElement).toBe(field)
    const go = screen.getByRole('button', { name: 'Delete permanently' })
    expect(go.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(go)
    expect(net.sent('POST', '/api/j2/routines/r1/delete')).toHaveLength(0)
    fireEvent.change(field, { target: { value: 'Pre-market routine' } })
    expect(screen.getByText('The name matches.')).toBeTruthy()
    net.refuseNext('POST', '/api/j2/routines/r1/delete', 400, { code: 'invalid', message: 'SERVER: type the name.' })
    fireEvent.click(go)
    expect(await screen.findByText('SERVER: type the name.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(await screen.findByText('“Pre-market routine” moved to Recently deleted. It\'s kept for 30 days.')).toBeTruthy()
    expect(net.sent('POST', '/api/j2/routines/r1/delete').at(-1).body).toEqual({ typedName: 'Pre-market routine' })
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Archived routine, history only')).toBeTruthy()
    expect(net.sent('POST', '/api/j2/routines/r1/undelete')).toHaveLength(1)
  })
})

describe('openRoutineEditor', () => {
  it('mounts on its own root, one at a time, and returns focus to the opener on close', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'Edit routine'
    document.body.appendChild(opener)
    opener.focus()
    let close
    await act(async () => { close = openRoutineEditor({ routineId: 'r1' }) })
    expect(document.querySelectorAll('[data-routine-editor-root]')).toHaveLength(1)
    let again
    await act(async () => { again = openRoutineEditor({ routineId: 'r1' }) })
    expect(again).toBe(close)
    expect(document.querySelectorAll('[data-routine-editor-root]')).toHaveLength(1)
    expect(await screen.findByRole('heading', { name: 'Edit routine' })).toBeTruthy()
    await act(async () => { close(); await new Promise((r) => setTimeout(r, 5)) })
    expect(document.querySelectorAll('[data-routine-editor-root]')).toHaveLength(0)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('from a placed block: a routine that cannot be read closes the editor and the block says why', async () => {
    const announce = vi.fn()
    await act(async () => { openRoutineEditor({ routineId: 'gone', announce }) })
    await waitFor(() => expect(announce).toHaveBeenCalledWith('Not available right now.'))
    await waitFor(() => expect(document.querySelectorAll('[data-routine-editor-root]')).toHaveLength(0))
  })

  it('onSaved hears the saved routine', async () => {
    const onSaved = vi.fn()
    let close
    await act(async () => { close = openRoutineEditor({ starter: 'premarket', onSaved }) })
    await waitFor(() => expect(itemInputs()).toHaveLength(5))
    save()
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: 'Pre-market routine' })))
    await waitFor(() => expect(document.querySelectorAll('[data-routine-editor-root]')).toHaveLength(0))
    close()
  })
})
