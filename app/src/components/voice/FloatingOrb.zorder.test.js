/* ORB-EATS-THE-CHART-MENU — the stacking rail.
 *
 * `voice/FloatingOrb.module.css` hardcoded `z-index: 8000`. The token scale
 * tops out at `--z-toast: 1100`, so the orb, its satellites and the first-run
 * coach-mark rendered ON TOP of every modal in the app — including the chart's
 * long-press ContextMenu, whose `Chart settings…` item is the ONLY route to the
 * Phase E criteria builder on a phone. The 2026-08-09 mobile audit could not
 * click through to the builder at all for this reason.
 *
 * WHY THIS TEST READS FILES INSTEAD OF RENDERING: jsdom does no layout and CSS
 * modules are not applied, so a render test cannot see a stacking order. The
 * declarations ARE the artifact under test.
 *
 * DERIVED, NEVER RETYPED: every number below is parsed out of the real CSS and
 * resolved through the real token scale. Retyping `1000` here would make this
 * file a second authority over `--z-modal` — the repo's single most repeated
 * defect — and it would keep passing after someone moved the token.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '../..')

const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8')

/** Every `--z-*: <n>;` custom property declared in tokens.css. */
function zTokens() {
  const css = read('styles/tokens.css')
  const out = {}
  for (const m of css.matchAll(/(--z-[a-z-]+)\s*:\s*([0-9]+)\s*;/g)) {
    out[m[1]] = Number(m[2])
  }
  return out
}

/** The `z-index` declaration of `selector` in `rel`, as written. */
function rawZIndex(rel, selector) {
  const css = read(rel)
  // Find the selector's block, then the first z-index inside it.
  const at = css.indexOf(selector)
  if (at < 0) return null
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  if (open < 0 || close < 0) return null
  const block = css.slice(open + 1, close)
  const m = block.match(/z-index\s*:\s*([^;]+);/)
  return m ? m[1].trim() : null
}

/** Resolve `var(--x)` / `calc(var(--x) + n)` / a literal against the token map. */
function resolveZ(raw, tokens) {
  if (raw == null) return null
  const lit = raw.match(/^-?[0-9]+$/)
  if (lit) return Number(raw)
  const calc = raw.match(/^calc\(\s*var\((--z-[a-z-]+)\)\s*([+-])\s*([0-9]+)\s*\)$/)
  if (calc) {
    const base = tokens[calc[1]]
    if (base == null) return null
    return calc[2] === '+' ? base + Number(calc[3]) : base - Number(calc[3])
  }
  const v = raw.match(/^var\((--z-[a-z-]+)\)$/)
  if (v) return tokens[v[1]] ?? null
  return null
}

const T = zTokens()
const ORB_RAW = rawZIndex('components/voice/FloatingOrb.module.css', '.orbCluster')
const BUBBLE_RAW = rawZIndex('components/voice/TranscriptBubble.module.css', '.bubble')
const MENU_RAW = rawZIndex('components/chart/ChartContextMenu.module.css', '.menu')

const orb = resolveZ(ORB_RAW, T)
const bubble = resolveZ(BUBBLE_RAW, T)
const chartMenu = resolveZ(MENU_RAW, T)

describe('CONTROL — the probes actually resolved something', () => {
  // Without these, every ordering assertion below could pass on `null < null`
  // being false-y nonsense, or on a token map that silently came back empty.
  test('the token scale parsed, and carries the rungs this test reasons about', () => {
    expect(Object.keys(T).length).toBeGreaterThan(5)
    for (const k of ['--z-base', '--z-sticky', '--z-nav', '--z-fab', '--z-backdrop', '--z-drawer', '--z-modal', '--z-toast']) {
      expect(T[k], `${k} missing from tokens.css`).toEqual(expect.any(Number))
    }
  })

  test('each z-index declaration was found and resolved to a number', () => {
    expect(ORB_RAW, '.orbCluster has no z-index').not.toBeNull()
    expect(BUBBLE_RAW, '.bubble has no z-index').not.toBeNull()
    expect(MENU_RAW, 'ChartContextMenu .menu has no z-index').not.toBeNull()
    expect(orb, `unresolvable: ${ORB_RAW}`).toEqual(expect.any(Number))
    expect(bubble, `unresolvable: ${BUBBLE_RAW}`).toEqual(expect.any(Number))
    expect(chartMenu, `unresolvable: ${MENU_RAW}`).toEqual(expect.any(Number))
  })

  test('the token scale is ordered the way the assertions assume', () => {
    expect(T['--z-base']).toBeLessThan(T['--z-sticky'])
    expect(T['--z-sticky']).toBeLessThan(T['--z-nav'])
    expect(T['--z-backdrop']).toBeLessThan(T['--z-drawer'])
    expect(T['--z-drawer']).toBeLessThan(T['--z-modal'])
    expect(T['--z-modal']).toBeLessThan(T['--z-toast'])
  })
})

describe('the orb sits ABOVE ordinary content', () => {
  test('above the page-chrome rungs a sticky header would use', () => {
    expect(orb).toBeGreaterThan(T['--z-base'])
    expect(orb).toBeGreaterThan(T['--z-dropdown'])
    expect(orb).toBeGreaterThan(T['--z-sticky'])
  })

  test('at least as high as the nav, so a fixed bar cannot cover it', () => {
    expect(orb).toBeGreaterThanOrEqual(T['--z-nav'])
  })
})

describe('the orb sits BELOW everything the user deliberately opened', () => {
  test('below the chart long-press menu — the only phone door to the builder', () => {
    expect(orb).toBeLessThan(chartMenu)
  })

  test('below every backdrop / drawer / modal / toast rung', () => {
    expect(orb).toBeLessThan(T['--z-backdrop'])
    expect(orb).toBeLessThan(T['--z-drawer'])
    expect(orb).toBeLessThan(T['--z-modal'])
    expect(orb).toBeLessThan(T['--z-toast'])
  })

  test('the transcript bubble tracks the orb instead of floating free', () => {
    // It was 8001 — "just above the orb's 8000" — which is how a satellite
    // number ended up above every modal too.
    expect(bubble).toBeGreaterThan(orb)
    expect(bubble).toBeLessThan(T['--z-backdrop'])
    expect(bubble).toBeLessThan(chartMenu)
  })
})

describe('no second hardcoded literal', () => {
  test('the orb and its bubble reference the token scale, not a magic number', () => {
    // A literal here is exactly how 8000 happened. Both must be var()-derived
    // so moving a token moves them.
    expect(ORB_RAW).toMatch(/var\(--z-/)
    expect(BUBBLE_RAW).toMatch(/var\(--z-/)
  })
})
