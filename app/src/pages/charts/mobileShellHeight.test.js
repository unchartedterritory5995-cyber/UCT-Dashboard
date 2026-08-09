/* CHART-CLIPPED-BY-TABBAR — the "subtract BOTH bars" rail.
 *
 * `.mobileWorkspace` sized itself with `calc(100dvh - 48px - safe-area-top)`:
 * it subtracted the fixed 48px top bar and forgot the fixed bottom tab bar.
 * Both bars are `position: fixed` and therefore invisible to a viewport-anchored
 * calc, so the workspace ran to y=812 against a bar top of 757 — 54px of chart
 * (volume pane, `3M 6M YTD 1Y 5Y` range bar, `A L %` scale toggles) buried under
 * the nav, and STILL buried after scrolling the container to its end. It was the
 * only route in the app where that was true.
 *
 * The real defect was a SECOND AUTHORITY: `Layout.module.css` already reserved
 * space for both bars, and `.mobileWorkspace` restated one of the two numbers by
 * hand. This rail asserts the heights are declared ONCE (tokens.css) and that
 * every consumer subtracts the tokens rather than a literal — so the next
 * viewport-locked route physically cannot forget a bar.
 *
 * jsdom does no layout, so the declarations are the artifact under test.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '../..')
const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8')

const TOP = '--mobile-topbar-h'
const BOTTOM = '--mobile-tabbar-h'

/** Body of the first rule whose selector line starts with `selector`. */
function ruleBody(css, selector) {
  const re = new RegExp(`^\\s*\\${selector}\\s*\\{`, 'm')
  const m = css.match(re)
  if (!m) return null
  const open = css.indexOf('{', m.index)
  const close = css.indexOf('}', open)
  return close < 0 ? null : css.slice(open + 1, close)
}

const tokensCss = read('styles/tokens.css')
const layoutCss = read('components/Layout.module.css')
const wsCss = read('pages/charts/ChartsWorkspace.module.css')
const tabbarCss = read('components/mobile/MobileTabBar.module.css')
const topbarCss = read('components/MobileNav.module.css')

const wsBody = ruleBody(wsCss, '.mobileWorkspace')
const mainBody = ruleBody(layoutCss, '.main')

describe('CONTROL — the rules this test reasons about were actually found', () => {
  test('.mobileWorkspace exists and declares a height', () => {
    expect(wsBody, '.mobileWorkspace rule not found').not.toBeNull()
    expect(wsBody).toMatch(/height\s*:/)
  })

  test('Layout still reserves space for both bars on the touch shell', () => {
    // `.main` under @media (max-width: 1024px) — the second `.main` block.
    const touch = layoutCss.slice(layoutCss.indexOf('@media (max-width: 1024px)'))
    expect(touch).toMatch(/padding-top\s*:/)
    expect(touch).toMatch(/padding-bottom\s*:/)
  })
})

describe('the two chrome heights are declared exactly once', () => {
  test('both tokens exist in tokens.css', () => {
    expect(tokensCss).toMatch(new RegExp(`${TOP}\\s*:\\s*\\d+px\\s*;`))
    expect(tokensCss).toMatch(new RegExp(`${BOTTOM}\\s*:\\s*\\d+px\\s*;`))
  })

  test('tokens.css is the ONLY declaration site — consumers may not redeclare', () => {
    for (const [name, css] of [
      ['Layout.module.css', layoutCss],
      ['ChartsWorkspace.module.css', wsCss],
      ['MobileTabBar.module.css', tabbarCss],
      ['MobileNav.module.css', topbarCss],
    ]) {
      for (const tok of [TOP, BOTTOM]) {
        expect(
          new RegExp(`${tok}\\s*:\\s*\\d`).test(css),
          `${name} redeclares ${tok} — that is the second authority this fix removed`,
        ).toBe(false)
      }
    }
  })
})

describe('.mobileWorkspace subtracts BOTH bars, via the tokens', () => {
  test('it subtracts the top bar token', () => {
    expect(wsBody).toContain(`var(${TOP})`)
  })

  test('it subtracts the bottom tab-bar token — the 54px that was buried', () => {
    expect(wsBody).toContain(`var(${BOTTOM})`)
  })

  test('every viewport unit it uses is paired with both subtractions', () => {
    // Two declarations (100vh fallback + 100dvh). Neither may forget a bar.
    const heights = [...wsBody.matchAll(/height\s*:\s*calc\(([^;]*)\)\s*;/g)].map(m => m[1])
    expect(heights.length).toBeGreaterThanOrEqual(2)
    for (const h of heights) {
      expect(h, `height calc missing ${TOP}: ${h}`).toContain(`var(${TOP})`)
      expect(h, `height calc missing ${BOTTOM}: ${h}`).toContain(`var(${BOTTOM})`)
    }
  })

  test('no bare pixel literal is subtracted from the viewport any more', () => {
    // `- 48px` / `- 55px` / `- 58px` is the shape that went stale. Safe-area
    // env() terms are fine; a raw px height is not.
    for (const h of [...wsBody.matchAll(/height\s*:\s*calc\(([^;]*)\)\s*;/g)].map(m => m[1])) {
      expect(h, `hardcoded px subtraction survives: ${h}`).not.toMatch(/-\s*\d+px/)
    }
  })
})

describe('Layout and the tab bar agree with the workspace', () => {
  test('Layout reserves with the same two tokens the workspace subtracts', () => {
    expect(mainBody === null ? layoutCss : layoutCss).toContain(`var(${TOP})`)
    expect(layoutCss).toContain(`var(${BOTTOM})`)
  })

  test('the tab bar itself is sized from the reservation token', () => {
    // Otherwise the bar's intrinsic height and the space reserved for it drift,
    // and a route sizing off the viewport has to guess which one to trust.
    expect(tabbarCss).toContain(`var(${BOTTOM})`)
  })

  test('the top bar is sized from its token too', () => {
    expect(topbarCss).toContain(`var(${TOP})`)
  })
})
