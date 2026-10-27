import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, it, expect, vi, afterEach } from 'vitest'

// Task 11.18 (W11-R9 + "live state never enters a note"): the editor's ONE guarded dynamic import of the 3rd-day
// Helpful line. A styled note while wave 11 is on asks the server once; the line's answers are gallery writes, never
// an editor transaction or a note PUT. An unstyled note, or wave 11 off, never fetches the line or asks at all.

const loaded = vi.hoisted(() => ({ line: 0, note: null }))
vi.mock('./library/HelpfulPromptLine', async (importOriginal) => { loaded.line += 1; return importOriginal() })

const BASE = {
  id: 'n1', title: 'Pre-market prep, Oct 26', subtitle: '', folderId: null, ticker: null, tags: [], heroImageUrl: null,
  updatedAt: '2026-10-26T12:00:00Z', isFavorite: false, locked: false, styleId: null, styleVersion: null, kindId: null,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan body.' }] }] },
}
const update = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: loaded.note, isLoading: false, update, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('./ChartEmbed', () => ({ default: () => <div data-testid="fake-chart" /> }))

import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { GALLERY } from '../../lib/templateLibrary'
import { chunkRetry } from '../../lib/lazyChunk'
import { buildCanvasDoc, emptyBoard, addItems, makeTextCard } from '../../lib/tradeCanvas'

const PROMPT_GET = `${GALLERY}/notes/n1/helpful-prompt`
const PROMPT_POST = `${GALLERY}/g1/helpful-prompt`
const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })

let calls
function serve() {
  calls = []
  global.fetch = vi.fn((url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ url: String(url), method })
    if (String(url) === PROMPT_GET && method === 'GET') {
      return json({ show: true, itemId: 'g1', title: 'Pre-market prep', line: 'Was Pre-market prep helpful?' })
    }
    if (String(url) === PROMPT_POST && method === 'POST') return json({ answer: 'yes', helpful: true, count: 1 })
    return json({})
  })
}

// The line's own words, typed here on purpose: a static import of the line's module would load it in this file and
// void the not-requested case's "never fetched" count. Its own test pins the constant.
const ANSWERED_WORDS = 'Thanks for your answer.'
const CANVAS = buildCanvasDoc(addItems(emptyBoard(), [makeTextCard({ x: 0, y: 0, text: 'first' })]).board)

async function open({ styleId, w11, canvas = false }) {
  loaded.note = { ...BASE, styleId, styleVersion: styleId ? 1 : null, ...(canvas ? { bodyJson: CANVAS } : {}) }
  latchNotebookFlags({ notebook_widgets_w11_enabled: w11, ...(canvas ? { notebook_trade_canvas_enabled: true } : {}) })
  serve()
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>
    </SWRConfig>,
  )
  await screen.findByPlaceholderText('Title')
  let editor = null
  await waitFor(() => {
    editor = document.querySelector('.ProseMirror')?.editor
    if (!editor) throw new Error('editor not mounted')
  })
  return editor
}

const notePuts = () => calls.filter((c) => c.method !== 'GET' && /\/api\/j2\/notes\b/.test(c.url))

// ⛔ `loaded.line` is NOT reset: a module factory runs once per file, so the count is "has the line's module ever been
// fetched in this file". The not-requested case therefore runs FIRST, while it must still read 0.
afterEach(() => { __resetNotebookFlags(); update.mockClear() })

describe('the 3rd-day Helpful line on the note page', () => {
  it('not_requested_without_style_or_w11_off', async () => {
    // Fix round 1 (M-5): a canvas note has no body to sit above, so it never asks either.
    for (const [styleId, w11, canvas] of [[null, true, false], ['s1', false, false], ['s1', true, true]]) {
      await open({ styleId, w11, canvas })
      await act(async () => { await vi.dynamicImportSettled() })
      expect(calls.filter((c) => c.url.includes('/helpful-prompt'))).toEqual([])
      expect(loaded.line).toBe(0)
      expect(screen.queryByText(/helpful\?/)).toBeNull()
      document.body.innerHTML = ''
      __resetNotebookFlags()
    }
  })

  for (const [label, answer] of [['Yes', 'yes'], ['Not really', 'not_really'], ['Dismiss', 'dismissed']]) {
    it(`no_doc_change_and_no_note_put (${answer})`, async () => {
      const editor = await open({ styleId: 's1', w11: true })
      const docChanges = []
      editor.on('transaction', ({ transaction }) => { if (transaction.docChanged) docChanges.push(transaction) })
      const user = userEvent.setup()
      const line = await screen.findByText('Was Pre-market prep helpful?', {}, { timeout: 10000 })
      // It sits above the note's body.
      const body = document.querySelector('[data-tour="note-body"]')
      expect(line.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      const status = document.querySelector('[data-helpful-prompt-status]')
      expect(status).toHaveTextContent(/^$/)                                   // the live region exists before its text
      // A keyboard member: focus on the answer, Enter. Focus must land on the note body, never <body>.
      const btn = screen.getByRole('button', { name: label })
      act(() => { btn.focus() })
      expect(document.activeElement).toBe(btn)
      await user.keyboard('{Enter}')
      expect(screen.queryByText('Was Pre-market prep helpful?')).toBeNull()
      expect(document.activeElement).toBe(editor.view.dom)
      expect(document.querySelector('[data-helpful-prompt-status]')).toBe(status)  // the same element, now speaking
      expect(status).toHaveTextContent(ANSWERED_WORDS)
      await waitFor(() => expect(calls.filter((c) => c.url === PROMPT_POST)).toHaveLength(1))
      await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
      expect(calls.filter((c) => c.url === PROMPT_GET)).toHaveLength(1)
      expect(docChanges).toHaveLength(0)
      expect(notePuts()).toEqual([])
      expect(update).not.toHaveBeenCalled()
      expect(loaded.line).toBe(1)
      // CONTROL: the spy does see a real edit, so the zero above is a measurement and not a deaf listener.
      // (`preventUpdate` keeps TipTap's onUpdate, and so the autosave, out of it: nothing leaks into the next case.)
      act(() => { editor.view.dispatch(editor.state.tr.insertText('x', 1).setMeta('preventUpdate', true)) })
      expect(docChanges).toHaveLength(1)
    })
  }

  // Fix round 1 (I-1, ruling D-I2): the courtesy line's chunk failing (offline, or a deploy removed its hash) renders
  // nothing. No page reload, no route boundary, and the editor stays mounted.
  it('a chunk that cannot load renders no line, never reloads, and keeps the editor', async () => {
    const mod = await import('./NoteEditorPage')
    const real = mod.helpfulPromptDoorLoaders.line
    const realLocation = window.location
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, origin: realLocation.origin, reload, href: String(realLocation.href) } })
    try { sessionStorage.clear() } catch { /* ignore */ }
    const gone = () => Promise.reject(new TypeError(`Failed to fetch dynamically imported module: ${realLocation.origin}/assets/HelpfulPromptLine-abc123.js`))
    mod.helpfulPromptDoorLoaders.line = vi.fn(gone)
    const retry = vi.spyOn(chunkRetry, 'importUrl').mockImplementation(gone)
    try {
      await open({ styleId: 's1', w11: true })
      await waitFor(() => expect(retry).toHaveBeenCalled(), { timeout: 5000 })   // the one in-place retry happened
      await act(async () => { await new Promise((r) => setTimeout(r, 100)) })
      expect(mod.helpfulPromptDoorLoaders.line).toHaveBeenCalled()
      expect(reload).not.toHaveBeenCalled()
      expect(screen.queryByText(/helpful\?/)).toBeNull()
      expect(document.querySelector('.ProseMirror')?.editor?.isDestroyed).toBe(false)
      expect(screen.getByPlaceholderText('Title')).toBeInTheDocument()
    } finally {
      mod.helpfulPromptDoorLoaders.line = real
      retry.mockRestore()
      Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
    }
  })
})
