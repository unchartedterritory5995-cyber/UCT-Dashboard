// Morning Wire's hub section (Phase 3 §3.1) — driven through REAL segment DOM.
//
// ⛔ EVERY ASSERTION THAT MATTERS IS ON RENDERED DOM, NOT ON STATE.
// The standing rule in this repo (CLAUDE.md, owner ruling 2026-09-09): user-facing effects are
// asserted by what the member can see. "the cursor index is 1" proves nothing about whether the
// outline moved — `useHubCursor` writes `data-hub-cursor="active"` imperatively onto a node that
// React never reconciles, so state and DOM here are genuinely two different claims. The segment
// DOM below is built with real elements so `querySelectorAll` and `paintCursor` are exercised
// rather than mocked around.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { useEffect, useMemo, useRef } from 'react'
import { validateSectionConfig, validateListAdapter, validateChipReadout } from '../contracts'
import { modesById, fanFor } from '../registry'
import { _reset as resetCursors } from '../useHubCursor'
import useWireSection, { segmentLabelText, readScrubPayload, segmentKeys } from './wireSection'

// The three segments a real rundown carries, in the shape MorningWire renders them.
const SEGMENTS = [
  ['tape', 'The Tape'],
  ['board', 'The Board'],
  ['picks', 'Top 5'],
]

/** Real rundown markup — `section.rd-seg[data-seg]` with a direct-child `.rd-seg-label`. */
function rundownHtml(segments = SEGMENTS) {
  const body = segments
    .map(([key, label]) => (
      `<section class="rd-seg" data-seg="${key}">`
      + `<div class="rd-seg-label">${label}</div>`
      + '<p class="rd-body">body copy</p>'
      + '</section>'
    ))
    .join('')
  return `<div class="rd-sections">${body}</div>`
}

/** The latest config the hook returned, captured across re-renders. */
const captured = { config: null }

// Written from module scope and handed in as a prop, never assigned during render:
// `react-hooks/immutability` refuses a component that writes an outer variable, and it is right
// to — a render that mutates shared state is a render that cannot be replayed.
const captureConfig = (config) => { captured.config = config }

function Harness({ html, wireDate, onConfig = captureConfig }) {
  const rootRef = useRef(null)
  const config = useWireSection({ rootRef, wireDate, html })
  useEffect(() => { onConfig(config) }, [onConfig, config])
  // ⛔ MEMOIZED IDENTITY, mirroring `MorningWire.jsx` exactly — and it is load-bearing HERE for
  // the same reason it is there. React diffs `dangerouslySetInnerHTML` by OBJECT identity, so a
  // fresh `{__html}` literal re-sets the whole rundown on every re-render, destroying and
  // rebuilding the segment nodes. On the page that wipes the injected feedback controls; here it
  // also wipes `data-hub-cursor`, because `paintCursor` wrote it onto nodes that no longer exist.
  // An unmemoized harness would therefore report a cursor defect the real page does not have —
  // and, worse, would hide a real one behind a fixture that never keeps its DOM.
  const dangerous = useMemo(() => ({ __html: html }), [html])
  return <div data-testid="rundown" ref={rootRef} dangerouslySetInnerHTML={dangerous} />
}

function mount({ html = rundownHtml(), wireDate = '2026-09-09' } = {}) {
  const utils = render(<Harness html={html} wireDate={wireDate} />)
  return {
    ...utils,
    /** The live segment nodes, in document order. */
    nodes: () => Array.from(
      utils.getByTestId('rundown').querySelectorAll('section.rd-seg[data-seg]'),
    ),
    /** Which segment currently wears the cursor, by `data-seg` — the DOM's own answer. */
    activeSeg: () => {
      const el = utils.getByTestId('rundown').querySelector('[data-hub-cursor="active"]')
      return el ? el.dataset.seg : null
    },
    tap: () => act(() => { captured.config.onTap() }),
    doubleTap: () => act(() => { captured.config.onDoubleTap() }),
  }
}

beforeEach(() => {
  resetCursors()
  captured.config = null
  // jsdom ships no scrollIntoView. Stubbing it here (rather than letting the section's guard
  // swallow the call) is what makes "the cursor was revealed" an assertable fact.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
  delete Element.prototype.scrollIntoView
})

// ─────────────────────────────────────────────────────────────────────────────
describe('tap and double-tap walk the segments, and clamp at both ends', () => {
  it('tap advances exactly one segment', () => {
    const w = mount()
    expect(w.activeSeg()).toBe('tape')
    w.tap()
    expect(w.activeSeg()).toBe('board')
    w.tap()
    expect(w.activeSeg()).toBe('picks')
  })

  it('⛔ tap CLAMPS at the last segment — it never wraps to the first', () => {
    // Wrapping would send a member who is reading the last segment back to the top of the
    // brief on a gesture that means "next", which is worse than doing nothing.
    const w = mount()
    w.tap(); w.tap()
    expect(w.activeSeg()).toBe('picks')
    w.tap(); w.tap(); w.tap()
    expect(w.activeSeg()).toBe('picks')
  })

  it('double-tap retreats exactly one segment', () => {
    const w = mount()
    w.tap(); w.tap()
    expect(w.activeSeg()).toBe('picks')
    w.doubleTap()
    expect(w.activeSeg()).toBe('board')
    w.doubleTap()
    expect(w.activeSeg()).toBe('tape')
  })

  it('⛔ double-tap CLAMPS at the first segment — it never wraps to the last', () => {
    const w = mount()
    expect(w.activeSeg()).toBe('tape')
    w.doubleTap(); w.doubleTap(); w.doubleTap()
    expect(w.activeSeg()).toBe('tape')
  })

  it('exactly ONE segment wears the cursor at a time', () => {
    // paintCursor must CLEAR the attribute everywhere else; a cursor on two rows is a cursor
    // on neither.
    const w = mount()
    w.tap()
    const marked = w.nodes().filter((n) => n.getAttribute('data-hub-cursor') === 'active')
    expect(marked.map((n) => n.dataset.seg)).toEqual(['board'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('a fresh wire is a fresh list', () => {
  it('⭐ a new wire DATE resets the cursor to segment 0 — with identical segment keys', () => {
    // The segments deliberately do NOT change: today's rundown carries the same `data-seg`
    // keys as yesterday's, so if the date were not part of the identity, nothing else in the
    // system would notice and yesterday's index would point into today's brief.
    const html = rundownHtml()
    const w = render(<Harness html={html} wireDate="2026-09-08" />)
    const activeSeg = () => {
      const el = w.getByTestId('rundown').querySelector('[data-hub-cursor="active"]')
      return el ? el.dataset.seg : null
    }

    act(() => { captured.config.onTap() })
    act(() => { captured.config.onTap() })
    expect(activeSeg()).toBe('picks')

    w.rerender(<Harness html={html} wireDate="2026-09-09" />)
    expect(activeSeg()).toBe('tape')
  })

  it('a re-render of the SAME wire leaves the cursor where the member put it', () => {
    // The control for the test above: if the identity were unstable, the reset would look
    // right for the wrong reason and the cursor would jump home on every SWR revalidation.
    const html = rundownHtml()
    const w = render(<Harness html={html} wireDate="2026-09-09" />)
    const activeSeg = () => {
      const el = w.getByTestId('rundown').querySelector('[data-hub-cursor="active"]')
      return el ? el.dataset.seg : null
    }

    act(() => { captured.config.onTap() })
    expect(activeSeg()).toBe('board')

    w.rerender(<Harness html={html} wireDate="2026-09-09" />)
    expect(activeSeg()).toBe('board')
  })

  it('a REPLACED rundown repaints the cursor onto the new nodes', () => {
    // When the html string itself changes, React really does rebuild the segment DOM — the
    // nodes `paintCursor` marked are gone. The section must re-read and repaint, or the outline
    // silently disappears and the member is left driving an invisible cursor.
    const w = render(<Harness html={rundownHtml()} wireDate="2026-09-09" />)
    const activeSeg = () => {
      const el = w.getByTestId('rundown').querySelector('[data-hub-cursor="active"]')
      return el ? el.dataset.seg : null
    }

    act(() => { captured.config.onTap() })
    expect(activeSeg()).toBe('board')

    const fresh = rundownHtml([['open', 'The Open'], ['tape', 'The Tape']])
    w.rerender(<Harness html={fresh} wireDate="2026-09-09" />)
    expect(w.getByTestId('rundown').querySelectorAll('section.rd-seg[data-seg]')).toHaveLength(2)
    expect(activeSeg()).toBe('open')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('readout() — what the chip says during a scrub', () => {
  it('returns the visible segment label text', () => {
    const w = mount()
    expect(captured.config.readout()).toBe('The Tape')
    w.tap()
    expect(captured.config.readout()).toBe('The Board')
    w.tap()
    expect(captured.config.readout()).toBe('Top 5')
  })

  it('⛔ excludes the feedback controls MorningWire injects INTO the label', () => {
    // MorningWire's feedback effect appends 👍 👎 ✎ INSIDE `.rd-seg-label` (grep `data-fb-vote`).
    // The naive `textContent` read narrates "The Board👍👎✎" — non-empty, from the right element,
    // and wrong. The markup below is copied from that effect's own `ctrlHtml`.
    const w = mount()
    const label = w.nodes()[1].querySelector('.rd-seg-label')
    label.insertAdjacentHTML(
      'beforeend',
      '<span class="rd-fb"><button data-fb-vote="up">👍</button>'
      + '<button data-fb-vote="down">👎</button>'
      + '<button class="rd-fb-note" data-fb-note="board">✎</button></span>',
    )
    w.tap()
    expect(captured.config.readout()).toBe('The Board')
  })

  it('returns a valid ChipReadout even when a label is empty', () => {
    const w = mount({ html: rundownHtml([['tape', ''], ['board', 'The Board']]) })
    const out = captured.config.readout()
    expect(() => validateChipReadout(out)).not.toThrow()
    expect(out).toBe('Segment 1 of 2')
    w.tap()
    expect(captured.config.readout()).toBe('The Board')
  })

  it('narrates something on an empty rundown rather than an empty chip', () => {
    mount({ html: '<div class="rd-sections"></div>' })
    expect(captured.config.readout()).toBe('No segments')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('scrollTo — a cursor that moves off-screen has stopped being a cursor', () => {
  it('the moved-to segment is scrolled into view', () => {
    const w = mount()
    w.tap()
    const target = w.nodes()[1]
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
    expect(target.scrollIntoView.mock.instances[0]).toBe(target)
  })

  it('every step of a walk reveals its own segment, in order', () => {
    const w = mount()
    w.tap(); w.tap(); w.doubleTap()
    const revealed = Element.prototype.scrollIntoView.mock.instances.map((n) => n.dataset.seg)
    expect(revealed).toEqual(['board', 'picks', 'board'])
  })

  it('⛔ does NOT scroll on arrival — opening the page is not a gesture', () => {
    // The first commit after the HTML lands moves the index -1 → 0, which reads as movement to
    // any naive "did the index change?" check. A member who just opened /morning-wire never
    // asked to be scrolled.
    mount()
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('the adapter\'s own scrollTo reveals the index it is handed', () => {
    const w = mount()
    act(() => { captured.config.listAdapter.scrollTo(2) })
    expect(w.nodes()[2].scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  })

  it('survives an environment with no scrollIntoView at all', () => {
    // jsdom is exactly that environment; without the guard the reveal throws on every move and
    // buries whatever the test was actually asserting.
    delete Element.prototype.scrollIntoView
    const w = mount()
    expect(() => w.tap()).not.toThrow()
    expect(w.activeSeg()).toBe('board')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('scrub — segment index, from either caller', () => {
  it('a normalized 0..1 delta lands on the matching segment', () => {
    const w = mount()
    act(() => { captured.config.onScrub({ delta: 1, axis: 'y' }) })
    expect(w.activeSeg()).toBe('picks')
    act(() => { captured.config.onScrub({ delta: 0, axis: 'y' }) })
    expect(w.activeSeg()).toBe('tape')
    act(() => { captured.config.onScrub({ delta: 0.5, axis: 'y' }) })
    expect(w.activeSeg()).toBe('board')
  })

  it('⛔ also works when the payload arrives SECOND, as HubRoot passes it', () => {
    // `contracts.js` documents `onScrub({delta, axis})`; the mounted `HubRoot.jsx:147` calls
    // `onScrub(ctx, scrub)`. A section written to one signature is inert under the other, and
    // an inert scrub throws nothing and logs nothing. Filed as R-05.
    const w = mount()
    const ctx = { mode: 'wire', symbol: null, timeframe: null, chartRef: { current: null } }
    act(() => { captured.config.onScrub(ctx, { delta: 1, axis: 'y' }) })
    expect(w.activeSeg()).toBe('picks')
  })

  it('an overshoot clamps instead of wrapping', () => {
    const w = mount()
    act(() => { captured.config.onScrub({ delta: 1.8, axis: 'y' }) })
    expect(w.activeSeg()).toBe('picks')
    act(() => { captured.config.onScrub({ delta: -0.4, axis: 'y' }) })
    expect(w.activeSeg()).toBe('tape')
  })

  it('onScrubCommit reveals the landed segment even when the index did not move', () => {
    const w = mount()
    act(() => { captured.config.onScrub({ delta: 0, axis: 'y' }) })
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    act(() => { captured.config.onScrubCommit() })
    expect(w.nodes()[0].scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  })

  it('readScrubPayload ignores anything that is not a scrub', () => {
    expect(readScrubPayload({ mode: 'wire' }, { delta: 0.25, axis: 'y' }))
      .toEqual({ delta: 0.25, axis: 'y' })
    expect(readScrubPayload({ mode: 'wire' })).toBeNull()
    expect(readScrubPayload(undefined, null)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the contract', () => {
  it('the registered config passes validateSectionConfig', () => {
    mount()
    expect(() => validateSectionConfig(captured.config, 'wireSection')).not.toThrow()
  })

  it('the list adapter passes validateListAdapter — items, identityKey AND scrollTo', () => {
    mount()
    expect(() => validateListAdapter(captured.config.listAdapter, 'wireSection')).not.toThrow()
    expect(captured.config.listAdapter.items).toEqual(['tape', 'board', 'picks'])
  })

  it('the identity key carries the wire date, not just the segment', () => {
    mount({ wireDate: '2026-09-09' })
    expect(captured.config.listAdapter.identityKey('board', 1)).toBe('wire:2026-09-09:board')
  })

  it('items are in the SAME order as the rendered nodes', () => {
    // paintCursor indexes `nodes` by the cursor's index, which indexes `items`. If the two ever
    // disagreed the outline would land on a segment the member did not select.
    const w = mount()
    expect(captured.config.listAdapter.items)
      .toEqual(w.nodes().map((n) => n.dataset.seg))
    expect(segmentKeys(w.getByTestId('rundown'))).toEqual(captured.config.listAdapter.items)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the JOIN — what HubRoot actually reads off a registered config', () => {
  // Phase 2 shipped a non-functional hub with both suites green because each half tested its
  // own idea of the seam. `registerHubMode` REPLACES the registry default, so a config that
  // satisfies `validateSectionConfig` and nothing else takes the chip's label and the fan with
  // it on the way down.

  it('⛔ fanFor(config) still resolves — a bare section config would THROW here', () => {
    mount()
    expect(() => fanFor(captured.config)).not.toThrow()
    expect(fanFor(captured.config)).toEqual(fanFor(modesById.wire))
  })

  it('CONTROL: a bare HubSectionConfig really does break fanFor', () => {
    // Without this the assertion above could pass for the wrong reason — e.g. if `fanFor` had
    // grown its own guard and the spread were no longer load-bearing at all.
    const bare = { id: 'wire', onTap: () => {}, readout: () => 'x' }
    expect(() => validateSectionConfig(bare, 'bare')).not.toThrow()
    expect(() => fanFor(bare)).toThrow()
  })

  it('keeps the chip labelled and coloured from the registry', () => {
    mount()
    expect(captured.config.id).toBe('wire')
    expect(captured.config.label).toBe(modesById.wire.label)
    expect(captured.config.color).toBe(modesById.wire.color)
    expect(captured.config.tapHint).toBe(modesById.wire.tapHint)
  })

  it('leaves `wire` in the preview — this wave ships no fan change', () => {
    mount()
    // fanFor's preview projection keys off `mode.id`, so the spread carrying `id: 'wire'`
    // through is what keeps the preview fan intact with no registry edit.
    expect(fanFor(captured.config).every((a) => a.kind === 'home' || a.id.endsWith('.voice')))
      .toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('segmentLabelText', () => {
  it('reads only the direct-child label, never the body copy', () => {
    const host = document.createElement('div')
    host.innerHTML = rundownHtml()
    const seg = host.querySelector('section.rd-seg[data-seg="board"]')
    expect(segmentLabelText(seg)).toBe('The Board')
  })

  it('returns an empty string for a segment with no label, and never throws on null', () => {
    const host = document.createElement('div')
    host.innerHTML = '<section class="rd-seg" data-seg="x"><p>no label</p></section>'
    expect(segmentLabelText(host.firstChild)).toBe('')
    expect(segmentLabelText(null)).toBe('')
  })
})
