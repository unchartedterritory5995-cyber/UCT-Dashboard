import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Notebook P1 follow-up (owner GO 2026-10-12): Home's New-note caret on the notes list's "+ New note".
 * Spec P1.4 names "the P0.1 split button AND the list's New note". Through the real NotebookTab, mocked at
 * the same boundaries as NotebookTab.kindPicker.test.jsx. Switch on: a caret beside "+ New note" opens
 * Home's menu (one implementation, NewNoteMenu.jsx), "From a style" opens the sheet on the first kind.
 * Switch off: no caret and no styles request. "+ New note" keeps its one-press blank contract either way.
 */
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: [], isLoading: false, error: null, refresh: vi.fn(), mutate: vi.fn(),
    total: 0, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
}))
vi.mock('../components/notebook/FolderSidebar', () => ({ default: () => <div data-testid="folder-sidebar" /> }))
vi.mock('../components/notebook/NoteEditorPage', () => ({
  default: ({ noteId }) => <div data-testid="note-editor" data-note-id={noteId} />,
}))
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../components/notebook/ResearchHome', () => ({ default: () => <div data-testid="research-home" /> }))
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))
vi.mock('../lib/noteCreation', async (importOriginal) => ({
  ...(await importOriginal()),
  createNoteViaApi: vi.fn(async () => ({ id: 'new1', title: '', updatedAt: 'R0' })),
}))

import NotebookTab from './NotebookTab'
import { createNoteViaApi } from '../lib/noteCreation'
import { BUILTIN_NOTE_KINDS } from '../lib/noteKinds'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { setCurrentAccountId } from '../lib/offline/currentAccount'

const listBody = {
  kinds: BUILTIN_NOTE_KINDS.map((k) => ({ ...k, builtin: true })),
  styles: BUILTIN_NOTE_KINDS.map((k) => ({ id: `builtin:${k.id}`, name: `${k.name} (starter)`, kindId: k.id,
    builtin: true, isDefault: true, version: 1, blocks: [], properties: {} })),
  blockKinds: [],
}
beforeAll(async () => { await import('../components/notebook/styles/StyleSurfaces') })
const T = { timeout: 20000 }
vi.setConfig({ testTimeout: 40000 })

const CARET = 'More ways to start a note'
let urls
beforeEach(() => {
  vi.clearAllMocks()
  urls = []
  setCurrentAccountId('acct-A')
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    urls.push(u)
    const ok = (body) => ({ ok: true, status: 200, json: async () => body })
    if (u === '/api/j2/journal-styles') return ok(listBody)
    if (u.startsWith('/api/j2/note-folders')) return ok({ folders: [] })
    if (u === '/api/j2/note-templates') return ok({ templates: [] })
    return ok({})
  })
})
afterEach(() => { setCurrentAccountId(null); __resetNotebookFlags() })

const renderList = () => render(
  <MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>,
)
const toolbar = () => screen.getByRole('toolbar', { name: 'Notes list tools' })

describe('the notes list\'s New note caret (Notebook P1 follow-up)', () => {
  it('switch on: the caret sits right after "+ New note" and lists Home\'s doors', () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    renderList()
    const bar = toolbar()
    const caret = within(bar).getByRole('button', { name: CARET })
    expect(caret).toHaveAttribute('aria-haspopup', 'menu')
    expect(caret).toHaveAttribute('aria-expanded', 'false')
    expect(caret.className).toMatch(/\bbtn btn-primary btn-sm\b/)
    const buttons = within(bar).getAllByRole('button')
    const newNote = within(bar).getByRole('button', { name: '+ New note' })
    expect(buttons.indexOf(caret)).toBe(buttons.indexOf(newNote) + 1)
    // ONE "new-note-home" anchor, and it is Home's: the list's instance carries none
    expect(bar.querySelector('[data-tour="new-note-home"]')).toBeNull()
    fireEvent.click(caret)
    const menu = within(bar).getByRole('menu', { name: 'Start a note' })
    expect(within(menu).getAllByRole('menuitem').map((el) => el.textContent.trim()))
      .toEqual(['From an outline', 'From a style', "Today's note"])
  })

  it('switch on: "From a style" opens the New-note sheet with focus on the first kind', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    renderList()
    fireEvent.click(within(toolbar()).getByRole('button', { name: CARET }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'From a style' }))
    const dialog = await screen.findByRole('dialog', { name: 'New note' })
    const first = await within(dialog).findByLabelText('New Trade plan', {}, T)
    await waitFor(() => expect(document.activeElement).toBe(first))
    expect(document.activeElement).not.toBe(within(dialog).getByRole('searchbox', { name: 'Search templates' }))
    expect(createNoteViaApi).not.toHaveBeenCalled()
  })

  it('switch on: "From an outline" opens the same sheet the Templates button opens', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    renderList()
    fireEvent.click(within(toolbar()).getByRole('button', { name: CARET }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'From an outline' }))
    const dialog = await screen.findByRole('dialog', { name: 'New note' })
    await within(dialog).findByLabelText('New Trade plan', {}, T)
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('searchbox', { name: 'Search templates' })))
  })

  it('switch off: no caret on the list, and /api/j2/journal-styles is never requested', async () => {
    renderList()
    const bar = toolbar()
    expect(within(bar).queryByRole('button', { name: CARET })).toBeNull()
    // the header's last control is still "+ New note", exactly as before
    const buttons = within(bar).getAllByRole('button')
    expect(buttons[buttons.length - 1]).toHaveTextContent('+ New note')
    await waitFor(() => expect(urls.some((u) => u.startsWith('/api/j2/note-folders') || u === '/api/j2/note-templates')).toBe(true))
    expect(urls).not.toContain('/api/j2/journal-styles')
  })

  it.each([['on', true], ['off', false]])('switch %s: "+ New note" is unchanged, one press is one blank create', async (_l, on) => {
    if (on) latchNotebookFlags({ notebook_journal_styles_enabled: true })
    renderList()
    const bar = toolbar()
    const newNote = within(bar).getByRole('button', { name: '+ New note' })
    expect(newNote).toHaveAttribute('data-tour', 'new-note')
    expect(newNote.className).toBe('btn btn-primary btn-sm')
    expect(newNote.parentElement).toBe(bar.querySelector('[data-tour="import"]').parentElement)   // not wrapped
    if (on) {
      // the caret alone creates nothing
      fireEvent.click(within(bar).getByRole('button', { name: CARET }))
      expect(createNoteViaApi).not.toHaveBeenCalled()
      expect(within(bar).getByRole('button', { name: CARET })).toBeTruthy()
    }
    fireEvent.click(newNote)
    await waitFor(() => expect(createNoteViaApi).toHaveBeenCalledTimes(1))
    const args = createNoteViaApi.mock.calls[0][0]
    expect(args.kindId).toBeUndefined()
    expect(args.styleId).toBeUndefined()
    expect(args.title).toBe('')
    await waitFor(() => expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'new1'))
  })

  it('keyboard: Left/Right reach the caret, Down walks the items, Escape returns to the caret', () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    renderList()
    const bar = toolbar()
    const newNote = within(bar).getByRole('button', { name: '+ New note' })
    const caret = within(bar).getByRole('button', { name: CARET })
    newNote.focus()
    fireEvent.keyDown(newNote, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(caret)
    expect(caret.tabIndex).toBe(0)
    fireEvent.keyDown(caret, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(newNote)
    fireEvent.keyDown(newNote, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(caret)

    fireEvent.click(caret)
    const items = within(screen.getByRole('menu', { name: 'Start a note' })).getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(items[2], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[1])
    // the toolbar's Left/Right must not pull focus out of an open menu (and leave it hanging open)
    fireEvent.keyDown(items[1], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1], { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(caret)
    expect(caret.tabIndex).toBe(0)
  })
})
