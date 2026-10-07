// @vitest-environment jsdom
// Finish program, lane FE, I7 verification: "a mousedown on the embed body no longer selects the
// block" (wave 13 lane 13H-2, live with every flag off).
//
// What the lane intended, and tested, is the LIVE chart: the chart owns its own gestures, so a
// press on its canvas must not reach the editor's click-to-select (that stole focus out of Draw
// mode). `widgetEmbedNode.test.js` holds that.
//
// What came with it, and is NOT covered there: the same rule applies to every block's body,
// because every kind of embed renders inside `[data-widget-embed-body]` (WidgetEmbedView.jsx) --
// an ARCHIVED IMAGE included, which has no gesture of its own to protect. Before 13H-2 a click
// on an archived chart image selected the block (then Backspace removed it, or a drag moved it).
// Now it does nothing. Measured in a real browser on this branch
// (docs/notebook/evidence/fin-fe/walk-run3-fixed-*/C_observations.json): a click on the body
// selects nothing; with no caption the block has no surface of its own that a click selects;
// the keyboard still selects, copies, cuts, pastes, deletes and undoes it, and the toolbar's
// Remove button still deletes it by mouse.
//
// The first test below asserts the behaviour BEFORE the wave and FAILS on this branch. It is
// written with `it.fails` so the suite stays green and so it turns RED the day the old behaviour
// is restored for static images (then: delete `.fails`). It is a record of a regression the
// controller ruled stays live for now, not a fix.
import { describe, it, expect } from 'vitest'
import { widgetEmbedStopEvent } from './widgetEmbedNode'

function embedWith(inner) {
  const host = document.createElement('div')
  host.innerHTML = `<div data-widget-embed-view="chart"><div data-widget-embed-body="">${inner}</div><div class="caption">cap</div></div>`
  document.body.appendChild(host)
  return host
}
const mousedownOn = (el) => ({ type: 'mousedown', target: el })

describe('I7 — clicking a chart block', () => {
  it.fails('REGRESSION RECORD: a click on an ARCHIVED IMAGE still selects the block (true before wave 13, false now)', () => {
    const host = embedWith('<img alt="AMD daily chart, archived" src="data:," />')
    // false = "not mine, let the editor select the block"
    expect(widgetEmbedStopEvent({ event: mousedownOn(host.querySelector('img')) })).toBe(false)
  })

  it('what is intended and holds: a press on a LIVE chart canvas never reaches click-to-select', () => {
    const host = embedWith('<canvas></canvas>')
    expect(widgetEmbedStopEvent({ event: mousedownOn(host.querySelector('canvas')) })).toBe(true)
  })

  it('a click on the caption (outside the body) still selects the block', () => {
    const host = embedWith('<canvas></canvas>')
    expect(widgetEmbedStopEvent({ event: mousedownOn(host.querySelector('.caption')) })).toBe(false)
  })

  it('copy, cut, paste and drag events are still the editor’s, from anywhere in the block', () => {
    const host = embedWith('<canvas></canvas>')
    const canvas = host.querySelector('canvas')
    for (const type of ['copy', 'cut', 'paste', 'dragstart', 'drop']) {
      expect(widgetEmbedStopEvent({ event: { type, target: canvas } })).toBe(false)
    }
  })
})
