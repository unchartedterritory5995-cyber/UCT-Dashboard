// app/src/components/chart/indicatorEditLayout.test.js
//
// ─── TWO LAYOUT INVARIANTS THAT ONLY A BROWSER CAN BREAK ────────────────────
//
// ⛔ ASSERTED ON THE CSS FILE, NOT ON A RENDER — deliberately, and the repo has
// paid for the lesson twice. jsdom computes no layout: every width is 0, nothing
// wraps, no flex basis resolves, and `getBoundingClientRect()` returns zeroes. A
// mounted test therefore cannot tell a control that moved from one that did not,
// which is the same hole that let `.chipMore` ship un-clickable for an hour with
// its interaction case green (`IndicatorChip.module.css:166`).
//
// Both rules below were derived from MEASUREMENTS taken in a real browser on
// production, recorded in each rule's own comment. This file exists so that
// deleting one of them fails by name instead of silently restoring the bug.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const read = (rel) => fs.readFileSync(path.resolve(process.cwd(), 'src', rel), 'utf8')

/** The body of one CSS rule, or null. Comment-blind on purpose: a rule named only
 *  in prose must not satisfy an assertion about the stylesheet. */
function ruleBody(css, selector) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = new RegExp(`(^|[},])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm')
  const m = stripped.match(re)
  return m ? m[2] : null
}

describe('the settings dialog row wraps, so a note cannot shove the control sideways', () => {
  const css = read('components/chart/IndicatorSettingsDialog.module.css')

  it('`.row` wraps', () => {
    // ⚰️ Typing `999` into MACD's Fast clamps to 100 and prints "Maximum is 100".
    // `.note` asks for `flex: 1 1 100%` — a line of its own — but `.row` did not
    // wrap, so the note became a competing item on the control's line and dragged
    // the input from x≈943 to x≈800 while its two siblings stayed at 943. The box
    // moved under the cursor at the moment it reported the error.
    expect(ruleBody(css, '.row')).toMatch(/flex-wrap:\s*wrap/)
  })

  it('`.note` and `.tip` each claim a full line', () => {
    // Without the basis, wrapping alone still lets them share the control's line.
    expect(ruleBody(css, '.note')).toMatch(/flex:\s*1\s+1\s+100%/)
    expect(ruleBody(css, '.tip')).toMatch(/flex:\s*1\s+1\s+100%/)
  })

  it('`.body` is floored so the panel does not resize between tabs', () => {
    // ⚰️ MEASURED ON THE DEPLOYED BUILD 2026-08-15, MACD settings: the three tab
    // panels were 339 / 403.6 / 313px tall, and because `Sheet` centres the panel
    // the TAB STRIP travelled 45.3px depending on which tab was open — you reach
    // for Visibility and it has moved out from under the cursor.
    const px = /min-height:\s*(\d+)px/.exec(ruleBody(css, '.body'))
    expect(px, '.body lost its min-height floor').toBeTruthy()
    // Style's body is the tallest at ~204px (its chip box is fixed); the floor has
    // to clear that or the tallest tab still sets a different height.
    expect(Number(px[1])).toBeGreaterThanOrEqual(204)
  })

  it('⛔ THE CONTROL — the reader can tell a rule that lacks the property', () => {
    // Without this, a matcher that returned true for everything would pass above.
    expect(ruleBody(css, '.label')).not.toMatch(/flex-wrap:\s*wrap/)
    expect(ruleBody(css, '.label')).toBeTruthy()
  })
})

describe('the compact legend can get back out again', () => {
  // ⛔ ASSERTED ON THE SOURCE, because the decision it guards runs inside a rAF
  // sampler that reads `getBoundingClientRect()` — jsdom returns zeroes for all of
  // it, so a mounted test cannot tell a collapsed legend from an expanded one.
  //
  // ⚰️ THE BUG: `lastFullBottomRef` is written only while NOT compact, so once the
  // legend collapses it remembers the height it had WHEN IT COLLAPSED. Removing
  // indicators cannot refresh it — the rows are not rendered while compact, so
  // there is nothing shorter to measure — and the legend stays collapsed with a
  // single indicator on, taking every MA row, every chip and the settings gear
  // with it. Measured on production 2026-08-15; a reload was the only cure.
  const src = read('components/StockChart.jsx')

  it('a change in how many rows the legend would draw drops the remembered height', () => {
    expect(src, 'the row-count signature is gone').toMatch(/legendRowSigRef/)
    // …and it must actually clear the memo and un-collapse, not merely record.
    const block = /legendRowSigRef\.current = sig[\s\S]{0,200}/.exec(src)
    expect(block, 'the signature is recorded but nothing resets on it').toBeTruthy()
    expect(block[0]).toMatch(/lastFullBottomRef\.current = 0/)
    expect(block[0]).toMatch(/setCompactLegend\(false\)/)
  })

  it('⛔ it ignores a null crosshair — otherwise every mouse-leave un-collapses', () => {
    expect(src).toMatch(/if \(!crosshairData\) return/)
  })

  it('⛔ THE CONTROL — the reader can tell a name that is NOT in the source', () => {
    expect(src).not.toMatch(/legendRowSigRefThatDoesNotExist/)
  })
})

describe('the legend chip keeps dead space in front of its destructive control', () => {
  const css = read('components/chart/legend/IndicatorChip.module.css')

  it('`.chipBtnDanger` carries a safety margin', () => {
    // ⚰️ MEASURED, MACD chip on WMT 1D, 2026-08-14:
    //   `MACD 0.1605`  → Hide 396.1–412.1 · Settings 413.1–429.1 · Remove 430.1–446.1
    //   `MACD -0.1458` → Hide 401.5–417.5 · Settings 418.5–434.5 · Remove 435.5–451.5
    // The strip is laid out after the chip's TEXT NODE, so one extra glyph moved
    // every control +5.4px — and page-x 430.1–434.5 is Remove in the first state
    // and Settings in the second. On a live tape that number reflows under the
    // pointer, so the swap is reachable by standing still.
    const body = ruleBody(css, '.chipBtnDanger')
    expect(body, '.chipBtnDanger lost its rule entirely').toBeTruthy()
    const px = /margin-left:\s*(\d+)px/.exec(body)
    expect(px, '.chipBtnDanger lost its margin-left').toBeTruthy()
    expect(Number(px[1])).toBeGreaterThanOrEqual(8)
  })

  it('the revealed strip is wide enough to hold the margin it now contains', () => {
    // `.chipControls` is `overflow: hidden`, so a max-width that no longer fits
    // clips the last button — and clipping is exactly the failure this file's own
    // header warns is invisible in jsdom.
    const hover = /\.chip:hover \.chipControls,\s*\.chip:focus-within \.chipControls\s*\{([^}]*)\}/
      .exec(css.replace(/\/\*[\s\S]*?\*\//g, ''))
    expect(hover, 'the hover reveal rule is gone').toBeTruthy()
    const max = /max-width:\s*(\d+)px/.exec(hover[1])
    expect(max).toBeTruthy()
    const danger = Number(/margin-left:\s*(\d+)px/.exec(ruleBody(css, '.chipBtnDanger'))[1])
    // three 16px buttons + two 1px gaps + the danger margin
    expect(Number(max[1])).toBeGreaterThanOrEqual(3 * 16 + 2 + danger)
  })
})
