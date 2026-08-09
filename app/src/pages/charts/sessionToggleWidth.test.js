// app/src/pages/charts/sessionToggleWidth.test.js
//
// ─── SESSION-TOGGLE-TRUNCATED — the horizontal half of the same control ─────
//
// Measured on a 375×812 phone, 2026-08-09, against the real app:
//
//     before   [role=group]"Chart session view"  scrollWidth 257 / clientWidth 231
//              → 26px clipped, "INCLUDE POST-MARKET" reads "INCLUDE POST-MARK"
//     after    scrollWidth 257 / clientWidth 257 → 0 clipped, at 320 / 375 / 390px
//              document horizontal overflow stays 0; the market clock wraps to
//              its own line (y 199 → 251) and is fully in the viewport
//
// ⛔ THE DOCUMENT REPORTS ZERO OVERFLOW EITHER WAY. `.sessionToggle` is
// `overflow: hidden` — it has to be, or its rounded corners cut through the
// buttons — so the loss is silent and the audit harness's overflow number can
// never see it. That is why the numbers above are `scrollWidth` vs
// `clientWidth` on the control itself.
//
// ⚠️ A CSS RAIL, AND ITS LIMIT IS STATED. jsdom does no layout, so no unit test
// in this repo can re-measure 257-vs-231; what a test CAN own is the two
// declarations the browser measurement proved sufficient, and the SCOPE they
// must keep. The geometry above is the evidence; this is the regression lock.
//
// ⭐ THE SCOPE IS THE LOAD-BEARING HALF. `.sessionToggle` is shared with
// `GridChartCell` (the multi-chart grid), where a tablet board can be four
// cells across — narrower than the control's natural 257px. Pinning
// `flex-shrink: 0` globally would push the control out of its cell there. The
// third case is the one that fails if someone "simplifies" the media query away.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CSS_PATH = path.join(HERE, 'ChartsWorkspace.module.css')
/** ⚠️ CRLF NORMALISED AT THE DOOR — `core.autocrlf` is on in this checkout, and
 *  a `\n`-joined anchor matches zero times without this. */
const CSS = fs.readFileSync(CSS_PATH, 'utf8').replace(/\r\n/g, '\n')

/** Every top-level `@media (...)` block, sliced by BRACE BALANCE — never a
 *  regex over the whole file, which cannot tell a nested `}` from the end.
 *  ⛔ AND EVERY ONE OF THEM, not the first: this file carries several blocks per
 *  breakpoint, so an `indexOf`-and-stop walker answers about whichever one
 *  happens to come first and reports a live declaration as absent. */
function mediaBlocks(query) {
  const out = []
  const needle = `@media ${query}`
  let from = 0
  for (;;) {
    const head = CSS.indexOf(needle, from)
    if (head < 0) return out
    const open = CSS.indexOf('{', head)
    if (open < 0) return out
    let depth = 0
    let end = -1
    for (let j = open; j < CSS.length; j += 1) {
      if (CSS[j] === '{') depth += 1
      else if (CSS[j] === '}') {
        depth -= 1
        if (depth === 0) { end = j; break }
      }
    }
    if (end < 0) return out
    out.push(CSS.slice(open + 1, end))
    from = end + 1
  }
}

/** Everything OUTSIDE any media query — the base cascade. */
function baseCascade() {
  let out = ''
  let i = 0
  for (;;) {
    const head = CSS.indexOf('@media', i)
    if (head < 0) { out += CSS.slice(i); return out }
    out += CSS.slice(i, head)
    const open = CSS.indexOf('{', head)
    if (open < 0) return out
    let depth = 0
    let end = CSS.length
    for (let j = open; j < CSS.length; j += 1) {
      if (CSS[j] === '{') depth += 1
      else if (CSS[j] === '}') {
        depth -= 1
        if (depth === 0) { end = j; break }
      }
    }
    i = end + 1
  }
}

/** The declarations of one selector inside a block — all occurrences, joined,
 *  because a selector may be declared more than once in the same layer. */
function rule(block, selector) {
  const re = new RegExp(`(?:^|[\\n};])\\s*\\${selector}\\s*\\{([^{}]*)\\}`, 'g')
  const found = [...String(block || '').matchAll(re)].map((m) => m[1])
  return found.length ? found.join('\n') : null
}

const PHONE = mediaBlocks('(max-width: 640px)').join('\n')
const TOUCH = mediaBlocks('(max-width: 1024px)').join('\n')
const BASE = baseCascade()

describe('SESSION-TOGGLE-TRUNCATED — the segmented control keeps its own width on a phone', () => {
  it('the phone media block exists and is the canonical 640 breakpoint', () => {
    // 640 and 1024 are the two boundaries this repo allows; a new literal here
    // is how a fix stops applying on the device it was measured on.
    expect(PHONE, 'no @media (max-width: 640px) block in ChartsWorkspace.module.css').toBeTruthy()
    expect(TOUCH, 'no @media (max-width: 1024px) block in ChartsWorkspace.module.css').toBeTruthy()
  })

  it('the right-hand cluster may wrap, so the clock moves instead of the label shrinking', () => {
    const r = rule(PHONE, '.headerTopRight')
    expect(r, '.headerTopRight is not styled in the phone block').toBeTruthy()
    expect(r).toMatch(/flex-wrap:\s*wrap/)
  })

  it('the toggle refuses to shrink — the declaration that turns 231 back into 257', () => {
    const r = rule(PHONE, '.sessionToggle')
    expect(r, '.sessionToggle is not styled in the phone block').toBeTruthy()
    expect(r).toMatch(/flex-shrink:\s*0/)
  })

  it('⭐ CONTROL — the no-shrink rule is PHONE-ONLY, never global and never ≤1024', () => {
    // The base `.sessionToggle` rule (outside any media query) and the touch
    // block must both stay free of it: a tablet multi-chart grid cell can be
    // narrower than the control, and there it must still shrink.
    expect(rule(BASE, '.sessionToggle') || '').not.toMatch(/flex-shrink:\s*0/)
    expect(rule(TOUCH, '.sessionToggle') || '').not.toMatch(/flex-shrink:\s*0/)
  })

  it('the owner’s VERTICAL fix is untouched — this is the other axis, not a revert', () => {
    // `5f969b4e` grew these buttons to `--tap-min` at ≤1024 and deliberately did
    // not widen them. Both fixes have to be live at once or the control is
    // either truncated or unhittable.
    const r = rule(TOUCH, '.sessionBtn')
    expect(r, '.sessionBtn is not styled in the touch block').toBeTruthy()
    expect(r).toMatch(/min-height:\s*var\(--tap-min/)
  })
})
