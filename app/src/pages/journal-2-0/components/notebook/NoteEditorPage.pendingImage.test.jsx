// S12 (audit 2026-11-05, M9): the phone "+" sheet's "Photo / chart screenshot". The image the member picked on the list
// is handed to the NEW note's editor and placed by its own image door -- the same upload and setImage a paste or the
// Insert menu's Image uses (`handleImageInsert`) -- once, and only in the note it was held for.
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { holdImageForNote, takeImageForNote } from '../../lib/pendingImageInsert'

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const NOTES = {
  n1: { id: 'n1', title: 'Chart screenshot', subtitle: '', folderId: null, ticker: null, tags: [], heroImageUrl: null,
    updatedAt: '2026-01-01T00:00:00Z', isFavorite: false, bodyJson: { type: 'doc', content: [{ type: 'paragraph' }] } },
  n2: { id: 'n2', title: 'Other', subtitle: '', folderId: null, ticker: null, tags: [], heroImageUrl: null,
    updatedAt: '2026-01-01T00:00:00Z', isFavorite: false, bodyJson: { type: 'doc', content: [P('Body.')] } },
}
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: (noteId) => ({ note: NOTES[noteId], isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

let uploads
beforeEach(() => {
  uploads = []
  global.fetch = vi.fn((url, init) => {
    if (/\/api\/j2\/notes\/[^/]+\/images$/.test(String(url)) && init?.method === 'POST') {
      uploads.push(String(url))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ url: '/media/chart.png', width: 10, height: 10 }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
})
afterEach(() => { takeImageForNote('n1'); takeImageForNote('n2'); vi.clearAllMocks() })

async function mount(noteId) {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const view = render(<MemoryRouter><NoteEditorPage noteId={noteId} onBack={vi.fn()} showBack /></MemoryRouter>)
  const el = await waitFor(() => {
    const e = view.container.querySelector('.ProseMirror')
    if (!e?.editor) throw new Error('editor not mounted')
    return e
  })
  return el.editor
}
const file = () => new File([new Uint8Array([137, 80, 78, 71])], 'chart.png', { type: 'image/png' })
const images = (ed) => { const o = []; ed.state.doc.descendants((n) => { if (n.type.name === 'image') o.push(n.attrs.src) }); return o }

describe('a held image is placed by the note\'s own image door', () => {
  it('the note it was held for uploads it to ITSELF and places it, once', async () => {
    holdImageForNote('n1', file())
    const ed = await mount('n1')
    await waitFor(() => expect(images(ed)).toEqual(['/media/chart.png']))
    expect(uploads).toEqual(['/api/j2/notes/n1/images'])
    expect(takeImageForNote('n1')).toBeNull()   // taken once
  })

  it('CONTROL: a different note never receives it', async () => {
    holdImageForNote('n1', file())
    const ed = await mount('n2')
    await new Promise((r) => setTimeout(r, 50))
    expect(images(ed)).toEqual([])
    expect(uploads).toEqual([])
    expect(takeImageForNote('n1')).not.toBeNull()
  })
})
