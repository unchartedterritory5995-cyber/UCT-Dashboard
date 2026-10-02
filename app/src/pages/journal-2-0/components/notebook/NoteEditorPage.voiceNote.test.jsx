/**
 * Wave 11 lane 11A — /voice in the REAL editor page: the slash item exists only
 * while the gate is on for a paid member, the command opens the dialog on THIS
 * editor, "Add to this note" lands the sections at the end of the note through
 * its own autosave (an editor transaction — no endpoint, no fork), and a LOCKED
 * note refuses with the standard sentence.
 *
 * The dialog itself is stubbed to one button that hands back a fixed result (its
 * own states are railed in VoiceNoteDialog.test.jsx); everything between the
 * slash command and the autosave is the real code.
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { VOICE_NOTE_EVENT, VOICE_NOTE_LOCKED_SENTENCE } from '../../lib/voiceNote'
import { blockItemsAvailable } from './SlashMenu'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const RESULT = {
  source: 'recording', title: 'Voice note', date: '2026-10-01', durationSeconds: 60,
  transcript: 'Watching NVDA. Stop on AMD.', words: 5, transcriptShortened: false,
  summary: 'NVDA watch; AMD stop.', tickers: ['NVDA'], actionItems: ['Set the AMD stop'],
  ai: { ok: true, model: 'claude-sonnet-5', sentence: '' },
}

const { noteStore, updateSpy, auth } = vi.hoisted(() => ({
  noteStore: {}, updateSpy: vi.fn(), auth: { user: { id: 'u1' }, isPaid: true },
}))
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: (noteId) => ({
    note: noteStore[noteId] ?? null,
    isLoading: !noteStore[noteId],
    update: async (patch) => {
      updateSpy(noteId, patch)
      const updated = { ...noteStore[noteId], ...patch, updatedAt: new Date().toISOString() }
      noteStore[noteId] = updated
      return updated
    },
    refresh: vi.fn(),
  }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('../VoiceInputButton', async () => {
  const React = await import('react')
  return { default: React.forwardRef(() => null) }
})
vi.mock('./VoiceNoteDialog', () => ({
  default: ({ onAppend, onClose }) => (
    <div role="dialog" aria-label="Voice note">
      <button type="button" onClick={() => { if (onAppend(RESULT).ok) onClose() }}>stub: add to this note</button>
    </div>
  ),
}))

const NOTE = (locked = false) => ({
  id: 'n1', title: 'Plan', subtitle: '', folderId: null, ticker: null, tags: [], heroImageUrl: null,
  updatedAt: '2026-01-01T00:00:00Z', isFavorite: false, locked,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My own view.' }] }] },
})

beforeEach(() => {
  noteStore.n1 = NOTE()
  updateSpy.mockClear()
  auth.isPaid = true
  __resetNotebookFlags()
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }))
})
afterEach(() => { __resetNotebookFlags(); vi.clearAllMocks() })

async function mount() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>)
  let editor
  await waitFor(() => {
    editor = document.querySelector('.ProseMirror')?.editor
    if (!editor) throw new Error('editor not mounted')
  })
  return editor
}
const slashTitles = (editor) => blockItemsAvailable(editor).map((i) => i.title)

describe('/voice — who is offered it', () => {
  it('nobody while the gate is off (control: the other block items are offered)', async () => {
    latchNotebookFlags({ notebook_voice_notes_enabled: false, notebook_writing_help_enabled: true })
    const editor = await mount()
    expect(slashTitles(editor)).not.toContain('Voice note')
    expect(slashTitles(editor)).toContain('Writing help')
  })

  it('not a free member, gate on', async () => {
    auth.isPaid = false
    latchNotebookFlags({ notebook_voice_notes_enabled: true })
    const editor = await mount()
    expect(slashTitles(editor)).not.toContain('Voice note')
  })

  it('a paid member with the gate on', async () => {
    latchNotebookFlags({ notebook_voice_notes_enabled: true })
    const editor = await mount()
    expect(slashTitles(editor)).toContain('Voice note')
  })
})

describe('/voice — Add to this note', () => {
  it('lands every section at the end of THIS note, through its own autosave', async () => {
    latchNotebookFlags({ notebook_voice_notes_enabled: true })
    const editor = await mount()
    const item = blockItemsAvailable(editor).find((i) => i.title === 'Voice note')
    const { from } = editor.state.selection
    act(() => { item.command({ editor, range: { from, to: from } }) })
    const add = await screen.findByRole('button', { name: 'stub: add to this note' })
    act(() => { add.click() })
    expect(await screen.findByText('Voice note added to this note. Undo takes it back out.')).toBeInTheDocument()
    const json = editor.getJSON()
    expect(json.content[0].content[0].text).toBe('My own view.')
    const types = json.content.map((n) => n.type)
    for (const t of ['askInsert', 'taskList', 'toggle']) expect(types).toContain(t)
    expect(screen.queryByRole('dialog', { name: 'Voice note' })).toBeNull()
    // the editor's own autosave carries it — no endpoint, no settle, no fork
    await waitFor(() => {
      const call = updateSpy.mock.calls.find(([id, patch]) => id === 'n1' && JSON.stringify(patch.bodyJson || {}).includes('voice_summary'))
      expect(call).toBeTruthy()
    }, { timeout: 4000 })
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/api/j2/voice-notes'))).toBe(false)
  })

  it('a LOCKED note refuses /voice with the standard sentence, and opens nothing', async () => {
    noteStore.n1 = NOTE(true)
    latchNotebookFlags({ notebook_voice_notes_enabled: true })
    const editor = await mount()
    // a locked editor is read-only, so the slash menu never offers it at all…
    expect(editor.isEditable).toBe(false)
    // …and the event, should anything dispatch it, is refused out loud
    act(() => { editor.view.dom.dispatchEvent(new CustomEvent(VOICE_NOTE_EVENT, { bubbles: true })) })
    expect(await screen.findByText(VOICE_NOTE_LOCKED_SENTENCE)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Voice note' })).toBeNull()
  })
})
