import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import NoteCard from './NoteCard'
import { BLOCKED_BADGE } from '../../lib/offline/unsyncedCopy'

// No test file existed for this component before this pass (its DOM-identity
// contract is covered separately, from the hub's own side, by
// app/src/hub/noteCardIdentity.test.jsx). Scoped to what this pass touches:
// the blocked-note badge now routes through the shared BlockedBadge.jsx
// (UX #15, 2026-09-22) rather than a copy local to this file.

const note = (over = {}) => ({
  id: 'n1', title: 'NVDA thesis', updatedAt: new Date().toISOString(), ...over,
})

describe('NoteCard — blocked-note badge', () => {
  it('shows the shared BlockedBadge when blocked=true', () => {
    render(<NoteCard note={note()} onOpen={vi.fn()} blocked />)
    expect(screen.getByText(BLOCKED_BADGE)).toBeInTheDocument()
  })

  it('shows nothing when blocked=false (the default)', () => {
    render(<NoteCard note={note()} onOpen={vi.fn()} />)
    expect(screen.queryByText(BLOCKED_BADGE)).toBeNull()
  })

  it('never shows it on a trashed card, even if blocked -- a trashed note cannot be edited to un-block', () => {
    render(<NoteCard note={note()} onOpen={vi.fn()} onRestore={vi.fn()} blocked />)
    expect(screen.queryByText(BLOCKED_BADGE)).toBeNull()
  })
})

describe('NoteCard — wave 5 selection', () => {
  it('without `selectable` there is no checkbox (every other surface is unchanged)', () => {
    render(<NoteCard note={note()} onOpen={vi.fn()} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('the checkbox sits BESIDE the card button, never inside it', () => {
    render(<NoteCard note={note()} onOpen={vi.fn()} selectable onToggleSelect={vi.fn()} />)
    const box = screen.getByRole('checkbox', { name: 'Select NVDA thesis' })
    const card = screen.getByRole('button', { name: /NVDA thesis/ })
    expect(card.contains(box)).toBe(false)
  })

  it('⛔ the hub identity stays on ONE element per note', () => {
    const { container } = render(<NoteCard note={note()} onOpen={vi.fn()} selectable onToggleSelect={vi.fn()} />)
    const tagged = container.querySelectorAll('[data-note-card-id]')
    expect(tagged).toHaveLength(1)
    expect(tagged[0].tagName).toBe('BUTTON')
  })

  it('checking it toggles selection and does NOT open the note', () => {
    const onOpen = vi.fn()
    const onToggleSelect = vi.fn()
    render(<NoteCard note={note()} onOpen={onOpen} selectable onToggleSelect={onToggleSelect} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggleSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }), { shift: false })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('Shift is carried through, so Shift+click can select a range', () => {
    const onToggleSelect = vi.fn()
    render(<NoteCard note={note()} onOpen={vi.fn()} selectable onToggleSelect={onToggleSelect} />)
    fireEvent.click(screen.getByRole('checkbox'), { shiftKey: true })
    expect(onToggleSelect).toHaveBeenCalledWith(expect.anything(), { shift: true })
  })

  it('reflects `selected`', () => {
    render(<NoteCard note={note()} onOpen={vi.fn()} selectable selected onToggleSelect={vi.fn()} />)
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('a trashed card is selectable too (bulk restore)', () => {
    const onToggleSelect = vi.fn()
    render(<NoteCard note={note()} onOpen={vi.fn()} onRestore={vi.fn()} selectable onToggleSelect={onToggleSelect} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select NVDA thesis' }))
    expect(onToggleSelect).toHaveBeenCalled()
  })

  it('the checkbox is a finger target at the touch tier (<=1024px), not only on a phone', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/NoteCard.module.css'), 'utf8')
      .replace(/\r\n/g, '\n')
    const touch = /@media\s*\(max-width:\s*1024px\)\s*\{([\s\S]*?)\n\}/.exec(css)
    expect(touch, 'a max-width:1024px block must exist').not.toBeNull()
    expect(touch[1]).toMatch(/\.selectBox\s*\{[^}]*min-width:\s*var\(--tap-min\)[^}]*min-height:\s*var\(--tap-min\)/)
  })
})

// Notebook simplify, Task 3: `layout="row"`, the notes list's default. Line one the title, line two the meta line in
// this order: relative date, $TICKER, up to three tags (muted text), the subtitle; then the lock and "Not synced" marks.
describe('NoteCard — the row layout', () => {
  const full = note({
    ticker: 'NVDA', tags: ['semis', 'thesis', 'ai', 'extra'], subtitle: 'Data centre cycle', locked: true,
  })
  const metaWords = (container) => [...container.querySelector('[data-note-meta]').children]
    .map((el) => el.getAttribute('aria-label') || el.textContent.trim())

  it('the title, then the meta line: date, ticker, three tags at most, subtitle, then the marks', () => {
    const { container } = render(<NoteCard note={full} onOpen={vi.fn()} layout="row" blocked />)
    expect(container.querySelector('[data-note-title]')).toHaveTextContent('NVDA thesis')
    const words = metaWords(container)
    expect(words[0]).toBe('now')
    expect(words.slice(1)).toEqual(['$NVDA', '#semis', '#thesis', '#ai', 'Data centre cycle', 'Locked', BLOCKED_BADGE])
  })

  it('opens the note on click; the hub identity stays on ONE element, the button', () => {
    const onOpen = vi.fn()
    const { container } = render(<NoteCard note={full} onOpen={onOpen} layout="row" selectable onToggleSelect={vi.fn()} />)
    const tagged = container.querySelectorAll('[data-note-card-id]')
    expect(tagged).toHaveLength(1)
    expect(tagged[0].tagName).toBe('BUTTON')
    fireEvent.click(tagged[0])
    expect(onOpen).toHaveBeenCalledWith(full)
    // the checkbox still sits BESIDE the row button
    expect(tagged[0].contains(screen.getByRole('checkbox', { name: 'Select NVDA thesis' }))).toBe(false)
  })

  it('draws no thumbnail and no card chrome (the card layout keeps both)', () => {
    const withImg = note({ firstImageUrl: '/ok.png' })
    const row = render(<NoteCard note={withImg} onOpen={vi.fn()} layout="row" />)
    expect(row.container.querySelector('[data-card-thumb]')).toBeNull()
    expect(row.container.querySelector('[data-note-card-id]').className).not.toMatch(/_card_/)
    row.unmount()
    const card = render(<NoteCard note={withImg} onOpen={vi.fn()} />)   // CONTROL: the card still has it
    expect(card.container.querySelector('[data-card-thumb]')).not.toBeNull()
    expect(card.container.querySelector('[data-note-meta]')).toBeNull()
  })

  it('a trashed row is inert with its own Restore, and carries no blocked badge', () => {
    const onRestore = vi.fn()
    render(<NoteCard note={full} onOpen={vi.fn()} onRestore={onRestore} layout="row" blocked />)
    expect(screen.queryByText(BLOCKED_BADGE)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(onRestore).toHaveBeenCalledWith(full)
  })

  it('an archived row keeps its Unarchive beside the row button', () => {
    const onUnarchive = vi.fn()
    render(<NoteCard note={full} onOpen={vi.fn()} onUnarchive={onUnarchive} layout="row" />)
    const un = screen.getByRole('button', { name: 'Unarchive NVDA thesis' })
    expect(document.querySelector('[data-note-card-id]').contains(un)).toBe(false)
    fireEvent.click(un)
    expect(onUnarchive).toHaveBeenCalledWith(full)
  })

  it('`selecting` marks a row so its tick box shows with nothing hovered; a card ignores it', () => {
    const { container, rerender } = render(
      <NoteCard note={full} onOpen={vi.fn()} layout="row" selectable onToggleSelect={vi.fn()} />,
    )
    const wrap = () => container.querySelector('[data-note-row]')
    expect(wrap().className).not.toMatch(/_selectingAny_/)                 // CONTROL
    rerender(<NoteCard note={full} onOpen={vi.fn()} layout="row" selectable selecting onToggleSelect={vi.fn()} />)
    expect(wrap().className).toMatch(/_selectingAny_/)
    rerender(<NoteCard note={full} onOpen={vi.fn()} selectable selecting onToggleSelect={vi.fn()} />)
    expect(wrap().className).not.toMatch(/_selectingAny_|_selectRow_/)    // Cards are unchanged
  })
})

// Visual audit issue 6: a thumbnail that fails to load used to paint the
// browser's broken-image glyph. On error the thumb box goes and the card keeps
// its no-image layout. CONTROL: before the error the thumb IS there, so the
// assertion after it cannot pass vacuously.
describe('NoteCard — broken thumbnail', () => {
  it.each([
    ['a live card', {}],
    ['a trashed card', { onRestore: vi.fn() }],
  ])('%s: hides the thumb when its image fails to load', (_name, extra) => {
    const { container } = render(
      <NoteCard note={note({ firstImageUrl: '/gone.png' })} onOpen={vi.fn()} {...extra} />,
    )
    const img = container.querySelector('[data-card-thumb] img')
    expect(img).not.toBeNull()
    fireEvent.error(img)
    expect(container.querySelector('[data-card-thumb]')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('keeps a thumb that loads', () => {
    const { container } = render(<NoteCard note={note({ firstImageUrl: '/ok.png' })} onOpen={vi.fn()} />)
    fireEvent.load(container.querySelector('[data-card-thumb] img'))
    expect(container.querySelector('[data-card-thumb] img')).not.toBeNull()
  })
})
