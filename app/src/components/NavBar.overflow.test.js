// app/src/components/NavBar.overflow.test.js
//
// ─── 🔴 THE RAIL FOR A LIST THAT OUTGREW ITS OWN CLIPPED BOX ────────────────
//
// `.nav` is `height: 100vh; overflow: hidden`. `.mainItems` was `flex: 1` with
// no overflow and no `min-height: 0`, so once the nav reached 17 items plus
// four group labels it pushed ~73px of itself out through a parent that clips —
// `Community` and `Support` rendered underneath `.bottomItems`, with no scroll
// affordance, on every page at 1080p.
//
// ⭐ AND THE GROUP LABELS COST THAT HEIGHT WHILE INVISIBLE. `.groupLabel` was
// given `.label`'s hover recipe verbatim (`opacity: 0`, fade in on
// `.nav:hover`). That is free for `.label`, which is INLINE in a row that
// already has height, and ~26px each for `.groupLabel`, which is a BLOCK with
// 18px of vertical padding. Copying a correct recipe onto a different box is
// what made it wrong — the reuse WAS the defect, which is why it was filed as
// "low risk, byte-for-byte reuse" and shipped.
//
// ⛔ SOURCE-LEVEL, BECAUSE jsdom COMPUTES NO LAYOUT. Same idiom and same
// limitation as `Dashboard.zones.test.jsx`: this asserts that the two
// structural properties the fix depends on are DECLARED. Only
// `tools/mobile_audit.py` can see them render.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, test, expect } from 'vitest'

// `readFileSync(new URL(...))` throws "The URL must be of scheme file" on this
// repo's Windows/vitest setup — fileURLToPath + join is the established pattern.
const here = dirname(fileURLToPath(import.meta.url))
const raw = readFileSync(join(here, 'NavBar.module.css'), 'utf8')
// ⛔ COMMENTS STRIPPED BEFORE MATCHING. The rules above deliberately QUOTE the
// old `opacity: 0` recipe in their explanation, and a naive scan would find the
// defect in the prose describing its own removal.
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of a top-level rule, or '' when the selector is gone. */
const block = (selector) => {
  const i = css.indexOf(`${selector} {`)
  return i === -1 ? '' : css.slice(i + selector.length + 2).split('}')[0]
}

describe('the scrolling item list', () => {
  test('.mainItems declares BOTH an overflow and min-height: 0', () => {
    const b = block('.mainItems')
    expect(b, '.mainItems is gone from NavBar.module.css').not.toBe('')
    expect(b, '.mainItems has no overflow, so a list taller than the viewport is '
      + 'clipped by .nav with no way to reach the tail')
      .toMatch(/overflow-y:\s*auto/)
    // ⛔ The half everyone forgets. A column flex item defaults to
    // `min-height: auto` and REFUSES to shrink below its content, so
    // `overflow-y: auto` alone still overflows.
    expect(b, '.mainItems can still refuse to shrink — `overflow-y: auto` without '
      + '`min-height: 0` does not scroll a flex child')
      .toMatch(/min-height:\s*0/)
  })

  test('.nav still clips, so the overflow above is the ONLY way out', () => {
    // If .nav stopped clipping, the rail would grow the page instead and this
    // rail would be measuring a problem that no longer exists in that form.
    expect(block('.nav')).toMatch(/overflow:\s*hidden/)
  })
})

describe('the group labels cost no height while the rail is collapsed', () => {
  test('.groupLabel is display:none by default, not merely transparent', () => {
    const b = block('.groupLabel')
    expect(b, '.groupLabel is gone from NavBar.module.css').not.toBe('')
    expect(b, '.groupLabel is hidden by opacity again — that is free on an inline '
      + '.label and ~26px each on this block, which is how ~106px of invisible '
      + 'height got into a rail with ~77px to spare')
      .toMatch(/display:\s*none/)
  })

  test('…and it comes back on the deliberate-hover expand', () => {
    // The control: without this, "costs no height" is satisfied by a label that
    // is never shown at all, which would silently delete the taxonomy.
    expect(block('.nav:hover .groupLabel'),
      'the group headings never render — the four-group taxonomy is gone')
      .toMatch(/display:\s*block/)
  })

  test('CONTROL: .label keeps the opacity recipe, which is correct FOR IT', () => {
    // The point of the fix is not "opacity is bad" — it is that the recipe's
    // cost depends on the box. `.label` is inline inside a sized row.
    const b = block('.label')
    expect(b).toMatch(/opacity:\s*0/)
    expect(b, '.label was "fixed" too — it never had this problem, and '
      + 'display:none on it would kill the width transition').not.toMatch(/display:\s*none/)
  })
})
