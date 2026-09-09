/* EMBEDDED-LIST-CAPPED-ON-PHONES — the "the standalone page's cap is not the
 * widget's cap" rail.
 *
 * `Watchlists.module.css` ends with the STANDALONE page's phone layout:
 * `/watchlists` stacks the list OVER a chart, so `.leftPanel` is capped
 * (45vh at <=768, then 38vh at <=480) to leave the chart room below it, and
 * `.page` drops to `overflow: visible` so the stacked column can grow.
 *
 * An EMBEDDED host has neither shape. There the list IS the whole widget and
 * the chart is a separate surface. Measured in the live breadth drill at
 * 390x844 before the fix: list pane 785px tall, list body 262px, ~46% of the
 * phone screen blank below it, virtualizer rendering 8 rows. After: 631px and
 * 23 rows. Every render site is such a host (BreadthDrillList, WatchlistWidget,
 * ScannerResults, PeriodSortResults, EtfHoldingsResults).
 *
 * TWO specificity facts carry the fix, and each is a separate way to break it:
 *  - `.pageEmbedded` and `.page` are BOTH (0,1,0), so the responsive block wins
 *    on SOURCE ORDER alone => the override must sit BELOW it.
 *  - `.pageEmbedded > .leftPanel` is (0,2,0) and outranks the bare `.leftPanel`
 *    inside the media queries => max-height is settled at every breakpoint
 *    without restating one.
 *
 * jsdom does no cascade and loads no CSS modules, so a component test is
 * structurally blind to this: the declarations are the artifact under test.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(HERE, 'Watchlists.module.css'), 'utf8')

const RESPONSIVE = '@media (max-width: 768px)'
const respAt = css.indexOf(RESPONSIVE)

/** Every `.pageEmbedded > .leftPanel` rule, as {at, body}, in source order. */
function embeddedLeftRules() {
  const out = []
  const re = /\.pageEmbedded\s*>\s*\.leftPanel\s*\{/g
  let m
  while ((m = re.exec(css)) !== null) {
    const open = css.indexOf('{', m.index)
    const close = css.indexOf('}', open)
    if (close < 0) continue
    out.push({ at: m.index, body: css.slice(open + 1, close) })
  }
  return out
}

describe('CONTROL - the rules this rail reasons about are actually present', () => {
  test('the standalone phone cap still exists (this rail exists because of it)', () => {
    expect(respAt, 'responsive block not found').toBeGreaterThan(-1)
    // If BOTH caps are ever deleted, the override below is dead weight - fail
    // loudly rather than keep guarding a rule nobody applies any more.
    expect(css).toMatch(/\.leftPanel\s*\{[^}]*max-height:\s*45vh/)
    expect(css).toMatch(/@media \(max-width: 480px\)[\s\S]{0,120}max-height:\s*38vh/)
  })

  test('the standalone page still drops to overflow:visible on phones', () => {
    const block = css.slice(respAt, css.indexOf('}', css.indexOf('.rightPanel', respAt)))
    expect(block).toMatch(/\.page\s*\{[^}]*overflow:\s*visible/)
  })

  test('there is a base .pageEmbedded > .leftPanel rule to build on', () => {
    expect(embeddedLeftRules().length).toBeGreaterThanOrEqual(2)
  })
})

describe('an embedded watchlist keeps its own box on phones', () => {
  test('.pageEmbedded > .leftPanel clears the standalone max-height cap', () => {
    const withCap = embeddedLeftRules().filter(r => /max-height:\s*none/.test(r.body))
    expect(
      withCap.length,
      'no `.pageEmbedded > .leftPanel { max-height: none }` - the 45vh/38vh cap ' +
      'squeezes every embedded list into ~38% of a phone screen',
    ).toBe(1)
  })

  test('the override sits BELOW the responsive block (source order is the tiebreak)', () => {
    const [override] = embeddedLeftRules().filter(r => /max-height:\s*none/.test(r.body))
    expect(
      override.at,
      'the override moved above the responsive block; `.pageEmbedded` and `.page` ' +
      'are the same specificity, so the media rules would win again',
    ).toBeGreaterThan(respAt)
  })

  test('.pageEmbedded re-asserts overflow:hidden after the responsive block', () => {
    const re = /\.pageEmbedded\s*\{([^}]*)\}/g
    let m, found = false
    while ((m = re.exec(css)) !== null) {
      if (m.index > respAt && /overflow:\s*hidden/.test(m[1])) found = true
    }
    expect(
      found,
      'a widget must clip its own content; `@media .page { overflow: visible }` ' +
      'otherwise wins on source order and the embedded page stops clipping',
    ).toBe(true)
  })

  test('the fix rides specificity + order, not !important', () => {
    const [override] = embeddedLeftRules().filter(r => /max-height:\s*none/.test(r.body))
    expect(override.body).not.toMatch(/!important/)
  })
})
