// The legend fold reserves as many stack rows as the `+N more` button is REALLY tall.
//
// The fold (StockChart's `studyRowBudget`) counts the room above the price pane's lookback band
// in 22px rows and, when it has to fold, keeps rows back for the disclosure button. It kept back
// ONE. A touch surface floors that button at `--tap-min` (the Ticker Hub sheet, a Notebook
// embed), and a 44px button in a 22px reservation hangs below the measured room: the legend's
// bottom crosses `collapseThresholdPx`, `setCompactLegend(true)` latches, and the member gets a
// hover-only legend. Measured in WebKit (local vite, route-mocked /api, 20 studies): the hub
// legend was gone at 390 and 834.
//
// The fix derives the reservation from the stylesheet that sizes the button: `.studyStack`
// declares `--study-more-h`, `.studyMore` takes its height from it, a touch scope raises the
// variable, and the sampler reads it (plus the stack's `row-gap`) off the stack element.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cssLengthPx, fullLegendMeasurable, nextCompactLegend, rangeBarYieldsToLegend, studyDisclosureRows, studyFoldRoom } from './StockChart'
import { stackDrawnOpen, stackExpandIsStale } from './chart/legend/stackExpand'

const SRC = join(process.cwd(), 'src')
const read = (p) => readFileSync(join(SRC, p), 'utf8')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const CSS = stripComments(read('components/StockChart.module.css'))
const JSX = read('components/StockChart.jsx')
const ROW = Number(/const STUDY_ROW_PX = (\d+)/.exec(JSX)[1])
const GAP = Number(/\.studyStack\s*\{[^}]*row-gap:\s*(\d+)px/.exec(CSS)[1])

/** The value a rule whose selector list holds exactly `selector` gives `prop`, anywhere in `css`. */
function values(css, selector, prop) {
  const out = []
  for (const [, sels, decls] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!sels.split(',').some((s) => s.trim() === selector)) continue
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+?)\\s*(?:;|$)`).exec(decls.trim())
    if (m) out.push(m[1])
  }
  return out
}

/** Pixels the fold shows: the visible rows plus the disclosure (its height + the gap above it). */
const shownPx = (rows, buttonPx) => rows * ROW + buttonPx + GAP

describe('the legend fold pays for the disclosure button it renders', () => {
  it('a 14px button costs one row, a 44px one three', () => {
    expect(ROW).toBe(22)
    expect(GAP).toBe(8)
    expect(studyDisclosureRows(14, 8)).toBe(1)
    expect(studyDisclosureRows(44, 8)).toBe(3)
    expect(studyDisclosureRows(44, null)).toBe(2)   // no gap read -> the line alone
  })

  it('⛔ an height it cannot read is NO ANSWER, never a silent "one row"', () => {
    // A one-row answer for a 44px button is the hover-only latch. When the height cannot be
    // resolved the sampler keeps what it had and measures the rendered button next frame.
    for (const h of [null, undefined, NaN, 0, -4]) expect(studyDisclosureRows(h, 8), String(h)).toBeNull()
  })

  it('the variable fallback resolves px AND rem; anything else is unresolved, not px', () => {
    expect(cssLengthPx('44px')).toBe(44)
    expect(cssLengthPx(' 14px ')).toBe(14)
    expect(cssLengthPx('2.75rem', 16)).toBe(44)
    expect(cssLengthPx('2.75rem', 20)).toBe(55)
    for (const raw of ['var(--tap-min)', 'calc(40px + 4px)', '3em', '', null, '44']) {
      expect(cssLengthPx(raw), String(raw)).toBeNull()
    }
    // so a non-px --tap-min can never read as the old single row
    for (const raw of ['var(--tap-min)', 'calc(40px + 4px)', '3em']) {
      expect(studyDisclosureRows(cssLengthPx(raw), 8), raw).not.toBe(1)
    }
  })

  it('--tap-min is a plain px token in every theme block (what the fallback resolves)', () => {
    const tokens = read('styles/tokens.css')
    const decls = [...tokens.matchAll(/--tap-min:\s*([^;]+);/g)].map((m) => m[1].trim())
    expect(decls.length).toBeGreaterThan(0)
    for (const v of decls) expect(cssLengthPx(v), v).toBe(44)
  })

  it('with a 44px button, the folded legend never overruns the room its budget measured', () => {
    const over = []
    for (let budget = 4; budget <= 14; budget += 1) {
      const rows = studyFoldRoom(30, budget, studyDisclosureRows(44, GAP))
      if (shownPx(rows, 44) > budget * ROW) over.push(`budget ${budget}: ${shownPx(rows, 44)} > ${budget * ROW}`)
    }
    expect(over).toEqual([])
  })

  it('CONTROL: the old one-row reservation DOES overrun with a 44px button (the defect)', () => {
    const budget = 6
    expect(shownPx(studyFoldRoom(30, budget, 1), 44)).toBeGreaterThan(budget * ROW)
    // and a 14px button never did
    expect(shownPx(studyFoldRoom(30, budget, studyDisclosureRows(14, GAP)), 14)).toBeLessThanOrEqual(budget * ROW)
  })

  it('nothing to disclose ⇒ nothing reserved, whatever the button would cost', () => {
    expect(studyFoldRoom(5, 8, 3)).toBe(8)
    expect(studyFoldRoom(9, 8, 3)).toBe(5)
    expect(studyFoldRoom(9, 2, 3)).toBe(0)
  })

  it('ONE authority for the height: the stack declares it, the button reads it', () => {
    expect(values(CSS, '.studyStack', '--study-more-h')).toEqual(['14px'])
    expect(values(CSS, '.studyMore', 'height')).toEqual(['var(--study-more-h)'])
  })

  it('every scope that floors the button at --tap-min tells the fold too', () => {
    const scopes = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .flatMap(([, sels, decls]) => (/min-height:\s*var\(--tap-min\)/.test(decls) ? sels.split(',') : []))
      .map((s) => s.trim()).filter((s) => s.endsWith(' .studyMore')).map((s) => s.slice(0, -' .studyMore'.length))
    expect(scopes.length).toBeGreaterThan(0)
    for (const scope of scopes) {
      expect(values(CSS, `${scope} .studyStack`, '--study-more-h'), scope).toEqual(['var(--tap-min)'])
    }
  })

  it('no collapse decision on a frame whose fold is stale; the usual hysteresis otherwise', () => {
    // First paint draws every row (budget seeded 99). Deciding on THAT legend latched the
    // hover-only collapse for good with many studies on a short pane.
    expect(nextCompactLegend(false, 400, 150, false)).toBeNull()
    expect(nextCompactLegend(true, 100, 150, false)).toBeNull()
    expect(nextCompactLegend(false, 160, 150)).toBe(true)
    expect(nextCompactLegend(false, 140, 150)).toBeNull()
    expect(nextCompactLegend(true, 140, 150)).toBeNull()      // inside the 12px hysteresis
    expect(nextCompactLegend(true, 137, 150)).toBe(false)
    expect(nextCompactLegend(false, 0, 150)).toBeNull()       // nothing measured yet
  })

  it('an EXPANDED stack never trips the collapse, and its height is never remembered as the full legend', () => {
    // Measured on production 2026-11-16: `+3 more` on a short pane made the whole legend
    // hover-only and small, and `Less` did not bring it back.
    expect(nextCompactLegend(false, 400, 150, true, true)).toBeNull()   // would collapse if folded
    expect(nextCompactLegend(true, 100, 150, true, true)).toBeNull()    // and no un-collapse either
    // the control: the same numbers DO decide once the stack is folded again
    expect(nextCompactLegend(false, 400, 150, true, false)).toBe(true)
    expect(nextCompactLegend(true, 100, 150, true, false)).toBe(false)
    // the memory: only a settled, full, FOLDED legend is measured
    expect(fullLegendMeasurable(true, false, false)).toBe(true)
    expect(fullLegendMeasurable(true, false, true)).toBe(false)
    expect(fullLegendMeasurable(true, true, false)).toBe(false)
    expect(fullLegendMeasurable(false, false, false)).toBe(false)
  })

  it('the range bar steps aside for an expanded stack, so it never covers the Less button', () => {
    // Measured 2026-11-16 on the fixed fold: the bar sat on the expanded stack's last row and a
    // click on `Less` pressed `3M`.
    expect(rangeBarYieldsToLegend(false, true)).toBe(true)
    expect(rangeBarYieldsToLegend(true, false)).toBe(true)    // the collapse always hid it
    expect(rangeBarYieldsToLegend(false, false)).toBe(false)  // the control: at rest the bar is drawn
    // the wire: the bar's own render gate asks, with the V2 stack's expand
    expect(JSX).toMatch(/&& !rangeBarYieldsToLegend\(compactLegend, legendV2 && chipsExpanded\) && \(\s*<div ref=\{rangeBarRef\}/)
  })

  it('an expand with no fold left to close is dropped, so the range bar and the collapse come back', () => {
    // Measured 2026-11-17 on production: `+2 more` at a 640px window, then the window at 1000px.
    // Every row fits, so no `Less` is drawn, and the expand stood for the life of the chart: no
    // 3M / 6M / YTD bar, no responsive collapse, nothing to press.
    expect(stackExpandIsStale(true, false, true)).toBe(true)
    // the controls: a fold that is still there keeps the member's expand ...
    expect(stackExpandIsStale(true, true, true)).toBe(false)
    // ... nothing to drop when it was never expanded ...
    expect(stackExpandIsStale(false, false, true)).toBe(false)
    // ... not on the frame a new budget was just set (`canFold` still describes the old one) ...
    expect(stackExpandIsStale(true, false, false)).toBe(false)
    // ... and not before the legend has rendered once (the ref starts null, never false)
    expect(stackExpandIsStale(true, null, true)).toBe(false)
    // the wire: the render writes what the sampler reads, and the sampler drops the expand
    expect(JSX).toMatch(/const studyCanFold = studyFitFrom < studyTotal\s+studyCanFoldRef\.current = studyCanFold\s/)
    expect(JSX).toMatch(/const staleExpand = stackExpandIsStale\(chipsExpandedRef\.current, studyCanFoldRef\.current, foldSettled\)\s+if \(staleExpand\) setChipsExpanded\(false\)/)
    expect(JSX).toMatch(/if \(!foldSettled \|\| nextCompact !== null \|\| staleExpand\) settled = false/)
    expect(JSX).toMatch(/const studyCanFoldRef = useRef\(null\)/)
  })

  it('an OPEN stack is lifted above the pane divider handle, and only an open one', () => {
    // Measured 2026-11-16: on a short pane the open stack's `Less` landed on the divider between
    // two panes, and the chart library's drag handle (above the legend) took the click.
    expect(stackDrawnOpen(true, true, true)).toBe(true)
    expect(stackDrawnOpen(true, false, true)).toBe(false)   // folded: the legend stacks as before
    expect(stackDrawnOpen(true, true, false)).toBe(false)   // nothing folds: nothing is open
    expect(stackDrawnOpen(false, true, true)).toBe(false)   // the flat legend has no stack
    // the wire: the legend's own class list asks
    expect(JSX).toMatch(/\$\{stackDrawnOpen\(legendV2, chipsExpanded, studyCanFold\) \? ' ' \+ styles\.legendStackOpen : ''\}/)
    // ⭐ DERIVED, NOT RESTATED: the handle's z-index is read out of the chart library that draws
    // it, so an upgrade that raises the handle fails here instead of silently re-breaking `Less`.
    const lib = readFileSync(join(SRC, '..', 'node_modules/lightweight-charts/dist/lightweight-charts.development.mjs'), 'utf8')
    const handle = /_addResizableHandle\(\) \{[\s\S]*?const element = document\.createElement\('div'\);[\s\S]*?style\.zIndex = '(\d+)';[\s\S]*?style\.cursor = 'row-resize';/.exec(lib)
    expect(handle, 'the pane divider handle was not found in lightweight-charts: re-derive this rail').not.toBeNull()
    const handleZ = Number(handle[1])
    expect(handleZ).toBeGreaterThan(0)
    const [openZ] = values(CSS, '.legendStackOpen', 'z-index').map(Number)
    const [restZ] = values(CSS, '.legend', 'z-index').map(Number)
    expect(openZ, 'an open stack must sit above the divider handle').toBeGreaterThan(handleZ)
    // the control: this is a real ordering, not a rule that passes whatever the numbers are
    expect(restZ, 'the legend at rest is below the handle, which is why the lift exists').toBeLessThan(handleZ)
  })

  it('the sampler marks the fold unsettled whenever it sets a new budget or cost, and gates on it (the wire)', () => {
    expect(JSX).toMatch(/if \(fit !== studyRowBudgetRef\.current\) \{ setStudyRowBudget\(fit\); foldSettled = false \}/)
    expect(JSX).toMatch(/if \(moreRows !== null && moreRows !== studyMoreRowsRef\.current\) \{ setStudyMoreRows\(moreRows\); foldSettled = false \}/)
    expect(JSX).toMatch(/if \(leg && fullLegendMeasurable\(foldSettled, compactLegendRef\.current, chipsExpandedRef\.current\)\) \{/)
    expect(JSX).toMatch(/nextCompactLegend\(compactLegendRef\.current, lastFullBottomRef\.current,\s*plan\.collapseThresholdPx, foldSettled, chipsExpandedRef\.current\)/)
    // the sampler reads the member's expand through a ref kept in step with the state
    expect(JSX).toMatch(/chipsExpandedRef\.current = chipsExpanded\r?\n/)
    // and no second, ungated writer of the collapse is left in the sampler
    expect(JSX.match(/setCompactLegend\(true\)/g) || []).toEqual([])
  })

  it('the sampler reads the variable and the gap off the stack, and the fold uses the result (the wire)', () => {
    // the RENDERED button's own height first; the stylesheet variable only when none is drawn
    expect(JSX).toMatch(/const moreBtn = stack\.querySelector\('\[data-study-more\]'\)/)
    expect(JSX).toMatch(/const moreH = moreBtn \? moreBtn\.offsetHeight\s*: cssLengthPx\(stackCs\.getPropertyValue\('--study-more-h'\), rootPx\)/)
    expect(JSX).toMatch(/studyDisclosureRows\(moreH, cssLengthPx\(stackCs\.rowGap\)\)/)
    expect(JSX).toMatch(/if \(moreRows !== null && moreRows !== studyMoreRowsRef\.current\)/)
    // the attribute the sampler looks for is on the disclosure button itself
    expect(JSX).toMatch(/className=\{`\$\{chipStyles\.chipMore\} \$\{styles\.studyMore\}`\}\s*data-study-more=""/)
    expect(JSX).toMatch(/const stackCs = getComputedStyle\(stack\)/)
    expect(JSX).toMatch(/const studyRoom = studyFoldRoom\(studyTotal, studyRowBudget, studyMoreRows\)/)
    // `stack` is the element the `.studyStack` class is rendered on
    expect(JSX).toMatch(/ref=\{studyStackRef\}[^>]*className=\{styles\.studyStack\}|className=\{styles\.studyStack\}[^>]*ref=\{studyStackRef\}/)
  })
})
