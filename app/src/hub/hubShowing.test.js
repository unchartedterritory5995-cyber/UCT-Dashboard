// The rail the owner asked for: THE SHOWING PREDICATE ANSWERS **NO** ON A KNOWN-HIDDEN ELEMENT.
//
// ⛔⛔ A PREDICATE NOBODY HAS SEEN ANSWER NO IS NOT A PREDICATE. Every frame the rendering harness
// keeps rests on this function saying yes; if it could only ever say yes, a capture of a page
// with no hub would be filed as a capture of the hub. That is not hypothetical — the touch smoke
// published a chart-shell defect that did not exist because a presence check stood in for a
// visibility one.
//
// ⛔ AND THE FOUR **NO** ANSWERS MUST BE DISTINGUISHABLE FROM EACH OTHER. "Not showing" is the
// same word for an element React never rendered, one the member has hidden, one CSS collapsed and
// one with no box — and a harness that collapses them cannot tell "the hub is off" from "the page
// failed to load". Each case therefore asserts its own `why`, not merely `showing === false`.
import { describe, it, expect } from 'vitest'
import { hubShowing, showingFromTriple } from './hubShowing'

/** jsdom performs no layout — `getBoundingClientRect` is all zeros — so a box is stubbed where the
 *  test is about something OTHER than the box. Without this every case would pass for the wrong
 *  reason: "zero box" would mask the branch actually under test. */
function mount(html, { box = { width: 120, height: 84 } } = {}) {
  document.body.innerHTML = html
  const el = document.querySelector('[data-testid="hub-root"]')
  if (el && box) el.getBoundingClientRect = () => ({ width: box.width, height: box.height })
  return { doc: document, win: window }
}

describe('hubShowing — the predicate answers both ways', () => {
  it('⭐ YES on a visible element, with its measured box', () => {
    const { doc, win } = mount('<div data-testid="hub-root"></div>')
    const r = hubShowing(doc, win)
    expect(r.showing, 'a plainly visible hub was reported as not showing').toBe(true)
    expect(r.present).toBe(true)
    expect(r.box).toEqual({ w: 120, h: 84 })
  })

  it('⛔ NO on the `hidden` attribute — the case the product actually uses', () => {
    // HubRoot hides itself with `hidden={hidden}`, so this is not a synthetic case: it is the
    // exact mechanism a member's "hide the joystick" produces.
    const { doc, win } = mount('<div data-testid="hub-root" hidden></div>')
    const r = hubShowing(doc, win)
    expect(r.showing).toBe(false)
    expect(r.present, 'hidden is PRESENT-but-not-showing, and the difference is load-bearing').toBe(true)
    expect(r.why).toBe('hidden attribute set')
  })

  it('⛔ NO on display:none', () => {
    const { doc, win } = mount('<div data-testid="hub-root" style="display:none"></div>')
    const r = hubShowing(doc, win)
    expect(r.showing).toBe(false)
    expect(r.why).toBe('computed display:none')
  })

  it('⛔ NO on visibility:hidden', () => {
    const { doc, win } = mount('<div data-testid="hub-root" style="visibility:hidden"></div>')
    const r = hubShowing(doc, win)
    expect(r.showing).toBe(false)
    expect(r.why).toBe('visibility:hidden')
  })

  it('⛔ NO on a zero box, and it says which dimension', () => {
    const { doc, win } = mount('<div data-testid="hub-root"></div>', { box: { width: 0, height: 40 } })
    const r = hubShowing(doc, win)
    expect(r.showing).toBe(false)
    expect(r.why).toContain('zero box')
  })

  it('⛔ ABSENT is reported as NOT PRESENT, not merely as not showing', () => {
    const { doc, win } = mount('<div></div>')
    const r = hubShowing(doc, win)
    expect(r.present, 'an absent hub must be distinguishable from a hidden one').toBe(false)
    expect(r.showing).toBe(false)
    expect(r.why).toBe('no hub-root in the DOM')
  })

  it('⛔ the verdict layer judges a triple WITHOUT a DOM — the shape hubReport.js hands it', () => {
    // hubReport.js calls showingFromTriple(visibilityTriple(...)), so the verdict must work on
    // the triple alone. If it only worked through hubShowing(doc, win) the product path would be
    // untested and the harness path would be the only one covered — the inverse of the point.
    expect(showingFromTriple({ present: false }).why).toBe('no hub-root in the DOM')
    expect(showingFromTriple({ present: true, hiddenAttr: true }).why).toBe('hidden attribute set')
    expect(showingFromTriple({ present: true, display: 'none' }).why).toBe('computed display:none')
    expect(showingFromTriple({ present: true, box: [0, 0, 120, 84] }).showing).toBe(true)
    expect(showingFromTriple({ present: true, box: [0, 0, 120, 84] }).box).toEqual({ w: 120, h: 84 })
  })

  it('⛔ every NO carries a DIFFERENT reason — they must not collapse into one word', () => {
    const reasons = [
      hubShowing(...Object.values(mount('<div data-testid="hub-root" hidden></div>'))).why,
      hubShowing(...Object.values(mount('<div data-testid="hub-root" style="display:none"></div>'))).why,
      hubShowing(...Object.values(mount('<div data-testid="hub-root" style="visibility:hidden"></div>'))).why,
      hubShowing(...Object.values(mount('<div data-testid="hub-root"></div>', { box: { width: 0, height: 0 } }))).why,
      hubShowing(...Object.values(mount('<div></div>'))).why,
    ]
    expect(new Set(reasons).size, `two states share a reason: ${reasons.join(' | ')}`).toBe(5)
  })
})
