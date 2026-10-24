// Wave 8 (Task 8.15): the widget builder sheet, end to end through its own fetches (the server is a fetch router in
// __fixtures__/builderFixtures.js). Asserted by RENDERED TEXT and by the requests on the wire.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { Editor, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import WidgetBuilderSheet, {
  PREVIEW_DEBOUNCE_MS, KEEP_QUESTION, RESUME_OFFER,
} from './WidgetBuilderSheet'
import { ANNOUNCE_DELAY_MS } from './PreviewPane'
import { DRAFT_PREFIX, DRAFT_TTL_MS } from './builderDraft'
import { openWidgetBuilder } from './openWidgetBuilder'
import { __resetBuiltCaches, FAILURE_COPY } from '../../../lib/builtWidgets'
import {
  installFetch, answer, refusal, deferred, payload, callsTo, bodyOf, SUMMARY, CATALOG,
} from './__fixtures__/builderFixtures'

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

let fetchSpy
let routes
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  __resetBuiltCaches()
  window.localStorage.clear()
  ;({ spy: fetchSpy, routes } = installFetch())
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
})

/** Put a route ahead of the defaults. */
const route = (method, test, reply) => routes.unshift([method, test, reply])
const previews = () => callsTo(fetchSpy, 'POST', (u) => u.endsWith('/preview'))
const saveButton = () => screen.getByTestId('builder-save')

async function openBuilder(props = {}) {
  const onClose = vi.fn()
  const utils = render(<WidgetBuilderSheet uid="u1" onClose={onClose} {...props} />)
  await flush()                         // the catalog, accounts and the widget being edited load
  await flush(PREVIEW_DEBOUNCE_MS)      // the first preview
  return { ...utils, onClose }
}

/** A note editor that records inserts (`chain().insertWidgetEmbed(...).run()`). */
function fakeEditor() {
  const run = vi.fn(() => true)
  const insertWidgetEmbed = vi.fn(() => ({ run }))
  return {
    editor: { isEditable: true, storage: { uctJournalWidgets: { noteId: 'n-1', uid: 'u1' } }, chain: () => ({ insertWidgetEmbed }) },
    insertWidgetEmbed, run,
  }
}

const SAVED = { id: 'd-1', name: 'Net P&L by setup', rev: 3, placedRev: 3, etag: 7, archived: false, usedIn: 14,
  lastAnswer: null, summary: SUMMARY,
  plan: { v: 1, source: 'closed_trades', accounts: 'all', range: { token: 'last_90d' }, filters: [], measures: [{ key: 'net_pnl' }],
    split: null, view: { type: 'number', auto: true }, sort: null, compare: null,
    display: { title: '', titleAuto: true, subtitle: '', accent: 'gold', showN: true, target: null } } }

describe('WidgetBuilderSheet', () => {
  it('preview_debounced_and_stale_dropped', async () => {
    await openBuilder()
    expect(previews()).toHaveLength(1)
    const target = screen.getByLabelText('Target for a progress bar')
    // Two edits 100 ms apart: ONE request, carrying the second.
    fireEvent.change(target, { target: { value: '5' } })
    await flush(100)
    fireEvent.change(target, { target: { value: '50' } })
    await flush(PREVIEW_DEBOUNCE_MS - 1)
    expect(previews()).toHaveLength(1)
    await flush(1)
    expect(previews()).toHaveLength(2)
    expect(bodyOf(previews()[1]).plan.display.target).toBe(50)

    // An older answer arriving after a newer one is ignored.
    const a = deferred()
    const b = deferred()
    const queue = [a, b]
    route('POST', (u) => u.endsWith('/preview'), () => queue.shift().promise)
    fireEvent.change(target, { target: { value: '60' } })
    await flush(PREVIEW_DEBOUNCE_MS)
    fireEvent.change(target, { target: { value: '70' } })
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(previews()).toHaveLength(4)
    await act(async () => { b.resolve(payload({ summary: 'The newer answer.' })) })
    await act(async () => { a.resolve(payload({ summary: 'The older answer.' })) })
    await flush()
    expect(screen.getByText('The newer answer.')).toBeInTheDocument()
    expect(screen.queryByText('The older answer.')).toBeNull()
  })

  it('failure_keeps_last_result_and_save_enabled', async () => {
    await openBuilder()
    expect(screen.getByText(SUMMARY, { selector: 'p:not([role=status])' })).toBeInTheDocument()
    const target = screen.getByLabelText('Target for a progress bar')
    const cases = [
      ['busy', () => refusal(503, 'busy', 'Busy right now. Try again in a moment.')],
      ['too_long', () => refusal(503, 'too_long', 'x')],
      ['rate_preview', () => refusal(429, 'rate_preview', 'x')],
    ]
    let n = 1
    for (const [code, reply] of cases) {
      route('POST', (u) => u.endsWith('/preview'), reply)
      n += 1
      fireEvent.change(target, { target: { value: String(n) } })
      await flush(PREVIEW_DEBOUNCE_MS)
      expect(screen.getByText(FAILURE_COPY[code])).toBeInTheDocument()
      // The last good result stays, dimmed, and Save stays enabled.
      expect(screen.getByText(SUMMARY, { selector: 'p:not([role=status])' })).toBeInTheDocument()
      expect(screen.getByTestId('builder-preview-view').className).toMatch(/dimmed/)
      expect(within(screen.getByTestId('builder-preview-view')).getByText('+$2,140.00')).toBeInTheDocument()
      expect(saveButton()).toBeEnabled()
      routes.shift()
    }
    // too_long offers the one-tap shorter range.
    route('POST', (u) => u.endsWith('/preview'), () => refusal(503, 'too_long', 'x'))
    fireEvent.click(screen.getByRole('button', { name: /Date range/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Year to date' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(screen.getByRole('button', { name: 'Last 90 days' })).toBeInTheDocument()
    routes.shift()
    // Offline: no request is made, the sentence says so, the result stays.
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    const before = previews().length
    fireEvent.change(target, { target: { value: '99' } })
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(previews()).toHaveLength(before)
    expect(screen.getByText(FAILURE_COPY.offline)).toBeInTheDocument()
    expect(screen.getByText(SUMMARY, { selector: 'p:not([role=status])' })).toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
  })

  it('invalid_view_disabled_with_reason', async () => {
    await openBuilder()
    const bar = screen.getByRole('radio', { name: 'Bar' })
    expect(bar).toBeDisabled()
    expect(bar).toHaveAccessibleDescription('A bar chart needs a split.')
    expect(screen.getByRole('radio', { name: 'Progress bar' })).toHaveAccessibleDescription('A progress bar needs a target.')
    expect(screen.getByRole('radio', { name: 'Number, suggested' })).toBeChecked()
    // With a split, Bar is the suggestion and Number cannot show it.
    fireEvent.click(screen.getByRole('button', { name: 'No split. Pick one' }))
    fireEvent.click(screen.getByRole('button', { name: 'Setup' }))
    expect(screen.getByRole('radio', { name: 'Bar, suggested' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'Bar, suggested' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Number' })).toHaveAccessibleDescription(
      'This view shows one number. Remove the split to use it.')
    // R-17: open positions cannot compare.
    fireEvent.click(screen.getByRole('radio', { name: 'Open positions' }))
    expect(screen.getByRole('radio', { name: 'Number with comparison' })).toHaveAccessibleDescription(
      'Open positions are a snapshot of right now, so there is no earlier period to compare.')
    expect(screen.getByText('Right now')).toBeInTheDocument()
  })

  it('previous-period comparison is refused against a number of trades (R-12)', async () => {
    await openBuilder()
    fireEvent.click(screen.getByRole('radio', { name: 'Number with comparison' }))
    fireEvent.click(screen.getByRole('button', { name: /Date range/ }))
    const lastN = screen.getByRole('button', { name: 'Last 20 trades' })
    expect(lastN).toBeDisabled()
    expect(lastN).toHaveAccessibleDescription(CATALOG.reasons.no_earlier)
  })

  it('save_new_inserts_built_widget_in_note', async () => {
    const { editor, insertWidgetEmbed, run } = fakeEditor()
    route('POST', (u) => u === '/api/j2/widget-definitions', () => answer({ ...SAVED, id: 'd-9', rev: 1, usedIn: 0 }))
    route('POST', (u) => u.endsWith('/run'), () => answer(payload({ defId: 'd-9', defRev: 1 })))
    const { onClose } = await openBuilder({ editor })
    fireEvent.click(saveButton())
    await flush()
    const created = callsTo(fetchSpy, 'POST', (u) => u === '/api/j2/widget-definitions')
    expect(created).toHaveLength(1)
    expect(bodyOf(created[0]).plan.source).toBe('closed_trades')
    expect(bodyOf(created[0]).name).toBeUndefined()            // the server names it from the plan
    const runs = callsTo(fetchSpy, 'POST', (u) => u.endsWith('/run'))
    expect(bodyOf(runs[0])).toMatchObject({ defId: 'd-9', defRev: 1 })
    expect(insertWidgetEmbed).toHaveBeenCalledWith('builtWidget', expect.objectContaining({ defId: 'd-9', defRev: 1 }))
    expect(run).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('editing_used_in_14_asks_update_all_or_new', async () => {
    const { editor } = fakeEditor()
    const getPos = vi.fn(() => null)
    route('GET', (u) => u.endsWith('/widget-definitions/d-1'), () => answer(SAVED))
    route('PUT', (u) => u.endsWith('/d-1'), (u, init) => (bodyOf([u, init]).apply === 'save_new'
      ? answer({ ...SAVED, id: 'd-2', rev: 1, usedIn: 0 }) : answer({ ...SAVED, rev: 4 })))
    route('POST', (u) => u.endsWith('/run'), () => answer(payload({ defId: 'd-2', defRev: 1 })))
    const { onClose } = await openBuilder({ editor, from: { defId: 'd-1', getPos } })
    expect(screen.getByRole('dialog', { name: 'Edit widget' })).toBeInTheDocument()
    // A content change (a measure added).
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }))
    fireEvent.click(screen.getByRole('button', { name: /Win rate/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(saveButton())
    await flush()
    expect(screen.getByText('This widget is in 14 notes.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Update all 14 notes/ })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /Save as a new widget/ })).toBeChecked()
    expect(callsTo(fetchSpy, 'PUT', () => true)).toHaveLength(0)       // nothing saved before the answer
    // "Update all" writes no note.
    fireEvent.click(screen.getByRole('radio', { name: /Update all 14 notes/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Update all 14 notes' }))
    await flush()
    const puts = callsTo(fetchSpy, 'PUT', () => true)
    expect(puts).toHaveLength(1)
    expect(bodyOf(puts[0])).toMatchObject({ apply: 'update_all', origin: 'n-1' })
    expect(puts[0][1].headers['If-Match']).toBe('7')
    expect(callsTo(fetchSpy, 'POST', (u) => u.endsWith('/run'))).toHaveLength(0)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('save as a new widget replaces only the source note widget', async () => {
    const { editor } = fakeEditor()
    const node = { type: { name: 'widgetEmbed' }, attrs: { widgetId: 'builtWidget', params: { defId: 'd-1', share: true }, layout: { width: 'half' } } }
    const dispatch = vi.fn()
    const setNodeMarkup = vi.fn(() => 'tr')
    editor.state = { doc: { nodeAt: () => node }, tr: { setNodeMarkup } }
    editor.view = { dispatch }
    route('GET', (u) => u.endsWith('/widget-definitions/d-1'), () => answer(SAVED))
    route('PUT', (u) => u.endsWith('/d-1'), () => answer({ ...SAVED, id: 'd-2', rev: 1, usedIn: 0 }))
    route('POST', (u) => u.endsWith('/run'), () => answer(payload({ defId: 'd-2', defRev: 1 })))
    await openBuilder({ editor, from: { defId: 'd-1', getPos: () => 5 } })
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }))
    fireEvent.click(screen.getByRole('button', { name: /Win rate/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(saveButton())
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Save as a new widget' }))
    await flush()
    expect(bodyOf(callsTo(fetchSpy, 'PUT', () => true)[0]).apply).toBe('save_new')
    expect(setNodeMarkup).toHaveBeenCalledTimes(1)
    const [pos, , attrs] = setNodeMarkup.mock.calls[0]
    expect(pos).toBe(5)
    expect(attrs.params).toMatchObject({ defId: 'd-2', defRev: 1, share: true })   // the member's share switch kept
    expect(attrs.layout).toEqual({ width: 'half' })
    expect(dispatch).toHaveBeenCalledWith('tr')
  })

  it('title_only_change_preselects_update_all', async () => {
    route('GET', (u) => u.endsWith('/widget-definitions/d-1'), () => answer(SAVED))
    await openBuilder({ from: { defId: 'd-1', getPos: () => 1 } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My setups' } })
    fireEvent.click(saveButton())
    await flush()
    expect(screen.getByRole('radio', { name: /Update all 14 notes/ })).toBeChecked()
  })

  it('after the first answer, the widget’s last answer is preselected', async () => {
    route('GET', (u) => u.endsWith('/widget-definitions/d-1'), () => answer({ ...SAVED, lastAnswer: 'save_new' }))
    await openBuilder({ from: { defId: 'd-1', getPos: () => 1 } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My setups' } })
    fireEvent.click(saveButton())
    await flush()
    expect(screen.getByRole('radio', { name: /Save as a new widget/ })).toBeChecked()
  })

  it('a widget in one note saves without asking', async () => {
    route('GET', (u) => u.endsWith('/widget-definitions/d-1'), () => answer({ ...SAVED, usedIn: 1 }))
    route('PUT', (u) => u.endsWith('/d-1'), () => answer({ ...SAVED, rev: 4 }))
    const { onClose } = await openBuilder({ from: { defId: 'd-1', getPos: () => 1 } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mine' } })
    fireEvent.click(saveButton())
    await flush()
    expect(screen.queryByText(/This widget is in/)).toBeNull()
    expect(bodyOf(callsTo(fetchSpy, 'PUT', () => true)[0])).toMatchObject({ apply: 'update_all', name: 'Mine' })
    expect(onClose).toHaveBeenCalled()
  })

  it('shelf_widget_saves_as_copy_replacing_node_one_undo', async () => {
    const Widget = Node.create({
      name: 'widgetEmbed', group: 'block', atom: true,
      addAttributes() {
        return {
          widgetId: { default: null }, params: { default: {} }, searchText: { default: '' }, fallback: { default: null },
          capturedAt: { default: null }, layout: { default: null },
        }
      },
      parseHTML() { return [{ tag: 'div[data-w]' }] },
      renderHTML() { return ['div', { 'data-w': '' }] },
    })
    const original = { defId: 'shelf:equity-curve', title: 'Equity curve', asOf: '2026-10-01T00:00:00Z', share: false }
    const editor = new Editor({
      extensions: [StarterKit, Widget],
      content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        { type: 'widgetEmbed', attrs: { widgetId: 'builtWidget', params: original } },
      ] },
    })
    editor.storage.uctJournalWidgets = { noteId: 'n-1', uid: 'u1' }
    const posOf = () => {
      let at = null
      editor.state.doc.descendants((n, p) => { if (n.type.name === 'widgetEmbed') at = p })
      return at
    }
    const plan = { v: 1, source: 'closed_trades', range: { token: 'last_90d' }, measures: [{ key: 'net_pnl' }],
      split: { by: 'day' }, view: { type: 'line', auto: false }, display: { title: 'Equity curve', titleAuto: false, accent: 'gold' } }
    route('GET', (u) => u.endsWith('/shelf'), () => answer({ examples: [{ id: 'shelf:equity-curve', name: 'Equity curve', plan }] }))
    route('POST', (u) => u === '/api/j2/widget-definitions', () => answer({ ...SAVED, id: 'd-copy', rev: 1, usedIn: 0 }))
    route('POST', (u) => u.endsWith('/run'), () => answer(payload({ defId: 'd-copy', defRev: 1, title: 'Equity curve' })))
    const { onClose } = await openBuilder({ editor, from: { defId: 'shelf:equity-curve', getPos: posOf } })
    expect(screen.getByRole('dialog', { name: 'Edit a copy' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Equity curve')
    fireEvent.click(screen.getByRole('button', { name: 'Save as a copy' }))
    await flush()
    expect(bodyOf(callsTo(fetchSpy, 'POST', (u) => u === '/api/j2/widget-definitions')[0]).name).toBe('Equity curve')
    const placed = editor.state.doc.nodeAt(posOf())
    expect(placed.attrs.params.defId).toBe('d-copy')
    let widgets = 0
    editor.state.doc.descendants((n) => { if (n.type.name === 'widgetEmbed') widgets += 1 })
    expect(widgets).toBe(1)                                      // replaced in place, nothing inserted
    expect(onClose).toHaveBeenCalled()
    // ONE undo brings the original back.
    editor.commands.undo()
    expect(editor.state.doc.nodeAt(posOf()).attrs.params).toEqual(original)
    editor.destroy()
  })

  it('conflict_keeps_draft', async () => {
    route('GET', (u) => u.endsWith('/widget-definitions/d-1'), () => answer({ ...SAVED, usedIn: 1 }))
    route('PUT', (u) => u.endsWith('/d-1'), () => refusal(409, 'conflict', 'Changed in another tab. Reload to see the newer version.'))
    const { onClose } = await openBuilder({ from: { defId: 'd-1', getPos: () => 1 } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mine' } })
    fireEvent.click(saveButton())
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent('Changed in another tab. Reload to see the newer version.')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Name')).toHaveValue('Mine')
    const kept = JSON.parse(window.localStorage.getItem(`${DRAFT_PREFIX}u1`))
    expect(kept).toMatchObject({ target: 'd-1', plan: { display: { title: 'Mine' } } })
    expect(saveButton()).toBeEnabled()
  })

  it('escape_backs_one_level_then_asks_keep', async () => {
    const { onClose } = await openBuilder()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mine' } })
    const chip = screen.getByRole('button', { name: /Date range/ })
    fireEvent.click(chip)
    expect(screen.getByRole('heading', { name: 'Date range' })).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    expect(screen.queryByRole('heading', { name: 'Date range' })).toBeNull()
    expect(document.activeElement).toBe(chip)                  // focus returns to the control that opened it
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.getByText(KEEP_QUESTION)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    const kept = JSON.parse(window.localStorage.getItem(`${DRAFT_PREFIX}u1`))
    expect(kept.plan.display.title).toBe('Mine')
    expect(typeof kept.at).toBe('number')
  })

  it('escape with nothing changed closes without asking', async () => {
    const { onClose } = await openBuilder()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByText(KEEP_QUESTION)).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('resume_draft_within_24h', async () => {
    const plan = { ...SAVED.plan, source: 'trading_days', measures: [{ key: 'avg_day_pnl' }] }
    window.localStorage.setItem(`${DRAFT_PREFIX}u1`, JSON.stringify({ v: 1, at: Date.now() - 2 * 3600e3, plan, nameTouched: false, target: null }))
    const first = await openBuilder()
    expect(screen.getByText(RESUME_OFFER)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Closed trades' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByRole('radio', { name: 'Trading days' })).toBeChecked()
    expect(screen.queryByText(RESUME_OFFER)).toBeNull()
    first.unmount()
    // Older than a day: no offer, and the stale draft is gone.
    window.localStorage.setItem(`${DRAFT_PREFIX}u1`, JSON.stringify({ v: 1, at: Date.now() - DRAFT_TTL_MS - 1000, plan, nameTouched: false, target: null }))
    const second = await openBuilder()
    expect(screen.queryByText(RESUME_OFFER)).toBeNull()
    expect(window.localStorage.getItem(`${DRAFT_PREFIX}u1`)).toBeNull()
    second.unmount()
    // Another widget's draft is not offered to a new one.
    window.localStorage.setItem(`${DRAFT_PREFIX}u1`, JSON.stringify({ v: 1, at: Date.now(), plan, nameTouched: false, target: 'd-1' }))
    await openBuilder()
    expect(screen.queryByText(RESUME_OFFER)).toBeNull()
  })

  it('ctrl_enter_saves', async () => {
    route('POST', (u) => u === '/api/j2/widget-definitions', () => answer({ ...SAVED, id: 'd-9', rev: 1, usedIn: 0 }))
    const { onClose } = await openBuilder()
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter', ctrlKey: true })
    await flush()
    expect(callsTo(fetchSpy, 'POST', (u) => u === '/api/j2/widget-definitions')).toHaveLength(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('ctrl+z undoes and ctrl+shift+z redoes', async () => {
    await openBuilder()
    fireEvent.click(screen.getByRole('radio', { name: 'Trading days' }))
    expect(screen.getByRole('radio', { name: 'Trading days' })).toBeChecked()
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(screen.getByRole('radio', { name: 'Closed trades' })).toBeChecked()
    fireEvent.keyDown(document.body, { key: 'Z', ctrlKey: true, shiftKey: true })
    expect(screen.getByRole('radio', { name: 'Trading days' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('radio', { name: 'Closed trades' })).toBeChecked()
  })

  it('live_region_announces_summary_only', async () => {
    await openBuilder()
    const live = screen.getByTestId('builder-live')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toHaveTextContent('')                          // not yet: it waits for the summary to settle
    await flush(ANNOUNCE_DELAY_MS)
    expect(live).toHaveTextContent(SUMMARY)
    expect(live.textContent).toBe(SUMMARY)
    // A failure is shown, never announced through this region.
    route('POST', (u) => u.endsWith('/preview'), () => refusal(503, 'busy', 'x'))
    fireEvent.change(screen.getByLabelText('Target for a progress bar'), { target: { value: '3' } })
    await flush(PREVIEW_DEBOUNCE_MS + ANNOUNCE_DELAY_MS)
    expect(live.textContent).toBe(SUMMARY)
    // The only live region in the builder.
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1)
  })

  it('chip_has_remove_button_named_by_sentence', async () => {
    await openBuilder()
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Setup' }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Flag' }))
    fireEvent.click(screen.getByRole('button', { name: 'VCP' }))
    // Member text is a string, never an object key.
    expect(screen.getByRole('button', { name: '__proto__' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    const chip = screen.getByRole('button', { name: 'Setup is Flag or VCP' })
    expect(chip).toBeInTheDocument()
    const remove = screen.getByRole('button', { name: 'Remove filter: Setup is Flag or VCP' })
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(bodyOf(previews().at(-1)).plan.filters).toEqual([{ field: 'setup', op: 'in', values: ['Flag', 'VCP'], overridable: false }])
    fireEvent.click(remove)
    expect(screen.queryByRole('button', { name: 'Setup is Flag or VCP' })).toBeNull()
  })

  it('every section has a heading', async () => {
    await openBuilder()
    for (const name of ['What to look at', 'Which ones', 'What to measure', 'Split it by', 'Show it as', 'Name it']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
  })

  it('a needs measure shows its coverage from the last preview', async () => {
    route('POST', (u) => u.endsWith('/preview'), () => answer(payload({
      measures: [{ label: 'Net P&L', unit: 'trades', kind: 'sum', fmt: 'money' }, { label: 'Expectancy (R)', unit: 'trades', kind: 'average', fmt: 'r' }],
      coverage: [null, { have: 23, total: 47, hint: null }],
    })))
    await openBuilder()
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }))
    fireEvent.click(screen.getByRole('button', { name: /Expectancy \(R\)/ }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(screen.getAllByText('R known on 23 of 47 trades').length).toBeGreaterThan(0)
  })

  it('member words: the builder never says definition, shelf, built widget, source, plan or scope', async () => {
    await openBuilder()
    const opened = [
      () => fireEvent.click(screen.getByRole('button', { name: /Date range/ })),
      () => fireEvent.click(screen.getByRole('button', { name: 'Filter' })),
      () => fireEvent.click(screen.getByRole('button', { name: 'Measure' })),
      () => fireEvent.click(screen.getByRole('button', { name: 'No split. Pick one' })),
    ]
    const banned = /\b(definitions?|shelf|built widgets?|sources?|plans?|scopes?)\b/i
    const sweep = () => {
      const panel = document.querySelector('[data-sheet-panel]')
      const text = panel.textContent
      const labels = [...panel.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label')).join(' ')
      expect(`${text} ${labels}`).not.toMatch(banned)
    }
    sweep()
    for (const open of opened) {
      open()
      sweep()
      fireEvent.keyDown(document.body, { key: 'Escape' })
    }
  })

  it('openWidgetBuilder mounts one builder at a time and closes it', async () => {
    let close1
    let close2
    act(() => { close1 = openWidgetBuilder({ editor: null }) })
    act(() => { close2 = openWidgetBuilder({ editor: null }) })
    expect(close2).toBe(close1)
    await flush()
    expect(document.querySelectorAll('[data-widget-builder-root]')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Build a widget' })).toBeInTheDocument()
    act(() => close1())
    await flush()
    expect(document.querySelectorAll('[data-widget-builder-root]')).toHaveLength(0)
  })
})
