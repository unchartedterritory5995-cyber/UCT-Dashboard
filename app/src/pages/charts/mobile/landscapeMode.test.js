// @vitest-environment node
/* Item 7 — landscape as a DESIGNED MODE, guarded where a static test can guard.
 *
 * ⛔ WHAT THIS FILE CAN AND CANNOT PROVE, stated up front so nobody reads more
 * into it. jsdom performs no layout and reports `pointer: fine`, so it can never
 * evaluate this mode — and neither can a desktop iframe, which was MEASURED
 * tonight: at 844×390 the media query matched WITHOUT the `(pointer: coarse)`
 * clause and failed WITH it, so the rule was inert while every other signal
 * about the viewport looked correct. A probe that omits the pointer clause
 * reports success against a rule that never applied.
 *
 * So the mode itself is proven on hardware, by the device harness's live
 * landscape panel — read on an iPhone 16 Plus / iOS 18.6 (430px), rotated:
 *     mode engaged: yes · toolbar is an out-of-flow vertical rail: yes
 *     (absolute/column) · rail hugs the LEFT edge: yes x=59 w=52 ·
 *     all five doors kept: Timeframe · Chart type · Indicators · Watchlist ·
 *     More tools
 *
 * ⭐ THIS FILE GUARDS THE DECLARATION, which is the part that can vanish in a
 * refactor with nothing going red. It is the `boardsDoor.wire.test.jsx` shape:
 * read the shipped artifact, name what is missing, and carry a non-vacuity
 * control so it cannot pass for the wrong reason.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CSS = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'MobileCharts.module.css'), 'utf8')

const GATE = '@media (pointer: coarse) and (orientation: landscape) and (max-height: 500px)'

/** The text of the landscape block — throws BY NAME rather than matching nothing. */
function landscapeBlock() {
  const start = CSS.indexOf(GATE)
  expect(start, `the landscape gate is gone from the stylesheet: ${GATE}`).toBeGreaterThan(-1)
  // Walk braces from the gate to its closing one.
  let depth = 0, i = CSS.indexOf('{', start)
  const from = i
  for (; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++
    else if (CSS[i] === '}') { depth--; if (depth === 0) return CSS.slice(from, i + 1) }
  }
  throw new Error('unterminated landscape block')
}

describe('landscape is a designed mode, not a rotation', () => {
  const block = landscapeBlock()

  it('⛔ the toolbar LEAVES THE FLOW — the bottom row is what costs the scarce axis', () => {
    expect(block).toMatch(/\.toolbar\s*\{[^}]*position:\s*absolute/s)
  })

  it('⛔ and becomes a VERTICAL rail — a row is portrait grammar', () => {
    expect(block).toMatch(/\.toolbar\s*\{[^}]*flex-direction:\s*column/s)
  })

  it('⛔ anchored LEFT, never right — the right edge is the price scale and the newest bars', () => {
    const tb = /\.toolbar\s*\{([^}]*)\}/s.exec(block)
    expect(tb, 'no .toolbar rule inside the landscape block').toBeTruthy()
    expect(tb[1]).toMatch(/left:/)
    expect(tb[1], 'the rail must never anchor to the right edge — it would cover the current price')
      .not.toMatch(/(^|[^-])right:\s*(?!auto)/m)
  })

  it('keeps a real tap target — a rail is not an excuse to shrink below --tap-min', () => {
    expect(block).toMatch(/min-height:\s*var\(--tap-min\)/)
  })

  it('the shell is positioned, or the rail would escape to the viewport', () => {
    expect(block).toMatch(/\.shell\s*\{[^}]*position:\s*relative/s)
  })

  it('NON-VACUITY · the same read still finds the pre-existing immersive rules', () => {
    // If the extractor were returning the wrong text, this would fail too.
    expect(block).toContain('.symStrip')
    expect(block).toMatch(/height:\s*100dvh/)
  })
})
