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
import { describe, it, expect, vi, beforeEach } from 'vitest'
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
  default: () => <div data-testid="folder-sidebar" />,
}))
// A card is a button that opens its note through the tab's own `onOpen` (openNote) --
// the same door the real NoteCard uses.
vi.mock('../components/notebook/NoteCard', () => ({
  default: ({ note, onOpen }) => (
    <button type="button" data-note-card-id={note.id} onClick={() => onOpen(note)}>{note.title}</button>
  ),
}))
vi.mock('../components/notebook/NoteEditorPage', () => ({
  default: ({ noteId }) => <div data-testid="note-editor" data-note-id={noteId} />,
}))
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../components/notebook/ResearchHome', () => ({
  default: () => <div data-testid="research-home">Research Home</div>,
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

  it('keyboard: the back control takes focus and Enter/click activates it', async () => {
    renderAt('/journal/notebook?view=all&note=n1')
    const back = backButton()
    back.focus()
    expect(document.activeElement).toBe(back)
    fireEvent.click(back) // a <button> turns Enter/Space into click natively
    await waitFor(() => expect(search()).toBe('?view=all'))
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
    expect(declaresProp(phone, '.phoneBack', 'min-height', /tap-min/)).toBe(true)
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
