// @vitest-environment jsdom
// Finish program, lane FE (round 2, controller ruling on I7): a click on a chart block's body
// SELECTS the block, as it did before wave 13.
//
// Wave 13 lane 13H-2 (commit 0d11a14787) stopped every mousedown on the body from reaching the
// editor. Its reason was Draw mode: the editor's click-to-select refocuses the editor on mouseup,
// and the embed reads that focus as "done drawing", so Draw mode ended after the first mark. But
// the stop was unconditional, so it also took away click-to-select (then Delete, or drag to move)
// for every block, an archived image and a chart with no caption included, with every flag off.
//
// The rule now: the body is the editor's to select EXCEPT while the member is drawing on it
// (`data-widget-embed-body="draw"`, set by WidgetEmbedView while Draw mode is on). Controls inside
// the block (buttons, selects, inputs) always keep their own clicks.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { widgetEmbedStopEvent } from './widgetEmbedNode'

function embedWith(inner, { drawing = false } = {}) {
  const host = document.createElement('div')
  host.innerHTML = `<div data-widget-embed-view="chart"><div data-widget-embed-body="${drawing ? 'draw' : ''}">${inner}</div><div class="caption">cap</div></div>`
  document.body.appendChild(host)
  return host
}
const mousedownOn = (el) => ({ type: 'mousedown', target: el })
// false = "not mine: let the editor select the block"; true = "the block's own, keep out"
const stopped = (el) => widgetEmbedStopEvent({ event: mousedownOn(el) })

describe('I7 — clicking a chart block', () => {
  it('a click on an ARCHIVED IMAGE selects the block', () => {
    const host = embedWith('<img alt="AMD daily chart, archived" src="data:," />')
    expect(stopped(host.querySelector('img'))).toBe(false)
  })

  it('a click on a LIVE chart (canvas, no caption needed) selects the block', () => {
    const host = embedWith('<canvas></canvas>')
    expect(stopped(host.querySelector('canvas'))).toBe(false)
  })

  it('CONTROL — a click on a button, select or input inside the body acts on the control and never selects the block', () => {
    const host = embedWith('<button type="button">Log scale</button><select><option>D</option></select><input />')
    for (const sel of ['button', 'select', 'input']) expect(stopped(host.querySelector(sel))).toBe(true)
  })

  it('the reason 13H-2 exists still holds: while DRAWING, a press on the canvas or a drawing handle never reaches click-to-select', () => {
    const host = embedWith('<canvas></canvas><svg><circle r="4"></circle></svg>', { drawing: true })
    expect(stopped(host.querySelector('canvas'))).toBe(true)
    expect(stopped(host.querySelector('circle'))).toBe(true)
  })

  it('a click on the caption (outside the body) selects the block, drawing or not', () => {
    expect(stopped(embedWith('<canvas></canvas>').querySelector('.caption'))).toBe(false)
    expect(stopped(embedWith('<canvas></canvas>', { drawing: true }).querySelector('.caption'))).toBe(false)
  })

  it('copy, cut, paste and drag events are still the editor’s, from anywhere in the block', () => {
    const canvas = embedWith('<canvas></canvas>').querySelector('canvas')
    for (const type of ['copy', 'cut', 'paste', 'dragstart', 'drop']) {
      expect(widgetEmbedStopEvent({ event: { type, target: canvas } })).toBe(false)
    }
  })

  it('the wire: the embed marks its body "draw" exactly while Draw mode is on', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(resolve(here, '../components/notebook/WidgetEmbedView.jsx'), 'utf8')
    expect(src).toContain("data-widget-embed-body={annotate ? 'draw' : ''}")
  })
})
