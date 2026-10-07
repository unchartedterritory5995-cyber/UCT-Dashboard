// app/src/pages/breadth/heatTiles.contrast.test.js
//
// RAIL: the Breadth treemap's tiles follow the member's theme AND stay readable. For every one
// of the 21 app themes (dark, oled, light + the 18 catalog themes, derived — never typed — from
// tokens.css + styles/appThemes.js by the terminal contrast rail's own reader), every tier's
// tile is built by the SAME function TreemapView calls (heatTileInks) from that theme's resolved
// tokens, and its label and value text must clear WCAG AA 4.5:1 on the tile.
//
// It also pins the two halves of the owner ruling that a contrast check alone cannot see:
//   • the text IS the theme's ink (--text / --text-muted), not a fixed white nudged into place;
//   • the HEAT MEANING survives: a stronger tier is a stronger tint of the ground, on light
//     themes as on dark ones.
import { describe, it, expect } from 'vitest'
import { allThemes, resolveVars, parseColor } from '../terminal/a11y/__tests__/terminalContrast'
import { contrast, composite } from '../../styles/__tests__/contrastMath'
import { APP_THEMES } from '../../styles/appThemes'
import { heatTileInks, compositeInk, parseInk, TIER_HEAT_TOKEN } from './heatTiles'

const THEMES = allThemes()
const TIERS = Object.keys(TIER_HEAT_TOKEN)

/** A token as a plain rgba() string, the form useThemeInk hands a canvas. */
function ink(vars, token) {
  const c = parseColor(resolveVars(`var(${token})`, vars))
  return `rgba(${c.rgb.map(Math.round).join(', ')}, ${c.alpha})`
}
/** The theme's opaque page ground (a translucent token composited onto black, as the rail does). */
function ground(vars) {
  const c = parseColor(resolveVars('var(--bg)', vars))
  const rgb = c.alpha >= 1 ? c.rgb.map(Math.round) : composite(c.rgb, c.alpha, [0, 0, 0])
  return `rgb(${rgb.join(', ')})`
}
function themeInks(vars) {
  const bg = ground(vars)
  return {
    bg,
    surface: compositeInk(ink(vars, '--bg-surface'), bg),
    text: compositeInk(ink(vars, '--text'), bg),
    muted: compositeInk(ink(vars, '--text-muted'), bg),
    heat: Object.fromEntries(TIERS.map((t) => [t, ink(vars, TIER_HEAT_TOKEN[t])])),
  }
}
const rgbOf = (c) => parseInk(c).rgb
const ratio = (a, b) => contrast(rgbOf(a), rgbOf(b))
const dist = (a, b) => Math.hypot(...rgbOf(a).map((v, i) => v - rgbOf(b)[i]))

const ROWS = Object.entries(THEMES).flatMap(([theme, vars]) => {
  const i = themeInks(vars)
  return [...TIERS, ''].map((tier) => ({ theme, tier: tier || 'none', i, ...heatTileInks(tier, i) }))
})

describe('Breadth treemap tiles — theme-following, readable in all 21 themes', () => {
  it('measures every theme and every tier (non-vacuity)', () => {
    expect(Object.keys(THEMES)).toHaveLength(3 + APP_THEMES.length)
    expect(APP_THEMES.length).toBe(18)
    expect(ROWS).toHaveLength(21 * 8)
    expect(TIERS).toEqual(['g3', 'g2', 'g1', 'a', 'r1', 'r2', 'r3'])
  })

  it('value and label text clear 4.5:1 on their own tile, every theme × tier', () => {
    const fails = ROWS.flatMap((r) => [
      ['value', r.value], ['label', r.label],
    ].filter(([, c]) => ratio(c, r.fill) < 4.5)
      .map(([k, c]) => `${r.theme} ${r.tier} ${k} ${c} on ${r.fill}: ${ratio(c, r.fill).toFixed(2)}`))
    expect(fails).toEqual([])
  })

  it('the text is the THEME\'s ink — --text for values, --text-muted or --text for labels — never nudged', () => {
    const off = ROWS.filter((r) => r.value !== r.i.text || (r.label !== r.i.muted && r.label !== r.i.text))
      .map((r) => `${r.theme} ${r.tier}: value ${r.value} (text ${r.i.text}) label ${r.label}`)
    expect(off).toEqual([])
  })

  it('a tile is the theme\'s ground tinted by the heat ladder: light themes get light tiles', () => {
    for (const [theme, vars] of Object.entries(THEMES)) {
      const i = themeInks(vars)
      const lightGround = contrast(rgbOf(i.bg), [255, 255, 255]) < contrast(rgbOf(i.bg), [0, 0, 0])
      for (const t of TIERS) {
        const fill = heatTileInks(t, i).fill
        const lightTile = contrast(rgbOf(fill), [255, 255, 255]) < contrast(rgbOf(fill), [0, 0, 0])
        expect(lightTile, `${theme} ${t}: tile ${fill} on ground ${i.bg}`).toBe(lightGround)
      }
    }
  })

  it('the heat meaning holds: a stronger tier is a stronger tint, both directions, every theme', () => {
    for (const [theme, vars] of Object.entries(THEMES)) {
      const i = themeInks(vars)
      const d = (t) => dist(heatTileInks(t, i).fill, i.bg)
      expect(d('g1'), `${theme} g1<g2`).toBeLessThan(d('g2'))
      expect(d('g2'), `${theme} g2<g3`).toBeLessThan(d('g3'))
      expect(d('r1'), `${theme} r1<r2`).toBeLessThan(d('r2'))
      expect(d('r2'), `${theme} r2<r3`).toBeLessThan(d('r3'))
      // and bull reads green, bear reads red
      const [gr, gg] = rgbOf(heatTileInks('g3', i).fill)
      const [rr, rg] = rgbOf(heatTileInks('r3', i).fill)
      expect(gg, `${theme} g3 is green`).toBeGreaterThan(gr)
      expect(rr, `${theme} r3 is red`).toBeGreaterThan(rg)
    }
  })

  it('CONTROL: the check SEES an unreadable pairing (ink equal to the ground fails)', () => {
    const i = themeInks(THEMES.dark)
    expect(ratio(i.bg, heatTileInks('g1', i).fill)).toBeLessThan(4.5)
    // and the function itself refuses it: a ground-coloured --text is nudged, not shipped
    const bad = heatTileInks('g1', { ...i, text: i.bg, muted: i.bg })
    expect(bad.value).not.toBe(i.bg)
    expect(ratio(bad.value, bad.fill)).toBeGreaterThanOrEqual(4.5)
  })

  it('compositeInk lays a translucent ink over an opaque ground', () => {
    expect(compositeInk('rgba(255, 0, 0, 0.5)', '#000000')).toBe('#800000')
    expect(compositeInk('#123456', '#ffffff')).toBe('#123456')
    expect(compositeInk('rgba(0, 0, 0, 0)', 'rgb(10, 20, 30)')).toBe('#0a141e')
  })
})
