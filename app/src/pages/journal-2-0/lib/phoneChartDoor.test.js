// Tier 4 fix round 1 (review 1 and 4): the phone chart's full-screen link is the editor's to IGNORE and the
// archive's to DROP. `widgetEmbedStopEvent` returns true for any event inside `[data-phone-chart-open]`, so
// ProseMirror never selects or focuses the block on the way out of the note; `captureElementPng` rasterises with
// a filter that drops every `[data-archive-exclude]` subtree.
import { describe, it, expect, vi } from 'vitest'

const blob = vi.hoisted(() => ({ calls: [] }))
vi.mock('modern-screenshot', () => ({ domToBlob: vi.fn(async (el, opts) => { blob.calls.push({ el, opts }); return 'png' }) }))

import { widgetEmbedStopEvent } from './widgetEmbedNode'
import { captureElementPng, keepInArchive } from './embedArchive'

function chartBody() {
  const body = document.createElement('div')
  body.setAttribute('data-widget-embed-body', '')
  const canvas = document.createElement('canvas')
  const link = document.createElement('a')
  link.setAttribute('data-phone-chart-open', '')
  link.setAttribute('data-archive-exclude', '')
  const pill = document.createElement('span')
  link.appendChild(pill)
  body.append(canvas, link)
  document.body.appendChild(body)
  return { body, canvas, link, pill }
}

describe('the editor ignores taps on the full-screen link', () => {
  for (const type of ['mousedown', 'touchstart', 'pointerdown', 'click', 'mouseup']) {
    it(`${type} on the link (or the pill inside it) is the link's own`, () => {
      const { pill, link } = chartBody()
      expect(widgetEmbedStopEvent({ event: { type, target: pill } })).toBe(true)
      expect(widgetEmbedStopEvent({ event: { type, target: link } })).toBe(true)
    })
  }

  it('CONTROL: a mousedown on the chart body outside Draw still selects the block', () => {
    const { canvas } = chartBody()
    expect(widgetEmbedStopEvent({ event: { type: 'mousedown', target: canvas } })).toBe(false)
  })

  it('a drag that starts on the link is still the editor\'s (the block can be dragged)', () => {
    const { link } = chartBody()
    expect(widgetEmbedStopEvent({ event: { type: 'dragstart', target: link } })).toBe(false)
  })
})

describe('the archive raster drops device chrome', () => {
  it('keepInArchive drops a marked element and keeps everything else', () => {
    const { link, canvas, pill } = chartBody()
    expect(keepInArchive(link)).toBe(false)
    expect(keepInArchive(canvas)).toBe(true)
    expect(keepInArchive(pill)).toBe(true) // its parent is dropped, so it never reaches the raster
    expect(keepInArchive(document.createTextNode('x'))).toBe(true)
  })

  it('captureElementPng hands domToBlob that filter', async () => {
    const { body } = chartBody()
    blob.calls.length = 0
    await captureElementPng(body)
    expect(blob.calls).toHaveLength(1)
    expect(blob.calls[0].opts.filter).toBe(keepInArchive)
  })
})
