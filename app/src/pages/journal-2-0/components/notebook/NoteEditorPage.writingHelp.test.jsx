import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TextSelection } from '@tiptap/pm/state'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

// Wave 7 lane H (H2) — writing help in the REAL editor page.
//
// ⛔⛔ The load-bearing rail: while the draft is streaming and while it sits in
// the preview, the NOTE IS UNCHANGED (ruling D-H1). The document changes once,
// on Accept, by ONE askInsert block with `action` + `model`; Discard leaves it
// exactly as it was. Every refusal is asserted as RENDERED TEXT.

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const NOTE = {
  id: 'n1', title: 'NVDA', subtitle: '', folderId: null, ticker: null, tags: [], heroImageUrl: null,
  updatedAt: '2026-01-01T00:00:00Z', isFavorite: false,
  bodyJson: { type: 'doc', content: [P('Keep this. I sold NVDA early because I was scared. Keep that.')] },
}
const AUTH = { user: { id: 'u1' }, isPaid: true }
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => AUTH }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
// The mic is H1's; keep it out of this file's way.
vi.mock('../VoiceInputButton', async () => {
  const React = await import('react')
  return { default: React.forwardRef(() => null) }
})

function sse(events) {
  const enc = new TextEncoder()
  const chunks = events.map((e) => enc.encode(`data: ${JSON.stringify(e)}\n\n`))
  let i = 0
  return {
    ok: true, status: 200, json: async () => ({}),
    body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }) }) },
  }
}
const DRAFT = [
  { type: 'start', action: 'rewrite', model: 'claude-sonnet-5', scope: 'selection', instruction: 'Rewrite — shorter' },
  { type: 'delta', text: 'Fear sold ' }, { type: 'delta', text: 'my NVDA early.' },
  { type: 'final', text: 'Fear sold my NVDA early.', action: 'rewrite', model: 'claude-sonnet-5' },
]

let fetchMock
let writingHelpResponse
beforeEach(() => {
  AUTH.isPaid = true
  __resetNotebookFlags()
  writingHelpResponse = () => sse(DRAFT)
  fetchMock = vi.fn((url) => (String(url).endsWith('/writing-help/stream')
    ? Promise.resolve(writingHelpResponse())
    : Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  global.fetch = fetchMock
})
// ⛔ No `document.body.innerHTML = ''` here: the panel is a Sheet PORTALED into
// body, and wiping body under React makes Testing Library's own unmount throw.
afterEach(() => { __resetNotebookFlags(); vi.clearAllMocks() })

async function mount() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>)
  const el = await waitFor(() => {
    const pm = document.querySelector('.ProseMirror')
    if (!pm?.editor) throw new Error('editor not mounted')
    return pm
  })
  return el.editor
}
const at = (editor, str) => {
  let hit = null
  editor.state.doc.descendants((n, pos) => {
    if (hit == null && n.isText) { const i = n.text.indexOf(str); if (i >= 0) hit = pos + i }
  })
  return hit
}
const selectPhrase = (editor, from, to) => act(() => {
  editor.view.dispatch(editor.state.tr.setSelection(
    TextSelection.create(editor.state.doc, at(editor, from), at(editor, to) + to.length)))
})
const inserts = (editor) => {
  const out = []
  editor.state.doc.descendants((n) => { if (n.type.name === 'askInsert') out.push(n) })
  return out
}

describe('writing help — dark, and paid-only', () => {
  it('flag OFF (never latched): no toolbar entry, no slash item', async () => {
    const editor = await mount()
    expect(screen.queryByRole('button', { name: 'Writing help' })).toBeNull()
    const { blockItemsAvailable } = await import('./SlashMenu')
    expect(blockItemsAvailable(editor).some((i) => i.title === 'Writing help')).toBe(false)
  })

  it('flag ON but an UNPAID member: nothing either', async () => {
    latchNotebookFlags({ notebook_writing_help_enabled: true })
    AUTH.isPaid = false
    const editor = await mount()
    expect(screen.queryByRole('button', { name: 'Writing help' })).toBeNull()
    const { blockItemsAvailable } = await import('./SlashMenu')
    expect(blockItemsAvailable(editor).some((i) => i.title === 'Writing help')).toBe(false)
  })

  it('flag ON and paid: the toolbar entry and the slash item are there', async () => {
    latchNotebookFlags({ notebook_writing_help_enabled: true })
    const editor = await mount()
    expect(screen.getByRole('button', { name: 'Writing help' }).closest('[role="toolbar"]')).toBeTruthy()
    const { blockItemsAvailable } = await import('./SlashMenu')
    expect(blockItemsAvailable(editor).some((i) => i.title === 'Writing help')).toBe(true)
  })
})

describe('writing help — the preview, then Accept or Discard', () => {
  beforeEach(() => latchNotebookFlags({ notebook_writing_help_enabled: true }))

  it('⛔⛔ the draft streams into the PREVIEW and the note is untouched until Accept', async () => {
    const editor = await mount()
    const before = JSON.stringify(editor.getJSON())
    selectPhrase(editor, 'I sold', 'scared.')
    fireEvent.click(screen.getByRole('button', { name: 'Writing help' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Working on your selection/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rewrite shorter' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Write it' }))
    await within(dialog).findByText('Fear sold my NVDA early.')
    // the request carried the SELECTION and the chosen action
    const [, opts] = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/writing-help/stream'))
    expect(JSON.parse(opts.body)).toEqual({
      action: 'rewrite', style: 'shorter', scope: 'selection', text: 'I sold NVDA early because I was scared.',
    })
    // ⛔ nothing in the document yet
    expect(JSON.stringify(editor.getJSON())).toBe(before)
    expect(inserts(editor)).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const [block] = inserts(editor)
    expect(inserts(editor)).toHaveLength(1)
    expect(block.attrs).toMatchObject({
      action: 'rewrite', model: 'claude-sonnet-5', scope: 'selection', question: 'Rewrite — shorter',
    })
    expect(block.textContent).toBe('Fear sold my NVDA early.')
    expect(editor.state.doc.textContent).not.toContain('I sold NVDA early because I was scared.')
    expect(editor.state.doc.textContent).toContain('Keep this.')
    expect(editor.state.doc.textContent).toContain('Keep that.')
    expect(await screen.findByText(/Added from writing help/)).toBeInTheDocument()
  })

  it('Discard removes NOTHING, because nothing was ever added', async () => {
    const editor = await mount()
    const before = JSON.stringify(editor.getJSON())
    selectPhrase(editor, 'I sold', 'scared.')
    fireEvent.click(screen.getByRole('button', { name: 'Writing help' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Write it' }))
    await within(dialog).findByText('Fear sold my NVDA early.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(JSON.stringify(editor.getJSON())).toBe(before)
  })

  it('the daily limit is SAID in the panel, in the server\'s words — never a silent no-op', async () => {
    writingHelpResponse = () => ({
      ok: false, status: 429,
      json: async () => ({ detail: "You've used today's writing help — it resets at midnight ET" }),
    })
    const editor = await mount()
    const before = JSON.stringify(editor.getJSON())
    fireEvent.click(screen.getByRole('button', { name: 'Writing help' }))
    const dialog = await screen.findByRole('dialog')
    // ⛔ the empty control first
    expect(within(dialog).queryByRole('alert')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Write it' }))
    expect(await within(dialog).findByRole('alert'))
      .toHaveTextContent("You've used today's writing help — it resets at midnight ET")
    expect(JSON.stringify(editor.getJSON())).toBe(before)
  })

  // ⛔ Ruling D-H7: with the caret in an Ask answer, writing help is refused UP FRONT, in the
  // product's own sentence -- no panel, no request, so no generation of the member's 60 is spent
  // on a draft that could never be placed -- and nothing is ever nested.
  it('D-H7 — the caret inside an Ask answer: refused in the product sentence, no panel, no request', async () => {
    const editor = await mount()
    const { appendAskInsert } = await import('../../lib/askInsert')
    act(() => {
      appendAskInsert(editor, {
        type: 'askInsert',
        attrs: { insertedAt: '2026-09-24T10:00:00.000Z', scope: 'whole', question: 'Why did I sell?' },
        content: [P('Because the stop was hit.')],
      })
    })
    act(() => {
      const pos = at(editor, 'stop')
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
    })
    const before = JSON.stringify(editor.getJSON())
    fireEvent.click(screen.getByRole('button', { name: 'Writing help' }))
    expect(await screen.findByText("Couldn't add the draft here. Move the cursor outside any answer block and try again."))
      .toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/writing-help/stream'))).toBe(false)
    expect(JSON.stringify(editor.getJSON())).toBe(before)
  })

  it('the slash item opens it on the WHOLE note, from its own editor', async () => {
    const editor = await mount()
    const { ITEMS } = await import('./SlashMenu')
    const item = ITEMS.find((i) => i.title === 'Writing help')
    const from = editor.state.selection.from
    act(() => { item.command({ editor, range: { from, to: from } }) })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Working on the whole note')).toBeInTheDocument()
  })
})
