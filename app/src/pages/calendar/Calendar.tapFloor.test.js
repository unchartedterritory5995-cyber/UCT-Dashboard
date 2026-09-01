// app/src/pages/calendar/Calendar.tapFloor.test.js
//
// The calendar declared its finger targets at `@media (max-width: 640px)` and
// nowhere else, so the TABLET tier (641-1024) — which this repo calls touch
// (breakpoints.css) — sat under the 44px floor on nearly every control.
//
// Probed at 820px with the page confirmed rendered: 19 sub-44px targets across
// 11 classes, including the DAY TABS at 27px tall, which are this page's
// primary navigation. At 390px the same page had 5. Tablet was not a smaller
// phone; it was simply uncovered.
//
// ⛔ THE LIST IS DERIVED FROM THE STYLESHEET, NEVER TYPED. The rule is a
// relationship, not a roster: whatever the PHONE block declares a finger
// target, the TOUCH tier must declare too. Add a control to the phone block
// tomorrow and this names it the same day.
//
// ⛔ WHY A CSS TEST AT ALL: jsdom computes no layout, so no rendering test in
// this suite can measure a tap target. `tools/mobile_audit.py` can, but it
// needs a running server and a browser. This is the standing check in between.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = join(process.cwd(), 'src', 'pages', 'calendar', 'Calendar.module.css')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Bodies of every `@media` block that ACTUALLY APPLIES at `width`.
 *
 * ⛔ NOT "max-width <= bound". That was the first version and it made the
 * whole suite a tautology: a `<=1024px` query also matches 390px, so the
 * phone class set was always a SUBSET of the touch set and the check could
 * never fail. The CONTROL below is what caught it — the rail was green and
 * meaningless for one commit's worth of time.
 */
function mediaBodies(css, width) {
  const out = []
  const re = /@media([^{]+)\{/g
  let m
  while ((m = re.exec(css))) {
    const cond = m[1]
    const max = /max-width:\s*(\d+)px/.exec(cond)
    const min = /min-width:\s*(\d+)px/.exec(cond)
    const applies = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
    let depth = 1
    let i = re.lastIndex
    while (i < css.length && depth) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
      i += 1
    }
    if (applies) out.push(css.slice(re.lastIndex, i - 1))
  }
  return out.join('\n')
}

/**
 * Classes whose rule body sets a min-width/height to var(--tap-min).
 *
 * ⛔ THE TARGET IS THE LAST CLASS IN EACH COMMA-SEPARATED PART, not every
 * class in the selector. `.quickBar .searchInput` styles the INPUT; taking
 * both names made `.quickBar` — a layout container that is not a tap target
 * at all — look like one, and the rail reported it as an uncovered finger
 * target. A false name in a failure message is worse than no message: it
 * sends the next reader to fix a class that was never broken.
 */
function tapTargetClasses(blockText) {
  const found = new Set()
  const rule = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = rule.exec(blockText))) {
    const [, sel, body] = m
    if (!/min-(?:width|height):\s*var\(--tap-min/.test(body)) continue
    for (const part of sel.split(',')) {
      const classes = part.match(/\.[A-Za-z][A-Za-z0-9_-]*/g)
      if (classes) found.add(classes[classes.length - 1])
    }
  }
  return found
}

const css = stripComments(readFileSync(CSS, 'utf8'))
// The two real touch tiers this repo defines (breakpoints.css).
const atPhone = mediaBodies(css, 390)
const atTablet = mediaBodies(css, 820)

describe('Calendar keeps the 44px floor across the whole TOUCH tier', () => {
  it('declares finger targets on the phone at all (non-vacuity)', () => {
    // If this ever empties, every assertion below passes for the wrong reason.
    expect(tapTargetClasses(atPhone).size).toBeGreaterThan(5)
  })

  it('every class the PHONE calls a finger target is one on TABLET too', () => {
    const phone = tapTargetClasses(atPhone)
    const touch = tapTargetClasses(atTablet)
    const missing = [...phone].filter((c) => !touch.has(c)).sort()
    expect(
      missing,
      `declared a finger target at <=640px but not at <=1024px — tablet is touch too:\n${missing.join(', ')}`,
    ).toEqual([])
  })

  it('CONTROL: the derivation can SEE a class that is phone-only', () => {
    // A parser that matched nothing would satisfy the test above silently.
    const fake = [
      '@media (max-width: 640px) { .a { min-height: var(--tap-min); } .b { min-height: var(--tap-min); } }',
      '@media (max-width: 1024px) { .a { min-height: var(--tap-min); } }',
    ].join('\n')
    const phone = tapTargetClasses(mediaBodies(fake, 390))
    const touch = tapTargetClasses(mediaBodies(fake, 820))
    expect([...phone].sort()).toEqual(['.a', '.b'])
    expect([...phone].filter((c) => !touch.has(c))).toEqual(['.b'])
  })

  it('CONTROL: a phone-only block does NOT apply at tablet width', () => {
    // The two tiers must stay distinguishable, or the check is a tautology
    // (every touch class trivially "covers" itself).
    const only640 = '@media (max-width: 640px) { .z { min-height: var(--tap-min); } }'
    expect([...tapTargetClasses(mediaBodies(only640, 390))]).toEqual(['.z'])
    expect([...tapTargetClasses(mediaBodies(only640, 820))]).toEqual([])
  })
})
