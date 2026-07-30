import { describe, it, expect } from 'vitest'
import { parseColor, luminance, dividerFor, panelFor, toolbarFor, sampleGradient, menuThemeVars, MENU_THEME } from './dividerColor'

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

describe('toolbarFor', () => {
  it('reproduces the original dark button colors on the default canvas', () => {
    // Was hardcoded #1a1c17 / #2e3127. The derived step lands within a hair of both,
    // so the default dark chart is visually unchanged.
    expect(toolbarFor('#0e0f0d').bg).toBe('rgb(26, 27, 25)')       // ≈ #1a1b19
    expect(toolbarFor('#0e0f0d').bgHover).toBe('rgb(45, 46, 44)')  // ≈ #2d2e2c
  })

  it('steps AWAY from the canvas — lighter on dark, darker on light', () => {
    const lum = (s) => {
      const [r, g, b] = /rgb\((\d+), (\d+), (\d+)\)/.exec(s).slice(1).map(Number)
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    }
    // Dark canvas: button is brighter than the canvas.
    expect(lum(toolbarFor('#0e0f0d').bg)).toBeGreaterThan(luminance(parseColor('#0e0f0d')))
    // Light canvas: button is darker. This is the whole point — a fixed "one step
    // up" would glow on white.
    expect(lum(toolbarFor('#ffffff').bg)).toBeLessThan(luminance(parseColor('#ffffff')))
    expect(lum(toolbarFor('#eaf1fa').bg)).toBeLessThan(luminance(parseColor('#eaf1fa')))
  })

  it('hover is a bigger step than idle, in the same direction', () => {
    const lum = (s) => {
      const [r, g, b] = /rgb\((\d+), (\d+), (\d+)\)/.exec(s).slice(1).map(Number)
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    }
    const dark = toolbarFor('#0e0f0d')
    const light = toolbarFor('#ffffff')
    expect(lum(dark.bgHover)).toBeGreaterThan(lum(dark.bg))
    expect(lum(light.bgHover)).toBeLessThan(lum(light.bg))
  })

  it('keeps the button tinted by the canvas rather than neutral grey', () => {
    // A red canvas gets a red-tinted button, not a grey one.
    expect(toolbarFor('#c41f2d').bg).toBe('rgb(199, 42, 56)')
  })

  it('flips the icon colors for a light canvas', () => {
    expect(toolbarFor('#0e0f0d').text).toBe('#a8a290')      // original
    expect(toolbarFor('#0e0f0d').textHover).toBe('#e2dfd6') // original
    expect(toolbarFor('#ffffff').text).not.toBe('#a8a290')
    expect(toolbarFor('#ffffff').textHover).not.toBe('#e2dfd6')
  })

  it('returns null on an unparseable canvas', () => {
    expect(toolbarFor('linear-gradient(to bottom, #fff, #000)')).toBeNull()
  })
})

describe('sampleGradient', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    expect(sampleGradient('#000000', '#ffffff', 0)).toBe('rgb(0, 0, 0)')
    expect(sampleGradient('#000000', '#ffffff', 1)).toBe('rgb(255, 255, 255)')
  })

  it('interpolates between the stops', () => {
    expect(sampleGradient('#000000', '#ffffff', 0.5)).toBe('rgb(128, 128, 128)')
  })

  it('samples a navy->white ramp near the bottom as LIGHT', () => {
    // The reported case: chrome at ~80% down sat as a dark slab on a near-white area.
    const low = sampleGradient('#16233b', '#ffffff', 0.8)
    expect(luminance(parseColor(low))).toBeGreaterThan(0.5)
    expect(dividerFor(low)).toMatch(/^rgba\(0, 0, 0,/)   // → dark hairline, visible
  })

  it('clamps t outside 0..1', () => {
    expect(sampleGradient('#000000', '#ffffff', -1)).toBe('rgb(0, 0, 0)')
    expect(sampleGradient('#000000', '#ffffff', 2)).toBe('rgb(255, 255, 255)')
  })

  it('returns null if either stop is unparseable', () => {
    expect(sampleGradient('#000000', 'nope', 0.5)).toBeNull()
    expect(sampleGradient(null, '#ffffff', 0.5)).toBeNull()
  })
})


describe('menuThemeVars — one fixed palette, canvas-invariant', () => {
  // Owner decision 2026-07-30: menu chrome is app identity, so a popup looks the
  // same on EVERY layout. These tests are the rail against a future "helpful"
  // reintroduction of canvas-derived menus.
  const CANVASES = [
    ['default dark', '#0e0f0d'],
    ['OLED black', '#000000'],
    ['white', '#ffffff'],
    ['sunset light-blue', '#eaf3fb'],
    ['saturated green', '#0e5a1a'],
    ['unparseable', 'var(--whatever)'],
    ['null', null],
  ]

  it.each(CANVASES)('%s canvas yields the identical palette', (_label, canvas) => {
    expect(menuThemeVars(canvas)).toEqual(MENU_THEME)
  })

  it('never returns null — a menu must never fall through to a stylesheet guess', () => {
    for (const [, canvas] of CANVASES) expect(menuThemeVars(canvas)).not.toBeNull()
  })

  it('ignores the gradient option entirely and emits no --menu-surface', () => {
    const v = menuThemeVars('#0e5a1a', { gradient: { top: '#0e5a1a', bottom: '#001e5a' }, alpha: 0.55 })
    expect(v['--menu-surface']).toBeUndefined()
    expect(v).toEqual(MENU_THEME)
  })

  it('is a dark, gold-accented, opaque palette', () => {
    const v = menuThemeVars('#ffffff')
    expect(luminance(parseColor(v['--menu-bg']))).toBeLessThan(0.15)  // dark on a white canvas too
    expect(v['--menu-bg']).toMatch(/^#/)                              // opaque hex, never rgba/gradient
    expect(v['--menu-accent']).toBe('#c9a84c')
    expect(v['--menu-text']).toBe('#ededed')
  })

  it('hands back a fresh object so a caller cannot mutate the shared palette', () => {
    const v = menuThemeVars('#0e0f0d')
    v['--menu-bg'] = '#ff0000'
    expect(menuThemeVars('#0e0f0d')['--menu-bg']).toBe(MENU_THEME['--menu-bg'])
  })
})
