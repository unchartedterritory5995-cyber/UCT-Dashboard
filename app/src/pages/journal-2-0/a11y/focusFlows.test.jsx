// app/src/pages/journal-2-0/a11y/focusFlows.test.jsx
//
// A4: where focus LANDS after each of the Notebook's everyday actions. A
// keyboard or screen-reader member who opens, leaves, deletes, asks, finds or
// dismisses a popup must end up somewhere that makes sense -- never dropped on
// <body> at the top of the page because the element that held focus was
// unmounted. Each rail asserts `document.activeElement` after the action
// settles, over the real NotebookTab / NoteEditorPage with only the network
// faked (fixtures.jsx).
//
//   open a note from the list          -> its title input
//   go back to the list (history Back) -> the row that opened it
//   delete it through ConfirmModal     -> the NEXT row, or the pane heading
//   close Ask                          -> the Ask toggle
//   close find                         -> the editor
//   Escape in the slash / emoji menu   -> the editor, caret unmoved
//   close the colour menu / outline    -> the toolbar button that opened it
//   close a Notebook Sheet (Save view) -> the button that opened it
//   the skip link                      -> the note, or the notes list heading
//
// ⭐ The emoji picker has no toolbar toggle: it is opened by typing `:` in the
// note, so the editor caret IS its toggle, exactly as for the slash menu.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { useNavigate } from 'react-router-dom'
import { installFetch, latchWave8Flags, Providers } from './fixtures'
import NotebookTab from '../tabs/NotebookTab'
import NoteEditorPage from '../components/notebook/NoteEditorPage'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const active = () => document.activeElement

let navigate = null
function NavProbe() { navigate = useNavigate(); return null }

// ── the tab ────────────────────────────────────────────────────────────────

async function renderTab(route = '/journal/notebook?folder=f1') {
  render(<Providers route={route}><NavProbe /><NotebookTab /></Providers>)
  await screen.findAllByText('Theses')
  const pane = document.getElementById('notebook-pane')
  await waitFor(() => expect(pane.querySelectorAll('[data-note-card-id]').length).toBeGreaterThan(1))
  await settle()
  return pane
}

const rowOrder = (pane) => [...pane.querySelectorAll('[data-note-card-id]')].map((el) => el.getAttribute('data-note-card-id'))
const rowFor = (pane, id) => pane.querySelector(`[data-note-card-id="${id}"]`)
const titleInput = () => screen.findByRole('textbox', { name: 'Note title' })

async function openFromList(pane, id) {
  const row = rowFor(pane, id)
  row.focus()
  fireEvent.click(row)
  const title = await titleInput()
  await waitFor(() => expect(active()).toBe(title))
  await settle()
  return title
}

async function deleteOpenNote() {
  const pane = document.getElementById('notebook-pane')
  fireEvent.click(within(pane).getByRole('button', { name: 'Delete' }))
  const dialog = await screen.findByRole('dialog', { name: /Delete this note\?/ })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
  // A note this device still holds unsent words for asks first (wave 6 item
  // 11); jsdom's editor can read as "ahead" of the fixture. Trash anyway.
  await settle(60)
  const anyway = screen.queryByRole('button', { name: /Trash anyway/ })
  if (anyway) fireEvent.click(anyway)
}

describe('focus in the Notebook tab', () => {
  beforeEach(() => { installFetch(); latchWave8Flags(true); navigate = null })

  it('opening a note from the list puts focus in its title', async () => {
    const pane = await renderTab()
    const [first] = rowOrder(pane)
    const title = await openFromList(pane, first)
    expect(title.tagName).toBe('INPUT')
  })

  it('going back to the list puts focus on the row that opened the note', async () => {
    const pane = await renderTab()
    const [, second] = rowOrder(pane)
    await openFromList(pane, second)
    act(() => { navigate(-1) })
    await waitFor(() => expect(active()?.getAttribute('data-note-card-id')).toBe(second))
  })

  it('a member who clicked into the sidebar keeps focus there when the note closes', async () => {
    const pane = await renderTab()
    const [first] = rowOrder(pane)
    await openFromList(pane, first)
    const allNotes = screen.getAllByRole('button').find((b) => /^All notes/.test(b.textContent || ''))
    allNotes.focus()
    fireEvent.click(allNotes)
    await settle()
    expect(active()).toBe(allNotes)
  })

  it('deleting a note through ConfirmModal puts focus on the NEXT row', async () => {
    const pane = await renderTab()
    const order = rowOrder(pane)
    await openFromList(pane, order[0])
    await deleteOpenNote()
    await waitFor(() => expect(active()?.getAttribute('data-note-card-id')).toBe(order[1]))
  })

  it('deleting the LAST row puts focus on the pane heading, which then shows', async () => {
    const pane = await renderTab()
    const order = rowOrder(pane)
    await openFromList(pane, order[order.length - 1])
    await deleteOpenNote()
    await waitFor(() => expect(active()?.tagName).toBe('H2'))
    expect(active().textContent).toBe('Notes in this folder')
    expect(active().tabIndex).toBe(-1)
  })

  it('the skip link is the first focusable thing in the tab, and it moves focus', async () => {
    const pane = await renderTab()
    const wrap = pane.parentElement
    const focusables = wrap.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
    const skip = focusables[0]
    expect(skip.textContent).toBe('Skip to notes list')
    fireEvent.click(skip)
    expect(active()).toBe(within(pane).getByRole('heading', { level: 2, name: 'Notes in this folder' }))

    // with a note open it says so, and lands in the note's title
    await openFromList(pane, rowOrder(pane)[0])
    const skip2 = wrap.querySelector('a[href="#notebook-pane"]')
    expect(skip2.textContent).toBe('Skip to note')
    skip2.focus()
    fireEvent.click(skip2)
    expect(active()).toBe(screen.getByRole('textbox', { name: 'Note title' }))
  })

  it('a Notebook Sheet (Save view) gives focus back to the button that opened it', async () => {
    const pane = await renderTab()
    const opener = within(pane).getByRole('button', { name: 'Save view' })
    opener.focus()
    fireEvent.click(opener)
    const field = await screen.findByRole('textbox', { name: /name/i })
    await waitFor(() => expect(active()).toBe(field))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /name/i })).toBeNull())
    expect(active()).toBe(opener)
  })
})

// ── the editor ─────────────────────────────────────────────────────────────

async function renderEditor() {
  render(
    <Providers route="/journal/notebook?note=n1">
      <NoteEditorPage noteId="n1" onBack={() => {}} showBack={false} />
    </Providers>,
  )
  await screen.findByPlaceholderText('Title')
  const dom = await waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el
  })
  await settle()
  return dom.editor
}

const caretAtEnd = (editor) => act(() => { editor.commands.focus('end') })

describe('focus in the note editor', () => {
  beforeEach(() => { installFetch(); latchWave8Flags(true) })

  it('closing Ask gives focus back to the Ask toggle', async () => {
    await renderEditor()
    const toggle = screen.getByRole('button', { name: /^Ask a question about/ })
    toggle.focus()
    fireEvent.click(toggle)
    const close = await screen.findByRole('button', { name: 'Close Ask' })
    close.focus()
    fireEvent.click(close)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close Ask' })).toBeNull())
    expect(active()).toBe(toggle)
  })

  it('closing the find bar gives focus back to the note', async () => {
    const editor = await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Find in note' }))
    const bar = await screen.findByRole('search', { name: 'Find in note' })
    const input = within(bar).getByRole('searchbox', { name: 'Find in note' })
    await waitFor(() => expect(active()).toBe(input))
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('search', { name: 'Find in note' })).toBeNull())
    // TipTap's focus command lands on the next animation frame
    await waitFor(() => expect(active()).toBe(editor.view.dom))
  })

  it('Escape in the slash menu leaves focus in the note, caret unmoved', async () => {
    const editor = await renderEditor()
    caretAtEnd(editor)
    act(() => { editor.commands.insertContent('/') })
    await waitFor(() => expect(document.getElementById('uct-slash-menu')).not.toBeNull())
    const caret = editor.state.selection.from
    expect(active()).toBe(editor.view.dom)
    fireEvent.keyDown(editor.view.dom, { key: 'Escape' })
    await settle()
    expect(active()).toBe(editor.view.dom)
    expect(editor.state.selection.from).toBe(caret)
  })

  it('Escape in the emoji menu leaves focus in the note, caret unmoved', async () => {
    const editor = await renderEditor()
    caretAtEnd(editor)
    act(() => { editor.commands.insertContent(' :smi') })
    await waitFor(() => expect(document.getElementById('uct-emoji-menu')).not.toBeNull())
    const caret = editor.state.selection.from
    fireEvent.keyDown(editor.view.dom, { key: 'Escape' })
    await settle()
    expect(active()).toBe(editor.view.dom)
    expect(editor.state.selection.from).toBe(caret)
  })

  it('closing the colour menu gives focus back to its toolbar button', async () => {
    await renderEditor()
    const toggle = screen.getByRole('button', { name: 'Text color and highlight' })
    toggle.focus()
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'))
    await waitFor(() => expect(active()).not.toBe(toggle)) // focus went INTO the menu
    fireEvent.keyDown(active(), { key: 'Escape' })
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('false'))
    expect(active()).toBe(toggle)
  })

  it('closing the outline gives focus back to its toolbar button', async () => {
    await renderEditor()
    const toggle = screen.getByRole('button', { name: 'Outline' })
    toggle.focus()
    fireEvent.click(toggle)
    const item = (await screen.findAllByText('Setup')).map((el) => el.closest('button[data-outline-item]')).find(Boolean)
    item.focus()
    fireEvent.keyDown(item, { key: 'Escape' })
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('false'))
    expect(active()).toBe(toggle)
  })
})
