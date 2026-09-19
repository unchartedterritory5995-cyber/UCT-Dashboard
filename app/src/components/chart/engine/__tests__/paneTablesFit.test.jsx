// app/src/components/chart/engine/__tests__/paneTablesFit.test.jsx
//
// ─── ⭐⭐ R-R — A TABLE WIDER THAN THE PHONE'S PLOT, AND WHAT MAY BE LOST ────
//
// Owner ruling, 2026-09-13, with the priority order stated in it: never lose a
// NUMBER (clipping is out), never cover the price labels (an opaque background
// is out), keep the author's declared row shape. What survives all three is a
// UNIFORM SCALE down to a 9px readable floor, and wrapping ONLY when the floor
// would otherwise be violated.
//
// ⭐ THE NUMBERS HERE ARE MEASURED, NOT CHOSEN. Item 4's audit read them off the
// live pane at 390×844: the price scale takes the last 104px, so the plot ends
// at 286; the Range table needs 287px on the defaults document and 356px with
// the toggles on. The layer then reserves both 8px table margins, so the width a
// table may actually occupy is 270 — and BOTH numbers appear below, because the
// ruling was written against 286 and the shipped code computes 270.
//
// ⛔ AND THE FLOOR IS REPORTED HONESTLY. The ruling's test asked whether doc B
// "scales to the floor and states whether it wraps". It does NOT reach the
// floor: 270/356 = 0.758, and the floor is 9/12 = 0.75. Neither real document
// wraps. So the wrap branch is exercised here by a width that DOES cross it,
// and the crossing point is asserted — a branch nothing can reach is not a
// fallback, it is dead code.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fitFactor, TABLES_FIT } from '../objectTableDom'
import { TEXT_SIZE_PX } from '../objectCanvas'
import { createObjectLayer } from '../objectLayer'
import { setPaneScaled, resetPaneScaled } from '../paneFitNotice'
import { KEEP } from '../ast/manifestProse'
import AttachedPineDisclosures from '../../pane/AttachedPineDisclosures'

// ── the measured constants, named once ─────────────────────────────────────
const SCREEN = 390            // the phone tier's audited width
const SCALE = 104             // priceScale('right').width() at SPY 1D
const PLOT = SCREEN - SCALE   // 286 — the ruling's "available"
const USABLE = PLOT - 16      // 270 — after both 8px table margins
const DOC_A = 287             // Range table, defaults
const DOC_B = 356             // Range table, every toggle on
const BASE = TEXT_SIZE_PX.normal   // 12

/** ⛔ A REGISTRY THAT ANSWERS NOTHING, so the only sentence the strip can render
 *  is the one R-R adds. A stub that returned documents would make "one note"
 *  pass for the wrong reason. */
const emptyRegistry = { getDefinition: () => null, registryGeneration: () => 0 }

describe('R-R — fitFactor, on the measured widths', () => {
  it('⭐ doc A (287 needed / 286 available) scales, and does NOT reach the floor', () => {
    const fit = fitFactor({ neededWidths: [DOC_A], plotWidth: PLOT })
    expect(fit.scaled).toBe(true)
    expect(fit.wrap).toBe(false)
    expect(fit.factor).toBeCloseTo(PLOT / DOC_A, 6)     // 0.99652…
    // the floor is a TYPE SIZE, so assert it in px rather than in factor
    expect(fit.factor * BASE).toBeGreaterThan(TABLES_FIT.floorPx)
  })

  it('⭐ doc A against what the layer really has (270) — still clear of the floor', () => {
    const fit = fitFactor({ neededWidths: [DOC_A], plotWidth: USABLE })
    expect(fit.factor).toBeCloseTo(USABLE / DOC_A, 6)   // 0.94076…
    expect(fit.wrap).toBe(false)
    expect(fit.factor * BASE).toBeCloseTo(11.29, 2)
  })

  it('⛔ doc B (356) scales — and it does NOT wrap, at either width', () => {
    const atRuling = fitFactor({ neededWidths: [DOC_B], plotWidth: PLOT })
    expect(atRuling.scaled).toBe(true)
    expect(atRuling.factor).toBeCloseTo(PLOT / DOC_B, 6)      // 0.80337…
    expect(atRuling.wrap).toBe(false)

    const atReal = fitFactor({ neededWidths: [DOC_B], plotWidth: USABLE })
    expect(atReal.factor).toBeCloseTo(USABLE / DOC_B, 6)      // 0.75842…
    expect(atReal.wrap).toBe(false)
    // ⚠️ BY HALF A PIXEL OF TYPE. 0.75842 × 12 = 9.10px against a 9px floor —
    // this is the number to re-read if the floor or the base size ever moves.
    expect(atReal.factor * BASE).toBeGreaterThan(TABLES_FIT.floorPx)
    expect(atReal.factor * BASE).toBeLessThan(TABLES_FIT.floorPx + 0.2)
  })

  it('⛔⛔ THE WRAP BRANCH IS REACHABLE, and here is exactly where', () => {
    // floorFactor = 9/12 = 0.75, so the widest table that still scales without
    // wrapping at 270 is 270/0.75 = 360.
    const floorFactor = TABLES_FIT.floorPx / BASE
    expect(floorFactor).toBeCloseTo(0.75, 6)
    const boundary = USABLE / floorFactor
    expect(boundary).toBeCloseTo(360, 6)

    expect(fitFactor({ neededWidths: [360], plotWidth: USABLE }).wrap).toBe(false)
    const wrapped = fitFactor({ neededWidths: [361], plotWidth: USABLE })
    expect(wrapped.wrap).toBe(true)
    expect(wrapped.scaled).toBe(true)
    // ⛔ IT STOPS AT THE FLOOR RATHER THAN GOING PAST IT. Scaling to 270/361
    // would keep the row shape and make the numbers unreadable, which loses the
    // value in a way a member cannot see they have lost.
    expect(wrapped.factor).toBeCloseTo(floorFactor, 6)
    expect(wrapped.factor * BASE).toBe(TABLES_FIT.floorPx)
  })

  it('⭐ ONE FACTOR FOR BOTH TABLES — the widest decides, so relative sizes hold', () => {
    const both = fitFactor({ neededWidths: [DOC_A, DOC_B], plotWidth: USABLE })
    const widestAlone = fitFactor({ neededWidths: [DOC_B], plotWidth: USABLE })
    expect(both.widest).toBe(DOC_B)
    expect(both.factor).toBe(widestAlone.factor)
    // and the narrow one is NOT fitted to itself — that would change the ratio
    // the author declared between the two dashboards.
    expect(both.factor).not.toBeCloseTo(USABLE / DOC_A, 6)
  })

  it('⛔ NOTHING TO DO IS A DISTINCT ANSWER — a table that fits is not "scaled by 1"', () => {
    const fit = fitFactor({ neededWidths: [DOC_B], plotWidth: 1024 - SCALE - 16 })
    expect(fit.scaled).toBe(false)
    expect(fit.factor).toBe(1)
    expect(fit.wrap).toBe(false)
  })
})

// ── the tier gate, through the real layer on a real document ────────────────

/** jsdom performs no layout, so `scrollWidth` is always 0. The width a table
 *  WANTS is exactly what the layer must read, so it is stubbed per element. */
let widthPatch = null
function stubScrollWidth() {
  const proto = window.HTMLElement.prototype
  widthPatch = Object.getOwnPropertyDescriptor(proto, 'scrollWidth')
  Object.defineProperty(proto, 'scrollWidth', {
    configurable: true,
    get() { return Number(this.__uctWant) || 0 },
  })
}
function restoreScrollWidth() {
  const proto = window.HTMLElement.prototype
  if (widthPatch) Object.defineProperty(proto, 'scrollWidth', widthPatch)
  else delete proto.scrollWidth
  widthPatch = null
}

const cellsFor = (text) => [{ col: 0, row: 0, text, text_color: '#fff', text_size: 'normal' }]

/** A layer on a real jsdom container, with the frame queue in hand. */
function mountLayer(innerWidth) {
  Object.defineProperty(window, 'innerWidth', { value: innerWidth, configurable: true })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const frames = []
  const layer = createObjectLayer({
    container,
    doc: document,
    instanceId: 'rr-1',
    insets: { top: 30 },
    raf: (cb) => { frames.push(cb); return frames.length },
    cancel: () => {},
    mapping: () => ({
      width: innerWidth, height: 400, rightInset: SCALE,
      timeToX: () => 0, priceToY: () => 0,
    }),
  })
  return {
    layer,
    container,
    root: () => container.querySelector('[data-uct-table-layer]'),
    flush() { const q = frames.splice(0); q.forEach((f) => f()) },
  }
}

describe('R-R — the tier gate, driven through the layer', () => {
  beforeEach(() => { resetPaneScaled(); stubScrollWidth() })
  afterEach(() => { restoreScrollWidth(); cleanup(); document.body.innerHTML = '' })

  const drive = (innerWidth, wideWant = DOC_B) => {
    const h = mountLayer(innerWidth)
    h.layer.set({
      lines: [], labels: [], boxes: [], fills: [],
      tables: [
        { id: 1, position: 'top_left', cells: cellsFor('ATR : $6.21 (0.81%)') },
        { id: 2, position: 'top_right', cells: cellsFor('Vol 45.48M') },
      ],
    }, 'sig-1')
    const els = [...h.root().querySelectorAll('[data-uct-object-table]')]
    expect(els).toHaveLength(2)
    els[0].__uctWant = wideWant   // the wide one, left-anchored, as measured
    els[1].__uctWant = 118        // the Volume table, which has always fitted
    h.flush()
    return { ...h, els }
  }

  /** The width a table may occupy at a given viewport, by the layer's own
   *  arithmetic — so an OVERFLOWING control is derived, never guessed. */
  const usableAt = (vw) => vw - SCALE - 16

  it('⭐ PHONE (390): the tables scale, the root says by how much, the notice fires', () => {
    const { root, els } = drive(SCREEN)
    const stamp = root().getAttribute('data-uct-tables-fit')
    expect(stamp).toBe((USABLE / DOC_B).toFixed(3))       // "0.758"
    expect(stamp).not.toContain('wrap')
    // ⛔ BOTH TABLES CARRY THE SAME FACTOR — that is the ruling's "relative sizes
    // stay as the author set them", asserted on the DOM rather than in arithmetic.
    expect(els[0].getAttribute('data-uct-table-scaled'))
      .toBe(els[1].getAttribute('data-uct-table-scaled'))
    // and each is anchored at its own corner, so scaling moves neither
    expect(els[0].style.transformOrigin).toBe('top left')
    expect(els[1].style.transformOrigin).toBe('top right')
  })

  it('⭐ CONTROL at 1024, the SAME document: no scaling, no transform, no note', () => {
    // ⚠️ THIS ONE PASSES BECAUSE THE TABLES FIT, NOT BECAUSE OF THE TIER —
    // 1024 leaves 904px of plot against a 356px table. It is the ruling's stated
    // control and it is worth having, but on its own it CANNOT see the tier gate;
    // the next test is the one that can. (Measured: forcing `isPhone` true leaves
    // every assertion here green.)
    const { root, els } = drive(1024)
    expect(usableAt(1024)).toBeGreaterThan(DOC_B)
    expect(root().getAttribute('data-uct-tables-fit')).toBe('none')
    expect(els[0].style.transform).toBe('')
    expect(els[0].hasAttribute('data-uct-table-scaled')).toBe(false)

    render(<AttachedPineDisclosures settings={null} registry={emptyRegistry} />)
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()
  })

  it('⛔⛔ THE TIER GATE, PROVED: a table that OVERFLOWS at 1024 is still '
    + 'left alone', () => {
    // ⭐ The discriminating control. A table needing more than the touch tier's
    // plot would scale if the gate keyed off width; the ruling says the gate is
    // the BREAKPOINT, so nothing happens here. Delete `isPhone` and this goes red.
    const want = usableAt(1024) + 200
    const { root, els } = drive(1024, want)
    expect(want).toBeGreaterThan(usableAt(1024))
    expect(root().getAttribute('data-uct-tables-fit')).toBe('none')
    expect(els[0].hasAttribute('data-uct-table-scaled')).toBe(false)
  })

  it('⛔ AND ONE PIXEL ABOVE THE TIER IS NOT A PHONE — 641 scales nothing', () => {
    // ⚠️ A narrow WIDGET on a desktop is not a phone, and 641 is the first
    // width that is not one. The needed width overflows 641's plot, so this fails
    // if the gate is removed rather than passing on the fit.
    const want = usableAt(641) + 200
    const h = mountLayer(641)
    h.layer.set({ tables: [{ id: 1, position: 'top_left', cells: cellsFor('x') }] }, 's')
    const el = h.root().querySelector('[data-uct-object-table]')
    el.__uctWant = want
    h.flush()
    expect(want).toBeGreaterThan(usableAt(641))
    expect(h.root().getAttribute('data-uct-tables-fit')).toBe('none')
  })
})

// ── the sentence, and the surface that says it ──────────────────────────────

describe('R-R — the disclosure', () => {
  beforeEach(() => resetPaneScaled())
  afterEach(() => { cleanup(); resetPaneScaled() })

  it('⛔ THE WORDS HAVE ONE OWNER — the manifest, and it survives the prose strip', () => {
    const raw = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, '../ast/closedTable.json'), 'utf8'))
    expect(TABLES_FIT.memberNote).toBe(raw._tables_fit.memberNote)
    expect(TABLES_FIT.floorPx).toBe(raw._tables_fit.floorPx)
    expect(TABLES_FIT.memberNote)
      .toBe("Tables are scaled to fit this screen width; text size differs from the author's.")
    // ⛔ A `_`-KEY IS DROPPED FROM THE BUNDLE UNLESS IT IS KEPT. Without this the
    // fit still works and the member is never told — the `_folds` failure shape.
    expect(KEEP).toContain('_tables_fit')
  })

  it('⭐ the strip says it when a pane is scaled, ONCE, and not otherwise', () => {
    const { rerender } = render(
      <AttachedPineDisclosures settings={null} registry={emptyRegistry} />)
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()

    act(() => { setPaneScaled('pane-1', true) })
    rerender(<AttachedPineDisclosures settings={null} registry={emptyRegistry} />)
    expect(screen.getByTestId('pine-attached-disclosures').textContent)
      .toBe(TABLES_FIT.memberNote)

    // ⛔ TWO ATTACHED DOCUMENTS ON ONE PHONE ARE ONE FACT ABOUT THE SCREEN.
    act(() => { setPaneScaled('pane-2', true) })
    rerender(<AttachedPineDisclosures settings={null} registry={emptyRegistry} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)

    act(() => { setPaneScaled('pane-1', false); setPaneScaled('pane-2', false) })
    rerender(<AttachedPineDisclosures settings={null} registry={emptyRegistry} />)
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()
  })

  it('⛔ AND IT GOES WHEN THE PANE GOES — clear() takes the sentence with it', () => {
    stubScrollWidth()
    const h = mountLayer(SCREEN)
    h.layer.set({ tables: [{ id: 1, position: 'top_left', cells: cellsFor('x') }] }, 's')
    h.root().querySelector('[data-uct-object-table]').__uctWant = DOC_B
    h.flush()
    render(<AttachedPineDisclosures settings={null} registry={emptyRegistry} />)
    expect(screen.getByTestId('pine-attached-disclosures').textContent)
      .toBe(TABLES_FIT.memberNote)

    act(() => { h.layer.clear() })
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()
    restoreScrollWidth()
  })
})
