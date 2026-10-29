// The chart legend's neutral text follows the CANVAS it is drawn on, never the app theme.
//
// Measured in WebKit (2026-10-28, hub + popup, all /api mocked): with `header.colors.legend`
// UNSET (a member who never applied a /charts theme) the legend took the app's `--text-*`
// tokens, while the canvas behind it is painted from chart_settings (default #17181a). Light app
// theme: the date `rgb(87,96,106)` at 0.82 over the canvas pixel rgb(23,24,26) = 2.28:1. The
// O/H/L/C keys and values had the same fault, and they ignored the member's legend colour too
// (only the field wrapper wore it; the key and value spans set their own colour).
//
// One authority: `legendInkForCanvas` (chartThemes.js), which applyThemeToSettings stores as
// header.colors.legend and StockChart falls back to. These rails pin the rule, its reach, and
// what it buys in contrast; the control shows the old fallback failing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHART_THEMES, applyThemeToSettings, legendInkForCanvas, LEGEND_INK_ON_DARK, LEGEND_INK_ON_LIGHT } from './chartThemes'
import { CHART_DEFAULTS, PRESETS } from './chartDefaults'
import { allThemes, parseColor, resolveVars } from '../../pages/terminal/a11y/__tests__/terminalContrast'
import { contrast, composite, hexRgb } from '../../styles/__tests__/contrastMath'

const SRC = join(process.cwd(), 'src')
const read = (p) => readFileSync(join(SRC, p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const STOCK_CSS = strip(read('components/StockChart.module.css'))
const ROW_CSS = strip(read('components/chart/legend/LegendRow.module.css'))
const CHIP_CSS = strip(read('components/chart/legend/IndicatorChip.module.css'))
const STOCK_JSX = read('components/StockChart.jsx')

/** The `color` a top-level rule whose selector is exactly `sel` declares (last wins), or null. */
function colorOf(css, sel) {
  let out = null
  for (const [, sels, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (sels.trim() !== sel) continue
    const m = [...body.matchAll(/(?:^|;)\s*color\s*:\s*([^;]+)/g)].pop()
    if (m) out = m[1].trim()
  }
  return out
}

// Every canvas the catalogue can put behind the legend: each theme's solid bg, or its gradient's
// top (the crosshair legend) and bottom (the volume strip and the pane legends sit ~80% down).
const CANVASES = [
  ...CHART_THEMES.flatMap((t) => (t.bgGradient ? [t.bgGradient.top, t.bgGradient.bottom] : [t.bg])).filter(Boolean),
  CHART_DEFAULTS.background,
  ...Object.values(PRESETS).map((p) => p.background).filter(Boolean),
  '#000000', '#ffffff',
]
// What the legend draws the ink at: values at 1, the date at .82, the keys at .72, the muted rows
// at the published 0.72 alpha.
const STEPS = [1, 0.82, 0.72]

describe('legendInkForCanvas: the one rule', () => {
  it('agrees with the old luminance split on every catalogued theme (no applied theme changes)', () => {
    const oldSplit = (hex) => {
      const n = parseInt(hex.slice(1), 16)
      const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
      return l > 0.6 ? '#1c2128' : '#d6d8dd'
    }
    for (const t of CHART_THEMES) {
      const bg = t.bgGradient ? t.bgGradient.top : t.bg
      if (!bg) continue
      expect(legendInkForCanvas(bg), t.id).toBe(oldSplit(bg))
      if (!t.legend) expect(applyThemeToSettings({}, t).header.colors.legend, t.id).toBe(legendInkForCanvas(bg))
    }
  })

  it('clears 4.5:1 on every catalogued canvas, at every step the legend draws it at', () => {
    for (const bg of CANVASES) {
      const c = hexRgb(bg)
      const ink = hexRgb(legendInkForCanvas(bg))
      for (const a of STEPS) expect(contrast(composite(ink, a, c), c), `${bg} @${a}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('always picks the better of its two inks (a mid-grey canvas a member can pick)', () => {
    for (let v = 0; v <= 255; v += 5) {
      const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`
      const c = hexRgb(hex)
      const chosen = contrast(hexRgb(legendInkForCanvas(hex)), c)
      const other = contrast(hexRgb(legendInkForCanvas(hex) === LEGEND_INK_ON_DARK ? LEGEND_INK_ON_LIGHT : LEGEND_INK_ON_DARK), c)
      expect(chosen, hex).toBeGreaterThanOrEqual(other)
    }
    // the case the old split got wrong
    expect(legendInkForCanvas('#959595')).toBe(LEGEND_INK_ON_LIGHT)
    expect(contrast(hexRgb(LEGEND_INK_ON_DARK), hexRgb('#959595'))).toBeLessThan(2.2)
    expect(contrast(hexRgb(LEGEND_INK_ON_LIGHT), hexRgb('#959595'))).toBeGreaterThan(5.3)
    // the other spellings a canvas can arrive in
    expect(legendInkForCanvas('#fff')).toBe(LEGEND_INK_ON_LIGHT)
    expect(legendInkForCanvas('rgb(255, 255, 255)')).toBe(LEGEND_INK_ON_LIGHT)
    expect(legendInkForCanvas('nonsense')).toBe(LEGEND_INK_ON_DARK)
  })
})

describe('the legend reads it: every neutral legend text rule, and StockChart publishes it', () => {
  const RULES = [
    // (the volume strip and pane legend rows read the same names: their containers re-point them
    // to the LOW sample, railed below)
    [STOCK_CSS, '.legend', '--legend-ink', 'var(--text-muted)'],
    [STOCK_CSS, '.legendTime', '--legend-ink', 'var(--text)'],
    [STOCK_CSS, '.legendLabel', '--legend-ink', 'var(--text)'],
    [STOCK_CSS, '.legendVal', '--legend-ink', 'var(--text-bright)'],
    [STOCK_CSS, '.barDate', '--legend-ink', 'var(--text-muted)'],
    [STOCK_CSS, '.barKey', '--legend-ink', 'var(--text-muted)'],
    [STOCK_CSS, '.barVal', '--legend-ink', 'var(--text-bright)'],
    [STOCK_CSS, '.volLegLabel', '--legend-ink', 'var(--text)'],
    [STOCK_CSS, '.volLegVal', '--legend-ink', 'var(--text-bright)'],
    [STOCK_CSS, '.vlLabel', '--legend-ink', 'var(--text)'],
    [STOCK_CSS, '.vlVal', '--legend-ink', 'var(--text-bright)'],
    [STOCK_CSS, '.paneLegendTitle', '--legend-ink', 'var(--text-bright)'],
    [STOCK_CSS, '.paneLegendNote', '--legend-ink-muted', 'var(--text-muted)'],
    [ROW_CSS, '.vLabel', '--legend-ink-muted', 'var(--text-muted)'],
    [ROW_CSS, '.vVal, .flatVal', '--legend-ink', 'var(--text-bright)'],
    [CHIP_CSS, '.chipGridLabel', '--legend-ink-muted', 'var(--text-muted)'],
    [CHIP_CSS, '.chipGridVal', '--legend-ink', 'var(--text-bright)'],
  ]
  it.each(RULES)('%#: %s', (css, sel, ink, token) => {
    // the canvas ink, with the old token as the fallback OUTSIDE a chart (a portaled menu row)
    expect(colorOf(css, sel), sel).toBe(`var(${ink}, ${token})`)
  })

  it('the volume strip and the pane legends re-point the rows inside them to the LOW sample', () => {
    const m = /\.volLegend, \.paneLegend \{([^}]*)\}/.exec(STOCK_CSS)
    expect(m).not.toBeNull()
    expect(m[1]).toMatch(/--legend-ink:\s*var\(--legend-ink-low\)/)
    expect(m[1]).toMatch(/--legend-ink-muted:\s*var\(--legend-ink-low-muted\)/)
  })

  it('StockChart derives the inks from the canvas samples with the one rule, never a literal', () => {
    expect(STOCK_JSX).toMatch(/import \{ legendInkForCanvas \} from '\.\/chart\/chartThemes'/)
    expect(STOCK_JSX).toMatch(/const inkTop = legendInkForCanvas\(solidTop\)/)
    expect(STOCK_JSX).toMatch(/const inkLow = legendInkForCanvas\(solidLow\)/)
    expect(STOCK_JSX).toMatch(/'--legend-ink': inkTop,/)
    expect(STOCK_JSX).toMatch(/'--legend-ink-low': inkLow,/)
    // published even when the panel tokens are not (an unparseable canvas still gets an ink)
    expect(STOCK_JSX).toMatch(/if \(!p\) return legendInkVars/)
    // the base fields: the member's colour when set, else the canvas ink, and the spans inside follow
    expect(STOCK_JSX).toMatch(/const _legInk = legendColor \|\| legendInkForCanvas\(canvasSample\.top\)/)
    expect(STOCK_JSX).toMatch(/const legBase = \{ color: _legInk, '--legend-ink': _legInk,/)
    expect(STOCK_JSX).not.toMatch(/const legBase = legendColor \?/)
  })
})

describe('CONTROL: the old fallback (the app tokens) fails on the default canvas', () => {
  it('light app theme over the default dark canvas: the date at 0.82 reads under 4.5:1 (2.28 measured)', () => {
    const themes = allThemes()
    const canvas = hexRgb(CHART_DEFAULTS.background)
    const muted = parseColor(resolveVars('var(--text-muted)', themes.light)).rgb
    const old = contrast(composite(muted, 0.82, canvas), canvas)
    expect(old).toBeLessThan(4.5)
    expect(old).toBeCloseTo(2.28, 1)
    // and the value token too: the light theme's --text-bright is dark ink on a dark canvas
    const bright = parseColor(resolveVars('var(--text-bright)', themes.light)).rgb
    expect(contrast(bright, canvas)).toBeLessThan(4.5)
    // while the canvas ink clears it at the same step
    const ink = hexRgb(legendInkForCanvas(CHART_DEFAULTS.background))
    expect(contrast(composite(ink, 0.82, canvas), canvas)).toBeGreaterThanOrEqual(4.5)
  })
})
