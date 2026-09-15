// app/src/components/chart/__tests__/priceOwnedChrome.css.test.js
//
// ─── BUG 1 WAS A CSS BUG, SO THIS RAIL READS THE CSS ────────────────────────
//
// ⚰️⚰️ THE SHAPE OF THE DEFECT. `--price-pane-top` was being set correctly, and
// the base `.legend` rule consumed it correctly. The legend still did not move,
// because the VARIANT classes on the same element —
//
//     .legendFlat     { top: 34px }      ← later in the file, same specificity
//     .legendVertical { top: 46px }
//
// — re-declared `top` as a constant and won on source order. The drawing toolbar,
// which lives in a different stylesheet and had no such variant, followed Price
// perfectly the whole time. That asymmetry in the owner's screenshot is what
// identified this: the offset was reaching the element and being overwritten.
//
// ⛔ NO UNIT TEST OF THE JS CAN SEE THIS. `chromePlan` can be perfect and the
// legend still sits on the wrong pane. So the rail is over the stylesheet: EVERY
// rule that positions a Price-owned surface must consume the offset, and a new
// variant that forgets it fails here rather than on a member's screen.
//
// ⚠️ IT IS DELIBERATELY A WHITELIST, NOT A PATTERN MATCH. The point is that
// adding a Price-owned surface should require saying so.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// ⚠️ COMMENTS COME OUT FIRST. These sheets are heavily commented and the
// comments contain braces; parsing rule blocks around them mis-pairs the very
// first one and every selector after it reads as part of some other rule.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const read = (rel) => stripComments(readFileSync(resolve(here, rel), 'utf8'))

const SHEETS = {
  stock: read('../../StockChart.module.css'),
  toolbar: read('../ChartToolbar.module.css'),
}

/**
 * Every surface that belongs to the PRICE pane and is positioned from the top.
 * Each must offset by `--price-pane-top` so it travels with the candles.
 */
const PRICE_OWNED = [
  ['stock', '.legend', 'the OHLC readout — the surface in the owner’s screenshot'],
  ['stock', '.legendVertical', 'the vertical legend variant'],
  ['stock', '.legendFlat', 'the flat legend variant — THIS is the one that shipped broken'],
  ['stock', '.compareRows', 'comparison rows, docked below the OHLC legend'],
  ['stock', '.compareRowsSide', 'comparison rows beside the vertical legend'],
  ['toolbar', '.toolbar', 'the drawing toolbar'],
]

/** Every `top:` declared in the rule whose selector list contains `sel`. */
function topDeclsFor(css, sel) {
  const out = []
  // Rule blocks: `selectors { body }`. Good enough — these sheets are flat.
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const selectors = m[1].split(',').map((s) => s.trim())
    if (!selectors.some((s) => s === sel || s.startsWith(`${sel}:`) || s.startsWith(`${sel}.`))) continue
    const body = m[2]
    for (const d of body.split(';')) {
      const [prop, ...rest] = d.split(':')
      if (prop && prop.trim() === 'top') out.push(rest.join(':').trim())
    }
  }
  return out
}

describe('⚰️⚰️ every PRICE-OWNED surface consumes --price-pane-top', () => {
  for (const [sheet, sel, what] of PRICE_OWNED) {
    it(`${sel} — ${what}`, () => {
      const tops = topDeclsFor(SHEETS[sheet], sel)
      expect(tops.length, `${sel} declares no \`top\` at all — has it been renamed?`).toBeGreaterThan(0)
      for (const value of tops) {
        expect(
          value.includes('--price-pane-top'),
          `${sel} sets \`top: ${value}\` — a constant. It will stay on the top pane when Price is arranged below another one, which is exactly the regression this rail exists for.`,
        ).toBe(true)
      }
    })
  }

  it('⛔ the offset degrades to 0px, so an unarranged chart is unchanged', () => {
    // Every consumer must pass a fallback: before the sampler's first frame the
    // custom property is simply absent, and the chart must look as it always did.
    for (const [sheet, sel] of PRICE_OWNED) {
      for (const value of topDeclsFor(SHEETS[sheet], sel)) {
        expect(value, `${sel} has no fallback`).toMatch(/var\(--price-pane-top,\s*0px\)/)
      }
    }
  })
})

describe('⛔ the WORKSPACE-owned surface must NOT consume it', () => {
  it('the lookback bar is positioned from the bottom, with no Price term', () => {
    // ⛔⛔ THE OTHER HALF OF THE TRAP. If `.rangeBar` ever grows a
    // `--price-pane-top` term it starts following Price, which is bug 2 again in
    // the opposite direction. It is anchored to the bottom of the workspace and
    // the sampler writes its `bottom` from the time axis alone.
    const tops = topDeclsFor(SHEETS.stock, '.rangeBar')
    expect(tops.some((v) => v.includes('--price-pane-top')), 'the lookback bar became Price-owned').toBe(false)

    const re = /(^|[,\s])\.rangeBar\s*\{([^{}]*)\}/
    const block = SHEETS.stock.match(re)
    expect(block, '.rangeBar rule not found — has it been renamed?').toBeTruthy()
    expect(block[2], 'the lookback bar must be anchored to the BOTTOM').toMatch(/bottom\s*:/)
    expect(block[2].includes('--price-pane-top')).toBe(false)
  })
})
