// The Ticker Hub sheet's "+ Compare" badge clears --tap-min for a finger.
// Measured in WebKit: 97x14 at 834 (touch) and 97x40 at 390 -- it is SymbolSearch's badge,
// sized for a chart TF bar. Same device condition as the TickerPopup floor:
// `(max-width: 1024px), (pointer: coarse)`.
//
// A STRUCTURAL RAIL (jsdom lays nothing out); the WebKit walk is the measurement.
//
// The hub's CHART (ChartPane -> StockChart inside `.chartWrap`, marked `data-ticker-hub-chart`):
// measured in WebKit at 390 and 834 (touch), the 1D/1W/1M chips were 32-35 x 40 (390) and x 18-20
// (834), the A/L/% scale chips 17x11 and the legend's "+N more" 47-51x14. All three are brought
// to --tap-min on the touch tier, scoped to the hub so no other chart surface moves, and the hub
// RESERVES the date axis the bigger A/L/% chips need (same 80px reserve as the TickerPopup, see
// TickerPopup.chipsClearAxis.test.js), so they sit under the date labels, not on them.
//
// ⛔ And `.chartWrap` stops CLIPPING the pane on touch. It was a fixed 240px box around a pane of
// identity row + timeframe bar + a 240px chart, with `overflow: hidden`, so the date axis and the
// A/L/% chips were cut off below the sheet's border at 390 AND 834 -- a 44px chip nobody can see
// is not a fix. On touch the box takes the pane's own height.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mediaBodiesOn } from '../../testing/cssMediaAt'
import { timeAxisMinHeightFromCss } from '../StockChart'
import { panelFor, toolbarFor } from '../../utils/dividerColor'
import { allThemes, parseColor, resolveVars } from '../../pages/terminal/a11y/__tests__/terminalContrast'
import { contrast } from '../../styles/__tests__/contrastMath'

const read = (p) => readFileSync(join(process.cwd(), 'src', p), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const CSS = stripComments(read('components/mobile/TickerHubSheet.module.css'))
const JSX = read('components/mobile/TickerHubSheet.jsx')
const SEL = '.compareRow button'

function pinned(block, selector, prop) {
  for (const [, sels, decls] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!sels.split(',').some((s) => s.trim() === selector)) continue
    if (new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*var\\(--tap-min\\)\\s*(?:;|$)`).test(decls.trim())) return true
  }
  return false
}

const FINGERS = [{ width: 390, pointer: 'coarse' }, { width: 834, pointer: 'coarse' }, { width: 1194, pointer: 'coarse' }]
const DESKTOP_MOUSE = { width: 1200, pointer: 'fine' }
const STOCK_CSS = stripComments(read('components/StockChart.module.css'))
const WS_CSS = stripComments(read('pages/charts/ChartsWorkspace.module.css'))
const STOCK_JSX = read('components/StockChart.jsx')
const TOKENS = read('styles/tokens.css')
const SCOPE = ':global([data-ticker-hub-chart])'

// [stylesheet, selector, props]
const CHART_TARGETS = [
  [WS_CSS, `${SCOPE} .tfBtn`, ['min-width', 'min-height']],
  [STOCK_CSS, `${SCOPE} .scaleToggleBtn`, ['min-width', 'min-height']],
  // "+N more": only its WIDTH is a floor here; its height rides `--study-more-h` (below),
  // which the legend fold reads -- a min-height would be invisible to the fold.
  [STOCK_CSS, `${SCOPE} .studyMore`, ['min-width']],
  // the in-chart range row (3M / 6M / YTD / 1Y / 5Y / Origin): 44 tall but 28-49 wide in WebKit
  // at 390/834. The shared <=1024 rule raises only its height, and not on a coarse pointer > 1024.
  [STOCK_CSS, `${SCOPE} .rangeBtn`, ['min-width', 'min-height']],
]

/** A px length or a `calc()` of px terms joined by + / -, in px; null when it is neither. */
function pxOf(raw) {
  if (raw == null) return null
  const s = String(raw).trim()
  const inner = /^calc\((.*)\)$/.exec(s)?.[1] ?? s
  const terms = inner.trim().split(/\s+([+-])\s+/)
  let sum = 0
  for (let i = 0; i < terms.length; i += 2) {
    const m = /^(\d+(?:\.\d+)?)px$/.exec(terms[i])
    if (!m) return null
    sum += (i === 0 || terms[i - 1] === '+' ? 1 : -1) * Number(m[1])
  }
  return sum
}

/** The value a rule whose selector list holds exactly `selector` gives `prop`, or null. */
function value(block, selector, prop) {
  for (const [, sels, decls] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!sels.split(',').some((s) => s.trim() === selector)) continue
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+?)\\s*(?:;|$)`).exec(decls.trim())
    if (m) return m[1]
  }
  return null
}

// The date axis has to hold its labels (28px natural) AND the 48px chip row (tap-min + 1px
// padding + 1px border, each side) on the inline 3px dock -- the popup's arithmetic.
const TAP_MIN = Number(/--tap-min:\s*(\d+)px/.exec(TOKENS)[1])
const DOCK_PX = Number(/style=\{\{\s*bottom:\s*'(\d+)px'\s*\}\}\s*title="Price scale: Arithmetic/.exec(STOCK_JSX)?.[1])
const NEEDED = 28 + TAP_MIN + 4 + DOCK_PX
const reserveOn = (d, css = STOCK_CSS) => {
  const v = value(mediaBodiesOn(css, d), `${SCOPE} .wrapper`, '--time-axis-min-height')
  return v == null ? null : timeAxisMinHeightFromCss(v)
}

describe('TickerHubSheet "+ Compare" badge touch floor', () => {
  it('is pinned to --tap-min at 390, 834 and 1194 on touch', () => {
    const misses = FINGERS.filter((d) => !pinned(mediaBodiesOn(CSS, d), SEL, 'min-height')).map((d) => d.width)
    expect(misses).toEqual([])
  })

  it('a mouse desktop is untouched', () => {
    expect(pinned(mediaBodiesOn(CSS, { width: 1200, pointer: 'fine' }), SEL, 'min-height')).toBe(false)
  })

  it('the row the floor names is the one that holds the compare door (the wire)', () => {
    expect(JSX).toMatch(/<div className=\{styles\.compareRow\}>\s*<CompareSymbolSearch\b/)
  })

  it("the hub chart's timeframe chips, A/L/% chips and +N more clear --tap-min on touch", () => {
    const misses = []
    for (const [css, sel, props] of CHART_TARGETS) {
      for (const d of FINGERS) {
        const block = mediaBodiesOn(css, d)
        for (const prop of props) if (!pinned(block, sel, prop)) misses.push(`${sel} ${prop} @${d.width}`)
      }
    }
    expect(misses).toEqual([])
  })

  it('a mouse desktop keeps the compact chart chips', () => {
    for (const [css, sel] of CHART_TARGETS) expect(pinned(mediaBodiesOn(css, DESKTOP_MOUSE), sel, 'min-height'), sel).toBe(false)
  })

  it('the hub reserves the date axis for the chip row on the same devices, and not on a mouse', () => {
    expect(TAP_MIN).toBe(44)
    expect(DOCK_PX).toBe(3)
    for (const d of FINGERS) expect(reserveOn(d), `@${d.width}`).toBeGreaterThanOrEqual(NEEDED)
    expect(reserveOn(DESKTOP_MOUSE)).toBeNull()
  })

  it("on touch the chart box takes the pane's height instead of clipping the axis and chips", () => {
    for (const d of FINGERS) expect(value(mediaBodiesOn(CSS, d), '.chartWrap', 'height'), `@${d.width}`).toBe('auto')
    expect(value(mediaBodiesOn(CSS, DESKTOP_MOUSE), '.chartWrap', 'height')).toBeNull()
  })

  it('on touch the chart gets back the height the reserve costs it, so the legend still fits', () => {
    // The reserve comes out of the chart's own height. Without it the price pane lost 52px and
    // the legend's responsive collapse hid it entirely (WebKit, 390 and 834).
    expect(JSX).toMatch(/stockChartProps=\{\{\s*(?:\/\/[^\n]*\n\s*)*height: 'var\(--hub-chart-h, 240px\)'/)
    for (const d of FINGERS) {
      const raw = value(mediaBodiesOn(CSS, d), '.chartWrap', '--hub-chart-h')
      // written as the sum it is -- the 240px chart, plus the reserve, less the natural axis --
      // and the reserve term is the one StockChart.module.css declares for the hub on this device
      const m = /^calc\(240px \+ (\d+)px - 28px\)$/.exec(raw || '')
      expect(m, `@${d.width}: ${raw}`).not.toBeNull()
      expect(Number(m[1]), `@${d.width}`).toBe(reserveOn(d))
      expect(pxOf(raw)).toBe(240 + reserveOn(d) - 28)
    }
    expect(value(mediaBodiesOn(CSS, DESKTOP_MOUSE), '.chartWrap', '--hub-chart-h')).toBeNull()
  })

  it('the legend fold SEES the 44px "+N more": the hub raises --study-more-h, not a min-height', () => {
    for (const d of FINGERS) {
      expect(value(mediaBodiesOn(STOCK_CSS, d), `${SCOPE} .studyStack`, '--study-more-h'), `@${d.width}`).toBe('var(--tap-min)')
      expect(value(mediaBodiesOn(STOCK_CSS, d), `${SCOPE} .studyMore`, 'min-height'), `@${d.width}`).toBeNull()
    }
    expect(value(mediaBodiesOn(STOCK_CSS, DESKTOP_MOUSE), `${SCOPE} .studyStack`, '--study-more-h')).toBeNull()
  })

  it('while the chart chunk loads, the fallback holds the pane\'s final height (no jump on mount)', () => {
    // WebKit, slow ChartPane chunk: the box was 19-21px under the fallback and 373-388px after.
    const expected = { 390: 49 + 45, 834: 34 + 45, 1194: 34 + 45 }
    for (const d of FINGERS) {
      const block = mediaBodiesOn(CSS, d)
      expect(value(block, '.chartWrap .chartLoading', 'height'), `@${d.width}`)
        .toBe('calc(var(--hub-chart-h) + var(--hub-chart-chrome-h))')
      // the LAST declaration of the chrome on this device wins, as in the cascade
      const chrome = [...block.matchAll(/\.chartWrap\s*\{([^{}]*)\}/g)]
        .map(([, decls]) => /--hub-chart-chrome-h:\s*([^;]+?)\s*(?:;|$)/.exec(decls.trim())?.[1]).filter(Boolean).pop()
      expect(pxOf(chrome), `@${d.width}`).toBe(expected[d.width])
    }
    expect(value(mediaBodiesOn(CSS, DESKTOP_MOUSE), '.chartWrap .chartLoading', 'height')).toBeNull()
    // the chart's fallback is the `.chartLoading` INSIDE `.chartWrap` (the fundamentals one is not)
    expect(JSX).toMatch(/data-ticker-hub-chart="">\s*<Suspense fallback=\{<div className=\{styles\.chartLoading\}>Loading chart/)
  })

  it("the chart area the rules name is the one that holds the hub's ChartPane (the wire)", () => {
    expect(JSX).toMatch(/<div className=\{styles\.chartWrap\} data-ticker-hub-chart="">\s*<Suspense\b[\s\S]*?>\s*<ChartPane\b\b/)
    // the classes the rules name are the ones the chart renders
    expect(STOCK_JSX).toMatch(/className=\{`\$\{styles\.scaleToggleBtn\}/)
    expect(STOCK_JSX).toMatch(/styles\.studyMore\b/)
    expect(read('components/chart/pane/ChartTfBar.jsx')).toMatch(/styles\.tfBtn\b/)
  })

  it('CONTROL: a popup-scoped, unscoped or too-small reserve does not count for the hub', () => {
    const popup = `@media (max-width: 1024px), (pointer: coarse) { :global([data-ticker-popup-chart]) .wrapper { --time-axis-min-height: 80px; } }`
    const unscoped = `@media (max-width: 1024px), (pointer: coarse) { .wrapper { --time-axis-min-height: 80px; } }`
    const small = `@media (max-width: 1024px), (pointer: coarse) { ${SCOPE} .wrapper { --time-axis-min-height: 60px; } }`
    expect(reserveOn(FINGERS[1], popup)).toBeNull()
    expect(reserveOn(FINGERS[1], unscoped)).toBeNull()
    expect(reserveOn(FINGERS[1], small)).toBeLessThan(NEEDED)
  })

  it('the range row still fits on a phone: capped short of the price scale and scrolling, not wrapping', () => {
    // six buttons at --tap-min need ~277px; the 390 pane leaves ~256 left of the price scale.
    // The cap is derived from the MEASURED price-scale width: StockChart.lookbackPlacement.test.jsx
    for (const d of FINGERS) {
      const block = mediaBodiesOn(STOCK_CSS, d)
      expect(value(block, `${SCOPE} .rangeBar`, 'overflow-x'), `@${d.width}`).toBe('auto')
      expect(value(block, `${SCOPE} .rangeBar`, 'max-width'), `@${d.width}`).toBe('calc(100% - 8px - var(--price-axis-w, 88px) - 4px)')
      // a button must not shrink under its floor inside the capped flex row
      expect(value(block, `${SCOPE} .rangeBtn`, 'flex'), `@${d.width}`).toBe('none')
      // never wrap: a second row grows UP (the bar is bottom-anchored) into the legend's "+N more"
      expect(value(block, `${SCOPE} .rangeBar`, 'flex-wrap'), `@${d.width}`).toBeNull()
    }
    const desk = mediaBodiesOn(STOCK_CSS, DESKTOP_MOUSE)
    expect(value(desk, `${SCOPE} .rangeBar`, 'overflow-x')).toBeNull()
    expect(value(desk, `${SCOPE} .rangeBar`, 'max-width')).toBeNull()
    // the wire: the buttons the rule names are the range bar's
    expect(STOCK_JSX).toMatch(/className=\{styles\.rangeBar\}>\s*\{RANGE_OPTS\.map\([\s\S]{0,200}?className=\{styles\.rangeBtn\}/)
  })

  // "+N more" on touch is a 44px box over the candles: it must be OPAQUE, at full opacity, with
  // its text >= 4.5:1 on that surface -- and its height still only through --study-more-h.
  const MORE_BG = (d) => value(mediaBodiesOn(STOCK_CSS, d), `${SCOPE} .studyMore`, 'background')
  const MORE_INK = (d) => value(mediaBodiesOn(STOCK_CSS, d), `${SCOPE} .studyMore`, 'color')
  /** The colour a `var(--chart-*, fallback)` resolves to with the chart's published vars. */
  const chartVars = (canvas) => {
    const vars = new Map()
    const t = toolbarFor(canvas)
    const p = panelFor(canvas)
    vars.set('--chart-toolbar-bg', t.bg)
    vars.set('--chart-panel-text-strong', p.textStrong)
    return vars
  }
  // the default canvas (StockChart's MB_BG), sunrise's, and the two extremes a member can pick
  const CANVASES = [/const MB_BG = '(#[0-9a-f]{6})'/i.exec(STOCK_JSX)[1], '#eaf1fa', '#000000', '#ffffff']

  it('"+N more" on touch is opaque, at full opacity, and its text clears 4.5:1 on it', () => {
    expect(CANVASES[0]).toBe('#0e0f0d')
    for (const d of FINGERS) {
      expect(MORE_BG(d), `@${d.width}`).toBe('var(--chart-toolbar-bg, var(--bg-elevated))')
      expect(MORE_INK(d), `@${d.width}`).toBe('var(--chart-panel-text-strong, var(--text-bright))')
      expect(value(mediaBodiesOn(STOCK_CSS, d), `${SCOPE} .studyMore`, 'opacity'), `@${d.width}`).toBe('1')
      // height is NOT set here (the fold measures --study-more-h; see the test above)
      for (const prop of ['height', 'min-height', 'max-height']) {
        expect(value(mediaBodiesOn(STOCK_CSS, d), `${SCOPE} .studyMore`, prop), `${prop} @${d.width}`).toBeNull()
      }
    }
    const fails = []
    // with the chart's published vars, on every canvas
    for (const canvas of CANVASES) {
      const vars = chartVars(canvas)
      const bg = parseColor(resolveVars(MORE_BG(FINGERS[0]), vars))
      const ink = parseColor(resolveVars(MORE_INK(FINGERS[0]), vars))
      if (bg.alpha < 1) fails.push(`${canvas}: background not opaque (${bg.alpha})`)
      const r = contrast(ink.rgb, bg.rgb)
      if (r < 4.5) fails.push(`${canvas}: ${r.toFixed(2)}`)
    }
    // and with the app fallbacks (the vars unset), in every app theme
    for (const [name, raw] of Object.entries(allThemes())) {
      const vars = new Map(raw)
      const bg = parseColor(resolveVars(MORE_BG(FINGERS[0]), vars))
      const ink = parseColor(resolveVars(MORE_INK(FINGERS[0]), vars))
      if (bg.alpha < 1) fails.push(`${name}: fallback background not opaque`)
      const r = contrast(ink.rgb, bg.rgb)
      if (r < 4.5) fails.push(`${name}: fallback ${r.toFixed(2)}`)
    }
    expect(fails).toEqual([])
    // a mouse desktop keeps the shared legend styling
    expect(MORE_BG(DESKTOP_MOUSE)).toBeNull()
  })

  it('CONTROL: the shared "+N more" styling is see-through (what the hub rule exists to cover)', () => {
    const CHIP_CSS = stripComments(read('components/chart/legend/IndicatorChip.module.css'))
    expect(value(CHIP_CSS, '.chipMore', 'background')).toBe('transparent')
    expect(Number(value(CHIP_CSS, '.chipMore', 'opacity'))).toBeLessThan(1)
    // and the panel wash (the canvas at 0.88) is not opaque either, so it is not a substitute
    expect(parseColor(panelFor('#0e0f0d').bg).alpha).toBeLessThan(1)
  })

  it('CONTROL: a phone-only or literal-px floor does not count', () => {
    const phoneOnly = `@media (max-width: 640px) { ${SEL} { min-height: var(--tap-min); } }`
    const literal = `@media (max-width: 1024px), (pointer: coarse) { ${SEL} { min-height: 44px; } }`
    expect(pinned(mediaBodiesOn(phoneOnly, FINGERS[1]), SEL, 'min-height')).toBe(false)
    expect(pinned(mediaBodiesOn(literal, FINGERS[1]), SEL, 'min-height')).toBe(false)
  })
})
