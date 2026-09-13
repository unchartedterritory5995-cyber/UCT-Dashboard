// Standing rail: the back-to-live chip's hit rect and the hub's hit rect must
// never intersect. See docs/plans/joystick/00-master-spec-v1.3.md §5
// ("Standing regression test") and docs/plans/joystick/20-wave05-ux.md §4.
//
// ⚠️ jsdom performs NO LAYOUT — there is no real box model here, and
// StockChart/HubRoot are not even mounted. Both rects are computed purely
// from the DECLARED CSS / inline-style values, the same "declarations are
// the artifact under test" approach as pages/charts/mobileShellHeight.test.js.
// `env(safe-area-inset-bottom)` cannot be resolved outside a real browser
// engine either, so it is treated as 0 (the bare, non-notched floor)
// throughout — a nonzero safe area only pushes the hub's box UP and away
// from the chip, so 0 is the conservative case for a collision check, never
// the one that could hide a real overlap.
//
// Geometry is READ from the real sources rather than hardcoded here — both
// are plain text, so no bundler is needed:
//   - the chip: `.goLivePill` in ../components/StockChart.module.css
//   - the hub:  the inline `style` object on HubPad in ./HubRoot.jsx
// If either drifts, these numbers move with it instead of silently going
// stale, which is the entire point of a drift rail (the two are independent
// numbers written by different people at different times — the master spec
// calls this out explicitly).
//
// ⛔ Do NOT change `.goLivePill` to make a FUTURE failure pass. The one move
// this rail sanctions has already happened: `right: 86px -> 118px`, applied in
// Phase 1 under spec §2c's rule that in this collision THE CHIP MOVES, NOT THE
// HUB (the hub has to clear the home indicator and the chart toolbar and has
// nowhere left to go). If this rail goes red again, something moved that was
// not supposed to — read both sources before touching either.
//
// (An earlier draft of this header said the rail was "expected to fail" through
// Phase 1. That was written before the chip move landed; it is not the state of
// the branch and has been corrected rather than left as a standing excuse for
// a red test.)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const hubSrc = read('./HubRoot.jsx')
const chipCss = read('../components/StockChart.module.css')

/** Body of the first `{...}` block whose selector matches `selector` literally. */
function cssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escaped}\\s*\\{`)
  const m = re.exec(css)
  if (!m) throw new Error(`selector not found: ${selector}`)
  const open = css.indexOf('{', m.index)
  const close = css.indexOf('}', open)
  if (close < 0) throw new Error(`unterminated block: ${selector}`)
  return css.slice(open + 1, close)
}

/** A bare `prop: <number>px;` CSS declaration inside a rule body. */
function cssDeclPx(body, prop, label) {
  const re = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px\\s*;`)
  const m = re.exec(body)
  if (!m) throw new Error(`${label}: no bare px value for "${prop}"`)
  return Number(m[1])
}

/** A `prop: '<value>'` (or double-quoted) entry inside a JS style-object literal. */
function jsStyleValue(src, prop, label) {
  const re = new RegExp(`${prop}\\s*:\\s*['"]([^'"]+)['"]`)
  const m = re.exec(src)
  if (!m) throw new Error(`${label}: style.${prop} not found`)
  return m[1]
}

/** The first bare `<number>px` found inside an arbitrary string (e.g. a `calc(...)`). */
function firstPx(str, label) {
  const m = /(-?\d+(?:\.\d+)?)px/.exec(str)
  if (!m) throw new Error(`${label}: no px number found in "${str}"`)
  return Number(m[1])
}

// ── The chip (.goLivePill) ──────────────────────────────────────────────────
const chipBody = cssBlock(chipCss, '.goLivePill')
const chipRight = cssDeclPx(chipBody, 'right', '.goLivePill')
const chipBottom = cssDeclPx(chipBody, 'bottom', '.goLivePill')
const chipWidth = cssDeclPx(chipBody, 'width', '.goLivePill')
const chipHeight = cssDeclPx(chipBody, 'height', '.goLivePill')

// ── The hub (HubPad's inline style in HubRoot.jsx) ───────────────────────────
const hubRight = firstPx(jsStyleValue(hubSrc, 'right', 'HubRoot.jsx'), 'HubRoot.jsx right')
const hubWidth = firstPx(jsStyleValue(hubSrc, 'width', 'HubRoot.jsx'), 'HubRoot.jsx width')
const hubHeight = firstPx(jsStyleValue(hubSrc, 'height', 'HubRoot.jsx'), 'HubRoot.jsx height')
// bottom is `calc(env(safe-area-inset-bottom) + 68px)` — env() treated as 0 (see header).
const hubBottom = firstPx(jsStyleValue(hubSrc, 'bottom', 'HubRoot.jsx'), 'HubRoot.jsx bottom')

describe('CONTROL — geometry was actually extracted from the real sources', () => {
  it('.goLivePill parsed to finite numbers for all four box declarations', () => {
    for (const [label, v] of [
      ['right', chipRight], ['bottom', chipBottom], ['width', chipWidth], ['height', chipHeight],
    ]) {
      expect(Number.isFinite(v), `.goLivePill ${label} did not parse to a number`).toBe(true)
    }
    // Sanity check on the fixture (mirrors tokens.test.js's own idiom) — pins
    // today's known values so a regex silently matching the wrong rule shows
    // up as a changed number here, not as a passing test for the wrong
    // reason. `chipRight: 118` reflects the Phase 1 chip move (§2c: the chip
    // moves, never the hub) — if this drifts, update it AND re-verify the
    // rail below still passes; don't just bump the number to match.
    expect({ chipRight, chipBottom, chipWidth, chipHeight })
      .toEqual({ chipRight: 118, chipBottom: 96, chipWidth: 40, chipHeight: 40 })
  })

  it("HubRoot.jsx's HubPad style parsed to finite numbers for all four box declarations", () => {
    for (const [label, v] of [
      ['right', hubRight], ['bottom', hubBottom], ['width', hubWidth], ['height', hubHeight],
    ]) {
      expect(Number.isFinite(v), `HubRoot.jsx ${label} did not parse to a number`).toBe(true)
    }
    expect({ hubRight, hubWidth, hubHeight }).toEqual({ hubRight: 24, hubWidth: 84, hubHeight: 84 })
  })
})

/** Do two `[lo, hi]` "distance from an edge" intervals overlap? */
function overlaps([aLo, aHi], [bLo, bHi]) {
  return aLo <= bHi && bLo <= aHi
}

let executedCases = 0

describe('the back-to-live chip and the hub do not intersect', () => {
  // Both boxes are anchored purely by `right`/`bottom` offsets (never
  // `left`/`top`), so their screen position is invariant to viewport WIDTH —
  // nothing in this arithmetic reads it. The three widths below are asserted
  // anyway: 375/430 match the shape of the standing rail as written in the
  // spec; 360 (a common small-Android layout width) was added at the Phase 1
  // gate. They're also a tripwire — if either box is ever repositioned onto
  // `left`/`top`, these per-width cases stop being redundant, and whoever
  // does that will need to plug the real width into the math here rather
  // than assuming it still doesn't matter.
  it.each([360, 375, 430])('at a %dpx-wide viewport, the two hit rects do not overlap', (viewportWidth) => {
    executedCases += 1
    expect(viewportWidth).toBeGreaterThan(0) // keeps the parameter genuinely used, not decorative

    const chipH = [chipRight, chipRight + chipWidth]     // distance from the right edge
    const chipV = [chipBottom, chipBottom + chipHeight]  // distance from the bottom edge
    const hubH = [hubRight, hubRight + hubWidth]
    const hubV = [hubBottom, hubBottom + hubHeight]

    const intersects = overlaps(chipH, hubH) && overlaps(chipV, hubV)

    // GREEN and expected to stay that way. `.goLivePill` reads `right: 118px`,
    // 10px clear of the hub's left edge at `right: 24px` + 84px wide.
    // If this goes red, one of the two moved — read both sources (§2c says the
    // chip yields, never the hub) rather than adjusting the number here.
    expect(
      intersects,
      `chip [${chipH}] and hub [${hubH}] hit rects overlap — see spec v1.3 §2c`,
    ).toBe(false)
  })
})

describe('mutation control — the rail actually ran real cases', () => {
  // A `vitest -t` filter that matches nothing exits 0 and looks identical to
  // a real green run (lesson_a_green_suite_can_hide_a_layout_regression).
  // This fails loudly instead if the it.each above is ever filtered away to
  // nothing, or its case list shrinks to zero.
  it('executed at least the three documented viewport-width cases', () => {
    expect(executedCases).toBeGreaterThanOrEqual(3)
  })
})
