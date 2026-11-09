// app/src/components/chart/engine/__tests__/readoutSchema.va2.test.js
//
// ─── UCT RS unit VA2 — the rating group's inputs, as the readout reads them ──
//
//   showRating      `when: 'input:showRating'` on every rating row: off omits the
//                   Rating glance row, its card's numbers and the pane-label number.
//   headlineRating  `chipWhen` on the two rating chip rows: which number rides the
//                   pane label (`ibd` 94, the default since 2026-11-07, `fast`
//                   "fast 91", `both`), the card keeps both.
//   showComponents  `when` on the Components detail row (off by default): the four
//                   component ranks the server sends as `rating.components`.
//   ratingBands     `band` on the rating rows: the site's 80 / 60 / 40 cuts, only
//                   while the switch is on.
//   and the schema half: the three new entry fields fail closed at registration,
//   the condition evaluator agrees with the inputs' `evalActiveWhen`, and none of
//   the new inputs is a server input (no `compute.rev` bump, no fetch-key change).
import { describe, it, expect } from 'vitest'
import { readoutRows, readoutChipRows, readoutConditionOpen, ratingBandOf, RATING_BANDS,
  READOUT_ENTRY_FIELDS } from '../readoutSchema'
import { evalActiveWhen } from '../../indicatorRegistry'
import { validateDefinition } from '../defSchema'
import { legendChips } from '../readout'
import * as engineRegistry from '../nativeRegistry'

const RS = engineRegistry.getDefinition('rsLine')
const PAYLOAD = Object.freeze({
  benchmark: { requested: 'SECTOR', resolved: 'XLK', label: 'Technology (XLK)', fallback: null, bars: 852 },
  rating: { ibd: 94, fast: 55, asof: '2026-11-05', d5: 2, d20: 7, source: 'row', summary: '94 · fast 55',
    m1: 91, m3: 97, m6: 95, m12: 96, components: '1M 91 · 3M 97 · 6M 95 · 12M 96' },
})
const rows = (inputs = {}, payload = PAYLOAD) => readoutRows(RS, payload, { inputs })
const keys = (rs) => rs.map((r) => r.key)
const chip = (inputs = {}, payload = PAYLOAD) => {
  const b = { instanceId: 'inst:rsLine:1', defId: 'rsLine', plotKey: 'rsLine', series: { __id: 'rs' }, lastValue: 0.4187 }
  const inst = { instanceId: 'inst:rsLine:1', defId: 'rsLine', inputs: { benchmark: 'SECTOR', ...inputs }, hidden: false }
  return legendChips([b], null, engineRegistry, [inst], { scalarsOf: () => payload })[0]
}

describe('the RS definition declares the rating inputs the plan names (§6.3)', () => {
  it('showRating (Simple), headlineRating, showComponents and ratingBands (Rating), with their defaults', () => {
    const by = Object.fromEntries(RS.inputs.map((i) => [i.key, i]))
    expect(by.showRating).toMatchObject({ type: 'bool', default: true, group: 'Simple' })
    // ⭐ 2026-11-07: the headline defaults to IBD-style (the plan said both), so the
    // pane label is the Phase 2a one, byte for byte
    expect(by.headlineRating).toMatchObject({ type: 'enum', default: 'ibd', group: 'Rating' })
    expect(by.headlineRating.options.map((o) => o[0])).toEqual(['ibd', 'fast', 'both'])
    expect(by.ratingBands).toMatchObject({ type: 'bool', default: true, group: 'Rating' })
    // both Rating controls dim while the rating is off
    expect(by.headlineRating.activeWhen).toEqual({ key: 'showRating', equals: true })
    expect(by.ratingBands.activeWhen).toEqual({ key: 'showRating', equals: true })
    // the payload carries the component ranks now (shape 4), so the switch ships, off
    expect(by.showComponents).toMatchObject({ type: 'bool', default: false, group: 'Rating',
      activeWhen: { key: 'showRating', equals: true } })
    // ⛔ a switch with nothing behind it is not shipped: there is no rating pane
    expect(by.showRatingHistory).toBeUndefined()
  })

  it('⛔ none is a server input, and the compute revision did not move', () => {
    for (const k of ['showRating', 'headlineRating', 'showComponents', 'ratingBands']) expect(RS.meta.serverInputs).not.toContain(k)
    // 3-08 moved both to 4 for the Phase 3 columns and inputs; the rating inputs
    // still moved neither (none is in serverInputs, above). Round 2 moved both to 5
    // for the RS Rating Reading's columns, not for these inputs.
    expect(RS.compute.rev).toBe(5)
    expect(RS.version).toBe(5)
  })

  it('every label and tooltip is plain words: no emoji, no "heuristic"', () => {
    for (const k of ['showRating', 'headlineRating', 'showComponents', 'ratingBands']) {
      const i = RS.inputs.find((x) => x.key === k)
      for (const s of [i.label, i.tooltip, ...(i.options || []).map((o) => o[1])]) {
        expect(s, k).not.toMatch(/\p{Extended_Pictographic}/u)
        expect(s, k).not.toMatch(/heuristic/i)
      }
    }
  })
})

describe('showRating', () => {
  it('on (default): the Rating glance row, its numbers and the pane-label numbers', () => {
    const r = rows()
    expect(keys(r)).toEqual(expect.arrayContaining(['ratingSummary', 'rating', 'fastRating', 'ratingAsOf']))
    expect(chip().suffix).toBe(' · XLK · 94')
  })
  it('off: every rating row is omitted, and the pane label keeps the benchmark alone', () => {
    const r = rows({ showRating: false })
    for (const k of ['ratingSummary', 'rating', 'fastRating', 'ratingAsOf']) expect(keys(r), k).not.toContain(k)
    // the Components row sits in the Rating card, so it goes with it, even switched on
    expect(keys(rows({ showRating: false, showComponents: true }))).not.toContain('ratingSummary')
    expect(keys(r)).toContain('benchmarkName')
    expect(chip({ showRating: false }).suffix).toBe(' · XLK')
  })
  it('off never promotes another row into the pane label', () => {
    const picked = readoutChipRows(RS, rows({ showRating: false }))
    expect(picked.map((x) => x.key)).toEqual(['benchmark'])
  })
})

describe('headlineRating', () => {
  it('ibd (default): the IBD-style number alone, exactly the Phase 2a label', () => {
    expect(chip({ headlineRating: 'ibd' }).suffix).toBe(' · XLK · 94')
    expect(chip().suffix).toBe(' · XLK · 94')
  })
  it('fast: the fast number, labelled so it never reads as the IBD-style one', () => {
    expect(chip({ headlineRating: 'fast' }).suffix).toBe(' · XLK · fast 55')
  })
  it('both: IBD-style then fast', () => {
    expect(chip({ headlineRating: 'both' }).suffix).toBe(' · XLK · 94 · fast 55')
  })
  it('the card keeps both numbers whatever the headline says, and the prefix never reaches the card', () => {
    for (const h of ['ibd', 'fast', 'both']) {
      const r = rows({ headlineRating: h })
      expect(r.find((x) => x.key === 'rating'), h).toMatchObject({ text: '94', detailOf: 'ratingSummary' })
      expect(r.find((x) => x.key === 'fastRating'), h).toMatchObject({ text: '55', detailOf: 'ratingSummary' })
    }
  })
  it('a missing fast rating leaves the label on the IBD-style number, never a dangling "fast"', () => {
    const p = { ...PAYLOAD, rating: { ...PAYLOAD.rating, fast: null, summary: '94' } }
    expect(chip({}, p).suffix).toBe(' · XLK · 94')
    expect(chip({ headlineRating: 'fast' }, p).suffix).toBe(' · XLK')
  })
})

describe('showComponents', () => {
  it('off (default): no Components row', () => {
    expect(keys(rows())).not.toContain('ratingComponents')
  })
  it('on: the text the server sends, verbatim, as a detail row of the Rating card', () => {
    expect(rows({ showComponents: true }).find((x) => x.key === 'ratingComponents'))
      .toMatchObject({ label: 'Components', text: '1M 91 · 3M 97 · 6M 95 · 12M 96', detailOf: 'ratingSummary', muted: false })
  })
  it('on, with no component in the payload: the row is omitted, never a stand-in', () => {
    const p = { ...PAYLOAD, rating: { ...PAYLOAD.rating, m1: null, m3: null, m6: null, m12: null, components: null } }
    expect(keys(rows({ showComponents: true }, p))).not.toContain('ratingComponents')
  })
  it('never rides the pane label and is never banded', () => {
    const r = rows({ showComponents: true })
    expect(readoutChipRows(RS, r).map((x) => x.key)).not.toContain('ratingComponents')
    expect(r.find((x) => x.key === 'ratingComponents').band).toBeUndefined()
    expect(chip({ showComponents: true }).suffix).toBe(' · XLK · 94')
  })
})

describe('ratingBands', () => {
  it('on (default): each rating row carries its band; the glance row reads the IBD-style number', () => {
    const r = rows()
    expect(r.find((x) => x.key === 'ratingSummary').band).toBe('lead')
    expect(r.find((x) => x.key === 'rating').band).toBe('lead')
    expect(r.find((x) => x.key === 'fastRating').band).toBe('neutral')
    // a row that is not a rating carries none
    expect(r.find((x) => x.key === 'benchmarkName').band).toBeUndefined()
  })
  it('off: no band anywhere', () => {
    for (const x of rows({ ratingBands: false })) expect(x.band, x.key).toBeUndefined()
  })
  it('the muted fallback ("not yet rated") is never banded', () => {
    const r = rows({}, { ...PAYLOAD, rating: { ibd: null, fast: null, summary: null } })
    expect(r.find((x) => x.key === 'ratingSummary')).toMatchObject({ muted: true, text: 'not yet rated' })
    expect(r.find((x) => x.key === 'ratingSummary').band).toBeUndefined()
  })
  it('the cuts are the site\'s: 80 and above, 60, 40, below 40; nothing outside 1 to 99', () => {
    expect(RATING_BANDS.map((b) => b[0])).toEqual([80, 60, 40, 1])
    const cases = [[99, 'lead'], [80, 'lead'], [79, 'strong'], [60, 'strong'], [59, 'neutral'], [40, 'neutral'], [39, 'lag'], [1, 'lag']]
    for (const [v, b] of cases) expect(ratingBandOf(v), String(v)).toBe(b)
    for (const v of [0, 100, -5, NaN, null, undefined, '94']) expect(ratingBandOf(v), String(v)).toBeNull()
  })
})

describe('readoutConditionOpen mirrors evalActiveWhen (one condition language)', () => {
  const def = { inputs: [{ key: 'h', type: 'enum', default: 'both' }, { key: 'n', type: 'int', default: 5 }, { key: 'b', type: 'bool', default: true }] }
  const conds = [
    { key: 'h', equals: 'both' }, { key: 'h', equals: 'ibd' }, { key: 'h', notEquals: 'fast' },
    { key: 'h', in: ['ibd', 'both'] }, { key: 'h', in: ['fast'] }, { key: 'h', in: 'nope' },
    { key: 'n', gt: 4 }, { key: 'n', gte: 6 }, { key: 'n', lt: 6 }, { key: 'n', lte: 4 },
    { key: 'b' }, { key: 'b', whatever: 1 }, null, { nokey: true },
  ]
  const storedSets = [{}, { h: 'ibd', n: 9, b: false }, { h: 'fast', n: 4 }]
  it('agrees on every comparator, over stored values and declared defaults', () => {
    for (const stored of storedSets) {
      const values = Object.fromEntries(def.inputs.map((i) => [i.key, stored[i.key] !== undefined ? stored[i.key] : i.default]))
      for (const c of conds) {
        expect(readoutConditionOpen(c, def, stored), JSON.stringify([c, stored])).toBe(evalActiveWhen(c, values))
      }
    }
  })
})

describe('defSchema: chipWhen / chipPrefix / band fail closed', () => {
  const base = (entry) => ({
    ...RS,
    readout: [{ key: 'a', label: 'A', source: 'scalar:x', format: 'int', ...entry }],
  })
  const errs = (entry) => { const r = validateDefinition(base(entry)); return r.ok ? [] : r.errors.join(' | ') }
  it('the three fields are declared readout fields', () => {
    for (const f of ['chipWhen', 'chipPrefix', 'band']) expect(READOUT_ENTRY_FIELDS).toContain(f)
  })
  it('accepts the shapes the RS rows use', () => {
    expect(errs({ chip: true, chipWhen: { key: 'headlineRating', in: ['ibd'] }, chipPrefix: 'fast',
      band: { source: 'scalar:x', when: 'input:ratingBands' } })).toEqual([])
    expect(errs({ band: { source: 'scalar:x' } })).toEqual([])
  })
  it('refuses a chipWhen off a chip row, on an undeclared input, or with no / two comparators', () => {
    expect(errs({ chipWhen: { key: 'headlineRating', in: ['ibd'] } })).toMatch(/only a chip row/)
    expect(errs({ chip: true, chipWhen: { key: 'nope', equals: 1 } })).toMatch(/names no declared input/)
    expect(errs({ chip: true, chipWhen: { key: 'headlineRating' } })).toMatch(/exactly one comparator/)
    expect(errs({ chip: true, chipWhen: { key: 'headlineRating', equals: 'ibd', in: ['x'] } })).toMatch(/exactly one comparator/)
    expect(errs({ chip: true, chipWhen: { key: 'headlineRating', in: 'ibd' } })).toMatch(/expected an array/)
    expect(errs({ chip: true, chipWhen: 'input:headlineRating' })).toMatch(/expected \{key/)
  })
  it('refuses an empty prefix and a band with a bad source, an undeclared input or an unknown field', () => {
    expect(errs({ chipPrefix: '' })).toMatch(/chipPrefix/)
    expect(errs({ band: { source: 'nope' } })).toMatch(/band\.source/)
    expect(errs({ band: { source: 'scalar:x', when: 'input:nope' } })).toMatch(/band\.when/)
    expect(errs({ band: { source: 'scalar:x', colour: 'red' } })).toMatch(/unknown band field/)
    expect(errs({ band: 'scalar:x' })).toMatch(/expected \{source/)
  })
})
