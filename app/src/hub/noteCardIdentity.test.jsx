/**
 * R-18 — the grid note card carries its note id in the DOM.
 *
 * ⛔ WHY THE HUB OWNS THIS RAIL. The attribute lives in the Notebook workstream's file, but the hub
 * is the only consumer and the only party that breaks when it disappears. A rail there would be
 * theirs to delete along with the attribute; here, a notebook-side removal fails in OUR suite, by
 * name, which is the whole point of asking for it.
 *
 * ⚠️ THE RAIL FILE IS IN app/src/hub BECAUSE RULE 12 FORBIDS ADDING FILES UNDER journal-2-0/**.
 * Importing that component is a read, not an edit.
 *
 * ⛔ THE NAME IS `data-note-card-id`, NOT `data-note-id`. The latter already belongs to TipTap's
 * inline note-LINK node inside note bodies (`journal-2-0/lib/noteLinkNode.jsx` renders
 * `{ 'data-note-id': attrs.noteId }` and parses `span[data-note-id]`). A hub selector on that name
 * would match every inline link in an open note as well as every grid card — ambiguous the day it
 * was written, and over-counting on exactly the screen where the cursor matters. A case below pins
 * that the two names stay distinct.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import NoteCard from '../pages/journal-2-0/components/notebook/NoteCard'

const note = (over = {}) => ({
  id: 'note-abc-123', title: 'Thesis: NVDA', updatedAt: new Date().toISOString(), ...over,
})

afterEach(cleanup)

describe('R-18 — the note card carries its identity in the DOM', () => {
  it('⛔ the OPEN card root carries data-note-card-id with the note id', () => {
    const { container } = render(<NoteCard note={note()} onOpen={vi.fn()} />)
    const card = container.querySelector('[data-note-card-id]')
    expect(card, 'no element carries data-note-card-id — the hub cannot say which note this is')
      .not.toBeNull()
    expect(card.getAttribute('data-note-card-id')).toBe('note-abc-123')
  })

  it('the attribute is on the card ROOT, not on a descendant', () => {
    // The hub paints `data-hub-cursor` on the node it finds. If the id sat on an inner element the
    // cursor outline would land inside the card instead of around it.
    const { container } = render(<NoteCard note={note()} onOpen={vi.fn()} />)
    const card = container.querySelector('[data-note-card-id]')
    expect(card.parentElement, 'the card should be a direct child of the render container')
      .toBe(container)
  })

  it('⛔ the TRASHED card carries it too — or the cursor count disagrees with the screen', () => {
    // Trash view renders the other branch of NoteCard. A card without the attribute is invisible to
    // the hub's selector, so the cursor would silently skip it and count fewer cards than are
    // rendered — the count-vs-rendered defect this repo keeps re-finding.
    const { container } = render(
      <NoteCard note={note({ id: 'note-trashed-9' })} onOpen={vi.fn()} onRestore={vi.fn()} />,
    )
    const card = container.querySelector('[data-note-card-id]')
    expect(card, 'the trashed card root carries no identity').not.toBeNull()
    expect(card.getAttribute('data-note-card-id')).toBe('note-trashed-9')
    expect(card.getAttribute('data-trashed')).toBe('true')
  })

  it('two cards produce two distinct ids, in render order', () => {
    const { container } = render(
      <div>
        <NoteCard note={note({ id: 'a' })} onOpen={vi.fn()} />
        <NoteCard note={note({ id: 'b' })} onOpen={vi.fn()} />
      </div>,
    )
    const ids = [...container.querySelectorAll('[data-note-card-id]')]
      .map((el) => el.getAttribute('data-note-card-id'))
    expect(ids).toEqual(['a', 'b'])
  })

  it('⛔ the selector does NOT collide with the inline note-link attribute', () => {
    // `data-note-id` is TipTap's inline link inside a note body. If the hub ever selected on that
    // name it would match links as well as cards. These two names must stay distinct.
    const { container } = render(<NoteCard note={note()} onOpen={vi.fn()} />)
    expect(
      container.querySelector('[data-note-id]'),
      'the card matched [data-note-id] — that name belongs to inline note links, not grid cards',
    ).toBeNull()
  })
})
