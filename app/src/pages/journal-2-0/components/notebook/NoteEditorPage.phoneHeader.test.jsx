import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MQ } from '../../../../styles/breakpoints'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

// Notebook phone pass (2026-10-10). Measured at 390x844: the note's title started ~550 CSS px
// down, under a header that wrapped to three rows (Star, Ask, Find, Share / the folder select,
// Writing help / Outline, More) and a formatting toolbar wrapping to two. On a phone the header
// is now ONE row -- Star, Writing help (as its icon), Share, More -- and Ask, Find, Outline and
// the folder move into "More note actions". Writing help stays because its walkthrough opens on
// that button (follow-up the same day, found by the fin walk).
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

// Audit 2026-11-05, spec S10 (M4): the header is FOUR controls on every width -- Favorite, AI (Ask and Writing help),
// Share and More. Find and Outline are More's first items on every width (`leadItems`); the folder is on the line under
// the title. On a phone Ask's toggle is hidden in the row, so More carries "Ask about this note" first there.
const PHONE_ITEMS = ['Ask about this note', 'Find in note', 'Outline']
const LEAD_ITEMS = ['Find in note', 'Outline']

describe('opened on a DESKTOP, More leads with Find and Outline', () => {
  it('no phone item; Find and Outline first, then a separator, then History; focus lands on Find', async () => {
    await renderEditor()
    more().focus()
    const p = openMore()
    expect(p.queryByRole('button', { name: 'Ask about this note' })).toBeNull()
    const buttons = p.getAllByRole('button')
    expect(buttons.slice(0, LEAD_ITEMS.length).map((x) => x.getAttribute('aria-label'))).toEqual(LEAD_ITEMS)
    expect(buttons[1].closest('div').nextElementSibling).toHaveAttribute('role', 'separator')
    expect(buttons[2]).toHaveAccessibleName('Version history')
    expect(document.activeElement).toHaveAccessibleName('Find in note')
  })

  it('and the header carries Ask and Writing help (one AI group), never Find, Outline or the folder', async () => {
    await renderEditor()
    const h = within(header())
    const ai = h.getByRole('group', { name: 'AI' })
    expect(within(ai).getByRole('button', { name: /^ask this note$/i })).toBeTruthy()
    expect(within(ai).getByRole('button', { name: 'Writing help' })).toBeTruthy()
    for (const name of ['Find in note', 'Outline']) expect(h.queryByRole('button', { name }), name).toBeNull()
    expect(h.queryByRole('combobox', { name: 'Folder' })).toBeNull()
    // The folder is on the line under the title.
    const folder = screen.getByRole('combobox', { name: 'Folder' })
    expect(folder.closest('[data-note-details-line]')).not.toBeNull()
  })
})

describe('opened on a PHONE, More carries Ask too', () => {
  beforeEach(() => { phone = true })

  it('Ask, Find and Outline come FIRST, then a separator, and focus lands on the first', async () => {
    await renderEditor()
    more().focus()
    const p = openMore()
    const buttons = p.getAllByRole('button')
    expect(buttons.slice(0, PHONE_ITEMS.length).map((x) => x.getAttribute('aria-label'))).toEqual(PHONE_ITEMS)
    expect(buttons[PHONE_ITEMS.length - 1].closest('div').nextElementSibling).toHaveAttribute('role', 'separator')
    expect(document.activeElement).toBe(buttons[0])
    // ...and everything that was in the panel is still there, Move to Trash still LAST
    for (const name of ['Version history', 'Duplicate note', 'Move to Trash']) expect(p.getByRole('button', { name }), name).toBeTruthy()
    expect(buttons[buttons.length - 1]).toHaveAccessibleName('Move to Trash')
  })

  it('⛔ every header control marked phone-hidden has its More counterpart (none is dropped)', async () => {
    await renderEditor()
    // The controls the phone block hides: `.phoneInMore` (none left in the header since S10), plus the Ask toggle
    // inside `.askSlot`.
    const hidden = [...header().querySelectorAll('[class*="phoneInMore"]')]
    const ask = header().querySelector('[class*="askSlot"] [data-ask-toggle]')
    expect(ask, 'non-vacuity: the Ask toggle sits in its slot').toBeTruthy()
    const COUNTERPART = { 'Find in note': 'Find in note', Outline: 'Outline' }
    const p = openMore()
    for (const el of hidden) {
      const name = el.getAttribute('aria-label')
      expect(COUNTERPART[name], `header control "${name}" is hidden on a phone with no More item`).toBeTruthy()
      expect(p.getByRole('button', { name: COUNTERPART[name] }), name).toBeTruthy()
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

  it('Find: opens the find bar (the same as Ctrl+F) and closes the panel', async () => {
    await renderEditor()
    const p = openMore()
    fireEvent.click(p.getByRole('button', { name: 'Find in note' }))
    expect(await screen.findByRole('search', { name: 'Find in note' })).toBeTruthy()
    expect(more()).toHaveAttribute('aria-expanded', 'false')
  })

  it('Outline: opens the outline and closes the panel; closing the outline hands focus back to the More door', async () => {
    await renderEditor()
    const p = openMore()
    const item = p.getByRole('button', { name: 'Outline' })
    fireEvent.click(item)
    expect(await screen.findByRole('navigation', { name: /outline/i })).toBeTruthy()
    expect(item).toHaveAttribute('aria-expanded', 'true')
    expect(more()).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Close outline' }))
    await waitFor(() => expect(screen.queryByRole('navigation', { name: /outline/i })).toBeNull())
    // The item is hidden with the panel; the door that stays on screen takes focus, never <body>.
    expect(document.activeElement).toBe(more())
  })

  it('Writing help STAYS in the row (its walkthrough opens on it), not in More', async () => {
    await renderEditor()
    const btn = within(header()).getByRole('button', { name: 'Writing help' })
    expect(btn.className).not.toMatch(/phoneInMore/)
    expect(btn).toHaveAttribute('data-tour', 'writing-help')
    expect(openMore().queryByRole('button', { name: 'Writing help' })).toBeNull()
    fireEvent.click(btn)
    expect(await screen.findByRole('dialog', { name: 'Writing help' })).toBeTruthy()
  })

  it('the folder (under the title) writes the same folder move it did from the header', async () => {
    await renderEditor()
    const select = screen.getByRole('combobox', { name: 'Folder' })
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Unfiled', 'Swing ideas', 'Earnings'])
    fireEvent.change(select, { target: { value: 'f2' } })
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updateMock.mock.calls[0][0]).toEqual({ folderId: 'f2' })
    expect(openMore().queryByRole('combobox')).toBeNull()        // one folder control, not two
  })

  it('a LOCKED note: no Writing help in the row or in More (the one condition)', async () => {
    NOTE = { ...baseNote(), locked: true }
    await renderEditor()
    expect(within(header()).queryByRole('button', { name: 'Writing help' })).toBeNull()
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
    expect(p.getAllByRole('button')[0]).toHaveAccessibleName('Find in note')
  })
})
