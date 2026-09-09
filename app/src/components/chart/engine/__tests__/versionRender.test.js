// app/src/components/chart/engine/__tests__/versionRender.test.js
//
// ─── R0.3 — VERSION-AWARE RENDERING ─────────────────────────────────────────
//
// ⭐ THE 17-COLOUR TABLE IS PARSED OUT OF THE SPEC, NOT RETYPED. Seventeen hexes
// is seventeen chances to fat-finger a digit, and a wrong hex is invisible in
// review and invisible on screen unless you happen to know the right one.
//
// ⭐ AND THE THREE v6 CHANGES ARE PARSED OUT OF THE EVOLUTION DOC. Those are the
// load-bearing rows: which constants changed, and when. A fourth constant quietly
// added to `COLOR_PRE_V6` would be a silent v5 rendering change.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  COLOR_V6,
  COLOR_PRE_V6,
  RENDER_CHANGES,
  MIN_VERSION,
  MAX_VERSION,
  colorConstant,
  labelDefaultTextColor,
  implicitTransparency,
  resolveLinewidth,
  colorSpelling,
  renderDefaults,
} from '../versionRender'
import { POOL_LIMITS } from '../objectPool'

const SRC = path.resolve(__dirname, '../../../..')
const REPO = path.resolve(SRC, '../..')
// ⚠️ Normalise: git checks these out CRLF on Windows and every multi-line regex
// would fail here while passing on an LF checkout.
const spec = fs.readFileSync(path.join(REPO, 'docs/pine/pine-presentation-spec.md'), 'utf8').replace(/\r\n/g, '\n')
const evolution = fs.readFileSync(path.join(REPO, 'docs/pine/pine-version-evolution.md'), 'utf8').replace(/\r\n/g, '\n')
const MODULE = path.join(SRC, 'components/chart/engine/versionRender.js')

/** §4.2.5's table rows: `| \`color.aqua\` | \`#00BCD4\` | …` (the hex may be bolded).
 *
 *  ⛔ SCOPED TO §4.2.5 ON PURPOSE. The spec carries a SECOND `color.* | #hex`
 *  table — the v5→v6 comparison in §6 — whose first hex column is the PRE-v6
 *  value. An unscoped sweep matches both and the later one wins, so red, teal and
 *  yellow silently come back as their v5 hexes and the "derived" register agrees
 *  with the wrong table. That is the derivation defect wearing the costume of the
 *  fix for it. `sectionOf` is what keeps them apart, and `v6ChangesFromSpec`
 *  below reads the other table deliberately, as corroboration. */
function sectionOf(heading) {
  const i = spec.indexOf(heading)
  if (i < 0) return ''
  const j = spec.indexOf('\n#### ', i + heading.length)
  return spec.slice(i, j < 0 ? undefined : j)
}

function paletteFromSpec() {
  const body = sectionOf('#### 4.2.5 The 17 `color.*` constants')
  const out = {}
  const rx = /\|\s*`color\.([a-z]+)`\s*\|\s*\*{0,2}`(#[0-9A-Fa-f]{6})`\*{0,2}\s*\|/g
  let m
  while ((m = rx.exec(body))) out[m[1]] = m[2]
  return out
}

/** The spec's own v5→v6 comparison table: `| \`color.red\` | \`#FF5252\` | **\`#F23645\`** | RENDERER |`.
 *  A second, independent statement of the same three changes inside the same doc. */
function v6ChangesFromSpec() {
  const out = {}
  const rx = /\|\s*`color\.([a-z]+)`\s*\|\s*`(#[0-9A-Fa-f]{6})`\s*\|\s*\*\*`(#[0-9A-Fa-f]{6})`\*\*\s*\|\s*RENDERER\s*\|/g
  let m
  while ((m = rx.exec(spec))) out[m[1]] = { before: m[2], after: m[3] }
  return out
}

/** Evolution row 49: "`color.red` `#FF5252` → `#F23645`; `color.teal` … ". */
function v6ColourChangesFromDoc() {
  const row = /\*\*Colour constants changed value\*\*:([^|]+)\|/.exec(evolution)
  if (!row) return {}
  const out = {}
  const rx = /`color\.([a-z]+)`\s*`(#[0-9A-Fa-f]{6})`\s*→\s*`(#[0-9A-Fa-f]{6})`/g
  let m
  while ((m = rx.exec(row[1]))) out[m[1]] = { before: m[2], after: m[3] }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the palette is derived from the spec, not typed in the module', () => {
  const parsed = paletteFromSpec()

  it('the spec still carries all 17 colour constants', () => {
    // ⭐ THE NON-VACUITY CONTROL for every comparison below.
    expect(Object.keys(parsed)).toHaveLength(17)
    expect(spec).toMatch(/The 17 `color\.\*` constants/)
  })

  it('the module\'s v6 palette is the spec\'s palette', () => {
    expect(COLOR_V6).toEqual(parsed)
  })

  it('color.blue is #2962ff and comparison is case-insensitive', () => {
    // The spec resolves this conflict explicitly: the payload carries #2962ff in
    // BOTH v5 and v6, lowercase, and #2196F3 appears only in the manual's prose.
    expect(COLOR_V6.blue.toLowerCase()).toBe('#2962ff')
    expect(spec).toMatch(/`color\.blue` is `#2962ff`, not `#2196F3`/)
    expect(colorConstant('COLOR.BLUE', 6)).toBe(COLOR_V6.blue)
    expect(colorConstant('Blue', 5)).toBe(COLOR_V6.blue)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the three constants that changed at v6', () => {
  const changes = v6ColourChangesFromDoc()

  it('the evolution doc still names exactly three', () => {
    expect(Object.keys(changes).sort()).toEqual(['red', 'teal', 'yellow'])
  })

  it('the spec\'s own v5-to-v6 table agrees with the evolution doc, row for row', () => {
    // ⭐ TWO INDEPENDENT STATEMENTS IN TWO DOCUMENTS. If they ever disagree, this
    // fails and a human decides which is right — rather than the module silently
    // inheriting whichever one the parser happened to read last, which is exactly
    // what went wrong the first time this test was written.
    expect(v6ChangesFromSpec()).toEqual(changes)
  })

  it('the module\'s pre-v6 values are the doc\'s "before" values', () => {
    for (const [name, { before }] of Object.entries(changes)) {
      expect(COLOR_PRE_V6[name], `pre-v6 ${name}`).toBe(before)
    }
    expect(Object.keys(COLOR_PRE_V6).sort()).toEqual(Object.keys(changes).sort())
  })

  it('the module\'s v6 values are the doc\'s "after" values', () => {
    for (const [name, { after }] of Object.entries(changes)) {
      expect(COLOR_V6[name], `v6 ${name}`).toBe(after)
    }
  })

  it('resolves each one differently either side of the v6 boundary', () => {
    for (const [name, { before, after }] of Object.entries(changes)) {
      expect(colorConstant(name, 5)).toBe(before)
      expect(colorConstant(name, 6)).toBe(after)
      expect(before).not.toBe(after)      // control: the boundary is real
    }
  })

  it('every OTHER constant is stable across every version', () => {
    for (const name of Object.keys(COLOR_V6)) {
      if (name in COLOR_PRE_V6) continue
      const seen = new Set([1, 2, 3, 4, 5, 6].map((v) => colorConstant(name, v)))
      expect(seen.size, `color.${name} should not vary by version`).toBe(1)
    }
  })

  it('⭐ two of the changed hexes match what a live chart actually draws', () => {
    // Independent corroboration: the Set A capture read the chart's own candle
    // colours out of the model, and they are the v6 red and teal exactly.
    const meta = JSON.parse(fs.readFileSync(
      path.join(REPO, 'tests/fixtures/vendor/reference/A/volume-spy-1d-250.meta.json'), 'utf8'))
    const style = meta.study.properties.mainSeriesStyle
    expect(style.downColor.toLowerCase()).toBe(COLOR_V6.red.toLowerCase())
    expect(style.upColor.toLowerCase()).toBe(COLOR_V6.teal.toLowerCase())
  })

  it('names an unknown constant', () => {
    expect(() => colorConstant('turquoise', 6)).toThrow(/turquoise/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('label default text colour', () => {
  it('flips from black to white at v6', () => {
    for (const v of [1, 2, 3, 4, 5]) expect(labelDefaultTextColor(v)).toBe('#000000')
    expect(labelDefaultTextColor(6)).toBe('#FFFFFF')
  })

  it('the evolution doc still records the flip', () => {
    expect(evolution).toMatch(/\*\*`label\.new\(\)` default text colour\*\* `color\.black` → `color\.white`/)
    expect(RENDER_CHANGES.row50.since).toBe(6)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('implicit transparency on bgcolor and fill', () => {
  it('is 90 up to v4 and 0 from v5', () => {
    // ⛔ The highest-value version regression there is: identical code, wildly
    // different opacity. A v4 script under v5 rules hides the chart behind it.
    for (const fn of ['bgcolor', 'fill']) {
      for (const v of [1, 2, 3, 4]) expect(implicitTransparency(fn, v)).toBe(90)
      for (const v of [5, 6]) expect(implicitTransparency(fn, v)).toBe(0)
    }
  })

  it('the evolution doc still records the drop, and dates it to v5', () => {
    expect(evolution).toMatch(/implicit default transparency of \*\*90\*\* no longer applied/)
    expect(RENDER_CHANGES.row27.since).toBe(5)
  })

  it('applies to bgcolor and fill only', () => {
    expect(() => implicitTransparency('plot', 4)).toThrow(/plot/)
    expect(() => implicitTransparency('bgcolour', 4)).toThrow(/bgcolour/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('linewidth', () => {
  it('passes a normal width through, truncating a float', () => {
    expect(resolveLinewidth(2, 6)).toEqual({ width: 2, flagged: null })
    expect(resolveLinewidth(3.9, 5)).toEqual({ width: 3, flagged: null })
  })

  it('flags a sub-1 width in v6 as our parser\'s fault, not the script\'s', () => {
    const r = resolveLinewidth(0, 6)
    expect(r.width).toBe(1)
    expect(r.flagged).toMatch(/compilation error in v6/)
  })

  it('⚠️ carries the verification debt for sub-1 widths before v6', () => {
    // The doc says the minimum became 1 at v6. It does NOT say what v5 drew for
    // 0 — hairline and invisible are visually opposite, so we clamp and SAY so
    // rather than pick one silently.
    const r = resolveLinewidth(0, 5)
    expect(r.width).toBe(1)
    expect(r.flagged).toMatch(/UNVERIFIED/)
  })

  it('flags a non-number rather than drawing NaN pixels', () => {
    expect(resolveLinewidth('thick', 6).flagged).toMatch(/not a number/)
    expect(resolveLinewidth(undefined, 6).width).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('version gating and the shared boundary with objectPool', () => {
  it('accepts v1 to v6 and refuses anything else, naming the range', () => {
    for (const v of [1, 2, 3, 4, 5, 6]) expect(() => renderDefaults(v)).not.toThrow()
    for (const v of [0, 7, -1, 5.5, NaN, undefined, '6']) {
      expect(() => renderDefaults(v), `v${v}`).toThrow(/unsupported Pine version/)
    }
  })

  it('says there is no v7, because that is a live fact and not an oversight', () => {
    expect(() => renderDefaults(7)).toThrow(/there is no v7/)
    expect(MIN_VERSION).toBe(1)
    expect(MAX_VERSION).toBe(6)
  })

  it('colour constants are bare before v4 and namespaced from v4', () => {
    for (const v of [1, 2, 3]) expect(colorSpelling(v)).toBe('bare')
    for (const v of [4, 5, 6]) expect(colorSpelling(v)).toBe('namespaced')
  })

  it('⭐ does not restate objectPool\'s drawing-availability table', () => {
    // Two authorities over "when did labels arrive" is exactly the defect this
    // repo keeps paying for. objectPool owns it; this asserts the boundary rather
    // than duplicating the answer.
    expect(POOL_LIMITS.label.since).toBe(4)
    expect(POOL_LIMITS.polyline.since).toBe(5)
    const src = fs.readFileSync(MODULE, 'utf8')
    expect(src).toMatch(/objectPool\.js/)
    expect(src).not.toMatch(/max_labels_count|max_polylines_count/)
  })

  it('the module names its provenance', () => {
    const src = fs.readFileSync(MODULE, 'utf8')
    expect(src).toContain('pine-presentation-spec.md')
    expect(src).toContain('pine-version-evolution.md')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('renderDefaults', () => {
  it('resolves a whole version in one call', () => {
    const v5 = renderDefaults(5)
    expect(v5.colors.red).toBe('#FF5252')
    expect(v5.labelTextColor).toBe('#000000')
    expect(v5.implicitTransparency).toEqual({ bgcolor: 0, fill: 0 })
    expect(v5.colorSpelling).toBe('namespaced')

    const v4 = renderDefaults(4)
    expect(v4.implicitTransparency).toEqual({ bgcolor: 90, fill: 90 })

    const v6 = renderDefaults(6)
    expect(v6.colors.red).toBe('#F23645')
    expect(v6.labelTextColor).toBe('#FFFFFF')
    expect(v6.linewidthMinimum).toBe(1)
  })

  it('carries all 17 colours at every version', () => {
    for (const v of [1, 3, 4, 5, 6]) {
      expect(Object.keys(renderDefaults(v).colors)).toHaveLength(17)
    }
  })

  it('⛔ v4 and v6 differ in more than one way at once', () => {
    // The control against a "version awareness" that only ever changes one thing:
    // if these two dialects agreed on everything but colour, the module would be
    // doing a fraction of its job and every test above would still pass.
    const a = renderDefaults(4)
    const b = renderDefaults(6)
    const differing = [
      a.colors.red !== b.colors.red,
      a.labelTextColor !== b.labelTextColor,
      a.implicitTransparency.fill !== b.implicitTransparency.fill,
      a.linewidthMinimum !== b.linewidthMinimum,
    ].filter(Boolean)
    expect(differing).toHaveLength(4)
  })
})
