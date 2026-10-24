// Wave 8 (Task 8.15 fix 1): the review's findings, each with a test that fails without its fix.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import WidgetBuilderSheet, {
  PREVIEW_DEBOUNCE_MS, STALE_DRAFT, SAVED_NOT_PLACED, SAVED_COPY_SENTENCE, KEEP_FAILED, KEEP_QUESTION, isTextControl,
} from './WidgetBuilderSheet'
import { ANNOUNCE_DELAY_MS, SAMPLE_LABEL } from './PreviewPane'
import { DRAFT_PREFIX } from './builderDraft'
import { openWidgetBuilder } from './openWidgetBuilder'
import { viewReason, autoView, indexCatalog, CHECK_TESTS } from './builderCatalog'
import { blankPlan } from './builderState'
import { __resetBuiltCaches, FAILURE_COPY } from '../../../lib/builtWidgets'
import {
  installFetch, answer, refusal, payload, callsTo, bodyOf, SUMMARY, CATALOG,
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
  vi.restoreAllMocks()
})

const route = (method, test, reply) => routes.unshift([method, test, reply])
const saveButton = () => screen.getByTestId('builder-save')
const DEFS = '/api/j2/widget-definitions'

async function openBuilder(props = {}) {
  const onClose = vi.fn()
  const utils = render(<WidgetBuilderSheet uid="u1" onClose={onClose} {...props} />)
  await flush()
  await flush(PREVIEW_DEBOUNCE_MS)
  return { ...utils, onClose }
}

function fakeEditor(node = null) {
  const run = vi.fn(() => true)
  const insertWidgetEmbed = vi.fn(() => ({ run }))
  const setNodeMarkup = vi.fn(() => 'tr')
  const dispatch = vi.fn()
  const editor = {
    isEditable: true, storage: { uctJournalWidgets: { noteId: 'n-1', uid: 'u1' } }, chain: () => ({ insertWidgetEmbed }),
    state: { doc: { nodeAt: () => node, descendants: () => {} }, tr: { setNodeMarkup } }, view: { dispatch, nodeDOM: () => null },
  }
  return { editor, insertWidgetEmbed, setNodeMarkup, dispatch }
}
const placed = (params) => ({ type: { name: 'widgetEmbed' }, attrs: { widgetId: 'builtWidget', params, layout: null } })

const SAVED = { id: 'd-1', name: 'Mine', rev: 3, placedRev: 3, etag: 7, archived: false, usedIn: 14, lastAnswer: null,
  summary: SUMMARY, plan: { ...blankPlan(), measures: [{ key: 'net_pnl' }] } }

describe('Task 8.15 fix 1', () => {
  it('I-2: a saved-but-not-placed widget saves the edits made since, then places the NEWEST revision', async () => {
    const { editor, insertWidgetEmbed } = fakeEditor()
    route('POST', (u) => u === DEFS, () => answer({ ...SAVED, id: 'd-9', rev: 1, etag: 1, usedIn: 0 }))
    let runs = 0
    route('POST', (u) => u.endsWith('/run'), (u, init) => {
      runs += 1
      return runs === 1 ? refusal(503, 'busy', 'x') : answer(payload({ defId: 'd-9', defRev: bodyOf([u, init]).defRev }))
    })
    route('PUT', (u) => u.endsWith('/d-9'), () => answer({ ...SAVED, id: 'd-9', rev: 2, etag: 2, usedIn: 0 }))
    const { onClose } = await openBuilder({ editor })
    fireEvent.click(saveButton())
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent(SAVED_NOT_PLACED)
    expect(insertWidgetEmbed).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed after' } })
    fireEvent.click(saveButton())
    await flush()
    expect(callsTo(fetchSpy, 'POST', (u) => u === DEFS)).toHaveLength(1)        // never a second widget
    const put = callsTo(fetchSpy, 'PUT', () => true)
    expect(put).toHaveLength(1)
    expect(bodyOf(put[0])).toMatchObject({ apply: 'update_all', name: 'Renamed after' })
    expect(put[0][1].headers['If-Match']).toBe('1')
    expect(bodyOf(callsTo(fetchSpy, 'POST', (u) => u.endsWith('/run')).at(-1)).defRev).toBe(2)
    expect(insertWidgetEmbed).toHaveBeenCalledWith('builtWidget', expect.objectContaining({ defRev: 2 }))
    expect(onClose).toHaveBeenCalled()
  })

  it('I-4: on sample data the summary line and the announcement start "Sample data ·"', async () => {
    route('POST', (u) => u.endsWith('/preview'), () => answer(payload({ sample: true })))
    await openBuilder()
    expect(within(screen.getByTestId('builder-preview')).getByText(SAMPLE_LABEL)).toBeInTheDocument()
    await flush(ANNOUNCE_DELAY_MS)
    expect(screen.getByTestId('builder-live').textContent).toBe(`Sample data · ${SUMMARY}`)
  })

  it('I-6: Ctrl+Z in a text field and Ctrl+Z inside a picker leave the builder history alone', async () => {
    await openBuilder()
    fireEvent.click(screen.getByRole('radio', { name: 'Trading days' }))
    const name = screen.getByLabelText('Name')
    fireEvent.keyDown(name, { key: 'z', ctrlKey: true })
    expect(screen.getByRole('radio', { name: 'Trading days' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Date range/ }))
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: /Back to the widget/ }))
    expect(screen.getByRole('radio', { name: 'Trading days' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true })
    expect(screen.getByRole('radio', { name: 'Closed trades' })).toHaveAttribute('aria-checked', 'true')
    expect(isTextControl(name)).toBe(true)
    expect(isTextControl(screen.getByRole('button', { name: 'Undo' }))).toBe(false)
  })

  it('I-7: a draft of a widget that changed since offers only "Save as a new widget", never an overwrite', async () => {
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer(SAVED))
    route('PUT', (u) => u.endsWith('/d-1'), () => answer({ ...SAVED, id: 'd-2', rev: 1, usedIn: 0 }))
    window.localStorage.setItem(`${DRAFT_PREFIX}u1`, JSON.stringify({ v: 1, at: Date.now() - 60000,
      plan: { ...SAVED.plan, display: { ...SAVED.plan.display, title: 'Kept', titleAuto: false } }, nameTouched: true,
      target: 'd-1', etag: 5 }))
    const { onClose } = await openBuilder({ from: { defId: 'd-1', getPos: () => 1 } })
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByText(STALE_DRAFT)).toBeInTheDocument()
    expect(saveButton()).toHaveTextContent('Save as a new widget')
    fireEvent.click(saveButton())
    await flush()
    expect(screen.queryByText(/This widget is in/)).toBeNull()                   // no Update all on offer
    const puts = callsTo(fetchSpy, 'PUT', () => true)
    expect(puts.map((c) => bodyOf(c).apply)).toEqual(['save_new'])
    expect(onClose).toHaveBeenCalled()
  })

  it('I-7: a draft kept at the same etag resumes as an ordinary edit', async () => {
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer(SAVED))
    window.localStorage.setItem(`${DRAFT_PREFIX}u1`, JSON.stringify({ v: 1, at: Date.now(), plan: SAVED.plan,
      nameTouched: false, target: 'd-1', etag: 7 }))
    await openBuilder({ from: { defId: 'd-1', getPos: () => 1 }, start: 'resume' })
    expect(screen.queryByText(STALE_DRAFT)).toBeNull()
    expect(saveButton()).toHaveTextContent('Save')
  })

  it('I-7: keeping a draft records the widget etag', async () => {
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer(SAVED))
    await openBuilder({ from: { defId: 'd-1', getPos: () => 1 } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
    expect(JSON.parse(window.localStorage.getItem(`${DRAFT_PREFIX}u1`)).etag).toBe(7)
  })

  it('I-8: side, regime and month offer lists or a month picker, never a blank text box', async () => {
    await openBuilder()
    const openField = async (name) => {
      fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
      fireEvent.click(screen.getByRole('button', { name }))
      await flush()
    }
    await openField('Side')
    expect(screen.getByRole('button', { name: 'Long' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Short' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Back to the widget/ }))
    await openField('Regime at entry')
    expect(screen.getByRole('button', { name: 'Yellow' })).toBeInTheDocument()     // the member's word
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Yellow' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    expect(screen.getByRole('button', { name: 'Regime at entry is Yellow' })).toBeInTheDocument()
    await openField('Month')
    const month = screen.getByLabelText('Pick a month')
    expect(month).toHaveAttribute('type', 'month')
  })

  it('I-9: the door returns focus to `returnFocus` when the builder closes without placing', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    let close
    act(() => { close = openWidgetBuilder({ editor: null, returnFocus: opener }) })
    await flush()
    act(() => close())
    await flush()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('I-9: the door focuses what the builder hands it (the placed widget) over returnFocus', async () => {
    const opener = document.createElement('button')
    const widget = document.createElement('div')
    widget.tabIndex = -1
    document.body.append(opener, widget)
    let close
    act(() => { close = openWidgetBuilder({ editor: null, returnFocus: opener }) })
    await flush()
    act(() => close(widget))
    await flush()
    expect(document.activeElement).toBe(widget)
    opener.remove(); widget.remove()
  })

  it('I-10: a deleted widget opens from the note’s saved copy, as "Save as a copy" with the 5.10 sentence', async () => {
    const def = { ...SAVED.plan, display: { ...SAVED.plan.display, title: 'From the note', titleAuto: false } }
    const { editor, setNodeMarkup } = fakeEditor(placed({ defId: 'd-gone', def, share: false }))
    route('GET', (u) => u.endsWith(`${DEFS}/d-gone`), () => answer({ detail: 'Not Found' }, 404))
    route('POST', (u) => u === DEFS, () => answer({ ...SAVED, id: 'd-copy', rev: 1, usedIn: 0 }))
    route('POST', (u) => u.endsWith('/run'), () => answer(payload({ defId: 'd-copy', defRev: 1 })))
    await openBuilder({ editor, from: { defId: 'd-gone', getPos: () => 4 } })
    expect(screen.getByRole('dialog', { name: 'Edit a copy' })).toBeInTheDocument()
    expect(screen.getByText(SAVED_COPY_SENTENCE)).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('From the note')
    fireEvent.click(screen.getByRole('button', { name: 'Save as a copy' }))
    await flush()
    expect(bodyOf(callsTo(fetchSpy, 'POST', (u) => u === DEFS)[0]).plan.display.title).toBe('From the note')
    expect(setNodeMarkup).toHaveBeenCalledWith(4, undefined, expect.objectContaining({
      params: expect.objectContaining({ defId: 'd-copy' }) }))
  })

  it('I-10: a 404 with no saved copy in the note says it is not available', async () => {
    route('GET', (u) => u.endsWith(`${DEFS}/d-gone`), () => answer({ detail: 'Not Found' }, 404))
    await openBuilder({ from: { defId: 'd-gone', getPos: () => 4 } })
    expect(screen.getByRole('alert')).toHaveTextContent(FAILURE_COPY.unavailable)
  })

  it('I-12: arrow keys move focus across the tiles without changing what is looked at', async () => {
    await openBuilder()
    const closed = screen.getByRole('radio', { name: 'Closed trades' })
    const open = screen.getByRole('radio', { name: 'Open positions' })
    expect(closed).toHaveAttribute('tabindex', '0')
    expect(open).toHaveAttribute('tabindex', '-1')
    closed.focus()
    fireEvent.keyDown(closed, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(open)
    expect(closed).toHaveAttribute('aria-checked', 'true')                       // nothing reset
    expect(open).toHaveAttribute('tabindex', '0')
    fireEvent.click(open)                                                        // Enter / Space click a button
    expect(open).toHaveAttribute('aria-checked', 'true')
  })

  it('I-13 (R-36): a widget in one note, opened from it, is replaced by its new revision there', async () => {
    const { editor, setNodeMarkup } = fakeEditor(placed({ defId: 'd-1', share: false }))
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer({ ...SAVED, usedIn: 1 }))
    route('PUT', (u) => u.endsWith('/d-1'), () => answer({ ...SAVED, rev: 4, etag: 8, usedIn: 1 }))
    route('POST', (u) => u.endsWith('/run'), () => answer(payload({ defId: 'd-1', defRev: 4 })))
    await openBuilder({ editor, from: { defId: 'd-1', getPos: () => 2 } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mine now' } })
    fireEvent.click(saveButton())
    await flush()
    expect(bodyOf(callsTo(fetchSpy, 'PUT', () => true)[0]).apply).toBe('update_all')
    expect(bodyOf(callsTo(fetchSpy, 'POST', (u) => u.endsWith('/run'))[0])).toMatchObject({ defId: 'd-1', defRev: 4 })
    expect(setNodeMarkup).toHaveBeenCalledWith(2, undefined, expect.objectContaining({
      params: expect.objectContaining({ defRev: 4 }) }))
  })

  it('replaceNode never overwrites a different widget, and writes nothing when the placed widget is gone', async () => {
    const { editor, setNodeMarkup, insertWidgetEmbed } = fakeEditor(placed({ defId: 'someone-else' }))
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer({ ...SAVED, usedIn: 1 }))
    route('PUT', (u) => u.endsWith('/d-1'), () => answer({ ...SAVED, rev: 4, usedIn: 1 }))
    route('POST', (u) => u.endsWith('/run'), () => answer(payload({ defId: 'd-1', defRev: 4 })))
    for (const getPos of [() => 2, () => { throw new Error('gone') }]) {
      const { unmount, onClose } = await openBuilder({ editor, from: { defId: 'd-1', getPos } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mine now' } })
      fireEvent.click(saveButton())
      await flush()
      expect(onClose).toHaveBeenCalled()                    // saved...
      unmount()
    }
    expect(setNodeMarkup).not.toHaveBeenCalled()            // ...but another widget is never overwritten
    expect(insertWidgetEmbed).not.toHaveBeenCalled()        // and no stray copy lands at the caret
  })

  it('I-14: the count cap, a raw 428 and too-new each say their sentence and keep the draft', async () => {
    route('POST', (u) => u === DEFS, () => refusal(409, 'count_cap', 'x'))
    const a = await openBuilder()
    fireEvent.click(saveButton())
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent(FAILURE_COPY.count_cap)
    expect(a.onClose).not.toHaveBeenCalled()
    a.unmount()
    routes.shift()
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer({ ...SAVED, usedIn: 1 }))
    route('PUT', (u) => u.endsWith('/d-1'), () => answer({}, 428))
    const b = await openBuilder({ from: { defId: 'd-1', getPos: () => 1 } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } })
    fireEvent.click(saveButton())
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent(FAILURE_COPY.conflict)
    b.unmount()
    routes.shift(); routes.shift()
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer({ ...SAVED, tooNew: true, summary: 'Net P&L by setup.' }))
    await openBuilder({ from: { defId: 'd-1', getPos: () => 1 } })
    expect(screen.getByRole('alert')).toHaveTextContent(FAILURE_COPY.too_new)
    expect(screen.getByText('Net P&L by setup.')).toBeInTheDocument()
    expect(screen.queryByTestId('builder-save')).toBeNull()
  })

  it('I-14: superseded says nothing and keeps the result; Show as table draws the same rows as a table', async () => {
    route('POST', (u) => u.endsWith('/preview'), () => answer(payload({ view: 'bar', rows: [
      { label: 'Flag', label2: null, v1: 100, n1: 3, s1: '', n: 3, flagged: false }] })))
    await openBuilder()
    routes.shift()
    route('POST', (u) => u.endsWith('/preview'), () => refusal(409, 'superseded', 'A newer preview replaced this one.'))
    fireEvent.change(screen.getByLabelText('Target for a progress bar'), { target: { value: '3' } })
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(screen.queryByText('A newer preview replaced this one.')).toBeNull()
    expect(screen.getByTestId('builder-preview-view').className).not.toMatch(/dimmed/)
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    expect(screen.getByTestId('built-table-alt')).toBeInTheDocument()
    expect(within(screen.getByTestId('built-table-alt')).getByText('Flag')).toBeInTheDocument()
  })

  it('I-14: member words across the filter editor, the save question, the keep question and the descriptions', async () => {
    route('GET', (u) => u.endsWith(`${DEFS}/d-1`), () => answer(SAVED))
    await openBuilder({ from: { defId: 'd-1', getPos: () => 1 } })
    const banned = /\b(definitions?|shelf|built widgets?|sources?|plans?|scopes?)\b/i
    const sweep = () => {
      const panel = document.querySelector('[data-sheet-panel]')
      const described = [...panel.querySelectorAll('[aria-describedby]')].flatMap((el) => el.getAttribute('aria-describedby')
        .split(' ').map((id) => document.getElementById(id)?.textContent || ''))
      const labels = [...panel.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label'))
      const all = [panel.textContent, ...labels, ...described].join(' ').replace(/trading plan/gi, '')
      expect(all).not.toMatch(banned)
    }
    // every field's filter editor, on the real catalog
    for (let i = 0; i < CATALOG.sources[0].fields.length; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
      fireEvent.click(within(screen.getByRole('list', { name: 'Fields' })).getAllByRole('button')[i])
      await flush()
      sweep()
      fireEvent.keyDown(document.body, { key: 'Escape' })
    }
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } })
    fireEvent.click(saveButton())
    await flush()
    expect(screen.getByText('This widget is in 14 notes.')).toBeInTheDocument()
    sweep()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.getByText(KEEP_QUESTION)).toBeInTheDocument()
    sweep()
  })

  it('R-35: the builder evaluates the SERVER’s view rules: change the rules and the answer changes', () => {
    const cat = indexCatalog(CATALOG)
    const plan = { ...blankPlan(), measures: [{ key: 'net_pnl' }] }
    expect(viewReason(cat, plan, 'bar')).toBe(CATALOG.reasons.view_bar)
    const without = indexCatalog({ ...CATALOG, viewRules: { ...CATALOG.viewRules,
      checks: CATALOG.viewRules.checks.filter((c) => c.reason !== 'view_bar') } })
    expect(viewReason(without, plan, 'bar')).toBeNull()
    expect(autoView(cat, { ...plan, split: { by: 'day', then: null } })).toBe('line')
    expect(autoView(indexCatalog({ ...CATALOG, viewRules: { ...CATALOG.viewRules,
      auto: { ...CATALOG.viewRules.auto, time: 'bar' } } }), { ...plan, split: { by: 'day', then: null } })).toBe('bar')
    // Every test the server sends is one the builder can evaluate.
    for (const c of CATALOG.viewRules.checks) expect(Object.hasOwn(CHECK_TESTS, c.test)).toBe(true)
  })

  it('minor: a catalog read refused while the wave is dark says "Not available right now."', async () => {
    route('GET', (u) => u.endsWith('/vocabulary'), () => answer({ detail: 'Not Found' }, 404))
    await openBuilder()
    expect(screen.getByRole('alert')).toHaveTextContent(FAILURE_COPY.unavailable)
  })

  it('minor: Ctrl+Enter does not save while a filter is being edited', async () => {
    await openBuilder()
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hold days' }))
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true })
    await flush()
    expect(callsTo(fetchSpy, 'POST', (u) => u === DEFS)).toHaveLength(0)
  })

  it('minor: an error inside the builder frees the door; the editor going away closes it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = { get defId() { throw new Error('boom') } }
    act(() => { openWidgetBuilder({ editor: null, from: bad }) })
    await flush()
    await flush()
    expect(document.querySelectorAll('[data-widget-builder-root]')).toHaveLength(0)
    const handlers = new Map()
    const editor = { storage: {}, on: (e, fn) => handlers.set(e, fn), off: (e) => handlers.delete(e) }
    act(() => { openWidgetBuilder({ editor }) })
    await flush()
    expect(document.querySelectorAll('[data-widget-builder-root]')).toHaveLength(1)
    act(() => handlers.get('destroy')())
    await flush()
    expect(document.querySelectorAll('[data-widget-builder-root]')).toHaveLength(0)
    expect(handlers.has('destroy')).toBe(false)
  })

  it('minor: a draft that cannot be kept says so and does not close', async () => {
    const { onClose } = await openBuilder()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(KEEP_FAILED)
  })

  it('minor: a changeable filter chip is still named by its sentence alone', async () => {
    await openBuilder()
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Side' }))
    fireEvent.click(screen.getByRole('button', { name: 'Long' }))
    fireEvent.click(screen.getByLabelText('Let each note change this filter'))
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    const chip = screen.getByRole('button', { name: 'Side is Long' })
    expect(chip).toHaveAccessibleDescription('Changeable in the note')
  })

  it('minor: the resume offer takes focus; a disabled measure stays focusable; the title is a heading', async () => {
    window.localStorage.setItem(`${DRAFT_PREFIX}u1`, JSON.stringify({ v: 1, at: Date.now(), plan: blankPlan(), nameTouched: false, target: null }))
    await openBuilder()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Build a widget' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }))
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }))
    for (const m of ['Win rate', 'Trades']) fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${m}`) }))
    const off = screen.getByRole('button', { name: /^Expectancy \(R\)/ })
    expect(off).toHaveAttribute('aria-disabled', 'true')
    expect(off).not.toBeDisabled()
    off.focus()
    expect(document.activeElement).toBe(off)
    expect(off).toHaveAccessibleDescription(/Average R per trade/)
    fireEvent.click(off)
    expect(off).toHaveAttribute('aria-pressed', 'false')
  })

  it('minor: unit-correct nouns and "a"/"an" before a field', async () => {
    route('GET', (u) => u.includes('/vocabulary?field=emotion'), () => refusal(500, 'failed'))
    await openBuilder()
    fireEvent.click(screen.getByRole('radio', { name: 'Trading days' }))
    expect(screen.getByText('Show how many days each figure is from')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Closed trades' }))
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Emotion' }))
    await flush()
    expect(screen.getByLabelText('Type an emotion')).toBeInTheDocument()
  })
})
