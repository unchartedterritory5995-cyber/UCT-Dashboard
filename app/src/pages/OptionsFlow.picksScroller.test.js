/* OF-ROW-AMPUTATION — the wire between the JSX hook and the phone layer.
 *
 * `/options-flow` on a phone rendered every TOP 10 FLOW PICKS row at 950px
 * inside a 321px box. The whole ancestor chain was `overflow-x: visible` up to
 * `.of-mroot`'s `overflow-x: hidden`, and there was NO scroller anywhere
 * (`hasScroller: false`) — 629px of every row (contract, strike/expiry, size,
 * premium, OI, grade) permanently unreachable. And because the clip happened at
 * the root, the document-overflow probe reported a clean `0` on the page that
 * lost the most data.
 *
 * OptionsFlow.jsx is PARTNER-OWNED (~7k lines, inline styles). The rebase-safe
 * technique is className-only HOOKS in the JSX + an additive `@media
 * (max-width:640px)` layer. That means the fix is TWO HALVES OF ONE WIRE, and
 * either half can be lost to a rebase while the other still looks correct — the
 * exact failure mode the 2026-08-08 audit named (8 features built, tested,
 * green, and connected to nothing). This rail goes RED when the wire is cut,
 * from either end.
 *
 * jsdom does no layout, so `scrollWidth` is not observable here; the pixel proof
 * is the audit re-run. This guards the wiring the pixels depend on.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const jsx = readFileSync(resolve(HERE, 'OptionsFlow.jsx'), 'utf8')
const css = readFileSync(resolve(HERE, 'OptionsFlow.mobile.css'), 'utf8')

const PHONE_MQ = '@media (max-width: 640px)'

/** The body of the phone media block — every rule in this file lives inside it. */
function phoneBlock() {
  const at = css.indexOf(PHONE_MQ)
  if (at < 0) return null
  return css.slice(css.indexOf('{', at) + 1)
}

describe('CONTROL — the files under test are the ones we think', () => {
  test('OptionsFlow.jsx still renders the picks list', () => {
    expect(jsx).toContain('TOP 10 FLOW PICKS')
  })

  test('the mobile layer is imported by the component', () => {
    expect(jsx).toMatch(/import\s+['"]\.\/OptionsFlow\.mobile\.css['"]/)
  })

  test('the phone media query the whole layer rides on is present', () => {
    expect(phoneBlock()).not.toBeNull()
  })
})

describe('JSX half — the className hooks exist', () => {
  test('the picks list container carries of-picks', () => {
    expect(jsx).toMatch(/className="of-picks"/)
  })

  test('the header row and the pick rows carry of-pickrow', () => {
    const hits = [...jsx.matchAll(/className="of-pickrow"/g)]
    // One for the column-header row, one for the row template inside picks.map.
    expect(hits.length).toBeGreaterThanOrEqual(2)
  })

  test('the hooks were added WITHOUT touching the partner inline styles', () => {
    // Both hooks sit on elements that still carry their original style={{...}}.
    expect(jsx).toMatch(/className="of-picks"\s+style=\{\{/)
    expect(jsx).toMatch(/className="of-pickrow"[^>]*style=\{\{/)
  })
})

describe('CSS half — the phone layer makes the list a real scroller', () => {
  const block = phoneBlock()

  test('.of-picks scrolls horizontally', () => {
    expect(block).toMatch(/\.of-mroot\s+\.of-picks\s*\{[^}]*overflow-x:\s*auto/)
  })

  test('.of-pickrow keeps its natural width instead of being squeezed', () => {
    // `min-width: max-content` is what turns "950px of columns crushed into
    // 321px" into "950px of columns you can reach". Squeezing them (the
    // tempting alternative) shrinks the data away instead of revealing it.
    expect(block).toMatch(/\.of-mroot\s+\.of-pickrow\s*\{[^}]*min-width:\s*max-content/)
  })

  test('the scroller sits on the LIST, not on each row', () => {
    // Per-row scrollers would let the ten rows and the header drift out of
    // register — ten independent scroll positions over one column grid.
    const rowRule = block.match(/\.of-mroot\s+\.of-pickrow\s*\{([^}]*)\}/)
    expect(rowRule).not.toBeNull()
    expect(rowRule[1]).not.toMatch(/overflow-x:\s*(auto|scroll)/)
  })

  test('a horizontal swipe does not chain into page navigation', () => {
    expect(block).toMatch(/\.of-mroot\s+\.of-picks\s*\{[^}]*overscroll-behavior-x:\s*contain/)
  })
})

describe('the root clip that produced the misleading zero is still explained', () => {
  test('.of-mroot keeps overflow-x: hidden — now with a scroller beneath it', () => {
    // Removing the root hidden would "fix" the overflow number by breaking the
    // page. The honest shape is: root clipped, payload scrollable.
    expect(phoneBlock()).toMatch(/\.of-mroot\s*\{[^}]*overflow-x:\s*hidden/)
  })
})
