// uiconSvgString — a glyph's static <svg> markup, generated from the SAME
// registry <UIcon> draws, for surfaces that inject HTML strings (Morning Wire's
// rundown feedback controls). It replaces a hand-copied set of path data and the
// drift test that guarded it: there is no second copy left to drift.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import UIcon, { UICON_NAMES, uiconSvgString } from './UIcon'

const parse = (html) => {
  const host = document.createElement('div')
  host.innerHTML = html
  return host.querySelector('svg')
}

describe('uiconSvgString', () => {
  it('serialises EVERY registry glyph to exactly the shapes <UIcon gold={false}> renders', () => {
    expect(UICON_NAMES.length).toBeGreaterThan(50)   // non-vacuity: the registry is really walked
    for (const name of UICON_NAMES) {
      const rendered = render(<UIcon name={name} gold={false} size={14} />).container.querySelector('svg')
      const fromString = parse(uiconSvgString(name, { size: 14 }))
      expect(fromString, name).not.toBeNull()
      expect(fromString.innerHTML, name).toBe(rendered.innerHTML)
      for (const attr of ['width', 'height', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'aria-hidden', 'focusable']) {
        expect(fromString.getAttribute(attr), `${name} ${attr}`).toBe(rendered.getAttribute(attr))
      }
    }
  })

  it('the Morning Wire feedback glyphs come out stroked in currentColor, at the asked size, no emoji', () => {
    for (const name of ['thumbsUp', 'thumbsDown', 'edit']) {
      const html = uiconSvgString(name, { size: 14 })
      const svg = parse(html)
      expect(svg.getAttribute('stroke')).toBe('currentColor')
      expect(svg.getAttribute('width')).toBe('14')
      expect(svg.querySelectorAll('path').length).toBeGreaterThan(0)
      expect(html).not.toMatch(/[\u{1F44D}\u{1F44E}✎]/u)
    }
  })

  it('a title makes it an image with an accessible name, and the title is escaped', () => {
    const svg = parse(uiconSvgString('edit', { title: 'Add a <note> & "save"' }))
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-hidden')).toBeNull()
    expect(svg.querySelector('title').textContent).toBe('Add a <note> & "save"')
  })

  it('carries per-shape attributes through (camelCase props become SVG attributes)', () => {
    // ind-oscillator has a dimmed rule (opacity) and ind-momentum a heavier stroke.
    expect(uiconSvgString('ind-oscillator')).toContain('opacity="0.38"')
    expect(uiconSvgString('ind-momentum')).toContain('stroke-width="1.9"')
  })

  it('returns empty for an unknown glyph (control: the lookup can miss)', () => {
    expect(uiconSvgString('not-a-real-icon-xyz')).toBe('')
  })
})
