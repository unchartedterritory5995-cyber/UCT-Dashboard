// Tier 1b fix round 1 (review Minor 15): on a phone the list's "+ New" group is `display: none` (the floating "+"
// replaces it, S12), so the base tour's three steps anchored there -- new-note, templates (the ▾) and import (the
// group) -- have no box. The tour must SKIP them, never point at nothing: anchorFor (the one test both tour engines
// ask) answers null for an anchor with no box, and a step without an anchor is passed over (NotebookTour.jsx /
// GenericTourEngine.jsx). jsdom lays nothing out, so the box is stubbed: none for the hidden group, one for the rest.
import { afterEach, describe, expect, it } from 'vitest'
import { anchorFor } from './tourAnchorVisibility'
import { TOUR_STEPS } from './tourSteps'

const real = HTMLElement.prototype.getClientRects
const realRect = HTMLElement.prototype.getBoundingClientRect
afterEach(() => {
  HTMLElement.prototype.getClientRects = real
  HTMLElement.prototype.getBoundingClientRect = realRect
  document.body.innerHTML = ''
})

function page() {
  document.body.innerHTML = `
    <div data-tour="view-switcher">View</div>
    <div class="newSplit" data-tour="import"><button data-tour="new-note">+ New</button><button data-tour="templates">▾</button></div>`
  HTMLElement.prototype.getClientRects = function rects() { return this.closest('.newSplit') ? [] : [{}] }
  HTMLElement.prototype.getBoundingClientRect = function box() {
    return this.closest('.newSplit') ? { left: 0, top: 0, right: 0, bottom: 0 } : { left: 10, top: 10, right: 110, bottom: 50 }
  }
}

describe('the base tour on a phone passes over the hidden "+ New" group', () => {
  it('the three anchors are real steps of the base tour (non-vacuity)', () => {
    expect(TOUR_STEPS.map((s) => s.anchor)).toEqual(expect.arrayContaining(['new-note', 'import']))
  })

  it.each(['new-note', 'templates', 'import'])('"%s" with no box: no anchor, so the step is skipped', (anchor) => {
    page()
    expect(document.querySelector(`[data-tour="${anchor}"]`)).not.toBeNull()   // present...
    expect(anchorFor(anchor)).toBeNull()                                         // ...but not on screen
  })

  it('CONTROL: a step whose anchor has a box is kept', () => {
    page()
    expect(anchorFor('view-switcher')).not.toBeNull()
  })
})
