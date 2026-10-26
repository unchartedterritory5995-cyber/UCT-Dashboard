// Wave 11 Task 11.17: the adoption sheet, "Make it yours". Every assertion reads what the member SEES (text, roles,
// names, values) or what the server is SENT (path, method, body), never component state. `fetch` is a fake gallery
// server whose answers have the shapes of Task 11.12's routes (built by 11.8/11.9, not yet merged here):
//   POST /{gid}/preview-mine  -> {slots: [{id, type, label, any, suggested, value}], cards, tools, questions}
//   POST /{gid}/use-template  -> {note, skipped, style, credit, created}
//   POST /{gid}/adopt-tool    -> {kind, id, credit}
// with the slot types and the `any` flag of widget_engine/share.py's `_Slots.take`, refusals {detail: {code, message}}.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import AdoptSheet, {
  ADDED_SENTENCE, ADDED_TEMPLATE_SENTENCE, DEBOUNCE_MS, MISSING_HINT, TITLE, UPDATED_SENTENCE, creditLine, createWords, useYourWords,
} from './AdoptSheet'
import { openAdoptSheet } from './openAdoptSheet'

vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => true, useIsTouch: () => true, useIsTablet: () => false, useIsDesktop: () => false,
  useHasCoarsePointer: () => true, useHasNoHover: () => true,
}))

const GID = 'g-setup-study'
const BASE = `/api/j2/template-gallery/${GID}`
const PREVIEW = `${BASE}/preview-mine`
const USE = `${BASE}/use-template`
const ADOPT_TOOL = `${BASE}/adopt-tool`
const VOCAB = '/api/j2/widget-definitions/vocabulary?field='
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true })
const S_PICK_SETUP = 'Pick a setup to see this widget.'
const S_NOT_YOURS = "That choice isn't in your account."
const S_UNRESOLVED = 'Every choice needs an answer before this can be used.'
const S_CAP = 'You have 100 widgets. Archive one in My tools to make room.'

// ── the fake server ────────────────────────────────────────────────────────────────────────────────

const SETUP = { id: 'p1', type: 'setup', label: 'Setup', any: false }
const ACCOUNT = { id: 'p2', type: 'account', label: 'Account', any: true }
const TAG = { id: 'p3', type: 'tag', label: 'Tag', any: true }
const HOLD = { id: 'p4', type: 'number', label: 'Hold days', any: false }

/** A member with data: the setup and the tag have suggestions; the account has none, so it starts at Any. */
const RICH_SLOTS = [
  { ...SETUP, suggested: { value: 'Breakout', label: 'Breakout' } },
  { ...ACCOUNT, suggested: null },
  { ...TAG, suggested: { value: 'a-plus', label: 'A+' } },
]
// lib/builtWidgets caches each field's values per tab (per test file here): every test reads the same lists.
const VOCAB_VALUES = { setup: ['Breakout', 'Pullback', 'Flag'], account: [{ id: 'acc-1', name: 'Main' }], tag: [] }
const QUESTIONS = [{ slot: 'routine_a', kind: 'routine', createName: 'Pre-market routine', use: { id: 'r-mine', name: 'Morning routine' } }]

/** What preview_mine answers for these answers (each slot at its answer, else its suggestion, else Any). */
function previewAnswer(slots, { questions = [], tools = [], sample = false, credit } = {}) {
  return (body) => {
    const a = body?.answers || {}
    const used = slots.map((s) => ({
      ...s,
      value: Object.hasOwn(a, s.id) ? a[s.id] : (s.suggested ? s.suggested.value : (s.any ? { any: true } : null)),
    }))
    const unresolved = used.find((s) => s.value === null && !s.any)
    const card = unresolved
      ? { slot: 'built_a', title: 'Win rate by setup', sentence: `Pick a ${unresolved.label.toLowerCase()} to see this widget.`, sample: false }
      : { slot: 'built_a', title: 'Win rate by setup', payload: { view: 'bar', rows: [{ v1: 3 }, { v1: 2 }] }, sample }
    return { slots: used, cards: [card], tools, questions, ...(credit ? { credit } : {}) }
  }
}
const TOOLS = [{ slot: 'routine_a', kind: 'routine', name: 'Pre-market routine', items: [{ text: 'Check news' }, { text: 'Mark levels' }], bind: 'note-day', forDayLabel: 'For the day of the note' }]

/** A gallery server. `preview(body)` answers preview-mine; `use(body)` / `adopt(body)` the two writes (a body for
 *  200, or {__status, body}). Every request is recorded; `hold` makes each preview wait until released. */
function installServer({ preview, use, adopt, hold = false, vocab = VOCAB_VALUES, routines = [] } = {}) {
  const calls = []
  const pending = []
  const reply = (fn, body, fallback) => {
    const out = fn ? fn(body) : fallback
    return out && out.__status ? json(out.__status, out.body) : json(200, out)
  }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ url, method: init.method || 'GET', body, key: init.headers?.['Idempotency-Key'] })
    const answer = () => {
      if (url === PREVIEW) return reply(preview, body)
      if (url === USE) return reply(use, body, { note: { id: 'n-new', title: 'Setup study' }, skipped: [], style: { id: 's1' }, credit: null, created: { routines: [], trackers: [], widgets: [] } })
      if (url === ADOPT_TOOL) return reply(adopt, body, { kind: 'widget', id: 'd-new', credit: "Based on Sam's Win rate" })
      if (url.startsWith(VOCAB)) return json(200, { field: url.slice(VOCAB.length), values: vocab[url.slice(VOCAB.length)] || [] })
      if (url.startsWith('/api/j2/routines?')) return json(200, { routines })
      return json(404, {})
    }
    if (hold && url === PREVIEW) return new Promise((resolve) => pending.push(() => resolve(answer())))
    return answer()
  })
  return {
    calls,
    previews: () => calls.filter((c) => c.url === PREVIEW),
    posts: () => calls.filter((c) => c.method === 'POST'),
    release: () => { const r = pending.shift(); r?.() },
    waiting: () => pending.length,
  }
}
const refuse = (code, message, status = 400) => () => ({ __status: status, body: { detail: { code, message } } })

function mount(props = {}) {
  const onClose = vi.fn()
  const onDone = vi.fn()
  const navigate = vi.fn()
  render(<AdoptSheet galleryId={GID} kind="template" onClose={onClose} onDone={onDone} navigate={navigate} {...props} />)
  return { onClose, onDone, navigate }
}
const useButton = () => screen.getByRole('button', { name: 'Use' })
const pickerCancel = () => within(document.querySelector('[data-slot-picker]')).getByRole('button', { name: 'Cancel' })
const rowText = (id) => document.querySelector(`[data-slot="${id}"] span`).textContent
const settle = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const ready = () => waitFor(() => expect(document.querySelector('[data-slot]')).not.toBeNull())

beforeEach(() => { setOnline(true) })
afterEach(() => { cleanup(); setOnline(true); vi.useRealTimers() })

// ── opening ──────────────────────────────────────────────────────────────────────────────────────────

describe('opening the sheet', () => {
  it('opens_with_one_preview_and_suggested_values', async () => {
    const net = installServer({ preview: previewAnswer(RICH_SLOTS, { questions: QUESTIONS, tools: TOOLS }) })
    mount()
    expect(await screen.findByRole('dialog', { name: TITLE })).toBeTruthy()
    await ready()
    expect(rowText('p1')).toBe('Setup: Breakout')
    expect(rowText('p2')).toBe('Account: Any account')
    expect(rowText('p3')).toBe('Tag: A+')
    // The preview is on screen at once: the server's card and the routine's items with its day, never day state.
    expect(await screen.findByText('Win rate by setup')).toBeTruthy()
    const tool = document.querySelector('[data-preview-tool="routine_a"]')
    expect(tool.textContent).toContain('Check news')
    expect(tool.textContent).toContain('For the day of the note')
    // ONE preview, asked with no answers: the server picks the suggestions.
    await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 100))
    expect(net.previews()).toHaveLength(1)
    expect(net.previews()[0].body).toEqual({})
    expect(net.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('a thin account: no suggestion and no Any reads the server sentence, never a zero, and Use waits for a pick', async () => {
    installServer({ preview: previewAnswer([{ ...SETUP, suggested: null }]) })
    mount()
    await ready()
    expect(rowText('p1')).toBe('Setup: Not picked yet')
    expect(await screen.findByText(S_PICK_SETUP)).toBeTruthy()
    expect(useButton().disabled).toBe(true)
    expect(screen.getByText(MISSING_HINT)).toBeTruthy()
    expect(useButton().getAttribute('aria-describedby')).toBe(document.querySelector('[data-missing]').id)
    // Nothing the sheet itself wrote is a zero.
    const sheet = document.querySelector('[data-adopt-sheet]')
    expect(sheet.textContent).not.toMatch(/(^|[^\d.])0([^\d.]|$)/)
    expect(sheet.textContent).not.toMatch(/\$0|0%|\(0\)/)
  })

  it('fewer than 5 trades: the cards say Sample data', async () => {
    installServer({ preview: previewAnswer(RICH_SLOTS, { sample: true }) })
    mount()
    const card = await waitFor(() => {
      const el = document.querySelector('[data-preview-card="built_a"]')
      expect(el).not.toBeNull()
      return el
    })
    expect(within(card).getByText('Sample data')).toBeTruthy()
  })

  it('a card with its own data carries no Sample data label', async () => {
    installServer({ preview: previewAnswer(RICH_SLOTS, { sample: false }) })
    mount()
    await screen.findByText('Win rate by setup')
    expect(screen.queryByText('Sample data')).toBeNull()
  })
})

// ── Use ───────────────────────────────────────────────────────────────────────────────────────────────

describe('Use', () => {
  it('one_tap_use_sends_suggestions', async () => {
    const net = installServer({ preview: previewAnswer(RICH_SLOTS, { questions: QUESTIONS }) })
    mount()
    await ready()
    fireEvent.click(useButton())
    await waitFor(() => expect(net.calls.some((c) => c.url === USE)).toBe(true))
    const body = net.calls.find((c) => c.url === USE).body
    expect(body.answers).toEqual({ p1: 'Breakout', p2: { any: true }, p3: 'a-plus' })
    expect(body.choices).toEqual({ routine_a: { use: 'r-mine' } })
  })

  it('a double-click on Use sends ONE use-template (one note)', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    const net = installServer({ preview: previewAnswer(RICH_SLOTS) })
    const realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, init) => {
      if (url === USE) await gate
      return realFetch(url, init)
    })
    const { navigate } = mount()
    await ready()
    const btn = useButton()
    // Two presses inside ONE render (no re-render between them, so the button is still on for the second), then more.
    act(() => { btn.click(); btn.click() })
    fireEvent.click(btn)
    fireEvent.doubleClick(btn)
    expect(btn.disabled).toBe(true)
    await act(async () => { release() })
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
    expect(net.calls.filter((c) => c.url === USE)).toHaveLength(1)
  })

  it('template_use_navigates_to_new_note', async () => {
    installServer({ preview: previewAnswer(RICH_SLOTS) })
    const { navigate, onClose, onDone } = mount()
    await ready()
    fireEvent.click(useButton())
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/journal/notebook?note=n-new'))
    expect(onClose).toHaveBeenCalled()
    expect(onDone.mock.calls[0][0]).toMatchObject({ kind: 'template', note: { id: 'n-new' } })
  })

  it('without a router navigate, the new note opens in place through history', async () => {
    installServer({ preview: previewAnswer(RICH_SLOTS) })
    const pops = vi.fn()
    window.addEventListener('popstate', pops)
    mount({ navigate: null })
    await ready()
    fireEvent.click(useButton())
    await waitFor(() => expect(window.location.search).toBe('?note=n-new'))
    expect(pops).toHaveBeenCalled()
    window.removeEventListener('popstate', pops)
    window.history.pushState(null, '', '/')
  })

  it('a widget\'s Use adopts it and says "Added to My tools."', async () => {
    const net = installServer({ preview: previewAnswer(RICH_SLOTS) })
    const { navigate, onDone } = mount({ kind: 'widget' })
    await ready()
    fireEvent.click(useButton())
    expect((await screen.findByRole('status')).textContent).toBe(ADDED_SENTENCE)
    const body = net.calls.find((c) => c.url === ADOPT_TOOL).body
    expect(body).toEqual({ answers: { p1: 'Breakout', p2: { any: true }, p3: 'a-plus' } })
    expect(net.calls.some((c) => c.url === USE)).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
    expect(onDone.mock.calls[0][0]).toMatchObject({ kind: 'widget', id: 'd-new' })
    // The sheet has made its one copy: no second Use.
    expect(screen.queryByRole('button', { name: 'Use' })).toBeNull()
  })

  it('mode update (Task 11.19): Use sends exactly ONE updateTool for the copy and no adoptTool', async () => {
    const net = installServer({ preview: previewAnswer(RICH_SLOTS) })
    const UPDATE = '/api/j2/template-gallery/tools/updates/routine/r-copy'
    const orig = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, init) => (url === UPDATE
      ? (net.calls.push({ url, method: init.method, body: JSON.parse(init.body) }), json(200, { kind: 'routine', id: 'r-copy' }))
      : orig(url, init)))
    const { onDone, navigate } = mount({ kind: 'routine', mode: 'update', copyId: 'r-copy' })
    await ready()
    const btn = useButton()
    fireEvent.click(btn)
    fireEvent.click(btn)                                                    // a double press: still one update
    expect((await screen.findByRole('status')).textContent).toBe(UPDATED_SENTENCE)
    const updates = net.calls.filter((c) => c.url === UPDATE)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ method: 'POST', body: { answers: { p1: 'Breakout', p2: { any: true }, p3: 'a-plus' } } })
    expect(net.calls.some((c) => c.url === ADOPT_TOOL || c.url === USE)).toBe(false)
    expect(net.previews().length).toBeGreaterThanOrEqual(1)                 // the listed item still previews
    expect(onDone.mock.calls[0][0]).toMatchObject({ kind: 'routine', id: 'r-copy' })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('mode adopt (W11-R25b): a template Use sends exactly ONE adoptTemplate, no useTemplate, makes no note, goes nowhere', async () => {
    const net = installServer({ preview: previewAnswer(RICH_SLOTS, { questions: QUESTIONS, tools: TOOLS }) })
    const ADOPT = `${BASE}/adopt`
    const orig = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, init) => (url === ADOPT
      ? (net.calls.push({ url, method: init.method, body: JSON.parse(init.body) }), json(200, { style: { id: 's-copy' }, credit: null }))
      : orig(url, init)))
    const { onDone, onClose, navigate } = mount({ mode: 'adopt' })
    await ready()
    const btn = useButton()
    act(() => { btn.click(); btn.click() })                                 // a double press: still one copy
    expect((await screen.findByRole('status')).textContent).toBe(ADDED_TEMPLATE_SENTENCE)
    const adopts = net.calls.filter((c) => c.url === ADOPT)
    expect(adopts).toHaveLength(1)
    expect(adopts[0].method).toBe('POST')
    expect(Object.keys(adopts[0].body).sort()).toEqual(['answers', 'choices'])
    expect(net.calls.some((c) => c.url === USE || c.url === ADOPT_TOOL)).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(onDone.mock.calls[0][0]).toMatchObject({ kind: 'template', style: { id: 's-copy' } })
  })

  it('the Use path is unchanged (no mode, or mode use): ONE useTemplate makes the note and opens it, no adoptTemplate', async () => {
    for (const props of [{}, { mode: 'use' }]) {
      const net = installServer({ preview: previewAnswer(RICH_SLOTS, { questions: QUESTIONS, tools: TOOLS }) })
      const { navigate } = mount(props)
      await ready()
      const btn = useButton()
      act(() => { btn.click(); btn.click() })
      await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
      expect(net.calls.filter((c) => c.url === USE)).toHaveLength(1)
      expect(net.calls.some((c) => c.url === `${BASE}/adopt`)).toBe(false)
      expect(screen.queryByText(ADDED_TEMPLATE_SENTENCE)).toBeNull()
      cleanup()
    }
  })

  it('a fresh adoption is unchanged: no mode (or update without a copy) adopts and never updates', async () => {
    for (const props of [{}, { mode: 'update' }, { mode: 'update', copyId: '' }]) {
      const net = installServer({ preview: previewAnswer(RICH_SLOTS) })
      mount({ kind: 'widget', ...props })
      await ready()
      fireEvent.click(useButton())
      expect((await screen.findByRole('status')).textContent).toBe(ADDED_SENTENCE)
      expect(net.calls.filter((c) => c.url === ADOPT_TOOL)).toHaveLength(1)
      expect(net.calls.some((c) => String(c.url).includes('/tools/updates/'))).toBe(false)
      cleanup()
    }
  })

  it('while Use is in flight the sheet cannot be closed, so its answer always lands', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    installServer({ preview: previewAnswer(RICH_SLOTS) })
    const realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, init) => { if (url === USE) await gate; return realFetch(url, init) })
    const user = userEvent.setup()
    const { onClose, navigate } = mount()
    await ready()
    fireEvent.click(useButton())
    expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(true)
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => { release() })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/journal/notebook?note=n-new'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a throwing onDone never strands the member: the sheet closes and the note opens', async () => {
    installServer({ preview: previewAnswer(RICH_SLOTS) })
    const onClose = vi.fn()
    const navigate = vi.fn()
    render(<AdoptSheet galleryId={GID} kind="template" onClose={onClose} navigate={navigate}
      onDone={() => { throw new Error('caller broke') }} />)
    await ready()
    fireEvent.click(useButton())
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/journal/notebook?note=n-new'))
    expect(onClose).toHaveBeenCalled()
  })

  it('no_write_before_use', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const net = installServer({
      preview: previewAnswer(RICH_SLOTS, { questions: QUESTIONS })
    })
    mount()
    await ready()
    // Change a choice, change the reuse answer, open and close a picker: only preview-mine is ever POSTed.
    fireEvent.click(screen.getByRole('button', { name: 'Change setup' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Pullback' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('radio', { name: createWords('Pre-market routine') }))
    fireEvent.click(screen.getByRole('button', { name: 'Change tag' }))
    fireEvent.click(pickerCancel())
    await settle(DEBOUNCE_MS + 50)
    await waitFor(() => expect(net.previews()).toHaveLength(2))
    expect(net.posts().every((c) => c.url === PREVIEW)).toBe(true)
    expect(net.calls.filter((c) => c.method !== 'GET' && c.method !== 'POST')).toEqual([])
    // Use is the first and only write.
    fireEvent.click(useButton())
    await waitFor(() => expect(net.calls.some((c) => c.url === USE)).toBe(true))
    expect(net.posts().filter((c) => c.url !== PREVIEW).map((c) => c.url)).toEqual([USE])
  })
})

// ── the choices ─────────────────────────────────────────────────────────────────────────────────────

describe('the choices', () => {
  it('any_only_where_allowed', async () => {
    installServer({
      preview: previewAnswer(RICH_SLOTS)
    })
    mount()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Change setup' }))
    await screen.findByRole('radio', { name: 'Pullback' })
    expect(screen.queryByRole('radio', { name: 'Any setup' })).toBeNull()
    fireEvent.click(pickerCancel())
    fireEvent.click(screen.getByRole('button', { name: 'Change account' }))
    expect(await screen.findByRole('radio', { name: 'Any account' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Main' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(rowText('p2')).toBe('Account: Main')
  })

  it('number_slot_needs_number', async () => {
    const net = installServer({ preview: previewAnswer([...RICH_SLOTS, { ...HOLD, suggested: null }]) })
    mount()
    await ready()
    expect(rowText('p4')).toBe('Hold days: Not picked yet')
    expect(useButton().disabled).toBe(true)                      // a number is never suggested (W11-R12)
    fireEvent.click(screen.getByRole('button', { name: 'Change hold days' }))
    const box = screen.getByRole('textbox', { name: 'Hold days' })
    const done = screen.getByRole('button', { name: 'Done' })
    fireEvent.change(box, { target: { value: 'three' } })
    expect(done.disabled).toBe(true)
    fireEvent.change(box, { target: { value: 'Infinity' } })
    expect(done.disabled).toBe(true)
    expect(screen.queryByRole('checkbox', { name: 'Any hold days' })).toBeNull()
    fireEvent.change(box, { target: { value: '3' } })
    fireEvent.click(done)
    expect(rowText('p4')).toBe('Hold days: 3')
    expect(useButton().disabled).toBe(false)
    fireEvent.click(useButton())
    await waitFor(() => expect(net.calls.some((c) => c.url === USE)).toBe(true))
    expect(net.calls.find((c) => c.url === USE).body.answers.p4).toBe(3)
  })

  it('change_reruns_preview_debounced', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const net = installServer({
      preview: previewAnswer(RICH_SLOTS), hold: true
    })
    mount()
    await waitFor(() => expect(net.waiting()).toBe(1))
    await act(async () => net.release())
    await ready()
    const choose = async (name) => {
      fireEvent.click(screen.getByRole('button', { name: 'Change setup' }))
      fireEvent.click(await screen.findByRole('radio', { name }))
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    }
    // Two quick changes: nothing until 600 ms after the last, then ONE ask with the last answer.
    await choose('Pullback')
    await settle(200)
    await choose('Flag')
    expect(rowText('p1')).toBe('Setup: Flag')                    // the row moves at once
    await settle(DEBOUNCE_MS - 100)
    expect(net.previews()).toHaveLength(1)
    await settle(200)
    expect(net.previews()).toHaveLength(2)
    expect(net.previews()[1].body.answers.p1).toBe('Flag')
    // While that ask is in flight, more changes wait for it: no second request in flight.
    await choose('Breakout')
    await settle(DEBOUNCE_MS + 50)
    expect(net.previews()).toHaveLength(2)
    expect(net.waiting()).toBe(1)
    await act(async () => net.release())
    await waitFor(() => expect(net.previews()).toHaveLength(3))  // then once, with the latest answers
    expect(net.previews()[2].body.answers).toEqual({ p1: 'Breakout', p2: { any: true }, p3: 'a-plus' })
    await act(async () => net.release())
    await settle(DEBOUNCE_MS + 50)
    expect(net.previews()).toHaveLength(3)
    expect(screen.queryByText('Updating the preview…')).toBeNull()
  })

  it('an older answer that lands while a newer change waits is still marked as updating', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const net = installServer({ preview: previewAnswer(RICH_SLOTS), hold: true })
    mount()
    await waitFor(() => expect(net.waiting()).toBe(1))
    await act(async () => net.release())
    await ready()
    const choose = async (name) => {
      fireEvent.click(screen.getByRole('button', { name: 'Change setup' }))
      fireEvent.click(await screen.findByRole('radio', { name }))
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    }
    await choose('Flag')
    await settle(DEBOUNCE_MS + 10)
    expect(net.waiting()).toBe(1)                                // the ask for Flag is out
    await choose('Pullback')                                     // a newer change, waiting its 600 ms
    await act(async () => net.release())                         // Flag's answer lands
    await settle(10)
    expect(screen.getByText('Updating the preview…')).toBeTruthy()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('routine_question_preselects_best_match', async () => {
    installServer({ preview: previewAnswer(RICH_SLOTS, { questions: QUESTIONS }) })
    mount()
    await ready()
    const mine = screen.getByRole('radio', { name: useYourWords('Morning routine') })
    const make = screen.getByRole('radio', { name: createWords('Pre-market routine') })
    expect(mine.checked).toBe(true)
    expect(make.checked).toBe(false)
  })

  it('with no routine of the member\'s to reuse, the template\'s is created', async () => {
    const net = installServer({ preview: previewAnswer(RICH_SLOTS, { questions: [{ ...QUESTIONS[0], use: null }] }) })
    mount()
    await ready()
    expect(screen.queryByRole('radio', { name: /^Use your/ })).toBeNull()
    expect(screen.getByRole('radio', { name: createWords('Pre-market routine') }).checked).toBe(true)
    fireEvent.click(useButton())
    await waitFor(() => expect(net.calls.some((c) => c.url === USE)).toBe(true))
    expect(net.calls.find((c) => c.url === USE).body.choices).toEqual({ routine_a: { create: true } })
  })

  it('create_choice_sent', async () => {
    const net = installServer({ preview: previewAnswer(RICH_SLOTS, { questions: QUESTIONS }) })
    mount()
    await ready()
    fireEvent.click(screen.getByRole('radio', { name: createWords('Pre-market routine') }))
    fireEvent.click(useButton())
    await waitFor(() => expect(net.calls.some((c) => c.url === USE)).toBe(true))
    expect(net.calls.find((c) => c.url === USE).body.choices).toEqual({ routine_a: { create: true } })
  })
})

// ── refusals and the credit ─────────────────────────────────────────────────────────────────────────

describe('server sentences and the credit line', () => {
  it('server_sentences_shown_verbatim', async () => {
    for (const [code, message, status] of [['not_yours', S_NOT_YOURS, 400], ['unresolved', S_UNRESOLVED, 400], ['count_cap', S_CAP, 409]]) {
      const net = installServer({ preview: previewAnswer(RICH_SLOTS), use: refuse(code, message, status) })
      mount()
      await ready()
      fireEvent.click(useButton())
      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe(message)
      expect(alert.getAttribute('data-refusal')).toBe(code)
      // The sheet stays open and Use can be tried again (still one request per press).
      expect(useButton().disabled).toBe(false)
      expect(net.calls.filter((c) => c.url === USE)).toHaveLength(1)
      cleanup()
    }
  })

  it('a refused preview stands at the top in the server\'s words, with Try again', async () => {
    installServer({ preview: refuse('rate', 'Too many previews in an hour. Try again later.', 429) })
    mount()
    expect((await screen.findByRole('alert')).textContent).toBe('Too many previews in an hour. Try again later.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(useButton().disabled).toBe(true)
  })

  it('a refusal at Use can be tried again: the lock is released and a retry sends exactly ONE more', async () => {
    let n = 0
    const net = installServer({ preview: previewAnswer(RICH_SLOTS), use: () => (++n === 1 ? { __status: 400, body: { detail: { code: 'not_yours', message: S_NOT_YOURS } } } : { note: { id: 'n-new' }, skipped: [], style: { id: 's1' }, credit: null, created: {} }) })
    const { navigate } = mount()
    await ready()
    fireEvent.click(useButton())
    expect((await screen.findByRole('alert')).textContent).toBe(S_NOT_YOURS)
    const btn = useButton()
    act(() => { btn.click(); btn.click() })
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
    expect(net.calls.filter((c) => c.url === USE)).toHaveLength(2)
  })

  it('F-FE-1 F2 (W11-R34): Use carries an Idempotency-Key; a retry after a LOST answer resends the same key', async () => {
    let n = 0
    const net = installServer({ preview: previewAnswer(RICH_SLOTS) })
    const serve = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, init) => {
      if (url === USE && ++n === 1) {
        net.calls.push({ url, method: 'POST', body: JSON.parse(init.body), key: init.headers?.['Idempotency-Key'] })
        throw new TypeError('Failed to fetch')                     // the request may have landed; no answer came back
      }
      return serve(url, init)
    })
    const { navigate } = mount()
    await ready()
    const use = useButton()
    use.focus()
    fireEvent.click(use)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(document.activeElement).toBe(use)                     // focus stays on Use for the retry
    fireEvent.click(useButton())
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
    const keys = net.calls.filter((c) => c.url === USE).map((c) => c.key)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(keys[1]).toBe(keys[0])                                // the server answers the first note, never a second
  })

  it('F-FE-1 F2: a press after a refusal for good is a new press with a new key; a double-click is still one', async () => {
    let n = 0
    const net = installServer({ preview: previewAnswer(RICH_SLOTS), use: () => (++n === 1 ? { __status: 400, body: { detail: { code: 'not_yours', message: S_NOT_YOURS } } } : { note: { id: 'n-new' }, skipped: [], style: { id: 's1' }, credit: null, created: {} }) })
    const { navigate } = mount()
    await ready()
    fireEvent.click(useButton())
    expect((await screen.findByRole('alert')).textContent).toBe(S_NOT_YOURS)
    const btn = useButton()
    act(() => { btn.click(); btn.click() })
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
    const keys = net.calls.filter((c) => c.url === USE).map((c) => c.key)
    expect(keys).toHaveLength(2)
    expect(keys.every(Boolean)).toBe(true)
    expect(keys[1]).not.toBe(keys[0])
  })

  it("F-FE-1 F2: a tool's Use (adopt-tool) carries the key too", async () => {
    const net = installServer({ preview: previewAnswer(RICH_SLOTS) })
    mount({ kind: 'widget' })
    await ready()
    fireEvent.click(useButton())
    await screen.findByText(ADDED_SENTENCE)
    expect(net.calls.find((c) => c.url === ADOPT_TOOL).key).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("F-FE-1 F3: Use sends only each slot's value, never a sampleValue and never a card payload's def", async () => {
    // A Sample data account (W11-R27/R27b): the server ran the card with the BOOK's setup (`sampleValue`) while the
    // member's own value (`value`) is what Use must send. The card's payload carries a plan `def`; it never travels.
    const slots = [
      { ...SETUP, suggested: { value: 'Breakout', label: 'Breakout' }, value: 'Breakout', sampleValue: 'Sample setup' },
      { ...ACCOUNT, suggested: null, value: { any: true } },
      { ...TAG, suggested: null, value: { any: true }, sampleValue: 'sample-tag' },
    ]
    const net = installServer({
      preview: () => ({ slots, cards: [{ slot: 'built_a', title: 'Win rate by setup', sample: true,
        payload: { view: 'bar', rows: [{ v1: 3 }], def: { plan: { filters: [{ values: ['Sample setup'] }] } } } }], tools: [], questions: [] }),
    })
    mount()
    await ready()
    expect(rowText('p1')).toBe('Setup: Breakout')
    fireEvent.click(useButton())
    await waitFor(() => expect(net.calls.some((c) => c.url === USE)).toBe(true))
    const body = net.calls.find((c) => c.url === USE).body
    expect(body.answers).toEqual({ p1: 'Breakout', p2: { any: true }, p3: { any: true } })
    const wire = JSON.stringify(body)
    expect(wire).not.toMatch(/sample/i)
    expect(wire).not.toMatch(/"def"|"plan"|"payload"/)
  })

  it("F-FE-1 F3: the first answers are the server's own `value`, not a re-derivation from suggested and any", async () => {
    // The server's value for a choice (W11-R27b) is what it previewed: here Any for a setup whose suggestion it set
    // aside. Re-deriving "the suggestion, else Any" on the client would send Breakout, which the card never ran with.
    const slots = [{ ...SETUP, any: true, suggested: { value: 'Breakout', label: 'Breakout' }, value: { any: true } }]
    const net = installServer({ preview: () => ({ slots, cards: [], tools: [], questions: [] }) })
    mount()
    await ready()
    expect(rowText('p1')).toBe('Setup: Any setup')
    fireEvent.click(useButton())
    await waitFor(() => expect(net.calls.some((c) => c.url === USE)).toBe(true))
    expect(net.calls.find((c) => c.url === USE).body.answers).toEqual({ p1: { any: true } })
  })

  it('credit_line_exact_and_former_member', async () => {
    // ONLY the server's own `credit` (W11-R24), as it came; no answer or no credit is no line.
    expect(creditLine({ credit: "Based on UCT's Pre-market prep" })).toBe("Based on UCT's Pre-market prep")
    expect(creditLine({ credit: "Based on a former member's Gap fill" })).toBe("Based on a former member's Gap fill")
    expect(creditLine({ credit: '  ' })).toBe('')
    expect(creditLine({ title: 'Gap fill', author: null })).toBe('')
    expect(creditLine(null)).toBe('')
    // An official template's answer: rendered verbatim, first line under the heading.
    installServer({ preview: previewAnswer(RICH_SLOTS, { credit: "Based on UCT's Pre-market prep" }) })
    mount()
    const line = await waitFor(() => {
      const el = document.querySelector('[data-credit]')
      expect(el).not.toBeNull()
      return el
    })
    expect(line.textContent).toBe("Based on UCT's Pre-market prep")
    expect(within(screen.getByRole('dialog', { name: TITLE })).getByText(TITLE)).toBeTruthy()
    expect(document.querySelector('[data-adopt-sheet]').firstElementChild.getAttribute('data-credit')).toBe('')
    cleanup()
    // CONTROL: a caller's title and author never make a line when the server sent none.
    installServer({ preview: previewAnswer(RICH_SLOTS) })
    mount({ title: 'Setup study', author: null })
    await ready()
    expect(document.querySelector('[data-credit]')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Based on/)
  })

  it('no client path builds a credit: the sheet\'s code holds no "Based on" or "former member" words', () => {
    for (const f of ['AdoptSheet.jsx', 'openAdoptSheet.js', 'SlotPicker.jsx']) {
      const code = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/library', f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      expect(code.length, f).toBeGreaterThan(500)                                    // non-vacuity: real code read
      expect(code, f).not.toMatch(/Based on|former member/)
    }
  })
})

// ── focus ─────────────────────────────────────────────────────────────────────────────────────────

describe('focus', () => {
  it('returns to the Change control after Done, Cancel, Enter in a number field and Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    installServer({ preview: previewAnswer([...RICH_SLOTS, { ...HOLD, suggested: null }]) })
    mount({ onClose })
    await ready()
    const change = screen.getByRole('button', { name: 'Change setup' })
    // Done
    change.focus()
    await user.keyboard('{Enter}')
    fireEvent.click(await screen.findByRole('radio', { name: 'Pullback' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(document.activeElement).toBe(change)
    // Cancel
    await user.keyboard('{Enter}')
    await screen.findByRole('radio', { name: 'Pullback' })
    fireEvent.click(pickerCancel())
    expect(document.activeElement).toBe(change)
    // Escape closes the picker only (never the sheet and its picks), and focus comes back
    await user.keyboard('{Enter}')
    await screen.findByRole('radio', { name: 'Pullback' })
    screen.getByRole('radio', { name: 'Pullback' }).focus()
    await user.keyboard('{Escape}')
    expect(document.querySelector('[data-slot-picker]')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => expect(document.activeElement).toBe(change))
    // Enter in the number field
    const hold = screen.getByRole('button', { name: 'Change hold days' })
    hold.focus()
    await user.keyboard('{Enter}')
    const box = screen.getByRole('textbox', { name: 'Hold days' })
    box.focus()
    await user.keyboard('5{Enter}')
    expect(rowText('p4')).toBe('Hold days: 5')
    await waitFor(() => expect(document.activeElement).toBe(hold))
  })

  it('after a tool\'s Use, focus is on the Done button', async () => {
    installServer({ preview: previewAnswer(RICH_SLOTS) })
    mount({ kind: 'widget' })
    await ready()
    fireEvent.click(useButton())
    await screen.findByText(ADDED_SENTENCE)
    // Focus moves after the success view renders; wait for it rather than racing the effect under load.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Done' })))
  })
})

// ── keyboard and touch ──────────────────────────────────────────────────────────────────────────────

describe('keyboard_only_390_and_44px', () => {
  it('the whole flow runs from the keyboard at 390 px, focus asserted at every step', async () => {
    window.innerWidth = 390
    window.dispatchEvent(new Event('resize'))
    const user = userEvent.setup()
    const net = installServer({
      preview: previewAnswer([{ ...SETUP, suggested: null }, ACCOUNT], { questions: QUESTIONS })
    })
    const { navigate } = mount()
    await ready()
    const active = () => document.activeElement
    // The KNOWN start: the first slot's Change control.
    const change = screen.getByRole('button', { name: 'Change setup' })
    change.focus()
    expect(active()).toBe(change)
    await user.keyboard('{Enter}')
    await screen.findByRole('radio', { name: 'Breakout' })
    await user.tab()
    expect(active()).toBe(screen.getByRole('radio', { name: 'Breakout' }))
    await user.keyboard(' ')
    await user.keyboard('{ArrowDown}')
    expect(active()).toBe(screen.getByRole('radio', { name: 'Pullback' }))
    expect(screen.getByRole('radio', { name: 'Pullback' }).checked).toBe(true)
    await user.tab()
    expect(active()).toBe(pickerCancel())
    await user.tab()
    expect(active()).toBe(screen.getByRole('button', { name: 'Done' }))
    await user.keyboard('{Enter}')
    expect(rowText('p1')).toBe('Setup: Pullback')
    expect(active()).toBe(change)                                   // back where the member was
    await user.tab()
    expect(active()).toBe(screen.getByRole('button', { name: 'Change account' }))
    await user.tab()
    const mine = screen.getByRole('radio', { name: useYourWords('Morning routine') })
    const make = screen.getByRole('radio', { name: createWords('Pre-market routine') })
    expect(active()).toBe(mine)                                     // the pre-selected answer
    await user.keyboard('{ArrowDown}')
    expect(active()).toBe(make)
    expect(make.checked).toBe(true)
    await user.tab()
    expect(active()).toBe(screen.getByRole('button', { name: 'Cancel' }))
    await user.tab()
    expect(active()).toBe(useButton())
    await user.keyboard('{Enter}')
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/journal/notebook?note=n-new'))
    const body = net.calls.find((c) => c.url === USE).body
    expect(body.answers).toEqual({ p1: 'Pullback', p2: { any: true } })
    expect(body.choices).toEqual({ routine_a: { create: true } })
  })

  it('every control in the sheet and its picker wears a class the stylesheet floors at 44 px', async () => {
    installServer({
      preview: previewAnswer([...RICH_SLOTS, { ...HOLD, any: true, suggested: null }], { questions: QUESTIONS, tools: TOOLS })
    })
    mount()
    await ready()
    const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/library/library.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
    const floored = new Set()
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/min-height:\s*var\(--tap-min\)/.test(m[2])) continue
      for (const part of m[1].split(',')) { const cls = part.match(/\.[A-Za-z][\w-]*/g); if (cls) floored.add(cls[cls.length - 1].slice(1)) }
    }
    expect(floored.size).toBeGreaterThan(4)                                         // non-vacuity
    const wears = (el) => [...el.classList].some((c) => [...floored].some((f) => c === f || c.includes(`_${f}_`)))
    const check = (minimum) => {
      const root = document.querySelector('[data-adopt-sheet]')
      const controls = [...root.querySelectorAll('button, input, select, textarea')]
      expect(controls.length).toBeGreaterThan(minimum)
      for (const el of controls) {
        const target = el.type === 'checkbox' || el.type === 'radio' ? el.closest('label') : el
        expect(wears(target), `${el.outerHTML.slice(0, 80)} is not floored`).toBe(true)
      }
    }
    check(6)
    fireEvent.click(screen.getByRole('button', { name: 'Change setup' }))
    await screen.findByRole('radio', { name: 'Pullback' })
    check(8)
    fireEvent.click(pickerCancel())
    fireEvent.click(screen.getByRole('button', { name: 'Change hold days' }))
    screen.getByRole('checkbox', { name: 'Any hold days' })
    check(8)
  })
})

// ── the door ──────────────────────────────────────────────────────────────────────────────────────────

describe('openAdoptSheet', () => {
  it('opens one at a time on its own root', async () => {
    const net = installServer({ preview: previewAnswer(RICH_SLOTS) })
    const close = openAdoptSheet({ galleryId: GID, kind: 'template' })
    const again = openAdoptSheet({ galleryId: GID, kind: 'widget' })
    expect(again).toBe(close)
    expect(await screen.findByRole('dialog', { name: TITLE })).toBeTruthy()
    expect(document.querySelectorAll('[data-adopt-sheet-root]')).toHaveLength(1)
    expect(document.querySelector('[data-adopt-sheet]').getAttribute('data-adopt-sheet')).toBe('template')
    await waitFor(() => expect(net.previews()).toHaveLength(1))
    act(() => close())
    await waitFor(() => expect(document.querySelector('[data-adopt-sheet-root]')).toBeNull())
    const next = openAdoptSheet({ galleryId: GID, kind: 'routine' })
    expect(next).not.toBe(close)
    act(() => next())
    await waitFor(() => expect(document.querySelector('[data-adopt-sheet-root]')).toBeNull())
  })

  it('offline: nothing is asked', async () => {
    setOnline(false)
    const net = installServer({ preview: previewAnswer(RICH_SLOTS) })
    mount()
    expect((await screen.findByRole('alert')).textContent).toBe("You're offline. Try again when you're back online.")
    expect(net.calls).toHaveLength(0)
  })
})
