// The TickerPopup's finger targets clear `--tap-min` on the WHOLE touch tier (phone 390 AND
// tablet 820) and on any COARSE pointer past it (a touch iPad in landscape, 1194), with the
// token, not a literal. A mouse desktop keeps its compact header.
//
// Measured by a Playwright + axe walk at 820 and 390: the header icon buttons (`.actionBtn`:
// research / Ask AI / save price) were 28x26, the "Switch ticker" box (`.switchInput`) 148x34,
// and the chart's A/L/% scale chips (`.scaleToggleBtn`, StockChart) ~22px (axe `target-size`).
// `.flagBtn` and `.closeBtn` share the header chrome; `.closeBtn` was only sized at <=640.
//
// ⛔ The scale-chip floor is SCOPED to the popup's `data-ticker-popup-chart` area, exactly like
// the Notebook embed's (`ChartEmbed.touchTargets.test.js`), so no other chart surface moves.
//
// ⛔ A STRUCTURAL RAIL. jsdom lays nothing out; passing here is necessary, not sufficient.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mediaBodiesOn } from '../testing/cssMediaAt'

const SRC = join(process.cwd(), 'src')
const read = (p) => readFileSync(join(SRC, p), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

const POPUP_CSS = stripComments(read('components/TickerPopup.module.css'))
const STOCK_CSS = stripComments(read('components/StockChart.module.css'))
const POPUP_JSX = read('components/TickerPopup.jsx')
const SCOPE = ':global([data-ticker-popup-chart])'
const PHONE = 390
const TABLET = 820
const IPAD_LANDSCAPE = 1194
const DESKTOP = 1200

// The devices the floor is FOR (a finger) and the one it must leave alone (a mouse desktop).
const ON_PHONE = { width: PHONE, pointer: 'coarse' }
const ON_TABLET = { width: TABLET, pointer: 'coarse' }
// A touch iPad in LANDSCAPE: past the 1024 width tier, so it gets the TickerPopup, not the
// hub sheet -- and its header buttons measured 28x26 there (WebKit walk, 1194px, touch).
const ON_IPAD_LANDSCAPE = { width: IPAD_LANDSCAPE, pointer: 'coarse' }
const ON_DESKTOP_MOUSE = { width: DESKTOP, pointer: 'fine' }
const FINGER_DEVICES = [ON_PHONE, ON_TABLET, ON_IPAD_LANDSCAPE]
const tag = (d) => `@${d.width}px/${d.pointer}`

/** Does a rule whose selector list contains exactly `selector` pin `prop` to the TOKEN? */
function pinned(block, selector, prop) {
  for (const [, sels, decls] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!sels.split(',').some((s) => s.trim() === selector)) continue
    const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*var\\(--tap-min\\)\\s*(?:;|$)`)
    if (re.test(decls.trim())) return true
  }
  return false
}

// [stylesheet, selector, props]
const TARGETS = [
  [POPUP_CSS, '.actionBtn', ['min-width', 'min-height']],
  [POPUP_CSS, '.flagBtn', ['min-width', 'min-height']],
  [POPUP_CSS, '.closeBtn', ['min-width', 'min-height']],
  [POPUP_CSS, '.switchInput', ['min-height']],   // 148px wide already; only its height was short
  [POPUP_CSS, '.compareEntry button', ['min-height']],   // SymbolSearch's "+ Compare" badge, 97px wide; 14px tall at 820
  [STOCK_CSS, `${SCOPE} .scaleToggleBtn`, ['min-width', 'min-height']],
]

describe('TickerPopup touch targets clear --tap-min on phone, tablet AND a touch iPad in landscape', () => {
  it('every header control and scale chip is pinned to the token at 390, 820 and 1194 (touch)', () => {
    const misses = []
    for (const [css, sel, props] of TARGETS) {
      for (const d of FINGER_DEVICES) {
        const block = mediaBodiesOn(css, d)
        for (const prop of props) if (!pinned(block, sel, prop)) misses.push(`${sel} ${prop} ${tag(d)}`)
      }
    }
    expect(misses).toEqual([])
  })

  it('a mouse desktop is untouched -- the floor follows the finger, not the width alone', () => {
    for (const [css, sel] of TARGETS) {
      expect(pinned(mediaBodiesOn(css, ON_DESKTOP_MOUSE), sel, 'min-height'), sel).toBe(false)
    }
  })

  it('the classes are the ones the popup renders (the wire, not just the stylesheet)', () => {
    for (const cls of ['actionBtn', 'flagBtn', 'closeBtn', 'switchInput', 'compareEntry']) {
      expect(POPUP_JSX, cls).toMatch(new RegExp(`styles\\.${cls}\\b`))
    }
    expect(POPUP_JSX).toMatch(/className=\{styles\.chartArea\}\s+data-ticker-popup-chart=""/)
  })

  it('⭐ CONTROL -- a phone-only floor does NOT satisfy the tablet width', () => {
    const phoneOnly = '@media (max-width: 640px) { .actionBtn { min-height: var(--tap-min); } }'
    expect(pinned(mediaBodiesOn(phoneOnly, ON_PHONE), '.actionBtn', 'min-height')).toBe(true)
    expect(pinned(mediaBodiesOn(phoneOnly, ON_TABLET), '.actionBtn', 'min-height')).toBe(false)
  })

  it('⭐ CONTROL -- a width-only touch tier does NOT reach the touch iPad in landscape', () => {
    const widthOnly = '@media (max-width: 1024px) { .actionBtn { min-height: var(--tap-min); } }'
    const withPointer = '@media (max-width: 1024px), (pointer: coarse) { .actionBtn { min-height: var(--tap-min); } }'
    expect(pinned(mediaBodiesOn(widthOnly, ON_TABLET), '.actionBtn', 'min-height')).toBe(true)
    expect(pinned(mediaBodiesOn(widthOnly, ON_IPAD_LANDSCAPE), '.actionBtn', 'min-height')).toBe(false)
    expect(pinned(mediaBodiesOn(withPointer, ON_IPAD_LANDSCAPE), '.actionBtn', 'min-height')).toBe(true)
    expect(pinned(mediaBodiesOn(withPointer, ON_DESKTOP_MOUSE), '.actionBtn', 'min-height')).toBe(false)
  })

  it('⭐ CONTROL -- a condition the parser does not understand never counts as applying', () => {
    const hoverNone = '@media (hover: none) { .actionBtn { min-height: var(--tap-min); } }'
    expect(pinned(mediaBodiesOn(hoverNone, ON_IPAD_LANDSCAPE), '.actionBtn', 'min-height')).toBe(false)
  })

  it('⭐ CONTROL -- an UNSCOPED or literal-px chip floor does not count as the popup fix', () => {
    const unscoped = '@media (max-width: 1024px) { .scaleToggleBtn { min-height: var(--tap-min); } }'
    const literal = `@media (max-width: 1024px) { ${SCOPE} .scaleToggleBtn { min-height: 44px; } }`
    const sel = `${SCOPE} .scaleToggleBtn`
    expect(pinned(mediaBodiesOn(unscoped, ON_TABLET), sel, 'min-height')).toBe(false)
    expect(pinned(mediaBodiesOn(literal, ON_TABLET), sel, 'min-height')).toBe(false)
  })
})
