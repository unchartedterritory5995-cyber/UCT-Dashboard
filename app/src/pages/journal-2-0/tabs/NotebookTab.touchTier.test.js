// The notebook's view toggles must be finger-sized on a TABLET, not just a phone.
//
// ⛔⛔ WHY THIS EXISTS ALONGSIDE `src/styles/tapFloor.test.js`, WHICH PASSES.
// That rail's rule is a RELATIONSHIP: whatever a file declares at 390px it must
// also declare at 820px. `NotebookTab.module.css` declared a finger target at
// NEITHER width, so there was no relationship to violate and the file was
// invisible to it — five 32x32 icon toggles on the notebook's primary surface,
// green the whole time. Its own header says so: "necessary, not sufficient."
// This asserts the floor EXISTS, which is the half that rail cannot see.
//
// ⛔ ONE SELECTOR, NOT A ROSTER. `.viewModeBtn` is the control this file added
// and the one that is icon-only, so it needs BOTH axes. A hand-kept list of
// every toolbar class is the artifact this repo keeps watching go stale.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(
  join(process.cwd(), 'src/pages/journal-2-0/tabs/NotebookTab.module.css'),
  'utf8',
)
const TABLET = 820
const FLOOR = 44

/** Bodies of the @media blocks that ACTUALLY APPLY at `width`.
 *  ⛔ Not "any max-width query": a `max-width: 640px` block does NOT apply at
 *  820, and treating it as if it did is exactly the bug being guarded. */
function mediaBodiesAt(css, width) {
  const out = []
  const re = /@media([^{]+)\{/g
  let m
  while ((m = re.exec(css))) {
    const cond = m[1]
    const max = /max-width:\s*(\d+)px/.exec(cond)
    const min = /min-width:\s*(\d+)px/.exec(cond)
    if (max && width > Number(max[1])) continue
    if (min && width < Number(min[1])) continue
    // walk braces from the block's opening brace to its match
    let depth = 1
    let i = re.lastIndex
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
    }
    out.push(css.slice(re.lastIndex, i - 1))
  }
  return out
}

/** One declaration's value, split on `;` and `:` rather than matched.
 *  ⛔ NOT `new RegExp(`...\s*${prop}...`)`. A template literal eats the escape,
 *  so `\s` becomes a literal `s` and the pattern silently matches nothing — the
 *  rail then reads 0 for a floor that is present, which is how this file first
 *  failed against CSS that was already correct. */
function declValue(decls, prop) {
  for (const part of decls.split(';')) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    if (part.slice(0, colon).trim() !== prop) continue
    return part.slice(colon + 1).trim()
  }
  return null
}

/** px value of a declaration, resolving `var(--tap-min, 44px)` to its fallback. */
function pxOf(body, selector, prop) {
  const rules = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  let best = 0
  for (const [, sels, decls] of rules) {
    const hit = sels.split(',').some((s) => s.trim().split(/\s+/).pop() === selector)
    if (!hit) continue
    const raw = declValue(decls, prop)
    if (raw === null) continue
    const v = /var\(\s*--tap-min\s*,\s*(\d+)px\s*\)/.exec(raw) || /^(\d+)px$/.exec(raw)
    if (v) best = Math.max(best, Number(v[1]))
  }
  return best
}

describe('the notebook toolbar is finger-sized on a tablet', () => {
  const tablet = mediaBodiesAt(CSS, TABLET).join('\n')

  it('⛔ NON-VACUITY — a tablet-applicable block really was found', () => {
    // Without this, a parse that found nothing would make every assertion
    // below pass against an empty string.
    expect(tablet.length).toBeGreaterThan(0)
    expect(tablet).toMatch(/viewModeBtn/)
  })

  it('gives the icon-only view toggles the floor on BOTH axes', () => {
    // A 44px-tall, 32px-wide target is still a miss on the axis the finger
    // travels along, and these five sit shoulder to shoulder.
    expect(pxOf(tablet, '.viewModeBtn', 'min-height')).toBeGreaterThanOrEqual(FLOOR)
    expect(pxOf(tablet, '.viewModeBtn', 'min-width')).toBeGreaterThanOrEqual(FLOOR)
  })

  it('⭐ CONTROL — a phone-only floor does NOT satisfy this', () => {
    // The historical defect verbatim: the floor declared at <=640 and nowhere
    // else. If this rail can be satisfied by a phone-only block it is testing
    // nothing, because that is the state it exists to reject.
    const phoneOnly = `@media (max-width: 640px) { .viewModeBtn { min-height: 44px; min-width: 44px; } }`
    const asTablet = mediaBodiesAt(phoneOnly, TABLET).join('\n')
    expect(pxOf(asTablet, '.viewModeBtn', 'min-height')).toBe(0)
  })
})
