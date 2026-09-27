import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  GEX_ASSUMPTION_LONG,
  GEX_ASSUMPTION_BY_MODE,
  gexModeName,
  gexModeLabel,
  gexAssumptionFor,
  gexAssumptionAriaLabel,
} from './gexAssumption.js'

// Resolved from cwd rather than import.meta.url, which is not a file:// URL
// under this vitest config. Both candidates are tried so the rail works whether
// it is run from `app/` or from the repo root; `it resolves the partner file`
// below is the non-vacuity guard on that.
const PARTNER_FILE = ['src/pages/OptionsFlow.jsx', 'app/src/pages/OptionsFlow.jsx']
  .map((p) => resolve(process.cwd(), p))
  .find((p) => existsSync(p))

/**
 * ⛔ CODE, NEVER PROSE. This strips block and line comments BEFORE hunting a
 * literal, because OptionsFlow.jsx carries a four-line comment immediately above
 * the toggle (`:4420-4423`) that explains the very same assumption in different
 * words. A naive scan would be matching an explanation of the thing it is trying
 * to measure, which is the defect class this repo has logged six times.
 * `test_the_stripper_removes_prose_and_keeps_code` is the control.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Every `title="..."` attribute value in the stripped source. */
function titleAttributes(src) {
  return [...stripComments(src).matchAll(/title="([^"]*)"/g)].map((m) => m[1])
}

describe('the GEX assumption copy is pinned to the partner file', () => {
  it('resolves the partner file — a missing path is a broken invocation, not a finding', () => {
    expect(PARTNER_FILE).toBeDefined()
  })

  const raw = readFileSync(PARTNER_FILE, 'utf8')
  const titles = titleAttributes(raw)

  it('finds title attributes at all — a scan that matched nothing is a broken invocation', () => {
    // NON-VACUITY. Without this, every assertion below passes over an empty set
    // the moment the regex, the path or the file shape changes.
    expect(titles.length).toBeGreaterThan(0)
  })

  it('GEX_ASSUMPTION_LONG is byte-identical to a title in OptionsFlow.jsx', () => {
    // ⛔ IF THIS IS RED, THE PARTNER FILE MOVED. Update GEX_ASSUMPTION_LONG in
    // gexAssumption.js to match it. NEVER edit OptionsFlow.jsx to satisfy this
    // test — it is partner-owned, and the point of the pin is that the copy this
    // module ships and the copy the product shows cannot disagree.
    expect(titles).toContain(GEX_ASSUMPTION_LONG)
  })

  it('CONTROL: the stripper removes prose and keeps code', () => {
    const fixture = [
      '/* title="a comment claiming to be a title" */',
      '// title="a line comment claiming to be a title"',
      '<div title="a real one" />',
    ].join('\n')
    const found = titleAttributes(fixture)
    expect(found).toEqual(['a real one'])
    // and prove the stripper is what did it, not the regex missing them
    expect(fixture).toContain('a comment claiming to be a title')
  })
})

describe('a label at the number states only the mode that produced it', () => {
  it('the two modes say different things', () => {
    // The ruling this pins: a per-mode label must actually vary by mode. A
    // constant would render the same sentence under both assumptions, which is
    // indistinguishable from not disclosing the assumption at all.
    expect(gexAssumptionFor(false)).not.toBe(gexAssumptionFor(true))
  })

  it('naive names open interest; trade-aware names flow', () => {
    expect(gexAssumptionFor(false)).toMatch(/open interest/i)
    expect(gexAssumptionFor(true)).toMatch(/flow/i)
  })

  it('neither short form states BOTH assumptions', () => {
    // The whole point of the at-the-number label: a reader must not have to
    // decide which of two assumptions their figure rests on.
    for (const text of Object.values(GEX_ASSUMPTION_BY_MODE)) {
      const namesBoth = /naive/i.test(text) && /trade-aware/i.test(text)
      expect(namesBoth).toBe(false)
    }
  })

  it('the short forms fit beside a number', () => {
    // They sit under an 18px figure in a 14px-padded tile. This is a deliberate
    // ceiling, not a style preference: the long form is 116 characters and is
    // why the disclosure ended up on a hover somewhere else in the first place.
    for (const text of Object.values(GEX_ASSUMPTION_BY_MODE)) {
      expect(text.length).toBeLessThanOrEqual(70)
    }
    expect(GEX_ASSUMPTION_LONG.length).toBeGreaterThan(70)
  })

  it('mode naming matches the toggle the member actually sees', () => {
    expect(gexModeName(false)).toBe('naive')
    expect(gexModeName(true)).toBe('tradeAware')
    // The labels are the toggle's own button text in OptionsFlow.jsx.
    expect(gexModeLabel(false)).toBe('Naive')
    expect(gexModeLabel(true)).toBe('Trade-Aware')
  })

  it('the accessible name says what it reveals, not "more info"', () => {
    expect(gexAssumptionAriaLabel(false)).toBe('What Naive GEX assumes')
    expect(gexAssumptionAriaLabel(true)).toBe('What Trade-Aware GEX assumes')
  })
})
