// Audit 2026-11-05, spec S10 (M4): the note header, the Saved indicator and the title keys, through a REAL
// NoteEditorPage.
//   1. The header holds exactly FOUR controls -- Favorite · AI · Share · ⋯ -- and every control on it is inside one of
//      them (Find, Outline and Move to Trash are in ⋯; the folder is on the line under the title).
//   2. The indicator says "Saved", "Saving…" or "Offline · saved on this device" (VIS-5's words), read from the editor's save state and
//      the outbox (useDurableNote, MOCKED here to hold committed unsent work); it is a polite region mounted EMPTY.
//   3. Enter in the title puts the caret in the body and types no newline; Shift+Enter goes to the subtitle.
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { saveIndicatorWords, offlineKept, SAVED_WORDS, SAVING_WORDS } from '../../lib/offline/unsyncedCopy'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const H = (t) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t }] })
let NOTE
const baseNote = () => ({
  id: 'n1', title: 'Swing plan', subtitle: '', folderId: null, ticker: null, tags: [],
  heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false, locked: false,
  bodyJson: { type: 'doc', content: [H('Setup'), P('First body line.')] },
})
const AUTH = { user: { id: 'u1' }, isPaid: true }
const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => AUTH }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({
  default: () => ({ folders: [{ id: 'f1', name: 'Semis' }] }),
}))
vi.mock('../VoiceInputButton', async () => {
  const React = await import('react')
  return { default: React.forwardRef(() => null) }
})
// The outbox: the real hook, with `unsynced` / `persisted` forced when a test says so.
const { DURABLE } = vi.hoisted(() => ({ DURABLE: { override: null } }))
vi.mock('../../lib/offline/useDurableNote', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, useDurableNote: (...args) => ({ ...real.useDurableNote(...args), ...(DURABLE.override || {}) }) }
})

let onLine
beforeEach(() => {
  NOTE = baseNote()
  DURABLE.override = null
  onLine = true
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => onLine })
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_writing_help_enabled: true, j2_share_links_enabled: true })
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => ({ ...NOTE, ...patch, updatedAt: '2026-01-03T00:00:00Z' }))
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})
afterEach(() => {
  __resetNotebookFlags()
  vi.clearAllMocks()
  onLine = true
})

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  await waitFor(() => {
    if (!document.querySelector('.ProseMirror')?.editor) throw new Error('editor not mounted')
  })
}
const header = () => document.querySelector('[data-note-header]')
const indicator = () => document.querySelector('[data-save-indicator]')
/** The header row's visible, operable controls (a closed More panel's items are `hidden`, so not counted). The pane's
 *  own "← Notebook" sits before the row: it is the way back, not one of the note's controls. */
const row = () => header().querySelector('[data-tour="ask-row"]')
const visibleControls = () => [...row().querySelectorAll('button, select, input, a[href], [role="button"]')]
  .filter((el) => !el.closest('[hidden]'))

describe('1. the header: Favorite · AI · Share · ⋯', () => {
  it('shows exactly four controls, and every control on it is inside one of them', async () => {
    await renderEditor()
    const four = [...header().querySelectorAll('[data-header-control]')]
    expect(four.map((el) => el.getAttribute('data-header-control'))).toEqual(['favorite', 'ai', 'share', 'more'])
    for (const el of visibleControls()) {
      expect(el.closest('[data-header-control]'), el.getAttribute('aria-label') || el.textContent).not.toBeNull()
    }
    // Share is a real control here (its switch is on), not an empty slot.
    expect(within(four[2]).getAllByRole('button').length).toBeGreaterThan(0)
    expect(within(four[1]).getByRole('button', { name: /^ask about this note$/i })).toBeTruthy()
    expect(within(four[1]).getByRole('button', { name: 'Writing help' })).toBeTruthy()
  })

  it('CONTROL: the rail counts what it says -- a control dropped loose into the header is seen', async () => {
    await renderEditor()
    const stray = document.createElement('button')
    stray.setAttribute('aria-label', 'Stray')
    row().appendChild(stray)
    expect(visibleControls().filter((el) => !el.closest('[data-header-control]'))).toEqual([stray])
    stray.remove()
  })

  it('Find, Outline and Move to Trash are in ⋯; the folder is on the line under the title', async () => {
    await renderEditor()
    for (const name of ['Find in note', 'Outline', 'Move to Trash']) {
      expect(within(header()).getByRole('button', { name, hidden: true }).closest('[hidden]'), name).not.toBeNull()
    }
    const folder = screen.getByRole('combobox', { name: 'Folder' })
    expect(folder.closest('[data-note-header]')).toBeNull()
    expect(folder.closest('[data-note-details-line]')).not.toBeNull()
    const title = screen.getByRole('textbox', { name: 'Note title' })
    expect(title.compareDocumentPosition(folder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('2. the Saved indicator', () => {
  it('the words, from the save state and the outbox (one authority)', () => {
    expect(saveIndicatorWords({ status: 'saved' })).toBe(SAVED_WORDS)
    expect(saveIndicatorWords({ status: 'dirty' })).toBe(SAVING_WORDS)
    expect(saveIndicatorWords({ status: 'saving' })).toBe(SAVING_WORDS)
    // VIS-5 (audit 2026-11-05, issue 17): ONE offline message, in the spec's words. It was "Offline, kept on this
    // device" (S10), beside two more header lines saying the same state three ways; they are reconciled into this.
    expect(saveIndicatorWords({ status: 'saving', offline: true, unsynced: true, persisted: true }))
      .toBe('Offline · saved on this device')
    // The noun narrows when the platform will not promise retention (Wave Q1's rule).
    expect(offlineKept(false)).toBe('Offline · saved in this browser')
    // Offline with nothing unsent: still the ONE offline message (it replaced "Viewing an earlier saved copy").
    expect(saveIndicatorWords({ status: 'saved', offline: true, unsynced: false, persisted: true }))
      .toBe('Offline · saved on this device')
    // Offline, a write only intended (not yet in the outbox): never claimed as saved.
    expect(saveIndicatorWords({ status: 'dirty', offline: true, unsynced: false })).toBe(SAVING_WORDS)
    // Offline, a failed save with nothing committed: silent here, the error line speaks.
    expect(saveIndicatorWords({ status: 'error', offline: true, unsynced: false })).toBe('')
    // Silent where another header line speaks for the state.
    for (const status of ['conflict', 'refused']) expect(saveIndicatorWords({ status })).toBe('')
    expect(saveIndicatorWords({ status: 'saved', blocked: true })).toBe('')
    expect(saveIndicatorWords({ status: 'error' })).toBe('')
    // Fix round 1 (review finding 5): an edit inside the durable debounce is not kept yet; a loading note says nothing.
    expect(saveIndicatorWords({ status: 'dirty', offline: true, unsynced: true, persisted: true })).toBe(SAVING_WORDS)
    expect(saveIndicatorWords({ status: 'saved', loading: true })).toBe('')
  })

  it('is a polite live region, then moves Saved -> Saving… -> Offline · saved on this device', async () => {
    await renderEditor()
    const el = indicator()
    expect(el).toHaveAttribute('role', 'status')
    expect(el).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => expect(el.textContent).toBe('Saved'))
    // The outbox holds the work and the save cannot reach the server.
    DURABLE.override = { unsynced: true, persisted: true }
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    updateMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))
    // An edit is waiting to go: Saving…
    fireEvent.change(screen.getByRole('textbox', { name: 'Note title' }), { target: { value: 'Swing plan v2' } })
    await waitFor(() => expect(indicator().textContent).toBe('Saving…'))
    // Online, the save fails: the Wave Q1 line speaks (the control for the offline check below).
    await waitFor(() => expect(screen.getByText(/waiting to sync/)).toBeTruthy(), { timeout: 8000 })
    // Then the browser goes offline.
    onLine = false
    act(() => { window.dispatchEvent(new Event('offline')) })
    await waitFor(() => expect(indicator().textContent).toBe('Offline · saved on this device'))
    // Fix round 1 (review finding 5) + VIS-5: ONE offline message. The Wave Q1 line stays quiet while the indicator
    // speaks for the unsent words, and the "earlier saved copy" banner is retired.
    expect(screen.queryByText(/waiting to sync/)).toBeNull()
    expect(screen.queryByText(/Viewing an earlier saved copy/)).toBeNull()
  })

  // ⚰️ Tier 1a's fix round 1 kept the "Viewing an earlier saved copy" banner for offline-with-nothing-unsent (a
  // second line, with the indicator reading "Saved"). VIS-5 (audit issue 17) retires it: the indicator's pill says
  // the same fact in the same place -- offline, and this copy is the one saved here.
  it('CONTROL: offline with nothing unsent, the ONE pill still says the member is offline -- and nothing else does', async () => {
    await renderEditor()
    await waitFor(() => expect(indicator().textContent).toBe('Saved'))
    onLine = false
    act(() => { window.dispatchEvent(new Event('offline')) })
    await waitFor(() => expect(indicator().textContent).toMatch(/^Offline · saved (on this device|in this browser)$/))
    expect(screen.queryByText(/Viewing an earlier saved copy/)).toBeNull()
  })

  it('is mounted EMPTY, and filled after (a region that arrives holding words is not read)', async () => {
    // Every mutation from the first render on: if the span had arrived HOLDING its words, the text would be part of the
    // subtree inserted with it, and no record would ever add a text node TO the span itself.
    const records = []
    const mo = new MutationObserver((rs) => records.push(...rs))
    mo.observe(document.body, { childList: true, subtree: true, characterData: true })
    await renderEditor()
    await waitFor(() => expect(indicator().textContent).toBe('Saved'))
    await new Promise((r) => setTimeout(r, 0))
    mo.disconnect()
    const filledLater = records.some((r) => r.type === 'childList' && r.target === indicator()
      && [...r.addedNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent === 'Saved'))
    expect(filledLater).toBe(true)
  })
})

describe('3. the title keys', () => {
  it('Enter in the title puts the caret in the body, at its start, and the title gains no newline', async () => {
    await renderEditor()
    const title = screen.getByRole('textbox', { name: 'Note title' })
    const body = document.querySelector('.ProseMirror')
    const docBefore = JSON.stringify(body.editor.getJSON())
    title.focus()
    const ev = fireEvent.keyDown(title, { key: 'Enter' })
    expect(ev).toBe(false)                                     // default prevented: nothing typed
    expect(title.value).toBe('Swing plan')
    // Fix round 1 (review): a real assertion, not the vacuous "an input has no newline": focus is IN the body, at its
    // start, and the body's document is exactly what it was (the Enter typed nothing anywhere).
    await waitFor(() => expect(body.contains(document.activeElement) || document.activeElement === body).toBe(true))
    expect(body.editor.state.selection.from).toBeLessThanOrEqual(2)
    expect(JSON.stringify(body.editor.getJSON())).toBe(docBefore)
  })

  it('Shift+Enter goes to the subtitle (shown for the visit)', async () => {
    await renderEditor()
    const title = screen.getByRole('textbox', { name: 'Note title' })
    title.focus()
    fireEvent.keyDown(title, { key: 'Enter', shiftKey: true })
    const subtitle = screen.getByRole('textbox', { name: 'Subtitle', hidden: true })
    await waitFor(() => expect(document.activeElement).toBe(subtitle))
    expect(subtitle.hidden).toBe(false)
    expect(title.value).toBe('Swing plan')
  })

  // Fix round 1 (review finding 6): the Enter that COMMITS an IME conversion belongs to the IME. Chrome and Firefox
  // mark it isComposing; Safari sends isComposing false with keyCode 229. Either way focus stays in the title.
  for (const [name, init] of [['isComposing', { isComposing: true }], ['keyCode 229 (Safari)', { keyCode: 229 }]]) {
    it(`an IME Enter (${name}) stays in the title, with or without Shift`, async () => {
      await renderEditor()
      const title = screen.getByRole('textbox', { name: 'Note title' })
      title.focus()
      fireEvent.keyDown(title, { key: 'Enter', ...init })
      fireEvent.keyDown(title, { key: 'Enter', shiftKey: true, ...init })
      await new Promise((r) => setTimeout(r, 30))
      expect(document.activeElement).toBe(title)
      expect(document.querySelector('input[aria-label="Subtitle"]').hidden).toBe(true)
    })
  }

  it('CONTROL: a key that is not Enter is the title\'s own (nothing moves)', async () => {
    await renderEditor()
    const title = screen.getByRole('textbox', { name: 'Note title' })
    title.focus()
    expect(fireEvent.keyDown(title, { key: 'a' })).toBe(true)
    expect(document.activeElement).toBe(title)
  })
})
