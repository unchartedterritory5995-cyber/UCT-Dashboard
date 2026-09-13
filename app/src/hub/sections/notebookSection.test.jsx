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
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen, renderHook, act, cleanup } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

import {
  PARAM_NOTE, PARAM_DOC, PARAM_PAGE, PARAM_EXCERPT, PARAM_REVIEW, applyTargetToParams,
} from '../../pages/journal-2-0/lib/searchNavigation'
import useNotebookSection, {
  NOTE_CARD_SELECTOR, NOTEBOOK_ROUTE, noteIdsInDocument, noteCardNodes,
} from './notebookSection'
import { HubProvider, useHub } from '../HubContext'

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

/**
 * Renders the hook plus a live readout of the URL, at a chosen route.
 *
 * ⭐ `seen.config` IS THE REGISTERED CONFIG, NOT A RECONSTRUCTION. A `HubProvider` is mounted so
 * `useHubMode` actually registers, and `ConfigProbe` reads back what `HubRoot` would receive. A
 * case that performs a gesture's steps itself — `next(); openNote(ids[i + 1])` — proves only that
 * the test author knows what tap should do; the tap the product ships opened note ONE for weeks
 * behind exactly that shape (R-05's lesson, in this file).
 */

/**
 * The spec of record, DERIVED — the highest-numbered `00-master-spec-v*.md` on disk.
 *
 * ⛔ Not a typed filename. This repo has shipped a plan citing a document that did not say the
 * thing, and a rail pinned to `v1.6` would quietly stop reading the spec the day `v1.7` lands —
 * passing for ever against a file nobody edits any more.
 */
function specOfRecord() {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..',
    'docs', 'plans', 'joystick')
  const versioned = readdirSync(dir)
    .filter((f) => /^00-master-spec-v[\d.]+\.md$/.test(f))
    .sort((a, b) => {
      const n = (s) => s.match(/v([\d.]+)\./)[1].split('.').map(Number)
      const [x, y] = [n(a), n(b)]
      for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
        if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
      }
      return 0
    })
  if (!versioned.length) throw new Error(`no 00-master-spec-v*.md under ${dir} — a missing spec is a failed lookup, not a passed rail`)
  return path.join(dir, versioned[versioned.length - 1])
}
function harness(initial) {
  const seen = { search: null, pathname: null, config: null }
  function Probe() {
    const api = useNotebookSection()
    const loc = useLocation()
    seen.search = loc.search
    seen.pathname = loc.pathname
    seen.api = api
    return null
  }
  function ConfigProbe() {
    seen.config = useHub().activeModeConfig
    return null
  }
  render(
    <MemoryRouter initialEntries={[initial]}>
      <HubProvider>
        <Probe />
        <ConfigProbe />
      </HubProvider>
    </MemoryRouter>,
  )
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

describe('B11 — the cursor is painted, and tap advances it', () => {
  const grid = (ids) => {
    document.body.innerHTML = `<div>${ids.map((id) => `<div data-note-card-id="${id}"></div>`).join('')}</div>`
  }
  const painted = () => [...document.querySelectorAll('[data-hub-cursor="active"]')]
    .map((el) => el.getAttribute('data-note-card-id'))

  it('⛔ exactly ONE card carries data-hub-cursor, and it is the one the index names', () => {
    grid(['a', 'b', 'c'])
    const seen = harness(NOTEBOOK_ROUTE)
    expect(painted(), 'the cursor is not painted on any card — it is invisible to the member')
      .toHaveLength(1)
    expect(painted()[0]).toBe(seen.api.ids[seen.api.index])
  })

  it('advancing moves the paint, and never paints two at once', () => {
    grid(['a', 'b', 'c'])
    const seen = harness(NOTEBOOK_ROUTE)
    const first = painted()[0]
    act(() => { seen.api.next() })
    expect(painted()).toHaveLength(1)
    expect(painted()[0], 'the paint did not move with the index').not.toBe(first)
  })

  it('⛔ tap ADVANCES and OPENS THE NOTE IT LANDS ON — the registry promises "tap: next note"', async () => {
    // The mode declares `tapHint: 'tap: next note'`. A tap that advanced without opening, or
    // opened without advancing, or opened a DIFFERENT note than the one it advanced to, makes
    // that chip a lie the member reads every time.
    //
    // ⚰️ THIS CASE USED TO RUN `seen.api.next(); seen.api.openNote(seen.api.ids[before + 1])` —
    // the two steps a tap is MADE OF, performed by the test. It passed for weeks while the
    // shipped `onTap` read `const at = next()` from a function that returns nothing and opened
    // `ids[at ?? 0]`: every tap re-opened note ONE. The fix is to invoke the registered config,
    // which is why `harness` mounts a HubProvider.
    const { modesById } = await import('../registry')
    expect(modesById.notebook.tapHint, 'the hint changed — this rail pins the promise it makes')
      .toBe('tap: next note')

    grid(['a', 'b', 'c'])
    const seen = harness(`${NOTEBOOK_ROUTE}?note=a`)
    expect(typeof seen.config?.onTap, 'the controller registered no config — nothing below is the '
      + 'product\'s tap').toBe('function')
    const before = seen.api.index
    act(() => { seen.config.onTap() })
    expect(seen.api.index, 'tap did not advance the cursor').toBe(before + 1)
    expect(new URLSearchParams(seen.search).get('note'), 'tap opened the wrong note — it must open '
      + 'the one the cursor LANDED on, not the one it left').toBe('b')

    // And again, because the defect this replaced was invisible on a single tap from index 0.
    act(() => { seen.config.onTap() })
    expect(seen.api.index).toBe(before + 2)
    expect(new URLSearchParams(seen.search).get('note'), 'the second tap did not reach note three')
      .toBe('c')

    // Clamped, never wrapped: a third tap stays on the last note.
    act(() => { seen.config.onTap() })
    expect(seen.api.index).toBe(2)
    expect(new URLSearchParams(seen.search).get('note')).toBe('c')
  })

  it('⛔ D-43 — double-tap REVERSES and opens the PREVIOUS note, which spec §C3 has always promised', () => {
    // ⚰️ THIS ROW DID NOT SHIP. `notebookSection.js` declared `onTap`, `onScrub` and `readout` and
    // no `onDoubleTap` at all, so Reverse did nothing on the note grid — while every other
    // cursor-bearing mode had it. No D-number tracked it for months, and the reason is worth
    // keeping: the instrument that lists bindings (`tools/hub_surface_matrix.mjs`) matched the
    // COLON form only, so it reported `wire` and `home` as declaring NOTHING (D-42). "Notebook is
    // missing one of four" cannot stand out from nine modes reported as missing everything.
    //
    // ⛔ THE PROMISE IS READ FROM THE SPEC, never restated here. A citation that cannot be quoted
    // is struck; this one quotes itself on every run and goes red the day the spec drops the
    // promise — which forces a decision instead of letting the gap reopen in silence.
    const spec = readFileSync(specOfRecord(), 'utf8')
    expect(spec.length, 'the spec of record read empty — an empty string satisfies almost any '
      + 'assertion placed after it (rule 14)').toBeGreaterThan(10000)
    expect(spec, 'spec §C3 no longer promises Reverse for the notebook. If that is deliberate, '
      + 'delete this rail AND the binding in the same commit — do not soften one of them.')
      .toContain('Primary: next note. Reverse: previous note.')

    grid(['a', 'b', 'c'])
    const seen = harness(`${NOTEBOOK_ROUTE}?note=a`)
    expect(typeof seen.config?.onDoubleTap, 'the controller registers no onDoubleTap — this is '
      + 'D-43 exactly').toBe('function')

    // ⛔ WALK FORWARD FIRST. Reverse from the first note has nowhere to go, so a rail that opened
    // at index 0 and only checked the clamp would pass against a binding that does nothing at all.
    act(() => { seen.config.onTap() })
    act(() => { seen.config.onTap() })
    expect(seen.api.index).toBe(2)
    expect(new URLSearchParams(seen.search).get('note')).toBe('c')

    act(() => { seen.config.onDoubleTap() })
    expect(seen.api.index, 'double-tap did not step the cursor back').toBe(1)
    expect(new URLSearchParams(seen.search).get('note'), 'Reverse opened the wrong note — it must '
      + 'open the one the cursor LANDED on, exactly as tap does').toBe('b')

    act(() => { seen.config.onDoubleTap() })
    expect(seen.api.index).toBe(0)
    expect(new URLSearchParams(seen.search).get('note')).toBe('a')

    // Clamped, never wrapped — the mirror of tap's third press holding on the last note.
    act(() => { seen.config.onDoubleTap() })
    expect(seen.api.index, 'Reverse wrapped onto the last note instead of holding at the first').toBe(0)
    expect(new URLSearchParams(seen.search).get('note')).toBe('a')
  })

  it('⛔ the REGISTERED config satisfies `contracts.js`, Reverse included', async () => {
    const { validateSectionConfig } = await import('../contracts')
    // ⛔ NON-VACUITY FIRST. `validateSectionConfig` reports through `report()`, which only THROWS
    // in dev — so `.not.toThrow()` on the real config proves nothing until this environment is
    // shown to be one where it CAN throw. This is the contract's own named violation.
    expect(() => validateSectionConfig({ id: 'notebook', onScrub: () => {} }, 'control'),
      'the contract cannot fail here, so the assertion below measures nothing').toThrow(/readout/)

    grid(['a', 'b'])
    const seen = harness(NOTEBOOK_ROUTE)
    expect(() => validateSectionConfig(seen.config, 'notebook registered config')).not.toThrow()
    // Asserted against the contract's OWN key list, never a copy of it here: R-05 is the case
    // where a test restated a contract, agreed with itself, and disagreed with the product.
    for (const k of ['onTap', 'onDoubleTap', 'onScrub', 'readout']) {
      expect(typeof seen.config[k], `the notebook config lost ${k}`).toBe('function')
    }
  })

  it('an empty grid paints nothing and does not throw', () => {
    document.body.innerHTML = '<div></div>'
    const seen = harness(NOTEBOOK_ROUTE)
    expect(painted()).toEqual([])
    expect(seen.api.count).toBe(0)
  })
})

describe('⛔ the list identity is the FILTER, not the selection', () => {
  const grid = (ids) => {
    document.body.innerHTML = `<div>${ids.map((id) => `<div data-note-card-id="${id}"></div>`).join('')}</div>`
  }

  it('opening a note does NOT reset the cursor — the bug that made tap useless', () => {
    // The first version folded the whole query string into the cursor's identity, so writing
    // `?note=` changed the identity and reset the index to 0. Tap-to-advance bounced back to the
    // first card on every tap and the member could never reach note two.
    grid(['a', 'b', 'c'])
    const seen = harness(NOTEBOOK_ROUTE)
    act(() => { seen.api.next() })
    const advanced = seen.api.index
    expect(advanced).toBe(1)
    act(() => { seen.api.openNote('b') })
    expect(seen.api.index, 'opening a note reset the cursor — tap can never get past the first note')
      .toBe(advanced)
  })

  it('changing the FILTER does reset it — a different folder is a different list', () => {
    grid(['a', 'b', 'c'])
    const seen = harness(`${NOTEBOOK_ROUTE}?folder=f-1`)
    act(() => { seen.api.next() })
    expect(seen.api.index).toBe(1)
    // A different folder is genuinely a different list; holding the old index would point at a
    // note the member never selected.
    const other = harness(`${NOTEBOOK_ROUTE}?folder=f-2`)
    expect(other.api.index).toBe(0)
  })
})

// ── MUTATION PROOF FOR D-43, PERFORMED 2026-09-13 ──────────────────────────────────────────────
// ⛔ Not a claim — a run, and these are the numbers it printed. The `onDoubleTap` arm was deleted
// from `notebookSection.js` IN PLACE and this file re-run:
//
//     Tests  2 failed | 17 passed (19)
//     × ⛔ D-43 — double-tap REVERSES and opens the PREVIOUS note …
//     × ⛔ the REGISTERED config satisfies `contracts.js`, Reverse included
//     AssertionError: the controller registers no onDoubleTap — this is D-43 exactly:
//                     expected 'undefined' to be 'function'
//
// ⭐ SEVENTEEN STAYED GREEN, and that is the half that matters: the tap rail, the cursor paint,
// the identity cases and the searchNavigation contract all still passed, so the red came from the
// DELETED BINDING and not from the harness falling over. A mutation run where everything goes red
// proves only that something broke.
//
// The mutation was reverted by writing the original bytes back, never `git checkout`
// (`feedback_mutation_check_never_git_checkout`), and the restored file was byte-compared.
//
// ⚠️ AND THE FIRST ATTEMPT LEFT THE MUTATION ON DISK. The harness printed its captured output to a
// cp1252 console, died on a ⛔ in the test name, and never reached the restore — the tree was left
// with the binding removed and only a `git diff` line-count to notice it by. Capture to a FILE and
// restore in a `finally`, or a mutation check becomes an unreviewed deletion.
