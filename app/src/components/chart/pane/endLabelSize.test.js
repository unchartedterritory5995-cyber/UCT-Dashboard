// The line-end tag's box, read once per element and text (chart/pane/endLabelSize.js): the same box for the same text,
// a new read for a new text, after the fonts load or a window resize, and never a kept zero.
import { describe, it, expect, beforeEach } from 'vitest'
import { createEndLabelSizer, invalidateEndLabelSizes } from './endLabelSize'

let reads
function tag(w = 40, h = 16) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'offsetWidth', { configurable: true, get() { reads += 1; return w } })
  Object.defineProperty(el, 'offsetHeight', { configurable: true, get() { return h } })
  return el
}
beforeEach(() => { reads = 0 })

describe('endLabelSize: the tag\'s box, read once per text', () => {
  it('S1 the same text is read once; S2 a new text is read again', () => {
    const size = createEndLabelSizer()
    const el = tag()
    expect(size(el, 'RS 94')).toMatchObject({ w: 40, h: 16 })
    expect(size(el, 'RS 94')).toMatchObject({ w: 40, h: 16 })
    expect(reads).toBe(1)
    size(el, 'RS 95')
    expect(reads).toBe(2)
  })
  it('S3 a zero box (an element not laid out) is never kept', () => {
    const size = createEndLabelSizer()
    const el = tag(0, 0)
    size(el, 'RS 94'); size(el, 'RS 94')
    expect(reads).toBe(2)
  })
  it('S4 a window resize (a browser zoom) or the fonts loading reads every box again', () => {
    const size = createEndLabelSizer()
    const el = tag()
    size(el, 'RS 94')
    window.dispatchEvent(new Event('resize'))
    size(el, 'RS 94')
    expect(reads).toBe(2)
    invalidateEndLabelSizes()
    size(el, 'RS 94')
    expect(reads).toBe(3)
  })
  it('S6 a document-level token change (the root\'s data-theme, class or style) reads every box again', async () => {
    const size = createEndLabelSizer()
    const el = tag()
    size(el, 'RS 94')
    document.documentElement.setAttribute('data-theme', 'light')
    await Promise.resolve()                                    // the observer's callback is a microtask
    size(el, 'RS 94')
    expect(reads).toBe(2)
    document.documentElement.removeAttribute('data-theme')
  })
  it('S5 each element keeps its own box', () => {
    const size = createEndLabelSizer()
    const a = tag(40), z = tag(52)
    expect(size(a, 'RS 94').w).toBe(40)
    expect(size(z, 'RS 94').w).toBe(52)
    expect(reads).toBe(2)
  })
})
