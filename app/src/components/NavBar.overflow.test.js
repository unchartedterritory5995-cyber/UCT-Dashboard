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

describe('Option 5 — no group headings or dividers, icons distributed evenly', () => {
  // The owner asked for a flat rail: nav icons in one uniform-spaced list, no
  // section labels, no separators. Two declarations carry it — a hidden label
  // and a dissolved wrapper — with the items at their natural row rhythm.
  test('.groupLabel renders nothing (display:none) — no headings, no reserved height', () => {
    const b = block('.groupLabel')
    expect(b, '.groupLabel is gone from NavBar.module.css').not.toBe('')
    expect(b, '.groupLabel is not display:none — a section heading (and the height '
      + 'it reserves) is back in what should be a flat rail')
      .toMatch(/display:\s*none/)
  })

  test('.navGroup is display:contents so the wrappers add no spacing between clusters', () => {
    // With the group wrappers as real boxes, each group would introduce its own
    // box into the flex column and break the uniform item rhythm. contents
    // dissolves them so every item is a direct flex child of .mainItems.
    expect(block('.navGroup'),
      '.navGroup is not display:contents — the group boxes are back and the flat, '
      + 'uniform spacing is gone')
      .toMatch(/display:\s*contents/)
  })

  test('no group divider rule survives — Option 5 removed all separators', () => {
    // The per-group `.groupLabel::before` hairline is gone. `block()` returns ''
    // for a selector that no longer opens a rule.
    expect(block('.groupLabel::before'),
      'a .groupLabel::before divider rule is back — Option 5 removed every divider')
      .toBe('')
  })

  test('CONTROL: .label keeps the opacity recipe (item labels still fade in on hover)', () => {
    // Removing the section headings does NOT touch the per-ITEM labels — those
    // still fade in with the width transition on hover.
    const b = block('.label')
    expect(b).toMatch(/opacity:\s*0/)
    expect(b, '.label uses display:none — that would kill the label fade/transition')
      .not.toMatch(/display:\s*none/)
  })
})
