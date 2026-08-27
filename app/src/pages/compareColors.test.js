import { describe, it, expect } from 'vitest'
import { COMPARE_COLORS } from './ChartRender'
import { CHART_DEFAULTS } from '../components/chart/chartDefaults'
import { SESSION_EXT_COLOR } from '../components/StockChart'

// A comparison line must never be mistaken for one of the chart's own lines.
// The first palette had #f472b6 for the second comparison — the house EMA-20's
// exact colour — so a two-symbol compare drew two pink lines (seen on the pod's
// render, 2026-08-26). This measures separation against the palette the app
// ACTUALLY draws rather than a list typed here, so a house recolour that crowds
// a comparison colour fails this test instead of shipping.

const hexes = (o, out = new Set()) => {
  if (typeof o === 'string') { if (/^#[0-9a-f]{6}$/i.test(o)) out.add(o.toLowerCase()); return out }
  if (Array.isArray(o)) { o.forEach(v => hexes(v, out)); return out }
  if (o && typeof o === 'object') { Object.values(o).forEach(v => hexes(v, out)); return out }
  return out
}
const toHsl = (hex) => {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return [((h * 60) + 360) % 360, l * 100, s * 100]
}
const dist = (a, b) => {
  const [ha, la, sa] = toHsl(a), [hb, lb, sb] = toHsl(b)
  const dh = Math.min(Math.abs(ha - hb), 360 - Math.abs(ha - hb))
  return Math.round(Math.hypot(dh * 1.6, la - lb, (sa - sb) * 0.5))
}
const MIN_SEPARATION = 40

describe('comparison line colours', () => {
  const house = [...hexes({ ...CHART_DEFAULTS, ext: SESSION_EXT_COLOR })]

  it('reads a real palette to measure against', () => {
    expect(house.length).toBeGreaterThan(8)
    expect(house).toContain('#f472b6')          // the EMA-20 that the first palette collided with
    expect(house).toContain('#60a5fa')
  })

  it('keeps every comparison colour clear of every colour the house chart draws', () => {
    for (const c of COMPARE_COLORS) {
      const [nearest] = house.map(h => [dist(c, h), h]).sort((a, b) => a[0] - b[0])
      expect(`${c} vs ${nearest[1]} = ${nearest[0]}`).toBe(`${c} vs ${nearest[1]} = ${nearest[0]}`)
      expect(nearest[0]).toBeGreaterThanOrEqual(MIN_SEPARATION)
    }
  })

  it('keeps the comparison colours clear of EACH OTHER', () => {
    for (let i = 0; i < COMPARE_COLORS.length; i++) {
      for (let j = i + 1; j < COMPARE_COLORS.length; j++) {
        expect(dist(COMPARE_COLORS[i], COMPARE_COLORS[j])).toBeGreaterThanOrEqual(MIN_SEPARATION)
      }
    }
  })

  it('would have failed the palette that shipped first', () => {
    const first = ['#38bdf8', '#f472b6', '#a3e635']
    const worst = Math.min(...first.map(c => Math.min(...house.map(h => dist(c, h)))))
    expect(worst).toBeLessThan(MIN_SEPARATION)   // the control: this test can fail
  })
})
