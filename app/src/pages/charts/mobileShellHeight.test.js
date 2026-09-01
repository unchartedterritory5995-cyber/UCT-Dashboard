/* CHART-CLIPPED-BY-FIXED-CHROME — the "subtract what Layout reserves" rail.
 *
 * History, in two acts. Act 1: `.mobileWorkspace` sized itself with
 * `calc(100dvh - 48px - safe-area-top)` — it hand-retyped the top bar and
 * FORGOT the bottom tab bar entirely, burying 54px of chart under the nav on
 * the one route where scrolling could never free it. The fix declared both
 * heights ONCE (tokens.css) and made every consumer subtract the tokens.
 *
 * Act 2 (2026-09-01, owner call): the bottom tab bar was REMOVED app-wide —
 * it duplicated the top-left menu route-for-route — and its height went back
 * to the chart. The rail's shape survives the bar it was written about: the
 * contract is still "Layout reserves with tokens; viewport-locked routes
 * subtract the SAME tokens; nobody retypes a px" — now for ONE bar — plus a
 * RESURRECTION GUARD: the tab-bar token may not quietly come back, because a
 * token with no bar behind it re-buries a strip of chart in whitespace.
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
const BOTTOM = '--mobile-tabbar-h'   // retired — guarded against resurrection

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
const topbarCss = read('components/MobileNav.module.css')

const wsBody = ruleBody(wsCss, '.mobileWorkspace')

describe('CONTROL — the rules this test reasons about were actually found', () => {
  test('.mobileWorkspace exists and declares a height', () => {
    expect(wsBody, '.mobileWorkspace rule not found').not.toBeNull()
    expect(wsBody).toMatch(/height\s*:/)
  })

  test('Layout still reserves space for the top bar on the touch shell', () => {
    // `.main` under @media (max-width: 1024px) — the second `.main` block.
    const touch = layoutCss.slice(layoutCss.indexOf('@media (max-width: 1024px)'))
    expect(touch).toMatch(/padding-top\s*:/)
    expect(touch).toMatch(/padding-bottom\s*:/)
  })
})

describe('the top-bar height is declared exactly once', () => {
  test('the token exists in tokens.css', () => {
    expect(tokensCss).toMatch(new RegExp(`${TOP}\\s*:\\s*\\d+px\\s*;`))
  })

  test('tokens.css is the ONLY declaration site — consumers may not redeclare', () => {
    for (const [name, css] of [
      ['Layout.module.css', layoutCss],
      ['ChartsWorkspace.module.css', wsCss],
      ['MobileNav.module.css', topbarCss],
    ]) {
      expect(
        new RegExp(`${TOP}\\s*:\\s*\\d`).test(css),
        `${name} redeclares ${TOP} — that is the second authority this rail removed`,
      ).toBe(false)
    }
  })

  test('the top bar is sized from its token too', () => {
    // Otherwise the bar's intrinsic height and the space reserved for it drift,
    // and a route sizing off the viewport has to guess which one to trust.
    expect(topbarCss).toContain(`var(${TOP})`)
  })
})

describe('RESURRECTION GUARD — the retired tab-bar token stays dead', () => {
  test('no source declares or consumes the tab-bar height token', () => {
    for (const [name, css] of [
      ['styles/tokens.css', tokensCss],
      ['components/Layout.module.css', layoutCss],
      ['pages/charts/ChartsWorkspace.module.css', wsCss],
      ['components/MobileNav.module.css', topbarCss],
    ]) {
      expect(
        css.includes(BOTTOM),
        `${name} references ${BOTTOM} — the bar it measured was removed 2026-09-01; `
          + 'a token with no bar behind it re-buries a strip of chart in whitespace. '
          + 'If the bar is deliberately coming back, restore the full two-bar '
          + 'contract from git history rather than patching one file.',
      ).toBe(false)
    }
  })
})

describe('.mobileWorkspace subtracts exactly what Layout reserves, via the token', () => {
  test('it subtracts the top bar token', () => {
    expect(wsBody).toContain(`var(${TOP})`)
  })

  test('every viewport unit it uses is paired with the subtraction', () => {
    // Two declarations (100vh fallback + 100dvh). Neither may forget the bar.
    const heights = [...wsBody.matchAll(/height\s*:\s*calc\(([^;]*)\)\s*;/g)].map(m => m[1])
    expect(heights.length).toBeGreaterThanOrEqual(2)
    for (const h of heights) {
      expect(h, `height calc missing ${TOP}: ${h}`).toContain(`var(${TOP})`)
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

describe('portrait full-height charting — three files agree the shell owns the viewport', () => {
  // Phase 9 hid the TOP bar on the phone chart shell; with the tab bar gone
  // the shell owns the FULL dynamic viewport. Three declarations in three
  // files must agree — precisely the multi-file drift this rail catches.
  const ATTR = 'html[data-mobile-chart-shell]'
  const PORTRAIT = /@media \(pointer: coarse\) and \(max-width: 640px\)/

  const blockFor = (css, name) => {
    const m = css.match(PORTRAIT)
    expect(m, `${name}: portrait phone block missing`).not.toBeNull()
    // From the FIRST portrait media query containing the attr — search forward.
    const from = css.indexOf(m[0])
    const scoped = css.slice(from)
    expect(scoped, `${name}: portrait block does not scope to the shell attribute`).toContain(ATTR)
    return scoped.slice(0, scoped.indexOf('}', scoped.indexOf(ATTR)) + 1)
  }

  test('MobileNav hides the top bar under the attr, phone-width only', () => {
    expect(blockFor(topbarCss, 'MobileNav.module.css')).toMatch(/display\s*:\s*none/)
  })

  test('Layout releases BOTH reservations (nothing fixed remains on either edge)', () => {
    const b = blockFor(layoutCss, 'Layout.module.css')
    expect(b).toMatch(/padding-top\s*:\s*0/)
    expect(b).toMatch(/padding-bottom\s*:\s*0/)
  })

  test('the workspace override takes the full dynamic viewport, no token subtractions', () => {
    const from = wsCss.search(PORTRAIT)
    expect(from, 'ChartsWorkspace.module.css: portrait override missing').toBeGreaterThan(-1)
    const b = wsCss.slice(from, wsCss.indexOf('}', wsCss.indexOf('height', from)) + 1)
    expect(b).toMatch(/height\s*:\s*100dvh/)
    expect(b, 'the top bar is hidden here — subtracting its token would re-bury a row of chart').not.toContain(`var(${TOP})`)
  })
})
