/**
 * Rails for the market context STAMP's model half (Notebook P2a, Task 9).
 *
 * ⛔ Every reading here is asserted by the TEXT a member reads: the value, the
 * source wording and the date. A stamp is a frozen record inside a note, and a
 * record that renders "0.00%" for a change nobody measured, or a server code path
 * as its source, is a wrong record that looks right.
 */
import { describe, it, expect } from 'vitest'
import {
  sourcedText, presetFor, FIELD_SETS, SOURCED_ROWS, REGIME_WORDS, CONTEXT_ROWS, UNCAPTURED_SENTENCE,
} from './marketContextModel'
import { BLOCK_KINDS } from '../../journal-2-0/lib/journalBlocks'

describe('the stamp\'s sourced rows', () => {
  it('a regime reads as its word', () => {
    expect(sourcedText('regime', { value: 'orange', source: 'UCT Exposure Rating', asOf: '2026-10-13', missing: null }))
      .toEqual({ text: 'Orange', missing: false, asOfText: 'UCT Exposure Rating, as of 2026-10-13' })
  })
  it('a price always says its time, in ET', () => {
    const t = sourcedText('spy', { value: { price: 600.5, changePct: -0.42, closed: false }, source: 'live price',
      asOf: '2026-10-13T17:26:00Z', missing: null })
    expect(t.text).toBe('600.50 (-0.42%) · as of 1:26 PM ET')
    expect(sourcedText('qqq', { value: { price: 500, changePct: 1, closed: true }, source: 'live price', asOf: null, missing: null }).text)
      .toBe('500.00 (+1.00%) · last close')
  })
  it('a missing field is its sentence, muted, never an object (IR-S4)', () => {
    expect(sourcedText('vix', { value: null, source: null, asOf: null, missing: 'VIX unavailable' }))
      .toEqual({ text: 'VIX unavailable', missing: true, asOfText: null })
    expect(sourcedText('regime', { value: null, missing: { liveUnavailable: 'x' } }).text).toBe('Not available.')
  })
  it('the presets', () => {
    expect(FIELD_SETS.indexes).toEqual({ context: [], sourced: ['spy', 'qqq', 'vix'] })
    expect(FIELD_SETS.regime.sourced).toEqual(['regime'])
    expect(FIELD_SETS.all.context).toEqual(CONTEXT_ROWS.map((r) => r.key))
    expect(SOURCED_ROWS.map((r) => r.key)).toEqual(['regime', 'spy', 'qqq', 'vix'])
    expect(REGIME_WORDS.amber).toBe('Yellow')
  })
})

describe('the stamp\'s wording (Task 9 rulings)', () => {
  it('R-T3-5: a null changePct is "change unavailable" — never 0.00%, never blank', () => {
    const t = sourcedText('spy', { value: { price: 600.5, changePct: null, closed: false }, source: 'live price',
      asOf: '2026-10-13T17:26:00Z', missing: null })
    expect(t.text).toBe('600.50 · change unavailable · as of 1:26 PM ET')
    expect(t.text).not.toMatch(/0\.00%/)
    expect(t.missing).toBe(false)
    const closed = sourcedText('qqq', { value: { price: 500, closed: true }, source: 'last close',
      asOf: '2026-10-09T20:00:00Z', missing: null })
    expect(closed.text).toBe('500.00 · change unavailable · last close')
  })

  it('CONTROL — a REAL zero change still reads as one (only a null is unavailable)', () => {
    expect(sourcedText('spy', { value: { price: 600, changePct: 0, closed: true }, source: 'last close',
      asOf: null, missing: null }).text).toBe('600.00 (0.00%) · last close')
  })

  it('the regime\'s internal code-path source is worded for members, never rendered raw', () => {
    const t = sourcedText('regime', { value: 'amber', source: 'journal_two.regime.get_current_regime',
      asOf: '2026-10-13', missing: null })
    expect(t).toEqual({ text: 'Yellow', missing: false, asOfText: 'UCT Exposure Rating, as of 2026-10-13' })
  })

  it('a regime dated by a timestamp reads its date in ET', () => {
    // 01:30 UTC on the 14th is still the 13th in New York — the ET day, not the UTC one.
    expect(sourcedText('regime', { value: 'red', source: 'x', asOf: '2026-10-14T01:30:00Z', missing: null }).asOfText)
      .toBe('UCT Exposure Rating, as of Oct 13, 2026, 9:30 PM ET')
  })

  it('a price\'s source line words its source and carries its ET date', () => {
    expect(sourcedText('spy', { value: { price: 600.5, changePct: -0.42, closed: false }, source: 'live price',
      asOf: '2026-10-13T17:26:00Z', missing: null }).asOfText).toBe('Live price, Oct 13, 2026, 1:26 PM ET')
    expect(sourcedText('qqq', { value: { price: 500, changePct: 1, closed: true }, source: 'last close',
      asOf: '2026-10-09T20:00:00Z', missing: null }).asOfText).toBe('Last close, Oct 9, 2026, 4:00 PM ET')
    // A plain-words label passes through; a code path never does.
    expect(sourcedText('spy', { value: { price: 1, changePct: 1, closed: true }, source: 'delayed quote',
      asOf: null, missing: null }).asOfText).toBe('Delayed quote')
    expect(sourcedText('spy', { value: { price: 1, changePct: 1, closed: true }, source: 'live_prices._px_key',
      asOf: null, missing: null }).asOfText).toBe('Quoted price')
  })

  it('a price whose number is not a number is not available — never "NaN"', () => {
    const t = sourcedText('spy', { value: { price: null, changePct: 1, closed: false }, source: 'live price',
      asOf: '2026-10-13T17:26:00Z', missing: null })
    expect(t).toEqual({ text: 'Not available.', missing: true, asOfText: null })
  })

  it('a regime value that is not a word is not available — never "[object Object]"', () => {
    expect(sourcedText('regime', { value: { id: 'red' }, source: 'x', asOf: null, missing: null }).text).toBe('Not available.')
  })

  it('presetFor: a known preset, else everything — an inherited key is not a preset', () => {
    expect(presetFor('indexes')).toBe(FIELD_SETS.indexes)
    expect(presetFor(undefined)).toBe(FIELD_SETS.all)
    expect(presetFor('newer-version-preset')).toBe(FIELD_SETS.all)
    expect(presetFor('constructor')).toBe(FIELD_SETS.all)
    expect(presetFor('toString')).toBe(FIELD_SETS.all)
  })

  it('the uncaptured sentence, verbatim (IR-S11)', () => {
    expect(UNCAPTURED_SENTENCE).toBe('Market context is captured when a note is created. This note was written before it had one.')
  })
})

describe('S20: FIELD_SETS is one of the four homes of the fields options — railed to the catalog', () => {
  const catalogFields = () => BLOCK_KINDS.find((k) => k.id === 'marketcontext')?.settings.find((s) => s.key === 'fields')

  it('the presets ARE the catalog\'s options, in its order', () => {
    const f = catalogFields()
    expect(f, 'journalBlocks carries a marketcontext fields setting').toBeTruthy()          // non-vacuity
    expect(f.options.length).toBeGreaterThan(0)
    expect(Object.keys(FIELD_SETS)).toEqual([...f.options])
    expect(FIELD_SETS[f.default], 'the catalog default is a preset').toBeTruthy()
  })

  it('every preset names only rows that exist', () => {
    const ctx = new Set(CONTEXT_ROWS.map((r) => r.key))
    const src = new Set(SOURCED_ROWS.map((r) => r.key))
    for (const [name, p] of Object.entries(FIELD_SETS)) {
      for (const k of p.context) expect(ctx.has(k), `${name}.context ${k}`).toBe(true)
      for (const k of p.sourced) expect(src.has(k), `${name}.sourced ${k}`).toBe(true)
    }
  })
})
