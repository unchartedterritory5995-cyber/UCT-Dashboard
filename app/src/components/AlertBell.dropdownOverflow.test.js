// app/src/components/AlertBell.dropdownOverflow.test.js
//
// A CSS-READING rail, not a rendered-geometry one — and that choice is
// deliberate, not a shortcut. jsdom performs no layout: a `position:
// absolute` panel's `getBoundingClientRect()` reports all-zero in every
// jsdom test in this repo (see CLAUDE.md "Mobile audit harness" and
// `tapFloor.test.js`'s own header), so a vitest/RTL test can never SEE the
// overflow this file guards against. The only thing a unit test can check
// is what the stylesheet DECLARES — which is exactly where the bug lived.
// The CSS-parsing helpers below are deliberately the same shape as
// `styles/tapFloor.test.js`'s (`mediaBodies` / `withoutMedia`), not
// reinvented, so a reader who trusts that rail can trust this one's parse.
//
// 🔴 THE BUG THIS RAILS: AlertBell's dropdown is `position: absolute;
// right: 0` inside `.wrap`, and the bell is the RIGHTMOST item in
// MobileNav's fixed top bar (`topBarRight` is the last child, ~12px from
// the bar's own right edge). `right: 0` keeps the panel's right edge flush
// with its anchor's right edge, which already sits near the viewport's
// right edge — safe at every width. A `max-width: 640px` override once
// restated the same `width` and added `right: -40px`, which pushes the
// panel's right edge 40px PAST its anchor — off the right edge of a
// 320/390px phone screen, every time the bell opens.
//
// ⛔ THE RULE, AND IT NEEDS NO KNOWLEDGE OF THE PARENT'S PADDING: for a
// `right`-anchored panel whose anchor already sits at (or near) the
// viewport's right edge, ANY declared `right` value below 0 extends the
// panel beyond that anchor — i.e. further OFF-screen, never further on. A
// safe override only ever narrows `width` or holds `right` at 0; it never
// goes negative. That is a property of the DECLARATION, checkable without
// rendering anything.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const CSS_PATH = join(here, 'AlertBell.module.css')

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/** Bodies of every `@media` block that ACTUALLY APPLIES at `width` —
 *  `styles/tapFloor.test.js`'s derivation, verbatim. Not "max-width <=
 *  bound": a `<=1024px` query also matches 390px, so this re-walks each
 *  block's own condition rather than assuming the touch/phone sets nest. */
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

const withoutMedia = (css) => css.replace(/@media[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, '')

/** The `right:` value (px; CSS allows the unitless `0`) declared for
 *  `.dropdown` in `blockText`, reading the LAST match — a later declaration
 *  for the same property wins within one block, same as the cascade. */
function dropdownRightPx(blockText) {
  const rule = /\.dropdown\s*\{([^{}]*)\}/g
  let right
  let m
  while ((m = rule.exec(blockText))) {
    const decls = m[1].match(/right:\s*(-?\d+(?:\.\d+)?)(?:px)?\s*[;}]/g)
    if (decls) {
      const last = decls[decls.length - 1]
      right = Number(/-?\d+(?:\.\d+)?/.exec(last)[0])
    }
  }
  return right
}

/** The effective `.dropdown { right: ... }` value at a given viewport
 *  width: the base (non-media) rule, overridden by whatever the
 *  applicable media block(s) declare — mirroring the cascade, base first. */
function effectiveRightAt(css, width) {
  const base = dropdownRightPx(withoutMedia(css))
  const touched = dropdownRightPx(mediaBodies(css, width))
  return touched !== undefined ? touched : base
}

const WIDTHS = [320, 390, 640, 820, 1024]

describe('AlertBell dropdown never gets a negative `right` at any touch width', () => {
  it('non-vacuity: `.dropdown` actually declares a `right` value to check', () => {
    const css = stripComments(readFileSync(CSS_PATH, 'utf8'))
    expect(effectiveRightAt(css, 1025)).toBe(0)
  })

  it.each(WIDTHS)('right >= 0 at %dpx (panel stays inside its anchor, not past it)', (w) => {
    const css = stripComments(readFileSync(CSS_PATH, 'utf8'))
    const right = effectiveRightAt(css, w)
    expect(right, `AlertBell.module.css .dropdown right at ${w}px`).not.toBeUndefined()
    expect(right).toBeGreaterThanOrEqual(0)
  })

  it('CONTROL: the derivation catches the exact regression it exists for', () => {
    // The real diff this fix reverted, verbatim, so the check is proved
    // against the actual historical bug rather than a sanitized stand-in.
    const bad = stripComments(`
      .dropdown {
        position: absolute;
        top: 100%;
        right: 0;
        width: min(320px, calc(100vw - 24px));
      }
      @media (max-width: 640px) {
        .dropdown {
          width: min(320px, calc(100vw - 24px));
          right: -40px;
        }
      }
    `)
    expect(effectiveRightAt(bad, 390)).toBe(-40)
    expect(effectiveRightAt(bad, 820)).toBe(0) // tablet was never hit by this one
  })

  it('CONTROL: a fix that holds `right: 0` at every touch width passes', () => {
    const good = stripComments(`
      .dropdown { position: absolute; right: 0; width: min(320px, calc(100vw - 24px)); }
    `)
    for (const w of WIDTHS) expect(effectiveRightAt(good, w)).toBe(0)
  })
})
