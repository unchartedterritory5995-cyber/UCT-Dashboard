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
import { CHART_THEMES, applyThemeToSettings, legendInkForCanvas, legendCanvasRgb, legendTextContrast, LEGEND_INK_ON_DARK, LEGEND_INK_ON_LIGHT } from './chartThemes'
import { legendInkVars, LEGEND_ROLES } from './legendInk'
import { parseColor as parseColorRgb, parseColorAlpha } from '../../utils/dividerColor'
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
    [STOCK_CSS, '.legend', 'muted', 'var(--text-muted)'],
    [STOCK_CSS, '.legendTime', 'text', 'var(--text)'],
    [STOCK_CSS, '.legendLabel', 'text', 'var(--text)'],
    [STOCK_CSS, '.legendVal', 'bright', 'var(--text-bright)'],
    [STOCK_CSS, '.barDate', 'muted', 'var(--text-muted)'],
    [STOCK_CSS, '.barKey', 'muted', 'var(--text-muted)'],
    [STOCK_CSS, '.barVal', 'bright', 'var(--text-bright)'],
    [STOCK_CSS, '.volLegLabel', 'text', 'var(--text)'],
    [STOCK_CSS, '.volLegVal', 'bright', 'var(--text-bright)'],
    [STOCK_CSS, '.vlLabel', 'text', 'var(--text)'],
    [STOCK_CSS, '.vlVal', 'bright', 'var(--text-bright)'],
    [STOCK_CSS, '.paneLegendTitle', 'bright', 'var(--text-bright)'],
    [STOCK_CSS, '.paneLegendNote', 'muted', 'var(--text-muted)'],
    [ROW_CSS, '.vLabel', 'muted', 'var(--text-muted)'],
    [ROW_CSS, '.vVal, .flatVal', 'bright', 'var(--text-bright)'],
    [CHIP_CSS, '.chipGridLabel', 'muted', 'var(--text-muted)'],
    [CHIP_CSS, '.chipGridVal', 'bright', 'var(--text-bright)'],
  ]
  it.each(RULES)('%#: %s', (css, sel, role, token) => {
    // the role's resolved ink, with the old token as the fallback OUTSIDE a chart (a portaled row)
    expect(colorOf(css, sel), sel).toBe(`var(--legend-ink-${role}, ${token})`)
    // and the role's token is the token the rule names
    expect(`var(${LEGEND_ROLES[role].token})`).toBe(token)
  })

  it('the volume strip and the pane legends re-point the rows inside them to the LOW sample', () => {
    const m = /\.volLegend, \.paneLegend \{([^}]*)\}/.exec(STOCK_CSS)
    expect(m).not.toBeNull()
    for (const role of Object.keys(LEGEND_ROLES)) {
      expect(m[1]).toMatch(new RegExp(`--legend-ink-${role}:\\s*var\\(--legend-ink-${role}-low, var\\(${LEGEND_ROLES[role].token}\\)\\)`))
    }
  })

  it('StockChart publishes legendInkVars from the DOM-read tokens and the canvas samples', () => {
    expect(STOCK_JSX).toMatch(/import \{ legendInkVars, readLegendContext \} from '\.\/chart\/legendInk'/)
    expect(STOCK_JSX).toMatch(/const \{ tokens, under \} = readLegendContext\(el\)/)
    expect(STOCK_JSX).toMatch(/legendInkVars\(\{ tokens, top: canvasSample\.top, low: canvasSample\.low, under, legendColor \}\)/)
    expect(STOCK_JSX).toMatch(/style=\{\{ height, \.\.\.panelVars, \.\.\.legendInks \}\}/)
    // re-run on an app theme change, not only on a canvas change
    // through the app's ONE theme observer (lib/theme/useThemeInk.js), never a second per chart
    expect(STOCK_JSX).toMatch(/import \{ useThemeVersion \} from '\.\.\/lib\/theme\/useThemeInk'/)
    expect(STOCK_JSX).toMatch(/const appThemeTick = useThemeVersion\(\)/)
    expect(STOCK_JSX).not.toMatch(/new MutationObserver/)
    expect(STOCK_JSX).toMatch(/\}, \[canvasSample\.top, canvasSample\.low, legendColor, appThemeTick\]\)/)
  })
})

describe('legendInkVars: keep the app token where it reads, replace it only where it fails', () => {
  const themes = allThemes()
  const tok = (theme, name) => resolveVars(`var(${name})`, themes[theme])
  const tokensOf = (theme) => Object.fromEntries(Object.entries(LEGEND_ROLES).map(([r, { token }]) => [r, tok(theme, token)]))
  const DARK_CANVAS = CHART_DEFAULTS.background

  it('a dark app theme over the default dark canvas keeps its tokens EXACTLY (no dimming)', () => {
    const t = tokensOf('dark')
    const v = legendInkVars({ tokens: t, top: DARK_CANVAS, low: DARK_CANVAS })
    expect(v['--legend-ink-bright']).toBe(t.bright)
    expect(v['--legend-ink-text']).toBe(t.text)
    expect(v['--legend-ink-muted']).toBe(t.muted)
    expect(v['--legend-ink-bright-low']).toBe(t.bright)
  })

  it('a light app theme over the dark canvas takes the canvas ink wherever its token fails', () => {
    const t = tokensOf('light')
    const v = legendInkVars({ tokens: t, top: DARK_CANVAS, low: DARK_CANVAS })
    expect(v['--legend-ink-bright']).toBe(LEGEND_INK_ON_DARK)
    expect(v['--legend-ink-muted']).toBe(LEGEND_INK_ON_DARK)
  })

  it('every app theme x every catalogued canvas: each role clears 4.5:1 at its opacity step', () => {
    for (const name of Object.keys(themes)) {
      const t = tokensOf(name)
      for (const bg of CANVASES) {
        const v = legendInkVars({ tokens: t, top: bg, low: bg })
        for (const [role, { opacity }] of Object.entries(LEGEND_ROLES)) {
          for (const k of [`--legend-ink-${role}`, `--legend-ink-${role}-low`]) {
            const c = legendTextContrast(v[k], legendCanvasRgb(bg), opacity)
            expect(c, `${name} on ${bg}: ${k} = ${v[k]}`).toBeGreaterThanOrEqual(4.5)
          }
        }
      }
    }
  })

  it("a member's explicit legend colour wins for EVERY role, the volume strip and pane legends too", () => {
    const v = legendInkVars({ tokens: tokensOf('dark'), top: DARK_CANVAS, low: DARK_CANVAS, legendColor: '#ffcc00' })
    for (const role of Object.keys(LEGEND_ROLES)) {
      expect(v[`--legend-ink-${role}`]).toBe('#ffcc00')
      expect(v[`--legend-ink-${role}-low`]).toBe('#ffcc00')
    }
  })

  it('a translucent canvas is judged as it is SEEN: composited over the surface under the chart', () => {
    // white at 20% over a black panel is near-black: light ink, and the dark tokens keep
    expect(legendInkForCanvas('#ffffff33', '#000000')).toBe(LEGEND_INK_ON_DARK)
    expect(legendInkForCanvas('#ffffff33', '#ffffff')).toBe(LEGEND_INK_ON_LIGHT)
    expect(legendInkForCanvas('rgba(255, 255, 255, 0.2)', 'rgb(255, 255, 255)')).toBe(LEGEND_INK_ON_LIGHT)
    expect(legendInkForCanvas('transparent', '#ffffff')).toBe(LEGEND_INK_ON_LIGHT)
    expect(legendCanvasRgb('#ffffff80', '#000000')).toEqual([128, 128, 128])
    // an opaque 8-digit canvas is just its colour (it used to read as unparseable -> light ink on white)
    expect(legendInkForCanvas('#ffffffff')).toBe(LEGEND_INK_ON_LIGHT)
    expect(legendInkForCanvas('#ffffffcc', '#ffffff')).toBe(LEGEND_INK_ON_LIGHT)
    // decimal rgb, the form a computed style can carry
    expect(legendInkForCanvas('rgb(250.5, 250.5, 250.5)')).toBe(LEGEND_INK_ON_LIGHT)
  })

  it('an unreadable token falls back to the canvas ink (jsdom, or a token the parser cannot read)', () => {
    const v = legendInkVars({ tokens: {}, top: '#ffffff', low: '#ffffff' })
    expect(v['--legend-ink-bright']).toBe(LEGEND_INK_ON_LIGHT)
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

describe('the one colour parser reads what a computed style can answer', () => {
  it('color(srgb …) — a color-mix() token, as the browser resolves it — keeps its look', () => {
    expect(parseColorAlpha('color(srgb 1 1 1)')).toEqual({ rgb: [255, 255, 255], a: 1 })
    expect(parseColorAlpha('color(srgb 0 0 0 / 0.5)')).toEqual({ rgb: [0, 0, 0], a: 0.5 })
    // a light near-white token mixed with color-mix still passes on a dark canvas and is KEPT
    const v = legendInkVars({ tokens: { bright: 'color(srgb 0.97 0.97 0.95)', text: 'color(srgb 0.9 0.9 0.9)', muted: 'color(srgb 0.8 0.79 0.75)' }, top: '#17181a', low: '#17181a' })
    expect(v['--legend-ink-bright']).toBe('color(srgb 0.97 0.97 0.95)')
    expect(v['--legend-ink-muted']).toBe('color(srgb 0.8 0.79 0.75)')
  })
  it('#rgba (4 digits) is read on purpose; the panel/toolbar helpers are unaffected for 3/6/8 digits', () => {
    expect(parseColorAlpha('#fff8')).toEqual({ rgb: [255, 255, 255], a: 0x88 / 255 })
    expect(parseColorRgb('#fff8')).toEqual([255, 255, 255])
    expect(parseColorRgb('#ffffffcc')).toEqual([255, 255, 255])
    expect(parseColorRgb('transparent')).toBeNull()
  })
})
