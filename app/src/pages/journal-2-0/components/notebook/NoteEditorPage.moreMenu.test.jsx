import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import NoteMenuActions from './NoteMenuActions'

// Wave 10 lane K2 — design finding D-3 and the keyboard clause (9d) together, through a REAL
// NoteEditorPage. The design review measured up to five rows of controls above a note's title at
// 1200 px with a red Delete among the first; the page-level actions now sit behind ONE "More note
// actions" door (NoteMoreMenu.jsx), Delete last. Every action must stay reachable by keyboard and
// by a screen reader, and the door keeps the editor's disclosure contract
// (lib/useDisclosureFocus.js): focus in on open, Tab kept inside, Escape back to the button.

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
let NOTE
const baseNote = () => ({
  id: 'n1', title: 'Original Title', subtitle: '', folderId: null,
  ticker: null, tags: ['macro'], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false, locked: false,
  bodyJson: { type: 'doc', content: [P('Intro line.')] },
})
const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

beforeEach(() => {
  NOTE = baseNote()
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => ({ ...NOTE, ...patch, updatedAt: '2026-01-03T00:00:00Z' }))
  global.fetch = vi.fn((url) => {
    if (String(url).startsWith('/api/j2/notes/switcher')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [{ id: 'n2', title: 'Weekly review' }, { id: 'n3', title: 'Week two' }] }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
})
afterEach(() => vi.clearAllMocks())

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(
    <MemoryRouter>
      <NoteEditorPage noteId="n1" onBack={vi.fn()} showBack
        noteMenu={(note, api) => <NoteMenuActions note={note} onChanged={api.refresh} onOpenBeside={vi.fn()} />} />
    </MemoryRouter>,
  )
  await screen.findByPlaceholderText('Title')
  await waitFor(() => {
    if (!document.querySelector('.ProseMirror')?.editor) throw new Error('editor not mounted')
  })
}
const more = () => screen.getByRole('button', { name: 'More note actions' })
const panel = () => document.getElementById(more().getAttribute('aria-controls'))
const tab = (shift = false) => fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: shift })

describe('D-3: the page-level actions sit behind "More note actions"', () => {
  it('closed: no Delete, Duplicate, Lock or Archive on the page -- one door, collapsed', async () => {
    await renderEditor()
    expect(more()).toHaveAttribute('aria-expanded', 'false')
    for (const name of ['Delete', 'Duplicate note', 'Lock', 'Archive', 'Save as template', 'Open a note beside…']) {
      expect(screen.queryByRole('button', { name }), name).toBeNull()
    }
    // hidden, not unmounted: the organise sentence and a half-typed template name survive a close
    expect(panel()).toHaveAttribute('hidden')
  })

  it('open: every action is there by name, Delete LAST after a separator, and not a red button', async () => {
    await renderEditor()
    fireEvent.click(more())
    expect(more()).toHaveAttribute('aria-expanded', 'true')
    const group = within(panel())
    for (const name of ['Duplicate note', 'Lock', 'Archive', 'Save as template', 'Open a note beside…', 'Delete']) {
      expect(group.getByRole('button', { name }), name).toBeTruthy()
    }
    const buttons = group.getAllByRole('button')
    expect(buttons[buttons.length - 1]).toHaveAccessibleName('Delete')
    expect(buttons[buttons.length - 1].previousElementSibling).toHaveAttribute('role', 'separator')
    expect(buttons[buttons.length - 1]).not.toHaveClass('btn-danger')
  })

  it('the tags are UNDER the title now, not a row above it', async () => {
    await renderEditor()
    const title = screen.getByLabelText('Note title')
    const tags = screen.getByRole('group', { name: 'Tags' })
    expect(within(tags).getByRole('button', { name: 'Remove tag macro' })).toBeTruthy()
    expect(title.compareDocumentPosition(tags) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tags.closest('header')).toBeNull()
  })
})

describe('the door keeps the keyboard contract (K2)', () => {
  it('opening moves focus in; Tab and Shift+Tab wrap inside; Escape closes and returns to the door', async () => {
    await renderEditor()
    more().focus()
    fireEvent.click(more())
    const buttons = within(panel()).getAllByRole('button')
    expect(document.activeElement).toBe(buttons[0])
    buttons[buttons.length - 1].focus()
    tab()
    expect(document.activeElement).toBe(buttons[0])
    tab(true)
    expect(document.activeElement).toBe(buttons[buttons.length - 1])
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(more()).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(more())
  })

  it('Delete asks first; Escape on the question puts focus back on Delete, and the panel is still open', async () => {
    await renderEditor()
    fireEvent.click(more())
    const del = within(panel()).getByRole('button', { name: 'Delete' })
    del.focus()
    fireEvent.click(del)
    const dialog = await screen.findByRole('dialog', { name: 'Delete this note?' })
    // a press inside the question is not a press outside the panel
    fireEvent.mouseDown(within(dialog).getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete this note?' })).toBeNull())
    expect(more()).toHaveAttribute('aria-expanded', 'true')
    expect(document.activeElement).toBe(within(panel()).getByRole('button', { name: 'Delete' }))
  })

  it('NESTED: the Open-beside search inside the panel keeps Tab to itself, and one Escape closes one layer', async () => {
    await renderEditor()
    fireEvent.click(more())
    const beside = within(panel()).getByRole('button', { name: 'Open a note beside…' })
    fireEvent.click(beside)
    const search = within(panel()).getByRole('textbox', { name: 'Find a note to open beside' })
    fireEvent.change(search, { target: { value: 'week' } })
    const list = await within(panel()).findByRole('list', { name: 'Notes to open beside' })
    const results = within(list).getAllByRole('button')
    results[results.length - 1].focus()
    tab()
    expect(document.activeElement).toBe(search)          // the inner search wrapped, not the panel
    tab(true)
    expect(document.activeElement).toBe(results[results.length - 1])
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(within(panel()).queryByRole('textbox', { name: 'Find a note to open beside' })).toBeNull()
    expect(more()).toHaveAttribute('aria-expanded', 'true')   // only the search closed
    expect(document.activeElement).toBe(beside)
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(more()).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(more())
  })

  it('CONTROL: with the panel closed, Tab from the door is the page\'s own (no trap, nothing hidden is a stop)', async () => {
    await renderEditor()
    more().focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    more().dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
  })
})
