// Wave 10 lane D2 (design finding D-1): a `?note=` link opens the NOTE on a phone,
// and "Back to notes" returns to the list.
//
// Measured at 390 px on fa6710394 (docs/notebook/proof/d2-before-fa6710394): a phone
// stacks the folder panel ABOVE the notes, so a `?note=` link painted the folder panel
// first and put the note's title 1,530 px down; the centre of the first screen landed
// on the folder panel. After (d2-after-*): the panel is hidden while a note is open and
// the first thing on the Notebook is the note.
//
// ⛔ jsdom performs no layout and applies no CSS, so this file cannot see "hidden at
// 390 px". It proves the two halves that make the browser result true: the RENDERED
// half (the state attribute is on the element whose `.sidebarSlot` the phone rule
// hides; the back control exists, is a real button, and goes back to the right list)
// and the STRUCTURAL half (the phone rule itself, in the media block that applies at
// 390 and not at 820). The real-browser verdict is d2_phone_measure.py's `deep` row.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

const NOTES = [
  { id: 'n1', title: 'Alpha thesis', updatedAt: '2026-09-27T10:00:00Z' },
  { id: 'n2', title: 'Beta review', updatedAt: '2026-09-26T10:00:00Z' },
]
const mockRefresh = vi.fn()
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: NOTES, isLoading: false, error: null, refresh: mockRefresh, mutate: vi.fn(),
    total: NOTES.length, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
}))
vi.mock('../components/notebook/FolderSidebar', () => ({
  // A folder choice goes through the tab's own `onSelectFolder` -- the same door the real panel uses.
  default: ({ onSelectFolder }) => (
    <div data-testid="folder-sidebar">
      <button type="button" onClick={() => onSelectFolder?.('f-swing')}>Pick Swing ideas</button>
    </div>
  ),
}))
// A card is a button that opens its note through the tab's own `onOpen` (openNote) --
// the same door the real NoteCard uses.
vi.mock('../components/notebook/NoteCard', () => ({
  default: ({ note, onOpen }) => (
    <button type="button" data-note-card-id={note.id} onClick={() => onOpen(note)}>{note.title}</button>
  ),
}))
// The editor stand-in pushes the SAME-NOTE entries the real one does
// (NoteEditorPage.jsx): a review citation (`?note=A&review=R`, a push) and an Ask
// citation into this note's own PDF (`&doc=D&page=N`, a push, then a replace that
// strips doc/page).
vi.mock('../components/notebook/NoteEditorPage', async () => {
  const { useSearchParams } = await import('react-router-dom')
  return {
    default: function EditorStandIn({ noteId }) {
      const [, setSearchParams] = useSearchParams()
      const edit = (fn, replace) => setSearchParams((prev) => { const n = new URLSearchParams(prev); fn(n); return n }, { replace })
      return (
        <div data-testid="note-editor" data-note-id={noteId}>
          <button type="button" onClick={() => edit((n) => n.set('review', 'r1'), false)}>review citation</button>
          <button type="button" onClick={() => edit((n) => { n.set('doc', 'd1'); n.set('page', '3') }, false)}>ask citation</button>
          <button type="button" onClick={() => edit((n) => { n.delete('doc'); n.delete('page') }, true)}>strip doc</button>
        </div>
      )
    },
  }
})
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../components/notebook/ResearchHome', () => ({
  default: () => <div data-testid="research-home">Research Home</div>,
}))
// D-7's own tests below switch view mode -- NotesTableView (an icon-row mode) and
// NoteTasksView (reached by its own `?view=tasks` URL too) stand in for the six
// content-first modes so switching doesn't try to lazy-load and render the real
// ones (NoteBoardView.test.jsx etc. already cover their own content).
vi.mock('../components/notebook/NotesTableView', () => ({
  default: () => <div data-testid="notes-table" />,
}))
vi.mock('../components/notebook/NoteTasksView', () => ({
  default: () => <div data-testid="note-tasks" />,
}))

import NotebookTab from './NotebookTab'

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.search}</div>
}

function renderAt(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Where />
      <NotebookTab />
    </MemoryRouter>,
  )
}

const search = () => screen.getByTestId('where').textContent
const backButton = () => screen.queryByRole('button', { name: 'Back to notes' })

beforeEach(() => {
  mockRefresh.mockClear()
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})

describe('D-1 -- a ?note= link opens the note (rendered)', () => {
  it('marks the Notebook box that holds the folder panel as "a note is open"', () => {
    renderAt('/journal/notebook?note=n1')
    expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'n1')
    // ⛔ The attribute must sit on an ANCESTOR of the folder panel -- that is the
    // element `.wrap[data-note-open] .sidebarSlot` matches. On any other element the
    // phone rule would hide nothing and every other assertion here would still pass.
    const holder = screen.getByTestId('folder-sidebar').closest('[data-note-open]')
    expect(holder).not.toBeNull()
    expect(holder).toHaveAttribute('data-note-open', 'true')
    // ...and it is the same box the editor is in (the two are siblings in it).
    expect(holder.contains(screen.getByTestId('note-editor'))).toBe(true)
  })

  it('without a note, nothing is marked and there is no back control', () => {
    renderAt('/journal/notebook?view=all')
    expect(screen.getByTestId('folder-sidebar').closest('[data-note-open]')).toBeNull()
    expect(backButton()).toBeNull()
  })

  it('the back control is a real button, and it comes BEFORE the note', () => {
    renderAt('/journal/notebook?note=n1')
    const back = backButton()
    expect(back).not.toBeNull()
    expect(back.tagName).toBe('BUTTON')
    expect(back).toHaveAttribute('type', 'button')
    // DOCUMENT_POSITION_FOLLOWING (4): the editor follows the button.
    expect(back.compareDocumentPosition(screen.getByTestId('note-editor')) & 4).toBe(4)
  })

  it('from a fresh ?note= link, "Back to notes" closes the note to the Notebook list', async () => {
    renderAt('/journal/notebook?view=all&note=n1')
    fireEvent.click(backButton())
    await waitFor(() => expect(screen.queryByTestId('note-editor')).toBeNull())
    expect(search()).toBe('?view=all')
    expect(screen.getByRole('button', { name: 'Alpha thesis' })).toBeInTheDocument()
    expect(backButton()).toBeNull()
  })

  it('a note opened FROM the list goes back to THAT list (history), not a rebuilt URL', async () => {
    renderAt('/journal/notebook?view=all')
    fireEvent.click(screen.getByRole('button', { name: 'Beta review' }))
    await waitFor(() => expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'n2'))
    // openNote drops `view` -- so a close alone could not find the list again
    // (measured on 97cffa4b9: it landed on Research Home).
    expect(search()).toBe('?note=n2')
    fireEvent.click(backButton())
    await waitFor(() => expect(screen.queryByTestId('note-editor')).toBeNull())
    expect(search()).toBe('?view=all')
    expect(screen.queryByTestId('research-home')).toBeNull()
    expect(screen.getByRole('button', { name: 'Beta review' })).toBeInTheDocument()
  })

  it('⛔ I-1 -- list -> note -> a same-note REVIEW citation push -> ONE tap returns to the list', async () => {
    renderAt('/journal/notebook?view=all')
    fireEvent.click(screen.getByRole('button', { name: 'Beta review' }))
    await waitFor(() => expect(search()).toBe('?note=n2'))
    fireEvent.click(screen.getByRole('button', { name: 'review citation' }))
    await waitFor(() => expect(search()).toBe('?note=n2&review=r1'))
    fireEvent.click(backButton())
    await waitFor(() => expect(screen.queryByTestId('note-editor')).toBeNull())
    expect(search()).toBe('?view=all')
    expect(screen.queryByTestId('research-home')).toBeNull()
    expect(screen.getByRole('button', { name: 'Beta review' })).toBeInTheDocument()
  })

  it('⛔ I-1 -- list -> note -> an ASK citation push, then its replace -> ONE tap returns to the list', async () => {
    renderAt('/journal/notebook?view=all')
    fireEvent.click(screen.getByRole('button', { name: 'Alpha thesis' }))
    await waitFor(() => expect(search()).toBe('?note=n1'))
    fireEvent.click(screen.getByRole('button', { name: 'ask citation' }))
    await waitFor(() => expect(search()).toBe('?note=n1&doc=d1&page=3'))
    fireEvent.click(screen.getByRole('button', { name: 'strip doc' }))
    await waitFor(() => expect(search()).toBe('?note=n1'))
    fireEvent.click(backButton())
    await waitFor(() => expect(screen.queryByTestId('note-editor')).toBeNull())
    expect(search()).toBe('?view=all')
  })

  it('a fresh ?note= link with a same-note push still closes to the Notebook list (no blind back)', async () => {
    renderAt('/journal/notebook?view=all&note=n1')
    fireEvent.click(screen.getByRole('button', { name: 'review citation' }))
    await waitFor(() => expect(search()).toBe('?view=all&note=n1&review=r1'))
    fireEvent.click(backButton())
    await waitFor(() => expect(screen.queryByTestId('note-editor')).toBeNull())
    // closed, not walked back through history: the page stays the Notebook
    expect(search()).not.toMatch(/note=/)
    expect(search()).toMatch(/view=all/)
  })

  it('keyboard: the back control takes focus and Enter/click activates it', async () => {
    renderAt('/journal/notebook?view=all&note=n1')
    const back = backButton()
    back.focus()
    expect(document.activeElement).toBe(back)
    fireEvent.click(back) // a <button> turns Enter/Space into click natively
    await waitFor(() => expect(search()).toBe('?view=all'))
  })
})

// ── D-7 (design re-review, docs/notebook/design-review-2.md): a content-first
// view mode collapses the SAME sidebar the desktop toggle already controls, at
// phone width only. jsdom applies no CSS, so this cannot see "the tree is 0
// width" -- it proves the STATE change (the "Show folders panel" toggle,
// conditionally rendered only while collapsed, is the rendered signal) and that
// it is scoped to phone width, exactly like NotebookTab.phoneNote's own D-1
// blocks prove `data-note-open` rather than the pixels it produces.
const realWidth = window.innerWidth
const setWidth = (w) => Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true })
const showFoldersBtn = () => screen.queryByRole('button', { name: 'Show folders panel' })

describe('D-7 -- a content-first view mode gives the view the first screen on a phone (rendered)', () => {
  afterEach(() => setWidth(realWidth))

  // Phone pass 2026-10-10: measured at 390x844, the tree filled the whole first screen on List
  // and Research Home, so the panel is now a drawer on EVERY phone view (it used to stay open here).
  it('List, the default landing, folds the panel at phone width too -- the notes get the first screen', () => {
    setWidth(390)
    renderAt('/journal/notebook?view=all')
    expect(showFoldersBtn()).not.toBeNull()
  })

  it('Research Home (no folder chosen) folds the panel at phone width', async () => {
    setWidth(390)
    renderAt('/journal/notebook')
    await screen.findByTestId('research-home')
    expect(showFoldersBtn()).not.toBeNull()
  })

  it('the SAME landing at 1280px keeps the panel open', () => {
    setWidth(1280)
    renderAt('/journal/notebook?view=all')
    expect(showFoldersBtn()).toBeNull()
  })

  it('the #search door keeps the panel OPEN at phone width (it opens it on purpose for its search box)', () => {
    setWidth(390)
    renderAt('/journal/notebook#search')
    expect(showFoldersBtn()).toBeNull()
  })

  it('a drawer: opened, then a folder chosen, it folds again so the folder is what the member sees', async () => {
    setWidth(390)
    renderAt('/journal/notebook?view=all')
    fireEvent.click(showFoldersBtn())
    expect(showFoldersBtn()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pick Swing ideas' }))
    await waitFor(() => expect(showFoldersBtn()).not.toBeNull())
  })

  it('the reopen control says what it opens on a phone ("Folders"), keeping its accessible name', () => {
    setWidth(390)
    renderAt('/journal/notebook?view=all')
    expect(showFoldersBtn().textContent).toContain('Folders')
  })

  it('switching to an icon-row mode (Table) at phone width collapses the panel', async () => {
    setWidth(390)
    renderAt('/journal/notebook?view=all')
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    await screen.findByTestId('notes-table')
    expect(showFoldersBtn()).not.toBeNull()
  })

  it('the SAME switch at 820px (not a phone) never collapses the panel', async () => {
    setWidth(820)
    renderAt('/journal/notebook?view=all')
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    await screen.findByTestId('notes-table')
    expect(showFoldersBtn()).toBeNull()
  })

  it('the floating toggle -- the EXISTING control, never a new one -- reopens the panel', async () => {
    setWidth(390)
    renderAt('/journal/notebook?view=all')
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    await screen.findByTestId('notes-table')
    fireEvent.click(showFoldersBtn())
    expect(showFoldersBtn()).toBeNull()
  })

  it('Tasks -- reached by its own ?view=tasks URL -- ALSO collapses the panel (it shares the icon row and the same mechanism, even though this walk reached it by URL)', async () => {
    setWidth(390)
    renderAt('/journal/notebook?view=tasks')
    await screen.findByTestId('note-tasks')
    expect(showFoldersBtn()).not.toBeNull()
  })

  it('a note open at phone width is unaffected -- D-1/D-2\'s own mechanism still owns that case', () => {
    setWidth(390)
    renderAt('/journal/notebook?view=all&note=n1')
    expect(showFoldersBtn()).toBeNull()
  })

  it('CONTROL: the panel is genuinely reachable while collapsed -- toggling shows the real FolderSidebar again', async () => {
    setWidth(390)
    renderAt('/journal/notebook?view=all')
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    await screen.findByTestId('notes-table')
    expect(screen.getByTestId('folder-sidebar')).toBeInTheDocument() // never unmounted, only hidden by CSS
    fireEvent.click(showFoldersBtn())
    expect(screen.getByTestId('folder-sidebar')).toBeInTheDocument()
  })
})

// ── the structural half: the phone rule, where it applies ──────────────────────
const CSS = readFileSync(
  join(process.cwd(), 'src/pages/journal-2-0/tabs/NotebookTab.module.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

/** Bodies of the @media blocks that ACTUALLY APPLY at `width`. */
function mediaBodiesAt(css, width) {
  const out = []
  const re = /@media([^{]+)\{/g
  let m
  while ((m = re.exec(css))) {
    const cond = m[1]
    const max = /max-width:\s*(\d+)px/.exec(cond)
    const min = /min-width:\s*(\d+)px/.exec(cond)
    if (max && width > Number(max[1])) continue
    if (min && width < Number(min[1])) continue
    let depth = 1
    let i = re.lastIndex
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
    }
    out.push(css.slice(re.lastIndex, i - 1))
  }
  return out
}

/** The stylesheet with every @media block cut out. */
function baseRules(css) {
  let out = ''
  let i = 0
  const re = /@media[^{]+\{/g
  let m
  while ((m = re.exec(css))) {
    out += css.slice(i, m.index)
    let depth = 1
    let j = re.lastIndex
    for (; j < css.length && depth > 0; j += 1) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') depth -= 1
    }
    i = j
    re.lastIndex = j
  }
  return out + css.slice(i)
}

function declaresProp(blockText, selector, prop, pattern) {
  const rules = [...blockText.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  for (const [, sels, decls] of rules) {
    if (!sels.split(',').some((s) => s.trim() === selector)) continue
    for (const part of decls.split(';')) {
      const colon = part.indexOf(':')
      if (colon < 0) continue
      if (part.slice(0, colon).trim() !== prop) continue
      if (pattern.test(part.slice(colon + 1).trim())) return true
    }
  }
  return false
}

const HIDE = '.wrap[data-note-open] .sidebarSlot'

describe('D-1 -- the phone rule (structural; d2_phone_measure.py is the verdict)', () => {
  const phone = mediaBodiesAt(CSS, 390).join('\n')
  const tablet = mediaBodiesAt(CSS, 820).join('\n')

  it('⛔ NON-VACUITY -- a phone block was found and it names the folder panel', () => {
    expect(phone).toMatch(/sidebarSlot/)
  })

  it('at 390 px a note-open Notebook hides the folder panel', () => {
    expect(declaresProp(phone, HIDE, 'display', /^none$/)).toBe(true)
  })

  it('at 390 px the back control shows, at a finger-sized height', () => {
    expect(declaresProp(phone, '.phoneBack', 'display', /^inline-flex$/)).toBe(true)
    // the finger floor is declared for every width (tapFloor.test.js), so the phone gets it too
    expect(declaresProp(baseRules(CSS), '.phoneBack', 'min-height', /tap-min/)).toBe(true)
  })

  it('⛔ above a phone the back control is hidden and the panel is NOT', () => {
    expect(declaresProp(baseRules(CSS), '.phoneBack', 'display', /^none$/)).toBe(true)
    expect(declaresProp(tablet, HIDE, 'display', /^none$/)).toBe(false)
    expect(declaresProp(tablet, '.phoneBack', 'display', /^inline-flex$/)).toBe(false)
    expect(declaresProp(baseRules(CSS), HIDE, 'display', /^none$/)).toBe(false)
  })

  it('⭐ CONTROL -- the parser sees an absent rule as absent', () => {
    const without = '@media (max-width: 640px) { .sidebarSlot { width: 100% !important; } }'
    expect(declaresProp(mediaBodiesAt(without, 390).join('\n'), HIDE, 'display', /^none$/)).toBe(false)
  })
})

// ── D-7 -- the phone rule (structural; the D-7 before/after walk is the verdict) ──
// Before this fix, `.wrap.collapsed .sidebarSlot` was forced back to `width: 100%
// !important` INSIDE the phone query -- collapsing did nothing at 390px, and the
// floating toggle that would have reopened it was `display: none` there too, so
// there was no way to hide the tree at phone width at all. Both are gone now: the
// base (non-media) rule's `width: 0` (already true at every OTHER width) is left
// to apply at phone as well, and the toggle is a real 44px control there.
describe('D-7 -- the phone rule (structural)', () => {
  const phone = mediaBodiesAt(CSS, 390).join('\n')
  const base = baseRules(CSS)

  it('⛔ NON-VACUITY -- a phone block was found and it still names the sidebar slot', () => {
    expect(phone).toMatch(/sidebarSlot/)
  })

  it('at 390px, collapsed genuinely hides the panel: the BASE width:0 rule is not fought back open', () => {
    expect(declaresProp(base, '.wrap.collapsed .sidebarSlot', 'width', /^0/)).toBe(true)
    expect(declaresProp(phone, '.wrap.collapsed .sidebarSlot', 'width', /^100%/)).toBe(false)
  })

  it('at 390px, collapsed ALSO zeroes height -- measured live (drf-d7-board-390.png): width:0 alone left a ~450px gap, because `.wrap` is a COLUMN here and a 0-width box still reports the height its now one-character-per-line content wraps to', () => {
    expect(declaresProp(phone, '.wrap.collapsed .sidebarSlot', 'height', /^0/)).toBe(true)
  })

  it('the floating toggle is no longer forced off at phone width -- it is the D-7 reveal control', () => {
    expect(declaresProp(phone, '.sidebarToggle', 'display', /^none$/)).toBe(false)
  })

  it('the toggle is a real 44px finger target at every width (base rule, never phone-only)', () => {
    expect(declaresProp(base, '.sidebarToggle', 'width', /tap-min/)).toBe(true)
    expect(declaresProp(base, '.sidebarToggle', 'height', /tap-min/)).toBe(true)
  })

  it('the collapsed main column keeps clear of the FLOATING toggle on desktop', () => {
    expect(declaresProp(base, '.wrap.collapsed .main', 'padding-left', /^62px$/)).toBe(true)
  })

  // Phone pass 2026-10-10: on a phone the toggle is a labelled button IN THE PAGE FLOW (static),
  // so the 62px clearance only wasted a sixth of the width (content started at x=86 of 390).
  // The two declarations travel together: a static toggle with no pad, never a floating one with none.
  it('on a phone the toggle is in the flow and the main column drops the clearance -- together', () => {
    expect(declaresProp(phone, '.sidebarToggle', 'position', /^static$/)).toBe(true)
    expect(declaresProp(phone, '.wrap.collapsed .main', 'padding-left', /^0$/)).toBe(true)
  })

  it('⭐ CONTROL -- the parser sees the OLD forced-open declaration when it is there', () => {
    const old = mediaBodiesAt('@media (max-width: 640px) { .wrap.collapsed .sidebarSlot { width: 100% !important; } }', 390).join('\n')
    expect(declaresProp(old, '.wrap.collapsed .sidebarSlot', 'width', /^100%/)).toBe(true)
    expect(declaresProp(old, '.wrap.collapsed .sidebarSlot', 'width', /^0/)).toBe(false)
  })
})
