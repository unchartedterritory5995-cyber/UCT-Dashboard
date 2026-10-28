// The TickerPopup's A/L/% chips clear the date-axis labels on phone AND tablet.
//
// PR #476 raised the chips to `--tap-min` at <=1024 (rail: TickerPopup.tapFloor.test.js). They
// dock on the date axis with an inline `bottom: 3px`, and a 48px chip row does not fit a 28px
// axis: at 390 and 820 it covered the right end of the date labels and the volume pane's axis.
//
// The fix RESERVES room rather than moving the chips onto the candles: the popup's stylesheet
// declares `--time-axis-min-height` on StockChart's `.wrapper` (scoped to
// `data-ticker-popup-chart`, touch tier only), and StockChart hands it to the time scale's own
// `minimumHeight`. The labels draw at the TOP of the axis band; the chips sit in the strip under
// them. Measured in Chromium (Playwright, local vite, route-mocked /api): axis 28 -> 80px at 390
// and 820, label ink bottom 14px above the chip tops; 1200 unchanged at 28px.
//
// ⛔ A STRUCTURAL RAIL. jsdom lays nothing out; passing here is necessary, not sufficient.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { timeAxisMinHeightFromCss } from './StockChart'
import { mediaBodiesOn } from '../testing/cssMediaAt'

const SRC = join(process.cwd(), 'src')
const read = (p) => readFileSync(join(SRC, p), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

const STOCK_CSS = stripComments(read('components/StockChart.module.css'))
const STOCK_JSX = read('components/StockChart.jsx')
const TOKENS = read('styles/tokens.css')
const SEL = ':global([data-ticker-popup-chart]) .wrapper'
const VAR = '--time-axis-min-height'
const PHONE = 390
const TABLET = 820
const DESKTOP = 1200

// What the reserve has to hold: the natural date axis at the default text size, plus the chip
// row (tap-min + 1px padding + 1px border, top and bottom), plus the inline 3px dock.
const NATURAL_AXIS_PX = 28
const TAP_MIN = Number(/--tap-min:\s*(\d+)px/.exec(TOKENS)[1])
const DOCK_PX = Number(/style=\{\{\s*bottom:\s*'(\d+)px'\s*\}\}\s*title="Price scale: Arithmetic/.exec(STOCK_JSX)?.[1])
const NEEDED = NATURAL_AXIS_PX + TAP_MIN + 4 + DOCK_PX

// Devices, through the shared parser (it understands `pointer`, so the touch iPad in
// landscape -- 1194px, past the width tier, and shown THIS popup -- is a real case here).
const IPAD_LANDSCAPE = 1194
const FINGERS = [
  { width: PHONE, pointer: 'coarse' },
  { width: TABLET, pointer: 'coarse' },
  { width: IPAD_LANDSCAPE, pointer: 'coarse' },
]
const DESKTOP_MOUSE = { width: DESKTOP, pointer: 'fine' }
const ON_TABLET = { width: TABLET, pointer: 'coarse' }
const ON_PHONE = { width: PHONE, pointer: 'coarse' }

/** The px value a rule whose selector list contains exactly `selector` gives `prop`, or null. */
function declared(block, selector, prop) {
  for (const [, sels, decls] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!sels.split(',').some((s) => s.trim() === selector)) continue
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+?)\\s*(?:;|$)`).exec(decls.trim())
    if (m) return timeAxisMinHeightFromCss(m[1])
  }
  return null
}

describe('TickerPopup scale chips clear the date-axis labels on phone, tablet AND a touch iPad in landscape', () => {
  it('the popup reserves enough axis for the label band AND the chip row at 390, 820 and 1194 (touch)', () => {
    expect(TAP_MIN).toBe(44)
    expect(DOCK_PX).toBe(3)
    for (const d of FINGERS) {
      const px = declared(mediaBodiesOn(STOCK_CSS, d), SEL, VAR)
      expect(px, `${SEL} ${VAR} @${d.width}px`).not.toBeNull()
      expect(px, `@${d.width}px`).toBeGreaterThanOrEqual(NEEDED)
    }
  })

  it('a mouse desktop declares no reserve -- the axis stays at its natural height', () => {
    expect(declared(mediaBodiesOn(STOCK_CSS, DESKTOP_MOUSE), SEL, VAR)).toBeNull()
  })

  it('the reserve and the chip floor it pays for apply on the SAME devices', () => {
    // A floor without its reserve is the covered-axis bug again; a reserve without the floor
    // wastes 52px of chart. Both ride one media block, so they cannot drift apart per device.
    const chip = ':global([data-ticker-popup-chart]) .scaleToggleBtn'
    for (const d of [...FINGERS, DESKTOP_MOUSE]) {
      const block = mediaBodiesOn(STOCK_CSS, d)
      const hasFloor = /min-height:\s*var\(--tap-min\)/.test(
        [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => sel.split(',').some((x) => x.trim() === chip)).map(([, , b]) => b).join(';'))
      expect(declared(block, SEL, VAR) != null, `@${d.width}px/${d.pointer}`).toBe(hasFloor)
    }
  })

  it('StockChart hands the variable to the time scale (the wire, not just the stylesheet)', () => {
    expect(STOCK_JSX).toMatch(/getComputedStyle\(host\)\.getPropertyValue\('--time-axis-min-height'\)/)
    expect(STOCK_JSX).toMatch(/applyOptions\(\{\s*timeScale:\s*\{\s*minimumHeight:\s*px\s*\}\s*\}\)/)
    // re-read when the viewport crosses the media query
    expect(STOCK_JSX).toMatch(/window\.addEventListener\('resize', apply\)/)
    // the element the effect reads (`wrapperRef`) is the one the `.wrapper` selector names
    expect(STOCK_JSX).toMatch(/ref=\{wrapperRef\} className=\{`\$\{styles\.wrapper\}/)
  })

  it('the reader takes a plain px length and nothing else (unset = the library default)', () => {
    expect(timeAxisMinHeightFromCss('80px')).toBe(80)
    expect(timeAxisMinHeightFromCss(' 80px ')).toBe(80)
    expect(timeAxisMinHeightFromCss('')).toBe(0)
    expect(timeAxisMinHeightFromCss(undefined)).toBe(0)
    expect(timeAxisMinHeightFromCss('calc(28px + 52px)')).toBe(0)
    expect(timeAxisMinHeightFromCss('5em')).toBe(0)
  })

  it('⭐ CONTROL -- unscoped, phone-only or too-small reserves do not count as the fix', () => {
    const unscoped = `@media (max-width: 1024px) { .wrapper { ${VAR}: 80px; } }`
    const phoneOnly = `@media (max-width: 640px) { ${SEL} { ${VAR}: 80px; } }`
    const tooSmall = `@media (max-width: 1024px) { ${SEL} { ${VAR}: 60px; } }`
    const good = `@media (max-width: 1024px) { ${SEL} { ${VAR}: 80px; } }`
    expect(declared(mediaBodiesOn(unscoped, ON_TABLET), SEL, VAR)).toBeNull()
    expect(declared(mediaBodiesOn(phoneOnly, ON_PHONE), SEL, VAR)).toBe(80)
    expect(declared(mediaBodiesOn(phoneOnly, ON_TABLET), SEL, VAR)).toBeNull()
    expect(declared(mediaBodiesOn(tooSmall, ON_TABLET), SEL, VAR)).toBeLessThan(NEEDED)
    expect(declared(mediaBodiesOn(good, ON_TABLET), SEL, VAR)).toBeGreaterThanOrEqual(NEEDED)
    // a width-only reserve does not reach the touch iPad in landscape
    expect(declared(mediaBodiesOn(good, FINGERS[2]), SEL, VAR)).toBeNull()
  })
})
