import { describe, it, expect } from 'vitest'
import { parseColor, luminance, dividerFor, panelFor } from './dividerColor'

// Gridlines/hairlines were authored as fixed near-white and vanish on a light canvas.
// dividerFor picks the contrasting side. The null return is load-bearing: it means
// "leave the existing hardcoded divider alone" rather than guessing a color.

describe('parseColor', () => {
  it('handles the forms the canvas pickers produce', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255])
    expect(parseColor('#0e0f0d')).toEqual([14, 15, 13])
    expect(parseColor('#1ae51a47')).toEqual([26, 229, 26])   // 8-digit: alpha ignored
    expect(parseColor('rgb(10, 92, 34)')).toEqual([10, 92, 34])
    expect(parseColor('rgba(10, 92, 34, 0.5)')).toEqual([10, 92, 34])
    expect(parseColor('  #EAF1FA  ')).toEqual([234, 241, 250])
  })

  it('returns null for anything it cannot read', () => {
    for (const bad of [null, undefined, 42, {}, '', 'red', 'var(--bg)',
                       'linear-gradient(to bottom, #fff, #000)', '#12', '#zzzzzz']) {
      expect(parseColor(bad)).toBeNull()
    }
  })
})

describe('dividerFor', () => {
  it('returns a DARK line on light canvases', () => {
    for (const c of ['#ffffff', '#eaf1fa', '#e8eff5', '#d7e6f2']) {
      expect(dividerFor(c)).toMatch(/^rgba\(0, 0, 0,/)
    }
  })

  it('returns a LIGHT line on dark canvases', () => {
    for (const c of ['#000000', '#0e0f0d', '#1a1c17', '#c41f2d']) {
      expect(dividerFor(c)).toMatch(/^rgba\(255, 255, 255,/)
    }
  })

  it('the strong variant carries more weight than the base on both sides', () => {
    const alpha = (s) => Number(/([\d.]+)\)$/.exec(s)[1])
    expect(alpha(dividerFor('#ffffff', { strong: true }))).toBeGreaterThan(alpha(dividerFor('#ffffff')))
    expect(alpha(dividerFor('#000000', { strong: true }))).toBeGreaterThan(alpha(dividerFor('#000000')))
  })

  it('weights dark-on-light more heavily than light-on-dark', () => {
    // Not symmetric on purpose — a dark hairline needs more alpha to read as the
    // same weight as a light one. If this ever flips, the light theme looks washed.
    const alpha = (s) => Number(/([\d.]+)\)$/.exec(s)[1])
    expect(alpha(dividerFor('#ffffff'))).toBeGreaterThan(alpha(dividerFor('#000000')))
  })

  it('returns null (keep the existing divider) when the color is unreadable', () => {
    expect(dividerFor('linear-gradient(to bottom, #fff, #000)')).toBeNull()
    expect(dividerFor(undefined)).toBeNull()
  })

  it('splits on perceived luminance, not raw brightness', () => {
    // Pure green is far brighter to the eye than pure blue at the same raw value.
    expect(luminance(parseColor('#00ff00'))).toBeGreaterThan(0.5)
    expect(luminance(parseColor('#0000ff'))).toBeLessThan(0.5)
    expect(dividerFor('#00ff00')).toMatch(/^rgba\(0, 0, 0,/)
    expect(dividerFor('#0000ff')).toMatch(/^rgba\(255, 255, 255,/)
  })
})

describe('panelFor', () => {
  it('reproduces the hardcoded range-bar background on the default canvas', () => {
    // rgba(14, 15, 13, ...) IS #0e0f0d — the literal the stylesheet used to hardcode.
    // If this drifts, the default dark chart silently changes appearance.
    expect(panelFor('#0e0f0d').bg).toBe('rgba(14, 15, 13, 0.88)')
    expect(panelFor('#0e0f0d').bgSoft).toBe('rgba(14, 15, 13, 0.62)')
  })

  it('tints the panel with the canvas, so a light canvas gets a light panel', () => {
    expect(panelFor('#ffffff').bg).toBe('rgba(255, 255, 255, 0.88)')
    expect(panelFor('#eaf1fa').bg).toBe('rgba(234, 241, 250, 0.88)')
  })

  it('flips text, border and hover on a light canvas', () => {
    const dark = panelFor('#0e0f0d')
    const light = panelFor('#eaf1fa')
    expect(dark.text).toBe('#8a8578')          // original muted tan
    expect(dark.textStrong).toBe('#e2dfd6')    // original near-white hover
    expect(light.text).not.toBe(dark.text)
    expect(light.textStrong).not.toBe(dark.textStrong)
    expect(light.border).toMatch(/^rgba\(0, 0, 0,/)
    expect(dark.border).toMatch(/^rgba\(255, 255, 255,/)
    expect(light.hover).toMatch(/^rgba\(0, 0, 0,/)
  })

  it('keeps the panel more opaque than its soft variant', () => {
    const p = panelFor('#123456')
    const a = (s) => Number(/([\d.]+)\)$/.exec(s)[1])
    expect(a(p.bg)).toBeGreaterThan(a(p.bgSoft))
  })

  it('returns null on an unparseable canvas (keep the hardcoded values)', () => {
    expect(panelFor('linear-gradient(to bottom, #fff, #000)')).toBeNull()
    expect(panelFor(null)).toBeNull()
  })
})
