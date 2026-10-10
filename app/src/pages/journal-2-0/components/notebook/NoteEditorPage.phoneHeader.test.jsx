import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MQ } from '../../../../styles/breakpoints'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

// Notebook phone pass (2026-10-10). Measured at 390x844: the note's title started ~550 CSS px
// down, under a header that wrapped to three rows (Star, Ask, Find, Share / the folder select,
// Writing help / Outline, More) and a formatting toolbar wrapping to two. On a phone the header
// is now ONE row -- Star, Share, More -- and Ask, Find, Writing help, Outline and the folder
// move into "More note actions".
//
// ⛔ WHAT THIS FILE CAN SAY. jsdom applies no stylesheet, so "not displayed on a phone" is a CSS
// fact railed structurally in NoteEditorPage.phoneChrome.test.js. What a rendered test CAN hold,
// through a REAL NoteEditorPage, and does here:
//   1. More carries the five actions ONLY when it was opened on a phone (the query is read at
//      the click), first in the panel; opened on a desktop the panel is exactly what it was;
//   2. each item runs the SAME handler as its header control -- proved by the header control's
//      own state moving (Ask's toggle, Outline's aria-expanded) or by the identical write;
//   3. every header control the phone hides has its More counterpart (a control added to the
//      phone-hidden set without one fails here by name);
//   4. focus comes back to the item that opened a panel, never <body>.

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const H = (t) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t }] })
let NOTE
const baseNote = () => ({
  id: 'n1', title: 'Swing plan', subtitle: '', folderId: null, ticker: null, tags: [],
  heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false, locked: false,
  bodyJson: { type: 'doc', content: [H('Setup'), P('First body line.')] },
})
const AUTH = { user: { id: 'u1' }, isPaid: true }
const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => AUTH }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({
  default: () => ({ folders: [{ id: 'f1', name: 'Swing ideas' }, { id: 'f2', name: 'Earnings' }] }),
}))
vi.mock('../VoiceInputButton', async () => {
  const React = await import('react')
  return { default: React.forwardRef(() => null) }
})

// A controllable matchMedia: `phone` decides whether MQ.phone matches, and a change can be
// dispatched to the listeners (a rotated phone).
let phone = false
const mqListeners = new Set()
let realMatchMedia
function installMatchMedia() {
  realMatchMedia = window.matchMedia
  window.matchMedia = vi.fn((query) => ({
    get matches() { return phone && query === MQ.phone },
    media: query,
    onchange: null,
    addEventListener: (_t, fn) => { if (query === MQ.phone) mqListeners.add(fn) },
    removeEventListener: (_t, fn) => { mqListeners.delete(fn) },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

beforeEach(() => {
  NOTE = baseNote()
  phone = false
  mqListeners.clear()
  installMatchMedia()
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_writing_help_enabled: true })
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => ({ ...NOTE, ...patch, updatedAt: '2026-01-03T00:00:00Z' }))
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})
afterEach(() => {
  window.matchMedia = realMatchMedia
  __resetNotebookFlags()
  vi.clearAllMocks()
})

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  await waitFor(() => {
    if (!document.querySelector('.ProseMirror')?.editor) throw new Error('editor not mounted')
  })
}
const header = () => document.querySelector('header')
const more = () => screen.getByRole('button', { name: 'More note actions' })
const panel = () => document.getElementById(more().getAttribute('aria-controls'))
const openMore = () => { fireEvent.click(more()); return within(panel()) }

const PHONE_ITEMS = ['Ask about this note', 'Find in note', 'Writing help', 'Outline']

describe('opened on a DESKTOP, the More panel is exactly what it was', () => {
  it('none of the phone items, and the first action (where focus lands) is still History', async () => {
    await renderEditor()
    more().focus()
    const p = openMore()
    for (const name of PHONE_ITEMS) expect(p.queryByRole('button', { name }), name).toBeNull()
    expect(p.queryByRole('combobox', { name: 'Move to folder' })).toBeNull()
    expect(p.getAllByRole('button')[0]).toHaveAccessibleName('Version history')
    expect(document.activeElement).toHaveAccessibleName('Version history')
  })

  it('and the header still carries Ask, Find, Writing help, Outline and the folder', async () => {
    await renderEditor()
    const h = within(header())
    expect(h.getByRole('button', { name: /^ask a question about/i })).toBeTruthy()
    for (const name of ['Find in note', 'Writing help', 'Outline']) expect(h.getByRole('button', { name }), name).toBeTruthy()
    expect(h.getByRole('combobox', { name: 'Folder' })).toBeTruthy()
  })
})

describe('opened on a PHONE, More carries the header actions the phone hides', () => {
  beforeEach(() => { phone = true })

  it('the five actions come FIRST, then a separator, and focus lands on the first', async () => {
    await renderEditor()
    more().focus()
    const p = openMore()
    const buttons = p.getAllByRole('button')
    expect(buttons.slice(0, PHONE_ITEMS.length).map((b) => b.getAttribute('aria-label'))).toEqual(PHONE_ITEMS)
    const folder = p.getByRole('combobox', { name: 'Move to folder' })
    expect(folder.closest('div').nextElementSibling).toHaveAttribute('role', 'separator')
    expect(document.activeElement).toBe(buttons[0])
    // ...and everything that was in the panel is still there, Delete still LAST
    for (const name of ['Version history', 'Duplicate note', 'Delete']) expect(p.getByRole('button', { name }), name).toBeTruthy()
    expect(buttons[buttons.length - 1]).toHaveAccessibleName('Delete')
  })

  it('⛔ every header control marked phone-hidden has its More counterpart (none is dropped)', async () => {
    await renderEditor()
    // The controls the phone block hides: `.phoneInMore`, plus the Ask toggle inside `.askSlot`.
    const hidden = [...header().querySelectorAll('[class*="phoneInMore"]')]
    const ask = header().querySelector('[class*="askSlot"] [data-ask-toggle]')
    expect(hidden.length, 'non-vacuity: the phone-hidden controls were found').toBeGreaterThanOrEqual(4)
    expect(ask, 'non-vacuity: the Ask toggle sits in its slot').toBeTruthy()
    const COUNTERPART = { 'Find in note': 'Find in note', 'Writing help': 'Writing help', Outline: 'Outline', Folder: 'Move to folder' }
    const p = openMore()
    for (const el of hidden) {
      const name = el.getAttribute('aria-label')
      expect(COUNTERPART[name], `header control "${name}" is hidden on a phone with no More item`).toBeTruthy()
      const role = el.tagName === 'SELECT' ? 'combobox' : 'button'
      expect(p.getByRole(role, { name: COUNTERPART[name] }), name).toBeTruthy()
    }
    expect(p.getByRole('button', { name: 'Ask about this note' })).toBeTruthy()
    // Star, Share and More itself stay in the row on a phone
    expect(header().querySelector('[class*="phoneInMore"][aria-label*="Favorites"]')).toBeNull()
    expect(more().className).not.toMatch(/phoneInMore/)
  })

  it('Ask: the item presses the header\'s OWN toggle; closing hands focus back to the item', async () => {
    await renderEditor()
    const toggle = header().querySelector('[data-ask-toggle]')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const p = openMore()
    const item = p.getByRole('button', { name: 'Ask about this note' })
    fireEvent.click(item)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')     // the header toggle's handler ran
    fireEvent.click(await screen.findByRole('button', { name: 'Close Ask' }))
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'))
    expect(document.activeElement).toBe(item)
  })

  it('Find: opens the same find bar as the header button and closes the panel', async () => {
    await renderEditor()
    const p = openMore()
    fireEvent.click(p.getByRole('button', { name: 'Find in note' }))
    expect(await screen.findByRole('search', { name: 'Find in note' })).toBeTruthy()
    expect(more()).toHaveAttribute('aria-expanded', 'false')
  })

  it('Outline: one state with the header button; closing hands focus back to the item', async () => {
    await renderEditor()
    const headerOutline = within(header()).getAllByRole('button', { name: 'Outline' })
      .find((b) => !panel().contains(b))
    const p = openMore()
    const item = p.getByRole('button', { name: 'Outline' })
    fireEvent.click(item)
    expect(await screen.findByRole('navigation', { name: /outline/i })).toBeTruthy()
    expect(item).toHaveAttribute('aria-expanded', 'true')
    expect(headerOutline).toHaveAttribute('aria-expanded', 'true')   // the same `outlineOpen`
    fireEvent.click(screen.getByRole('button', { name: 'Close outline' }))
    await waitFor(() => expect(screen.queryByRole('navigation', { name: /outline/i })).toBeNull())
    expect(document.activeElement).toBe(item)
  })

  it('Writing help: the item opens the same panel as the header button', async () => {
    await renderEditor()
    const p = openMore()
    fireEvent.click(p.getByRole('button', { name: 'Writing help' }))
    expect(await screen.findByRole('dialog', { name: 'Writing help' })).toBeTruthy()
  })

  it('Move to folder: the same write as the header select', async () => {
    await renderEditor()
    fireEvent.change(within(header()).getByRole('combobox', { name: 'Folder' }), { target: { value: 'f2' } })
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    const fromHeader = updateMock.mock.calls[0][0]
    const p = openMore()
    const select = p.getByRole('combobox', { name: 'Move to folder' })
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Unfiled', 'Swing ideas', 'Earnings'])
    fireEvent.change(select, { target: { value: 'f2' } })
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(2))
    expect(updateMock.mock.calls[1][0]).toEqual(fromHeader)
    expect(fromHeader).toEqual({ folderId: 'f2' })
  })

  it('a LOCKED note: no Writing help in More either (the one condition both doors read)', async () => {
    NOTE = { ...baseNote(), locked: true }
    await renderEditor()
    const p = openMore()
    expect(p.queryByRole('button', { name: 'Writing help' })).toBeNull()
    expect(p.getByRole('button', { name: 'Ask about this note' })).toBeTruthy()
  })

  it('widening past 640 while open takes the phone items out (a rotated phone)', async () => {
    await renderEditor()
    const p = openMore()
    expect(p.getByRole('button', { name: 'Ask about this note' })).toBeTruthy()
    phone = false
    act(() => { for (const fn of [...mqListeners]) fn({ matches: false }) })
    expect(p.queryByRole('button', { name: 'Ask about this note' })).toBeNull()
    expect(p.getAllByRole('button')[0]).toHaveAccessibleName('Version history')
  })
})
