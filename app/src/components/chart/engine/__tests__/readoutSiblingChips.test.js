// app/src/components/chart/engine/__tests__/readoutSiblingChips.test.js
//
// ─── TWO COPIES OF ONE INDICATOR MUST NOT WEAR THE SAME NAME ────────────────
//
// ⚰️ MEASURED ON PRODUCTION 2026-08-14, WMT 1D. "+ Add another" on MACD put a
// second instance on the chart. The legend then carried FOUR chips reading
// `MACD`, `SIG`, `MACD`, `SIG` — every one of them titled
// `MACD — right-click for options`, with nothing anywhere saying which was
// 12/26/9 and which was 15/26/9. Chart Settings → Indicators rendered two
// sections both headed exactly `MACD`, and the Indicators library showed a single
// `✓`. The whole point of "add another" is running one indicator at two settings,
// and the product could not tell the member which was which on any surface.
//
// ⛔ THE DISAMBIGUATOR IS DERIVED FROM WHAT ACTUALLY DIFFERS, not from
// `meta.legendParams`. MACD deliberately declares NO `legendParams`
// (`nativeRegistry.js:345`) because its two plots need distinct labels — `SIG` is
// not "MACD" — and `shortName` cannot express that. A disambiguator built on
// `legendParams` would therefore do nothing for the one definition that surfaced
// the bug. Comparing the siblings' resolved inputs works for every definition,
// including AST-lane user formulas that declare no meta at all.
//
// ⭐ AND A LONE CHIP IS UNTOUCHED, BYTE FOR BYTE. That is the property that keeps
// this out of the ~4,700 existing chart assertions: the suffix appears only when
// a second instance of the SAME plot is actually on the chart.
import { describe, it, expect } from 'vitest'
import { chipsFrom } from '../readout'
import * as engineRegistry from '../nativeRegistry'

const MACD = 'macd'

function entry(instanceId, plotKey, series, lastValue) {
  return { defId: MACD, plotKey, series, lastValue, instanceId }
}

/** `chipsFrom` needs a truthy series handle and finds nothing in an empty map,
 *  so it falls through to `lastValue` — which makes it a pure formatter here. */
const NO_POINTS = new Map()

function chips(entries, inputsByInstance) {
  return chipsFrom(entries, NO_POINTS, engineRegistry, (_defId, instanceId) => inputsByInstance[instanceId] || {})
}

describe('one instance — the legend is unchanged', () => {
  it('a lone MACD chip still reads exactly "MACD"', () => {
    const out = chips([entry('inst:macd:1', 'macd', {}, 1.5)], {
      'inst:macd:1': { fast: 12, slow: 26, signal: 9 },
    })
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe('MACD')
    expect(out[0].text).toBe('MACD 1.5000')
  })

  it('a lone SIG chip still reads exactly "SIG"', () => {
    const out = chips([entry('inst:macd:1', 'signal', {}, -0.5)], {
      'inst:macd:1': { fast: 12, slow: 26, signal: 9 },
    })
    expect(out[0].label).toBe('SIG')
  })
})

describe('two instances — each chip says which one it is', () => {
  const twoEntries = [
    entry('inst:macd:1', 'macd', {}, 1.5),
    entry('inst:macd:1', 'signal', {}, -0.5),
    entry('inst:macd:2', 'macd', {}, 2.5),
    entry('inst:macd:2', 'signal', {}, -1.5),
  ]
  const inputs = {
    'inst:macd:1': { fast: 12, slow: 26, signal: 9 },
    'inst:macd:2': { fast: 15, slow: 26, signal: 9 },
  }

  it('names the input that differs, and only that one', () => {
    const out = chips(twoEntries, inputs)
    const macd = out.filter(c => c.plotKey === 'macd').map(c => c.label)
    expect(macd).toEqual(['MACD (fast 12)', 'MACD (fast 15)'])
    // `slow` and `signal` are equal across the pair — naming them would be noise.
    expect(macd.join(' ')).not.toMatch(/slow|signal/)
  })

  it('disambiguates the SIGNAL plot too — both chips are ambiguous, not just one', () => {
    const out = chips(twoEntries, inputs)
    expect(out.filter(c => c.plotKey === 'signal').map(c => c.label))
      .toEqual(['SIG (fast 12)', 'SIG (fast 15)'])
  })

  it('the printed text carries the suffix, since that is what the member reads', () => {
    const out = chips(twoEntries, inputs)
    expect(out[0].text).toBe('MACD (fast 12) 1.5000')
  })

  it('names EVERY differing input when more than one differs', () => {
    const out = chips(twoEntries, {
      'inst:macd:1': { fast: 12, slow: 26, signal: 9 },
      'inst:macd:2': { fast: 15, slow: 30, signal: 9 },
    })
    expect(out.filter(c => c.plotKey === 'macd').map(c => c.label))
      .toEqual(['MACD (fast 12, slow 26)', 'MACD (fast 15, slow 30)'])
  })

  it('falls back to an ordinal when the two instances are genuinely identical', () => {
    // `addInstance` seeds declared defaults, so a member who adds a second copy
    // and changes nothing yet is in exactly this state — and the two lines are
    // drawn on top of each other. "#1/#2" is thin, but it is not a lie, and it
    // beats two chips that claim to be the same thing.
    const out = chips(twoEntries, {
      'inst:macd:1': { fast: 12, slow: 26, signal: 9 },
      'inst:macd:2': { fast: 12, slow: 26, signal: 9 },
    })
    expect(out.filter(c => c.plotKey === 'macd').map(c => c.label))
      .toEqual(['MACD #1', 'MACD #2'])
  })

  it('three instances all get named', () => {
    const out = chips([
      entry('inst:macd:1', 'macd', {}, 1),
      entry('inst:macd:2', 'macd', {}, 2),
      entry('inst:macd:3', 'macd', {}, 3),
    ], {
      'inst:macd:1': { fast: 12, slow: 26, signal: 9 },
      'inst:macd:2': { fast: 15, slow: 26, signal: 9 },
      'inst:macd:3': { fast: 20, slow: 26, signal: 9 },
    })
    expect(out.map(c => c.label)).toEqual(['MACD (fast 12)', 'MACD (fast 15)', 'MACD (fast 20)'])
  })

  it('two DIFFERENT definitions are not siblings and keep their plain labels', () => {
    const out = chipsFrom([
      { defId: 'macd', plotKey: 'macd', series: {}, lastValue: 1, instanceId: 'inst:macd:1' },
      { defId: 'rsi', plotKey: 'rsi', series: {}, lastValue: 55, instanceId: 'inst:rsi:1' },
    ], NO_POINTS, engineRegistry, (defId) => (defId === 'rsi' ? { period: 14 } : { fast: 12, slow: 26, signal: 9 }))
    expect(out.map(c => c.label)).toEqual(['MACD', 'RSI(14)'])
  })

  it('a definition that ALREADY tells its copies apart is left alone', () => {
    // RSI declares `legendParams: ['period']`, so two copies already print
    // `RSI(14)` and `RSI(7)`. Suffixing those would read `RSI(14) (period 14)`.
    const out = chipsFrom([
      { defId: 'rsi', plotKey: 'rsi', series: {}, lastValue: 54.321, instanceId: 'inst:rsi:1' },
      { defId: 'rsi', plotKey: 'rsi', series: {}, lastValue: 61.25, instanceId: 'inst:rsi:2' },
    ], NO_POINTS, engineRegistry, (_d, id) => (id === 'inst:rsi:1' ? { period: 14 } : { period: 7 }))
    expect(out.map(c => c.label)).toEqual(['RSI(14)', 'RSI(7)'])
  })

  it('the same instance listed twice is not two instances — the control', () => {
    // Without this, a naive "more than one entry for this plot" test would
    // disambiguate a legend that has only one copy on it.
    const out = chips([
      entry('inst:macd:1', 'macd', {}, 1.5),
      entry('inst:macd:1', 'macd', {}, 1.5),
    ], { 'inst:macd:1': { fast: 12, slow: 26, signal: 9 } })
    expect(out.every(c => c.label === 'MACD')).toBe(true)
  })
})
