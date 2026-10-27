// The TickerPopup's finger targets clear `--tap-min` on the WHOLE touch tier (phone 390 AND
// tablet 820), with the token, not a literal.
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

const SRC = join(process.cwd(), 'src')
const read = (p) => readFileSync(join(SRC, p), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

const POPUP_CSS = stripComments(read('components/TickerPopup.module.css'))
const STOCK_CSS = stripComments(read('components/StockChart.module.css'))
const POPUP_JSX = read('components/TickerPopup.jsx')
const SCOPE = ':global([data-ticker-popup-chart])'
const PHONE = 390
const TABLET = 820
const DESKTOP = 1200

/** Bodies of the @media blocks that APPLY at `width` (the tapFloor.test.js helper). */
function mediaBodiesAt(css, width) {
  const out = []
  const re = /@media([^{]+)\{/g
  let m
  while ((m = re.exec(css))) {
    const cond = m[1]
    const max = /max-width:\s*(\d+)px/.exec(cond)
    const min = /min-width:\s*(\d+)px/.exec(cond)
    let depth = 1
    let i = re.lastIndex
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
    }
    if (max && width > Number(max[1])) continue
    if (min && width < Number(min[1])) continue
    out.push(css.slice(re.lastIndex, i - 1))
  }
  return out.join('\n')
}

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
  [STOCK_CSS, `${SCOPE} .scaleToggleBtn`, ['min-width', 'min-height']],
]

describe('TickerPopup touch targets clear --tap-min on phone AND tablet', () => {
  it('every header control and scale chip is pinned to the token at 390 and 820', () => {
    const misses = []
    for (const [css, sel, props] of TARGETS) {
      for (const w of [PHONE, TABLET]) {
        const block = mediaBodiesAt(css, w)
        for (const prop of props) if (!pinned(block, sel, prop)) misses.push(`${sel} ${prop} @${w}px`)
      }
    }
    expect(misses).toEqual([])
  })

  it('desktop is untouched -- the floor lives only in the touch tier', () => {
    for (const [css, sel] of TARGETS) {
      expect(pinned(mediaBodiesAt(css, DESKTOP), sel, 'min-height'), sel).toBe(false)
    }
  })

  it('the classes are the ones the popup renders (the wire, not just the stylesheet)', () => {
    for (const cls of ['actionBtn', 'flagBtn', 'closeBtn', 'switchInput']) {
      expect(POPUP_JSX, cls).toMatch(new RegExp(`styles\\.${cls}\\b`))
    }
    expect(POPUP_JSX).toMatch(/className=\{styles\.chartArea\}\s+data-ticker-popup-chart=""/)
  })

  it('⭐ CONTROL -- a phone-only floor does NOT satisfy the tablet width', () => {
    const phoneOnly = '@media (max-width: 640px) { .actionBtn { min-height: var(--tap-min); } }'
    expect(pinned(mediaBodiesAt(phoneOnly, PHONE), '.actionBtn', 'min-height')).toBe(true)
    expect(pinned(mediaBodiesAt(phoneOnly, TABLET), '.actionBtn', 'min-height')).toBe(false)
  })

  it('⭐ CONTROL -- an UNSCOPED or literal-px chip floor does not count as the popup fix', () => {
    const unscoped = '@media (max-width: 1024px) { .scaleToggleBtn { min-height: var(--tap-min); } }'
    const literal = `@media (max-width: 1024px) { ${SCOPE} .scaleToggleBtn { min-height: 44px; } }`
    const sel = `${SCOPE} .scaleToggleBtn`
    expect(pinned(mediaBodiesAt(unscoped, TABLET), sel, 'min-height')).toBe(false)
    expect(pinned(mediaBodiesAt(literal, TABLET), sel, 'min-height')).toBe(false)
  })
})
