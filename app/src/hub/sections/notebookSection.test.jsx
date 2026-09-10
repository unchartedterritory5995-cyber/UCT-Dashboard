/**
 * §3.7 — the Notebook controller, and the two contracts it leans on that live in another
 * workstream's files.
 *
 * ⛔ Q2 — `applyTargetToParams` IS AN IMPORT, SO IT IS A CONTRACT. The hub depends on a helper the
 * Notebook workstream can rename or reshape without knowing we consume it. These cases import the
 * REAL module and assert the behaviour we rely on, using its own exported constants rather than
 * string literals — so a rename fails HERE, loudly, by name, instead of silently changing what a
 * hub gesture does to the URL.
 *
 * ⛔ Q4 — the selector is the other one. `[data-note-card-id]` is R-18's attribute; its rail is
 * `hub/noteCardIdentity.test.jsx`, which renders the real card.
 *
 * ⛔ Q5 — off-route, the mode registers nothing. No guard in the product; a rail instead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, renderHook, act, cleanup } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

import {
  PARAM_NOTE, PARAM_DOC, PARAM_PAGE, PARAM_EXCERPT, PARAM_REVIEW, applyTargetToParams,
} from '../../pages/journal-2-0/lib/searchNavigation'
import useNotebookSection, {
  NOTE_CARD_SELECTOR, NOTEBOOK_ROUTE, noteIdsInDocument, noteCardNodes,
} from './notebookSection'

afterEach(() => { cleanup(); document.body.innerHTML = '' })

describe('Q2 — the searchNavigation contract the hub imports', () => {
  it('⛔ the export exists and is a function', () => {
    expect(typeof applyTargetToParams, 'applyTargetToParams is gone or renamed — §3.7 depends on it')
      .toBe('function')
  })

  it('⛔ it SETS the note param, by the module\'s own constant', () => {
    const out = applyTargetToParams(new URLSearchParams(''), { noteId: 'n-1', depth: 'note' })
    expect(out.get(PARAM_NOTE)).toBe('n-1')
    // The constant must still BE 'note' — the hub's whole seam is that one query key.
    expect(PARAM_NOTE).toBe('note')
  })

  it('⛔ it CLEARS the four deeper params — the reason the hub does not hand-roll set()', () => {
    // A stale `?doc=&page=47` left over from the previous note points the reader into a DIFFERENT
    // note's document. This is the half-retrieval that module's own header says it exists to close.
    const prev = new URLSearchParams()
    prev.set(PARAM_NOTE, 'old')
    prev.set(PARAM_DOC, 'doc-9')
    prev.set(PARAM_PAGE, '47')
    prev.set(PARAM_EXCERPT, 'ex-3')
    prev.set(PARAM_REVIEW, 'rev-2')

    const out = applyTargetToParams(prev, { noteId: 'new', depth: 'note' })
    expect(out.get(PARAM_NOTE)).toBe('new')
    for (const [name, p] of [['doc', PARAM_DOC], ['page', PARAM_PAGE], ['excerpt', PARAM_EXCERPT], ['review', PARAM_REVIEW]]) {
      expect(out.get(p), `${name} survived the note change — the reader lands in the wrong note`).toBeNull()
    }
  })

  it('unrelated params are preserved — it is a patch, not a replacement', () => {
    const prev = new URLSearchParams('folder=f-1&view=all')
    const out = applyTargetToParams(prev, { noteId: 'n-2', depth: 'note' })
    expect(out.get('folder')).toBe('f-1')
    expect(out.get('view')).toBe('all')
  })
})

describe('the DOM reading — cards in render order', () => {
  const grid = (ids) => {
    document.body.innerHTML = `<div>${ids.map((id) => `<div data-note-card-id="${id}"></div>`).join('')}</div>`
  }

  it('reads ids in document order', () => {
    grid(['a', 'b', 'c'])
    expect(noteIdsInDocument()).toEqual(['a', 'b', 'c'])
    expect(noteCardNodes()).toHaveLength(3)
  })

  it('⛔ an empty grid reads as empty, not as an error — and the selector is the R-18 name', () => {
    document.body.innerHTML = '<div></div>'
    expect(noteIdsInDocument()).toEqual([])
    expect(NOTE_CARD_SELECTOR).toBe('[data-note-card-id]')
    // ⛔ NOT `[data-note-id]`, which is TipTap's inline note LINK inside a note body.
    expect(NOTE_CARD_SELECTOR).not.toBe('[data-note-id]')
  })

  it('ignores a card with an empty id rather than counting a blank', () => {
    document.body.innerHTML = '<div data-note-card-id="a"></div><div data-note-card-id=""></div>'
    expect(noteIdsInDocument()).toEqual(['a'])
  })
})

/** Renders the hook plus a live readout of the URL, at a chosen route. */
function harness(initial) {
  const seen = { search: null, pathname: null }
  function Probe() {
    const api = useNotebookSection()
    const loc = useLocation()
    seen.search = loc.search
    seen.pathname = loc.pathname
    seen.api = api
    return null
  }
  render(<MemoryRouter initialEntries={[initial]}><Probe /></MemoryRouter>)
  return seen
}

describe('Q5 — off the Notebook route, the controller does nothing', () => {
  it('⛔ off-route it registers no mode and reads no cards', () => {
    document.body.innerHTML = '<div data-note-card-id="a"></div>'
    const seen = harness('/dashboard')
    expect(seen.api.onRoute, 'the controller thinks /dashboard is the Notebook').toBe(false)
    expect(seen.api.ids, 'it read cards on a route it does not own').toEqual([])
  })

  it('on-route it reads the cards that are there', () => {
    document.body.innerHTML = '<div data-note-card-id="a"></div><div data-note-card-id="b"></div>'
    const seen = harness(NOTEBOOK_ROUTE)
    expect(seen.api.onRoute).toBe(true)
    expect(seen.api.ids).toEqual(['a', 'b'])
    expect(seen.api.count).toBe(2)
  })
})

describe('opening a note writes the URL', () => {
  it('⛔ through applyTargetToParams, so a stale doc/page cannot survive', () => {
    document.body.innerHTML = '<div data-note-card-id="n-1"></div>'
    const seen = harness(`${NOTEBOOK_ROUTE}?note=old&doc=doc-9&page=47`)
    act(() => { seen.api.openNote('n-1') })
    const out = new URLSearchParams(seen.search)
    expect(out.get('note')).toBe('n-1')
    expect(out.get('doc'), 'a stale doc survived — the reader lands in the wrong note').toBeNull()
    expect(out.get('page')).toBeNull()
  })

  it('opening nothing writes nothing', () => {
    document.body.innerHTML = '<div data-note-card-id="n-1"></div>'
    const seen = harness(`${NOTEBOOK_ROUTE}?note=old`)
    act(() => { seen.api.openNote(undefined) })
    expect(new URLSearchParams(seen.search).get('note')).toBe('old')
  })
})
