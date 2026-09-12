/**
 * S10 CP2 — F-S10-1's resolution, railed.
 *
 * ⛔ APPROVED SCOPE (owner, 2026-09-12, GATE-S10 line 2): F-S10-1, two named
 * primitives, the drawingLabels importers.
 *
 * ⭐ THE RESOLUTION IS "BOTH, NAMED", NOT "ONE". `formatPriceDisclosure`
 * renders `$12.50` with an em dash when absent; `formatPriceTick` renders
 * `123.46`, tick-aware, with the EMPTY STRING when absent. Every one of those
 * three disagreements is a real requirement of a different surface, and the
 * absent sentinels are read by LAYOUT rather than by a person: an em dash holds
 * a column, an empty string collapses it.
 *
 * ⛔⛔ SO THE CENTRAL RAIL HERE ASSERTS THEY STAY DIFFERENT. A future pass that
 * "simplifies" S10 by collapsing them would be a member-visible layout change
 * on four product surfaces, and it would pass every other test in the repo.
 */
import { describe, expect, it } from 'vitest'

import {
  ABSENT,
  formatPriceDisclosure,
  formatPriceTick,
} from './presentationPrimitives'
import { formatPrice as drawingFormatPrice } from '../../components/chart/drawingLabels'
import { formatPrice as disclosureFormatPrice } from '../../components/provenance/presentationFormat'

// ---------------------------------------------------------------------------
// THE FROZEN ORACLES — the two pre-CP2 bodies, verbatim, run in-process
//
// ⛔ NOT A STORED EXPECTED STRING. A snapshot of "what it printed on the machine
// that generated it" is a fact about that machine; an oracle is the rule. These
// are the exact bodies CP2 moved, so "byte-identical" is checkable rather than
// asserted.
// ---------------------------------------------------------------------------

/** `chart/drawingLabels.formatPrice`, as it stood before S10 CP2. */
function OLD_drawingFormatPrice(value, { tick = null, maxDecimals = 6 } = {}) {
  if (value === null || value === undefined || value === '') return ''
  const v = Number(value)
  if (!Number.isFinite(v)) return ''
  if (tick && Number.isFinite(tick) && tick > 0) {
    const dp = Math.min(maxDecimals, Math.max(0, Math.ceil(-Math.log10(tick) - 1e-9)))
    return v.toFixed(dp)
  }
  const a = Math.abs(v)
  if (a === 0) return '0.00'
  if (a < 1) return v.toFixed(4)
  if (a < 1000) return v.toFixed(2)
  return v.toFixed(2)
}

/** `provenance/presentationFormat.formatPrice`, as it stood before S10. */
function OLD_disclosureFormatPrice(value) {
  return Number.isFinite(value) ? `$${Number(value).toFixed(2)}` : '—'
}

/** ⭐ Inputs chosen to cross every branch of BOTH rules, including the ones a
 *  round-numbered fixture never reaches: sub-dollar, the a===0 special case,
 *  the four-figure boundary, a tick finer than maxDecimals, and all four
 *  spellings of absent. */
const VALUES = [
  0, 0.0001, 0.5, 0.9999, 1, 1.005, 12.5, 12.505, 99.999, 100, 999.994, 1000,
  1234.567, 20798, -3.5, -0.25,
]
const ABSENTS = [null, undefined, '', NaN, Infinity, -Infinity, 'abc', {}]
const TICKS = [null, 0, -1, 0.01, 0.05, 0.005, 0.0001, 1, 1e-7, 1e-9]

// ---------------------------------------------------------------------------
// NON-VACUITY
// ---------------------------------------------------------------------------

describe('non-vacuity', () => {
  it('the oracles actually disagree with each other, or nothing below means anything', () => {
    expect(OLD_drawingFormatPrice(12.5)).toBe('12.50')
    expect(OLD_disclosureFormatPrice(12.5)).toBe('$12.50')
    expect(OLD_drawingFormatPrice(null)).toBe('')
    expect(OLD_disclosureFormatPrice(null)).toBe('—')
  })

  it('the fixture crosses more than one branch of the tick rule', () => {
    const seen = new Set(TICKS.map((t) => OLD_drawingFormatPrice(12.3456789, { tick: t })))
    expect(seen.size).toBeGreaterThan(3)
  })
})

// ---------------------------------------------------------------------------
// BYTE IDENTITY — neither call site may move
// ---------------------------------------------------------------------------

describe('byte identity against the frozen oracles', () => {
  it('formatPriceTick === the pre-CP2 drawingLabels body, on every value x tick', () => {
    for (const v of [...VALUES, ...ABSENTS]) {
      for (const tick of TICKS) {
        expect(formatPriceTick(v, { tick })).toBe(OLD_drawingFormatPrice(v, { tick }))
      }
      expect(formatPriceTick(v)).toBe(OLD_drawingFormatPrice(v))
    }
  })

  it('maxDecimals is honoured identically', () => {
    for (const maxDecimals of [0, 1, 2, 4, 6, 9]) {
      expect(formatPriceTick(12.3456789, { tick: 1e-9, maxDecimals }))
        .toBe(OLD_drawingFormatPrice(12.3456789, { tick: 1e-9, maxDecimals }))
    }
  })

  it('formatPriceDisclosure === the pre-S10 presentationFormat body', () => {
    for (const v of [...VALUES, ...ABSENTS]) {
      expect(formatPriceDisclosure(v)).toBe(OLD_disclosureFormatPrice(v))
    }
  })

  it('⛔ AND THE TWO EXPORTED NAMES STILL RENDER WHAT THEY ALWAYS DID', () => {
    // The importers did not move, so this is what the four product call sites
    // actually get. If a delegation were wired to the wrong primitive, every
    // test above would still pass.
    for (const v of [...VALUES, ...ABSENTS]) {
      expect(drawingFormatPrice(v, { tick: 0.01 })).toBe(OLD_drawingFormatPrice(v, { tick: 0.01 }))
      expect(disclosureFormatPrice(v)).toBe(OLD_disclosureFormatPrice(v))
    }
  })
})

// ---------------------------------------------------------------------------
// ⛔⛔ THEY MUST STAY DIFFERENT
// ---------------------------------------------------------------------------

describe('two primitives, three deliberate disagreements', () => {
  it('the currency symbol is present in one and absent in the other', () => {
    expect(formatPriceDisclosure(12.5)).toContain('$')
    expect(formatPriceTick(12.5)).not.toContain('$')
  })

  it('only the tick primitive changes precision with the instrument', () => {
    expect(formatPriceTick(12.3456, { tick: 0.0001 })).toBe('12.3456')
    expect(formatPriceTick(12.3456, { tick: 0.01 })).toBe('12.35')
    // the disclosure rule has no tick and must not grow one by accident
    expect(formatPriceDisclosure(12.3456)).toBe('$12.35')
  })

  it('⛔ THE ABSENT SENTINELS ARE DIFFERENT, AND LAYOUT READS THEM', () => {
    // An em dash HOLDS a column; an empty string COLLAPSES it. Collapsing these
    // two into one sentinel moves a member-visible layout on four surfaces.
    expect(formatPriceDisclosure(null)).toBe(ABSENT)
    expect(formatPriceTick(null)).toBe('')
    expect(formatPriceDisclosure(null)).not.toBe(formatPriceTick(null))
  })

  it('they disagree on a real value, not only on absence', () => {
    expect(formatPriceDisclosure(12.5)).not.toBe(formatPriceTick(12.5))
  })
})

// ---------------------------------------------------------------------------
// THE DELEGATION IS REAL — asserted against SOURCE, with prose stripped
// ---------------------------------------------------------------------------

/** ⛔ CODE, NEVER PROSE. Both files QUOTE their retired bodies verbatim in ⚰️
 *  comments — that is the idiom — so a raw substring search would find the old
 *  implementation in both and this rail would fail forever on its own
 *  documentation. */
function stripJsComments(src) {
  let out = ''
  let i = 0
  let mode = 'code'
  let quote = ''
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    if (mode === 'code') {
      if (c === '/' && d === '*') { mode = 'block'; i += 2; continue }
      if (c === '/' && d === '/') { mode = 'line'; i += 2; continue }
      if (c === '"' || c === "'" || c === '`') { mode = 'str'; quote = c; out += c; i += 1; continue }
      out += c; i += 1; continue
    }
    if (mode === 'block') {
      if (c === '*' && d === '/') { mode = 'code'; i += 2; continue }
      i += 1; continue
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c }
      i += 1; continue
    }
    // string
    if (c === '\\') { out += c + (d ?? ''); i += 2; continue }
    out += c
    if (c === quote) mode = 'code'
    i += 1
  }
  return out
}

describe('the delegation is real', () => {
  const read = async (p) => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    return fs.readFileSync(path.resolve(process.cwd(), p), 'utf8')
  }

  it('drawingLabels no longer carries its own tick arithmetic in CODE', async () => {
    const code = stripJsComments(await read('src/components/chart/drawingLabels.js'))
    expect(code).toContain('formatPriceTick(value, { tick, maxDecimals })')
    expect(code).not.toContain('Math.ceil(-Math.log10(tick)')
    // ⛔ CONTROL: the ⚰️ block that records the retired body is still there, so
    // "absent from CODE" is a statement about code and not about deletion.
    const raw = await read('src/components/chart/drawingLabels.js')
    expect(raw).toContain('Math.ceil(-Math.log10(tick)')
    // ⛔ CONTROL: the stripper still sees real code.
    expect(code).toContain('export function formatPrice')
  })

  it('presentationFormat forwards to the disclosure primitive in CODE', async () => {
    const code = stripJsComments(await read('src/components/provenance/presentationFormat.js'))
    expect(code).toContain('formatPriceDisclosure(value)')
    expect(code).toContain('export function formatPrice')
  })

  it('⚰️ the false "one place in the app" claim is gone from drawingLabels', async () => {
    const raw = await read('src/components/chart/drawingLabels.js')
    // The claim is retired IN PLACE, so the words survive inside the ⚰️ block —
    // what must not survive is the ASSERTION, which read "because this is
    // already the one place in the app that knows how a price is rendered".
    expect(raw).not.toContain('because this is\n * already the one place in the app')
    expect(raw).toContain('lesson_a_comment_claiming_agreement_is_not_agreement')
  })
})

// ---------------------------------------------------------------------------
// THE ONE CALL SITE THAT IS BEHAVIOUR, NOT PRESENTATION
// ---------------------------------------------------------------------------

describe('StopConfirmSheet seeds an EDITABLE INPUT from this formatter', () => {
  it('⚠️ the seeded string is byte-identical to the pre-CP2 one', () => {
    // What a member sees, edits and SUBMITS. A changed decimal rule here is a
    // behaviour change wearing a formatter's clothes, which is why CP2 proves
    // this site separately from the rendering ones.
    for (const stop of [187.4321, 4.005, 0.9999, 1234.5]) {
      for (const tick of [0.01, 0.05, 0.0001]) {
        expect(drawingFormatPrice(stop, { tick }))
          .toBe(OLD_drawingFormatPrice(stop, { tick }))
      }
    }
  })
})
