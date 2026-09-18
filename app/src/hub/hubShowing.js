// ⛔⛔ THE VERDICT LAYER OVER `visibilityTriple`. ONE authority on "can a member see the hub".
//
// `hubReport.js::visibilityTriple` MEASURES — present, hidden attribute, computed display, box.
// This file JUDGES those facts, and it is the only place that judgement is made:
//   · `hubReport.js` imports `showingFromTriple` so an owner's report says whether the hub was
//     VISIBLE, not merely what its box was;
//   · `tools/hub_critique_capture.py` READS this file and injects it, so the rendering harness
//     and the product cannot drift apart;
//   · `hubShowing.test.js` drives it to every answer, each with a distinct reason.
//
// ⚰️ An earlier draft of this file re-implemented the measurement instead of deriving from
// `visibilityTriple`, which would have put a second authority on the one question the Report
// affordance exists to answer — inside the very commit whose comment warned against exactly that.
// Caught by `reachable.test.js` refusing to let it in unwired, and by reading `hubReport.js` before
// committing.
//
// ⚠️ PRESENT IS NOT SHOWING, AND IT CUTS BOTH WAYS. `HubRoot` keeps `<div data-testid="hub-root">`
// in the DOM and sets the `hidden` attribute, so `querySelector` answers "did React render a
// container", never "can the member see it" — the touch smoke published a chart-shell defect that
// did not exist on exactly that mistake. And `offsetParent === null` is NOT the signal either: the
// hub is `position: fixed`, so that is null while it is plainly on screen.
//
// ⛔ THIS FILE HAS NO IMPORTS, DELIBERATELY. The harness injects its source into a live page, where
// no module graph exists. `showingFromTriple` therefore takes the triple as data rather than
// importing the function that produces it; `hubReport.js` supplies it on the product side.

/**
 * Judge an already-measured visibility triple.
 * @param {{present: boolean, hiddenAttr: boolean|null, display: string|null, box: number[]|null}} t
 * @returns {{present: boolean, showing: boolean, why?: string, box?: {w:number,h:number}}}
 */
export function showingFromTriple(t) {
  if (!t || !t.present) return { present: false, showing: false, why: 'no hub-root in the DOM' }
  if (t.hiddenAttr === true) return { present: true, showing: false, why: 'hidden attribute set' }
  if (t.display === 'none') return { present: true, showing: false, why: 'computed display:none' }
  if (t.visibility === 'hidden') return { present: true, showing: false, why: 'visibility:hidden' }
  const w = t.box ? t.box[2] : 0
  const h = t.box ? t.box[3] : 0
  if (!w || !h) return { present: true, showing: false, why: `zero box ${w}x${h}` }
  return { present: true, showing: true, box: { w: Math.round(w), h: Math.round(h) } }
}

/**
 * Measure and judge in one call, for a caller holding only a document — which is what the
 * rendering harness has when it injects this file.
 */
export function hubShowing(doc, win, selector = '[data-testid="hub-root"]') {
  const el = doc.querySelector(selector)
  if (!el) return showingFromTriple({ present: false })
  const cs = win && typeof win.getComputedStyle === 'function' ? win.getComputedStyle(el) : null
  const r = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null
  return showingFromTriple({
    present: true,
    hiddenAttr: el.hasAttribute ? el.hasAttribute('hidden') : null,
    display: cs ? cs.display : null,
    visibility: cs ? cs.visibility : null,
    box: r ? [Math.round(r.left), Math.round(r.top), r.width, r.height] : null,
  })
}
