import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, it, expect, vi } from 'vitest'

// Notebook P1 round 3 (re-review N-I1): the style surfaces are fetched ON DEMAND. With the switch ON, an
// UNSTYLED note opens without fetching them (a styled note needs the banner check; /style asks for the
// chooser). Counted through the surfaces module's factory, which runs only when the module is imported.

const loaded = vi.hoisted(() => ({ surfaces: 0 }))
vi.mock('./styles/StyleSurfaces', async (importOriginal) => { loaded.surfaces += 1; return importOriginal() })

const NOTE = {
  id: 'n1', title: 'Plain note', subtitle: '', folderId: null, ticker: null, tags: [], heroImageUrl: null,
  updatedAt: '2026-01-01T00:00:00Z', isFavorite: false, locked: false, styleId: null, styleVersion: null, kindId: null,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plain body.' }] }] },
}
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
const fetchJournalStyles = vi.fn()
vi.mock('../../lib/journalStyles', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchJournalStyles: (...a) => fetchJournalStyles(...a),
}))

import { latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { STYLE_EVENT } from '../../lib/journalStylesFlag'

describe('the switch is ON and the note has no style', () => {
  it('opens without fetching the style surfaces; /style fetches them and opens the chooser', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    fetchJournalStyles.mockResolvedValue({
      kinds: [{ id: 'trade_plan', name: 'Trade plan' }],
      styles: [{ id: 's2', name: 'Plan B', kindId: 'trade_plan', builtin: false, isDefault: true, version: 1, blocks: [], properties: {} }],
      blockKinds: [],
    })
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>
      </SWRConfig>,
    )
    await screen.findByPlaceholderText('Title')
    await waitFor(() => { if (!document.querySelector('.ProseMirror')?.editor) throw new Error('editor not mounted') })
    await act(async () => { await vi.dynamicImportSettled() })
    expect(loaded.surfaces).toBe(0)
    expect(fetchJournalStyles).not.toHaveBeenCalled()
    act(() => { document.querySelector('.ProseMirror').editor.view.dom.dispatchEvent(new CustomEvent(STYLE_EVENT, { bubbles: true })) })
    expect(await screen.findByRole('dialog', { name: 'Choose a journal style' }, { timeout: 10000 })).toBeTruthy()
    expect(loaded.surfaces).toBe(1)
  })
})
