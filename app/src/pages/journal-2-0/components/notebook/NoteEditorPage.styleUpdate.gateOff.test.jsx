import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, it, expect, vi } from 'vitest'

// Notebook P1 (Task 14, spec P1.7c): the switch gates CREATING, never RENDERING. With it off a styled note
// renders exactly as it was written, and no banner, sheet, chooser or /style appears -- and none of their
// chunks is even FETCHED (a chunk's module factory runs only when it is imported, which is what is counted).

const loaded = vi.hoisted(() => ({ banner: 0, sheet: 0 }))
vi.mock('./styles/StyleUpdateBanner', async (importOriginal) => { loaded.banner += 1; return importOriginal() })
vi.mock('./styles/StyleUpdateSheet', async (importOriginal) => { loaded.sheet += 1; return importOriginal() })

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const NOTE = {
  id: 'n1', title: 'NVDA weekend', subtitle: '', folderId: null, ticker: 'NVDA', tags: [], heroImageUrl: null,
  updatedAt: '2026-01-01T00:00:00Z', isFavorite: false, locked: false,
  styleId: 's1', styleVersion: 1, kindId: 'weekend_prep',
  bodyJson: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] }, P('Styled body.')] },
}
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

import { STYLE_EVENT } from '../../lib/journalStylesFlag'
import { ITEMS } from './SlashMenu'

describe('the switch is off (never latched)', () => {
  it('a styled note renders; no banner, sheet or chooser is offered or even loaded; /style is not available', async () => {
    const urls = []
    global.fetch = vi.fn((u) => { urls.push(String(u)); return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }) })
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>
      </SWRConfig>,
    )
    await screen.findByPlaceholderText('Title')
    await waitFor(() => { if (!document.querySelector('.ProseMirror')?.editor) throw new Error('editor not mounted') })
    // the note renders as written (P1.7c)
    expect(document.querySelector('.ProseMirror').textContent).toContain('Styled body.')
    act(() => { document.querySelector('.ProseMirror').editor.view.dom.dispatchEvent(new CustomEvent(STYLE_EVENT, { bubbles: true })) })
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(screen.queryByText(/Update layout/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Review update' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Choose a journal style' })).toBeNull()
    expect(loaded).toEqual({ banner: 0, sheet: 0 })
    expect(urls.filter((u) => u.includes('journal-styles') || u.includes('style-update-plan'))).toEqual([])
    expect(ITEMS.find((i) => i.title === 'Journal style').available({})).toBe(false)
  })
})
