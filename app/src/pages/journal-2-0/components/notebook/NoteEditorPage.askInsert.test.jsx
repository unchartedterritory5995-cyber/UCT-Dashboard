import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearPendingAskInsert, takePendingAskInsert, writePendingAskInsert } from '../../lib/askInsert'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

// G-064 — the real editor mount, same convention as NoteEditorPage.noteLinks.test.jsx.
// A component test that mocks the editor could not see a severed wire.

const NOTE = {
  id: 'n1', title: 'Original Title', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My own view.' }] }] },
}
const NODE = {
  type: 'askInsert', attrs: { insertedAt: '2026-09-22T12:00:00.000Z', scope: 'notebook', question: 'q' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inserted answer text.' }] }],
}

vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(async () => NOTE), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

function sse(events) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
}

beforeEach(() => {
  clearPendingAskInsert()
  sessionStorage.clear()
  __resetNotebookFlags()
  global.fetch = vi.fn((url) => {
    if (typeof url === 'string' && url.includes('/api/j2/ask/stream')) {
      return Promise.resolve({
        ok: true, status: 200, json: async () => ({}),
        body: sse([
          { type: 'sources', scope: 'note', scopeLabel: 'This note', coverageNotice: null, sources: [{
            n: 1, type: 'note', label: 'Other note', citation: 'exact', snippet: 's',
            navigation: { kind: 'note', note_id: 'n9' }, location: {}, payload: {}, stance: null, truncated: false,
          }] },
          { type: 'final', answer: 'Margins fell [1].' },
        ]),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
})
afterEach(() => vi.clearAllMocks())

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
}

describe('NoteEditorPage — G-064 Ask insert', () => {
  it('an answer picked for this note elsewhere lands at the end of it', async () => {
    writePendingAskInsert('n1', NODE)
    await renderEditor()
    await waitFor(() => expect(screen.getByText('Inserted answer text.')).toBeInTheDocument())
    expect(screen.getByText('From Ask Notebook')).toBeInTheDocument()
    expect(await screen.findByText('Answer inserted at the end of this note.')).toBeInTheDocument()
    expect(takePendingAskInsert('n1')).toBeNull()
  })

  it("another note's pending answer is not inserted here", async () => {
    writePendingAskInsert('n2', NODE)
    await renderEditor()
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Inserted answer text.')).toBeNull()
    expect(takePendingAskInsert('n2')?.noteId).toBe('n2')
  })

  it('"Insert into this note" appends the answer from the note\'s own Ask panel', async () => {
    latchNotebookFlags({ notebook_ask_insert_on: true })
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Ask a question about this note' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ask This note' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'margins?' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Insert into this note' }))
    await waitFor(() => expect(screen.getByText('From Ask Notebook')).toBeInTheDocument())
    expect(within(dialog).getByRole('button', { name: 'Inserted' })).toBeDisabled()
  })
})
