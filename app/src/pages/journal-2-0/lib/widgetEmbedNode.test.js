// Wave 13 lane 13H-2 — the stopEvent predicate that keeps the chart's own
// drawing surface out of ProseMirror's click-to-select handling.
//
// Root cause (measured, not guessed): widgetEmbed is `atom: true,
// selectable: true`, so ProseMirror's own mousedown handling arms a mouseup
// listener that calls `view.focus()` on release — stealing focus back to
// the prose editor, which WidgetEmbedView reads as "exit Draw mode". The
// evidence (docs/notebook/evidence/wave13-13h2/walk-69473964d-run7)
// recorded the exact call stack: MouseDown.up -> selectClickedLeaf ->
// updateSelection -> view.focus(). See widgetEmbedNode.jsx's header comment
// on widgetEmbedStopEvent for the full mechanism.
//
// This is a pure DOM-event classifier (no editor, no DOM needed) — tested
// directly against plain objects shaped like the pieces it reads
// (`event.type`, `event.target.tagName`, `.isContentEditable`, `.closest`).
import { describe, it, expect } from 'vitest'
import { widgetEmbedStopEvent } from './widgetEmbedNode'

// A minimal DOM-event-shaped target. `closest` mimics Element.closest:
// returns itself (or a stand-in) when `selector` is in `matches`, else null.
function target({ tag = 'DIV', contentEditable = false, matches = [] } = {}) {
  return {
    tagName: tag,
    isContentEditable: contentEditable,
    closest: (selector) => (matches.includes(selector) ? {} : null),
  }
}

describe('widgetEmbedStopEvent — the 13H-2 draw-mode focus-steal fix', () => {
  it('stops a mousedown that lands on the chart body — the fix itself', () => {
    const t = target({ tag: 'CANVAS', matches: ['[data-widget-embed-body]'] })
    expect(widgetEmbedStopEvent({ event: { type: 'mousedown', target: t } })).toBe(true)
  })

  it('stops a mousedown on an SVG drawing handle inside the body (the exact evidence shape)', () => {
    // The walk's recorder captured the real offending target as
    // `circle.[object SVGAnimatedString][]` — an SVG <circle>, not a CANVAS.
    const t = target({ tag: 'circle', matches: ['[data-widget-embed-body]'] })
    expect(widgetEmbedStopEvent({ event: { type: 'mousedown', target: t } })).toBe(true)
  })

  it('does NOT stop a mousedown outside the body — unrelated chrome keeps the default click-to-select', () => {
    const t = target({ tag: 'DIV', matches: [] }) // not inside data-widget-embed-body
    expect(widgetEmbedStopEvent({ event: { type: 'mousedown', target: t } })).toBe(false)
  })

  it('still stops BUTTON/SELECT/TEXTAREA/INPUT clicks regardless of body membership (unchanged default)', () => {
    for (const tag of ['BUTTON', 'SELECT', 'TEXTAREA', 'INPUT']) {
      const outsideBody = target({ tag, matches: [] })
      expect(widgetEmbedStopEvent({ event: { type: 'mousedown', target: outsideBody } })).toBe(true)
      const insideBody = target({ tag, matches: ['[data-widget-embed-body]'] })
      expect(widgetEmbedStopEvent({ event: { type: 'mousedown', target: insideBody } })).toBe(true)
    }
  })

  it('still stops a contentEditable target (unchanged default)', () => {
    const t = target({ tag: 'DIV', contentEditable: true })
    expect(widgetEmbedStopEvent({ event: { type: 'mousedown', target: t } })).toBe(true)
  })

  it('leaves the drag/drop/clipboard family alone — unchanged default (false = let ProseMirror handle it)', () => {
    const t = target({ tag: 'DIV', matches: ['[data-widget-embed-body]'] })
    for (const type of ['dragstart', 'dragend', 'drop', 'copy', 'paste', 'cut']) {
      expect(widgetEmbedStopEvent({ event: { type, target: t } })).toBe(false)
    }
  })

  it('an input element dragging itself still defers to the drag/drop family, not the input passthrough', () => {
    const t = target({ tag: 'BUTTON', matches: [] })
    expect(widgetEmbedStopEvent({ event: { type: 'dragstart', target: t } })).toBe(false)
    expect(widgetEmbedStopEvent({ event: { type: 'drop', target: t } })).toBe(false)
  })

  it('stops anything else bubbling from inside the embed that is not one of the above (matches the vendor default fallthrough)', () => {
    const t = target({ tag: 'DIV', matches: [] })
    expect(widgetEmbedStopEvent({ event: { type: 'keydown', target: t } })).toBe(true)
  })

  it('a mouseup is never consulted by this predicate for the fix to work — stopping mousedown is sufficient', () => {
    // prosemirror-view's MouseDown.up (the call that fires view.focus()) is
    // wired directly on view.root the moment handlers.mousedown runs, and is
    // never re-gated through stopEvent on the matching mouseup. Documented
    // here so a future reader does not "helpfully" try to also special-case
    // mouseup and conclude this already-sufficient fix was incomplete.
    const t = target({ tag: 'CANVAS', matches: ['[data-widget-embed-body]'] })
    expect(widgetEmbedStopEvent({ event: { type: 'mouseup', target: t } })).toBe(true)
  })
})
