// The hub honours `prefers-reduced-motion` — and this file pins the mechanism that ACTUALLY does
// it, not the one that looks like it does.
//
// ── WHAT WAS MEASURED BEFORE WRITING THIS ──────────────────────────────────────────────────────
// `hub.module.css:180-188` zeroes transitions on five hub classes under `reduce`, and its own
// comment says "the global reset in tokens.css already zeroes transition-duration app-wide, this
// just says so locally and explicitly for the hub."
//
// That comment is TRUE — verified, not assumed: `styles/tokens.css:650` declares
// `*, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1
// !important; transition-duration: .01ms !important; scroll-behavior: auto !important }`.
// Being universal AND `!important`, it outranks the hub's local block on every property the local
// block sets. So the hub's own block is a FALLBACK, not the protection.
//
// ⭐ THAT DISTINCTION IS THE WHOLE POINT OF THIS FILE. A rail that only checked the local block
// would be watching the decorative half: it would stay green while someone scoped, moved or
// deleted `tokens.css:650` and every hub animation came back for members who asked for stillness.
// And the hub's comment would still claim it was handled — a comment naming a mechanism is a
// claim about a run (`lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`).
//
// Also measured, so the scope of this file is honest rather than assumed: the hub drives NO motion
// from JavaScript. There is no rAF loop and no timer-driven animation anywhere in `hub/` — the two
// `setTimeout`s in `useJoystick.js` are the hold-to-home and double-tap GESTURE windows, which are
// input timing and must not be shortened for reduced motion. All hub motion is CSS transitions on
// `transform`/`opacity`, which is exactly what the global reset reaches. If a rAF animation is
// ever added here, this file does not cover it and a JS-side `matchMedia` check becomes required.
//
// ── SO THE TWO THINGS ASSERTED ARE ─────────────────────────────────────────────────────────────
//   1. The global reset still exists and is still UNIVERSAL + `!important`. This is the mechanism.
//   2. The hub's local fallback still covers every hub class that animates — DERIVED each run, so
//      an animated class added tomorrow fails BY NAME instead of silently leaving the list behind.
//      Today the fallback is exactly complete (5 of 5); this keeps it that way.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const HUB = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const STYLES = path.join(HUB, '..', 'styles')

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const HUB_CSS = stripComments(readFileSync(path.join(HUB, 'hub.module.css'), 'utf8'))
const TOKENS_CSS = stripComments(readFileSync(path.join(STYLES, 'tokens.css'), 'utf8'))

const REDUCE_AT = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/

/**
 * Does this block's first rule apply to EVERY element?
 *
 * ⚰️ THE FIRST VERSION WAS A REGEX OVER THE WHOLE BLOCK — `/(^|[\s,{])\*\s*[,{]/` — and the
 * control below caught it on the first run. `.intro *, .intro *::before` contains a space then
 * `*` then a comma, so a SCOPED reset matched the "universal" pattern exactly as well as a bare
 * `*` did. The check would have gone on passing while the app-wide reset was narrowed to one
 * component, which is the single thing this rail exists to notice.
 *
 * ⭐ Read the selector LIST and ask whether any member of it is the universal selector itself.
 * `.intro *` is a descendant selector, not a universal one, and splitting on commas is what
 * makes the two distinguishable at all.
 */
function hasUniversalSelector(block) {
  const m = block.match(/([^{}]+)\{/)
  if (!m) return false
  return m[1].split(',').map((s) => s.trim()).some((s) => s === '*' || s.startsWith('*::'))
}

/** The hub's local fallback block, and the classes it names. */
function fallback() {
  const m = HUB_CSS.match(REDUCE_AT)
  if (!m) return { block: null, covered: [] }
  return { block: m[1], covered: [...new Set([...m[1].matchAll(/\.([A-Za-z][\w-]*)/g)].map((x) => x[1]))].sort() }
}

/**
 * Every hub class that actually MOVES, derived from the stylesheet outside the reduce block.
 *
 * ⭐ `transition: none` is excluded on purpose: `.knobFaceDragging` sets it to SUPPRESS the
 * spring-back while a drag is live. Counting a suppression as motion would demand reduced-motion
 * coverage for a rule whose entire job is already "do not animate" — a rail failing on a class
 * that is more correct than the ones it passes.
 */
function animatedClasses() {
  const m = HUB_CSS.match(REDUCE_AT)
  const body = m ? HUB_CSS.slice(0, m.index) + HUB_CSS.slice(m.index + m[0].length) : HUB_CSS
  const found = new Set()
  for (const rule of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector, decls] = rule
    const decl = decls.match(/\b(?:transition|animation)\s*:\s*([^;]*)/)
    if (!decl) continue
    if (/^none\b/.test(decl[1].trim())) continue
    for (const cls of selector.matchAll(/\.([A-Za-z][\w-]*)/g)) found.add(cls[1])
  }
  return [...found].sort()
}

describe('the global reduced-motion reset — the mechanism that actually stops hub motion', () => {
  it('non-vacuity — tokens.css declares a reduced-motion block at all', () => {
    expect(TOKENS_CSS, 'tokens.css has no `prefers-reduced-motion: reduce` block, so every '
      + 'assertion below is being made about nothing').toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  })

  it('⛔⛔ it is UNIVERSAL and !important — the two properties the hub depends on', () => {
    const m = TOKENS_CSS.match(REDUCE_AT)
    expect(m, 'could not read the reduced-motion block').toBeTruthy()
    const block = m[1]

    expect(hasUniversalSelector(block), 'the app-wide reduced-motion reset is no longer applied '
      + 'with a UNIVERSAL selector. The joystick hub relies on it reaching every hub element — '
      + '`hub.module.css:178` says so in as many words — and the hub\'s own block is only a '
      + 'partial fallback. Scoping this reset silently restores hub animation for members who '
      + 'asked for stillness.').toBe(true)

    for (const prop of ['animation-duration', 'transition-duration']) {
      const decl = new RegExp(`${prop}\\s*:[^;]*!important`)
      expect(block, `${prop} is no longer zeroed with !important. Without !important this reset `
        + 'loses to any more specific rule in the app, including the hub\'s own transitions.')
        .toMatch(decl)
    }
  })

  it('⛔ THE CONTROL: a SCOPED reset must not satisfy the universality check', () => {
    // Without this, the assertion above could be passing on the word "reduce" appearing anywhere,
    // and a reset narrowed to `.intro *` would read as app-wide coverage.
    // ⚰️ This control EARNED ITS KEEP on its first run: it failed, and what it was failing was
    // the detector above, not the stylesheet. Both fixtures are kept verbatim.
    const scoped = '\n  .intro *, .intro *::before {\n    transition-duration: 0.01ms !important;\n  }\n'
    expect(hasUniversalSelector(scoped), 'a reset scoped under a class registered as universal — '
      + 'the detector cannot tell the difference and proves nothing').toBe(false)

    const universal = '\n  *, *::before, *::after {\n    transition-duration: 0.01ms !important;\n  }\n'
    expect(hasUniversalSelector(universal), 'a genuinely universal reset must be detected, '
      + 'or this rail can never be satisfied').toBe(true)

    // A bare `*` alone (no comma list) is still universal — the common minimal form.
    expect(hasUniversalSelector('\n  * {\n    transition-duration: 0s !important;\n  }\n')).toBe(true)
  })
})

describe("the hub's own fallback block still covers everything the hub animates", () => {
  it('non-vacuity — the derivation finds real animated classes, named not counted', () => {
    const animated = animatedClasses()
    expect(animated, 'no hub class reads as animated, so the coverage assertion below is vacuous '
      + '— the derivation is broken, not the stylesheet').not.toEqual([])
    // A named member rather than a count: a count goes stale the day a class is added.
    expect(animated, 'the knob face is the hub\'s most obvious moving part and the derivation '
      + 'missed it').toContain('knobFace')
  })

  it('⛔ THE CONTROL: prose is not a declaration, and `transition: none` is not motion', () => {
    // hub.module.css writes about transitions in comments right next to the rules. If the scan
    // counted those, it would demand reduced-motion coverage for classes that never move.
    const prose = '/* transition: transform 0.28s is what the knob used to do */\n.thing { color: red; }'
    const stripped = stripComments(prose)
    expect(stripped.includes('transition'), 'comment-stripping removed the fixture entirely, so '
      + 'this control demonstrates nothing').toBe(false)

    // And the suppression case, which is the one that would produce a false demand.
    expect(animatedClasses(), 'a `transition: none` rule was counted as motion. `.knobFaceDragging` '
      + 'exists to STOP the spring-back mid-drag; requiring reduced-motion coverage for it would '
      + 'fail the rail on a rule that is already doing the right thing.')
      .not.toContain('knobFaceDragging')
  })

  it('⛔⛔ every animated hub class is named in the reduced-motion fallback', () => {
    const { block, covered } = fallback()
    expect(block, 'the hub\'s own `prefers-reduced-motion` block is gone. The global reset in '
      + 'tokens.css still covers the hub, so this is not member-visible today — but the hub now '
      + 'has NO fallback of its own, and that is a deliberate decision, not a tidy-up.').toBeTruthy()

    const uncovered = animatedClasses().filter((c) => !covered.includes(c))
    expect(uncovered, 'these hub classes animate but are not listed in the hub\'s '
      + '`prefers-reduced-motion` block.\n'
      + 'The app-wide reset in tokens.css:650 still zeroes them with !important, so a member is '
      + 'not affected TODAY — this is the fallback drifting behind the stylesheet it backs up, '
      + 'which is the shape that only hurts once the thing it backs up is touched.\n'
      + 'Add them to the block, or delete the block outright and say the global reset is the only '
      + 'mechanism — but do not leave it half-covering.')
      .toEqual([])
  })
})
