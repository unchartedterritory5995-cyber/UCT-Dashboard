/**
 * The phone chip row, asserted in the BUILT CSS.
 *
 * ⛔ WHY THIS EXISTS AS A SEPARATE FILE. `SectionRail.test.jsx` covers the
 * behaviour thoroughly — tablist semantics, roving tabindex, arrow keys,
 * Home/End, aria-controls — and not one of its tests can see the bug this
 * guards. jsdom applies no stylesheet and evaluates no media query, so the
 * entire phone layout is invisible to it. MEASURED, not asserted: deleting
 * `flex:0 0 auto` and rebuilding leaves EVERY behavioural test green while this
 * file goes red. (No count is written here on purpose — a hand-typed count
 * beside the file it describes is this repo's most-repeated defect.)
 *
 * ⭐ THE FIX IS COUNTER-INTUITIVE, WHICH IS EXACTLY WHY IT NEEDS A RAIL. The
 * labels were never too long. `.rail` becomes a flex ROW here, so its children
 * inherit `flex-shrink:1` and COMPRESS to fit the viewport instead of
 * overflowing into the scroller that `overflow-x:auto` exists to provide. That
 * compression fed `.itemLabel`'s (correct, desktop-only) ellipsis and ran the
 * labels together. The obvious "fix" — shortening the labels — treats the
 * symptom and leaves the mechanism in place.
 *
 * Runs against `app/dist`; skips when there is no build, so a bare checkout is
 * never blocked. Idiom + brace-matching borrowed from
 * `pages/breadth/liveStyles.dist.test.js`; see user memory
 * `lesson_css_modules_hashes_not_arguments`.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../dist/assets')

/** Locate SectionRail's compiled module and DERIVE its hash.
 *
 * ⛔ The hash changes on every build, so it can never be typed here
 * (`lesson_probe_names_must_be_derived_not_typed`). It is identified
 * structurally instead: the one stylesheet carrying `_rail_`, `_tabs_`,
 * `_links_`, `_item_` and `_itemLabel_` under a SINGLE shared hash. Several
 * unrelated modules also compile an `.itemLabel`, so matching that name alone
 * would read a different component's rules and report them as this one's.
 */
function railModule() {
  if (!fs.existsSync(DIST)) return null
  for (const f of fs.readdirSync(DIST).filter((f) => f.endsWith('.css'))) {
    const text = fs.readFileSync(path.join(DIST, f), 'utf8')
    for (const m of text.matchAll(/\._rail_([a-z0-9]+)_\d+/g)) {
      const h = m[1]
      const all = ['tabs', 'links', 'item', 'itemLabel']
        .every((n) => text.includes(`_${n}_${h}_`))
      if (all) return { text, h }
    }
  }
  return null
}

/** Every `@media (max-width:640px)` body, brace-matched.
 *
 * ⛔ A regex cannot scope a search to INSIDE a media query and both obvious
 * attempts fail in opposite directions — `[^}]*` stops at the first nested
 * rule's closing brace, and a lazy `[\s\S]*?` runs straight past the query's
 * own closing brace into the top-level rules that follow. The second is how an
 * earlier version of a sibling test read a DESKTOP value while reporting it as
 * the phone one. Count braces.
 */
function phoneBlocks(text) {
  const out = []
  for (const m of text.matchAll(/@media\(max-width:640px\)\{/g)) {
    let i = m.index + m[0].length
    let depth = 1
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') depth--
      i++
    }
    out.push(text.slice(m.index + m[0].length, i - 1))
  }
  return out
}

/** The stylesheet with every `@media` block removed — i.e. the unconditional
 *  rules.
 *
 *  ⛔ NOT `text.split('@media')[0]`. This is a bundle of many modules, so
 *  SectionRail's own desktop rules sit AFTER some unrelated module's media
 *  query; splitting on the first one searches a slice that does not contain
 *  them and the control below fails for the wrong reason. (It did.)
 */
function topLevel(text) {
  let out = '', i = 0
  while (i < text.length) {
    const at = text.indexOf('@media', i)
    if (at < 0) { out += text.slice(i); break }
    out += text.slice(i, at)
    let j = text.indexOf('{', at), depth = 1
    j++
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') depth--
      j++
    }
    i = j
  }
  return out
}

/** Declarations for the first rule whose SELECTOR mentions `cls`. */
function decls(scope, cls) {
  for (const rule of scope.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (rule[1].includes(cls)) return rule[2]
  }
  return null
}

const mod = railModule()
const d = mod ? describe : describe.skip

d('📱 the phone chip row survives the build', () => {
  const { text, h } = mod || { text: '', h: '' }
  const phone = mod ? phoneBlocks(text).filter((b) => b.includes(`_${h}_`)) : []
  const scope = phone.join('\n')

  it('the phone scope was actually found — this file is not passing on an empty string', () => {
    // Without this every assertion below would pass vacuously against ''.
    expect(phone.length, 'no @media(max-width:640px) block mentions SectionRail; '
      + 'the phone rules were dropped from the build entirely').toBeGreaterThan(0)
    expect(decls(scope, `_rail_${h}_`), 'the phone .rail rule is missing')
      .toMatch(/flex-direction:row/)
  })

  it('reads the PHONE scope, not the desktop rules — the control', () => {
    // Proves the brace-matcher isn't running past its own closing brace into the
    // top-level rules. Desktop truncates on purpose; phone must not.
    const desktop = decls(topLevel(text), `_itemLabel_${h}_`)
    expect(desktop, 'desktop .itemLabel not found').toMatch(/text-overflow:ellipsis/)
    expect(decls(scope, `_itemLabel_${h}_`)).not.toMatch(/ellipsis/)
  })

  it('⛔ the GROUPS do not shrink — the actual cause of "AnalPsts& OwnCerShib"', () => {
    const g = decls(scope, `_tabs_${h}_`)
    expect(g, 'the phone .tabs/.links rule is gone').toBeTruthy()
    expect(g, 'the tab/link GROUPS may not shrink. Without flex:0 0 auto they '
      + 'compress to the viewport instead of overflowing into the scroller, and '
      + 'the labels run together — the labels are not too long.')
      .toMatch(/flex:0 0 auto/)
  })

  it('⛔ each CHIP sizes to its label and keeps a 44px tap target on the SHORT axis', () => {
    const item = decls(scope, `_item_${h}_`)
    expect(item, 'the phone .item rule is gone').toBeTruthy()
    expect(item, 'chips must not shrink').toMatch(/flex:0 0 auto/)
    // Height alone passing is the trap: flipped horizontal, the WIDTH is the
    // small axis — measured at 390px, Setup 38px / Brief 35px / Call 34px, all
    // under the floor. A 34x44 chip still misses a thumb.
    expect(item, 'min-width must hold the tap floor on the axis that got small')
      .toMatch(/min-width:var\(--tap-min\)/)
    expect(item).toMatch(/white-space:nowrap/)
  })

  it('⛔ the ellipsis is UNDONE here — it belongs to the fixed-width vertical rail', () => {
    const label = decls(scope, `_itemLabel_${h}_`)
    expect(label, 'the phone .itemLabel rule is gone').toBeTruthy()
    // In a scrolling row there is no width to fit into, so truncating can only
    // ever destroy a label that had room.
    expect(label).toMatch(/overflow:visible/)
    expect(label).toMatch(/text-overflow:clip/)
  })
})
