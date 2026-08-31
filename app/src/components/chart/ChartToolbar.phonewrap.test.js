/* PHONE-TOOLBAR-OVERLAP — the "Magnet intercepts Trendline" rail.
 *
 * Measured 2026-08-30 via a Playwright touch walk on a 393px viewport: the
 * drawing toolbar's ACTIONS cluster (7 coarse 40px buttons + the labelled
 * Indicators button) is wider than the whole phone toolbar. As a fixed
 * `flex: 0 0 auto` item it overflowed the single flex line and painted on top
 * of the tools rail — which had shrunk to zero — so EVERY drawing tool was
 * untappable on a phone (the tap on Trendline landed on the Magnet button).
 *
 * The fix is three declarations inside the toolbar's phone media block:
 *   .toolbar → flex-wrap: wrap      (lines may stack instead of overpainting)
 *   .actions → flex-basis 100%      (actions take their own line(s) below)
 *   .tools   → flex-basis 0         (the rail shares line 1 with the collapse
 *                                    chevron instead of orphaning it)
 * Lose any one and the phone drawing rail regresses. jsdom does no layout, so
 * the declarations are the artifact under test — the mobileShellHeight idiom.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'ChartToolbar.module.css'),
  'utf8',
)

/** The body of the first `@media (max-width: 640px)` block. */
function phoneBlock(src) {
  const m = src.indexOf('@media (max-width: 640px)')
  if (m < 0) return null
  const open = src.indexOf('{', m)
  let depth = 1
  let i = open + 1
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') depth--
    i++
  }
  return src.slice(open + 1, i - 1)
}

/** Body of the first rule for `selector` inside `block`. */
function ruleBody(block, selector) {
  const re = new RegExp(`\\${selector}(?![\\w-])[^{]*\\{`)
  const m = block.match(re)
  if (!m) return null
  const open = block.indexOf('{', m.index)
  const close = block.indexOf('}', open)
  return close < 0 ? null : block.slice(open + 1, close)
}

const block = phoneBlock(css)

describe('CONTROL — the phone media block and its rules were actually found', () => {
  test('the ≤640px block exists and styles the toolbar', () => {
    expect(block, 'no @media (max-width: 640px) block in ChartToolbar.module.css').not.toBeNull()
    expect(ruleBody(block, '.toolbar')).not.toBeNull()
  })
})

describe('the three declarations that keep drawing tools tappable on a phone', () => {
  test('.toolbar wraps instead of letting the actions cluster overpaint the tools', () => {
    expect(ruleBody(block, '.toolbar')).toMatch(/flex-wrap\s*:\s*wrap/)
  })

  test('.actions takes its own line (flex-basis 100%)', () => {
    const body = ruleBody(block, '.actions')
    expect(body, '.actions has no rule in the phone block').not.toBeNull()
    expect(body).toMatch(/flex\s*:\s*1\s+1\s+100%|flex-basis\s*:\s*100%/)
  })

  test('.tools shares line 1 with the collapse chevron (flex-basis 0)', () => {
    const body = ruleBody(block, '.tools')
    expect(body, '.tools has no rule in the phone block').not.toBeNull()
    expect(body).toMatch(/flex\s*:\s*1\s+1\s+0(?![\d%])|flex-basis\s*:\s*0(?![\d%])/)
  })
})
