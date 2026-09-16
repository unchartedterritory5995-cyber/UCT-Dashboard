/**
 * D-39 — the clearance probe, wired.
 *
 * ⛔⛔ THE LOAD-BEARING CASE IN THIS FILE IS "IT DOES NOT LOOP". `HubChip` is one of the components
 * that froze navigation app-wide for ~4.5 hours on 2026-09-10 — a passive-effect loop in hub code
 * starved React Router's transition commit, and it was found by a member, not by a suite. Every
 * other case here checks that the chip yields correctly; the render-count case checks that adding
 * the yielding did not re-open that class.
 *
 * ⚠️ jsdom performs NO layout. Every rect is zero and `elementFromPoint` does not exist, so the
 * geometry below is stubbed. That is honest rather than a shortcut: the DECISION is railed as a
 * pure function in `chipClearance.test.js`, and what this file proves is that the component asks
 * the right question, applies the answer, and stops.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import HubChip from './HubChip'

// journal @393: the chip is anchored right at 275 and the Journal FAB owns [16, 72].
const VIEWPORT = 393
const CHIP = { left: 24, right: 275, top: 700, bottom: 728, width: 251, height: 28 }
const MODE = { left: 36, right: 100, top: 704, bottom: 724, width: 64, height: 20 }
const HINT = { left: 106, right: 263, top: 704, bottom: 724, width: 157, height: 20 }
const FAB = { left: 16, right: 72, top: 690, bottom: 746, width: 56, height: 56 }

let fabPresent = true
let intro = false
let originalRO
let originalRect
let fabEl

/**
 * ⚠️ THE OCCLUDER IS A REAL ELEMENT, NOT A PLAIN OBJECT, AND THAT IS NOT FUSSINESS.
 * The first version of this fixture returned `{ closest, getBoundingClientRect }`, and jsdom's
 * `Node.contains()` threw `parameter 1 is not of type 'Node'` — which looked like a product bug for
 * a moment. It is not: in a browser `elementFromPoint` returns `Element | null` and never anything
 * else, so hardening the component against that case would have been defending it from a state it
 * cannot reach, on the word of a fixture that was wrong. Fix the fixture.
 */
function stubGeometry() {
  originalRect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function stub() {
    if (this.dataset && this.dataset.testid === 'hub-chip') return CHIP
    if (this === fabEl) return FAB
    if (this.tagName === 'B') return MODE
    if (this.tagName === 'SPAN') return HINT
    return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }
  }

  fabEl = document.createElement('button')
  fabEl.setAttribute('aria-label', 'Log a trade')
  document.body.appendChild(fabEl)

  document.elementFromPoint = (x) => {
    if (fabPresent && x >= FAB.left && x <= FAB.right) {
      if (intro) {
        // The intro overlay paints over everything, and its own pills are anonymous spans — only
        // the ROOT carries aria-label="Welcome", which is why the predicate uses `closest`.
        const welcome = document.createElement('div')
        welcome.setAttribute('aria-label', 'Welcome')
        const pill = document.createElement('span')
        welcome.appendChild(pill)
        document.body.appendChild(welcome)
        return pill
      }
      return fabEl
    }
    return document.querySelector('[data-testid="hub-chip"]')
  }
}

const maxWidth = () => screen.getByTestId('hub-chip').style.maxWidth

beforeEach(() => {
  fabPresent = true
  intro = false
  window.innerWidth = VIEWPORT
  originalRO = global.ResizeObserver
  // A no-op observer: this file drives re-measurement through re-renders, not through the browser.
  global.ResizeObserver = class { observe() {} disconnect() {} }
  stubGeometry()
})

afterEach(() => {
  cleanup()
  global.ResizeObserver = originalRO
  delete document.elementFromPoint
  // ⛔ RESTORE, never delete. `delete Element.prototype.getBoundingClientRect` removes the method
  // for every later test file in the same worker — the tidy-looking teardown that breaks a
  // neighbour and gets blamed on the neighbour.
  if (originalRect) Element.prototype.getBoundingClientRect = originalRect
  document.body.innerHTML = ''
  fabEl = null
})

describe('⛔ D-39 — the chip yields to page-level fixed furniture', () => {
  it('CONTROL: with nothing in the way the chip keeps its CSS ceiling, untouched', () => {
    // Non-vacuity for every case below: if this returned a px clamp too, the fix would be
    // clamping unconditionally and the "it yields" case would pass for the wrong reason.
    fabPresent = false
    render(<HubChip label="Journal" tapHint="tap: open" />)
    expect(maxWidth()).toMatch(/^calc\(100vw - \d+px\)$/)
  })

  it('⭐ with the FAB in the way it shrinks to start where the FAB ends', () => {
    render(<HubChip label="Journal" tapHint="tap: open" />)
    // chipRight 275 - fabRight 72 = 203.
    expect(maxWidth()).toBe('203px')
  })

  it('⛔ the MODE NAME survives — it is still rendered after the chip yields', () => {
    render(<HubChip label="Journal" tapHint="tap: open" />)
    // The ruling: the mode name must survive, the tap hint may yield. Asserted as RENDERED TEXT,
    // because a chip that clamps to a width nobody can read is not a fix.
    expect(screen.getByText('Journal')).toBeTruthy()
  })

  it('⚰️ it does NOT yield to the intro animation — that misreading cost a withdrawn defect', () => {
    intro = true
    render(<HubChip label="Journal" tapHint="tap: open" />)
    expect(maxWidth()).toMatch(/^calc\(100vw - \d+px\)$/)
  })

  it('a chip with no layout engine renders exactly what it rendered before', () => {
    // The real jsdom condition, with the stubs removed: no elementFromPoint at all.
    delete document.elementFromPoint
    render(<HubChip label="Journal" tapHint="tap: open" />)
    expect(maxWidth()).toMatch(/^calc\(100vw - \d+px\)$/)
  })
})

describe('⛔⛔ IT DOES NOT LOOP — the 2026-09-10 class, railed', () => {
  it('a settled page reaches a stable clamp and STOPS re-rendering', () => {
    let renders = 0
    function Counting(props) {
      renders += 1
      return <HubChip {...props} />
    }
    render(<Counting label="Journal" tapHint="tap: open" />)

    // One render for the initial paint, one for the clamp landing. A release/clamp oscillation
    // would keep climbing here forever — which is exactly how the nav freeze presented, at
    // ~4,500 commits per second in a component whose own tests were all green.
    expect(renders).toBeLessThanOrEqual(3)
    expect(maxWidth()).toBe('203px')

    const settled = renders
    // Re-render with identical props: `measure` must short-circuit on the geometry key and
    // `setClampPx` must bail out, so this costs one render and not a cascade.
    cleanup()
    expect(renders).toBe(settled)
  })

  it('⭐ CONTROL: the counter can actually climb, so the bound above is not vacuous', () => {
    // A rail asserting "<= 3" proves nothing unless a loop would really exceed it.
    let renders = 0
    function Runaway() {
      renders += 1
      if (renders < 25) return <Runaway />
      return null
    }
    render(<Runaway />)
    expect(renders).toBeGreaterThan(3)
  })
})
