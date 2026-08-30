import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect } from 'vitest'

/**
 * PageHeader.module.css computes its full-bleed negative margin from
 * `--page-pad-top`/`--page-pad-x` — and, below 640px, `--page-pad-top-m`/
 * `--page-pad-x-m` — read off whatever element wraps it (its own header
 * comment: "A page with different padding sets those two vars on the
 * element that wraps this header"). `Breadth.module.css`'s `.page` rule did
 * that at the DEFAULT width, but its two responsive `@media` overrides
 * changed `padding` alone — so PageHeader kept pulling back by the DESKTOP
 * inset (24px) while the page itself was only inset 10px (900px tier) or
 * 8px (640px tier), and the header overhung the viewport by the difference.
 *
 * 🔴 MEASURED IN REAL CHROMIUM (throwaway Vite + Playwright harness, deleted
 * before this commit): `documentElement.scrollWidth` exceeded `clientWidth`
 * by 14px/side at 700x900 and 800x900, and by 8px/side at 390x844, on the
 * Breadth page's Views tab — before the two `@media` blocks below set the
 * matching vars alongside their `padding`. Zero overflow after.
 *
 * ⛔ THE RAIL IS THE PAIRING, NOT A PIXEL. A test asserting `padding` equals
 * some literal would say nothing about whether PageHeader was ever told —
 * exactly how this drifted the first time (the base rule pairs them; the two
 * `@media` overrides that came later did not). Whenever a `.page` rule sets
 * `padding`, it must also set the var(s) in the SAME rule.
 */
describe('.page never changes its own padding without telling PageHeader\'s bleed margin', () => {
  const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'Breadth.module.css')
  const css = readFileSync(cssPath, 'utf8')

  // Every `.page { ... }` rule body (base + each `@media` override), in
  // source order — NOT `.pageCot`/`.pageEmbedded`, which are separate classes.
  const pageRules = [...css.matchAll(/(?<!\S)\.page\s*\{([^}]*)\}/g)].map(m => m[1])

  it('the fixture holds more than one `.page` rule, so the sweep below checks something', () => {
    // A control: collapse this to one rule (or none) and the `it.each` below
    // would pass vacuously — it never touched more than the base rule.
    expect(pageRules.length).toBeGreaterThan(1)
  })

  it.each(pageRules.map((body, i) => [i, body]))('rule #%i', (_, body) => {
    if (!/padding\s*:/.test(body)) return  // doesn't touch padding — nothing to pair
    const setsDesktopVars = /--page-pad-top\s*:/.test(body) && /--page-pad-x\s*:/.test(body)
    const setsMobileVars = /--page-pad-top-m\s*:/.test(body) && /--page-pad-x-m\s*:/.test(body)
    expect(
      setsDesktopVars || setsMobileVars,
      'this rule changes .page padding without pairing --page-pad-top/-x '
        + '(or the -m mobile pair) in the same rule — PageHeader\'s bleed '
        + 'margin will overhang the viewport by the difference',
    ).toBe(true)
  })
})
