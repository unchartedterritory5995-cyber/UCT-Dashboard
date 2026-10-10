// requestReveal (phone pass follow-up, 2026-10-10): a tour asks the region hiding its anchor to
// open. It asks ONLY for an anchor that exists, is not on screen, and sits inside a region marked
// data-tour-reveal -- never for one already visible, one with no region, or one that is absent.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { requestReveal, TOUR_REVEAL_EVENT } from './tourAnchorVisibility'

const heard = () => {
  const got = []
  const fn = (e) => got.push(e.detail)
  window.addEventListener(TOUR_REVEAL_EVENT, fn)
  return { got, off: () => window.removeEventListener(TOUR_REVEAL_EVENT, fn) }
}
afterEach(() => { document.body.innerHTML = '' })

describe('requestReveal', () => {
  it('an off-screen anchor inside a reveal region asks THAT region, naming the anchor', () => {
    document.body.innerHTML = '<div data-tour-reveal="notebook-sidebar"><input data-tour="search"></div>'
    const h = heard()
    expect(requestReveal('search')).toBe(true)
    expect(h.got).toEqual([{ region: 'notebook-sidebar', anchor: 'search' }])
    h.off()
  })

  it('no region around the anchor: asks nobody', () => {
    document.body.innerHTML = '<input data-tour="search">'
    const h = heard()
    expect(requestReveal('search')).toBe(false)
    expect(h.got).toEqual([])
    h.off()
  })

  it('an absent anchor: asks nobody', () => {
    document.body.innerHTML = '<div data-tour-reveal="notebook-sidebar"></div>'
    const h = heard()
    expect(requestReveal('search')).toBe(false)
    expect(h.got).toEqual([])
    h.off()
  })

  it('an anchor already ON screen: asks nobody (CONTROL: the same markup as the first case)', () => {
    document.body.innerHTML = '<div data-tour-reveal="notebook-sidebar"><input data-tour="search"></div>'
    const el = document.querySelector('[data-tour="search"]')
    vi.spyOn(el, 'getClientRects').mockReturnValue([{}])
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 })
    const h = heard()
    expect(requestReveal('search')).toBe(false)
    expect(h.got).toEqual([])
    h.off()
  })
})
