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

import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { GALLERY } from '../../lib/templateLibrary'

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

async function open({ styleId, w11 }) {
  loaded.note = { ...BASE, styleId, styleVersion: styleId ? 1 : null }
  latchNotebookFlags({ notebook_widgets_w11_enabled: w11 })
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
    for (const [styleId, w11] of [[null, true], ['s1', false]]) {
      await open({ styleId, w11 })
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
      await user.click(screen.getByRole('button', { name: label }))
      expect(screen.queryByText('Was Pre-market prep helpful?')).toBeNull()
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
})
