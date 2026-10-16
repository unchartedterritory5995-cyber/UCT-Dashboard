import { expect, test } from 'vitest'
import { plainMeta } from '../plainWords'

test('plainMeta relabels only the columns it has a plain name for', () => {
  const meta = { categories: [{ key: 'technical' }], filters: [
    { key: 'adr_pct', label: 'ADR %', presets: [{ label: 'Over 4%' }] },
    { key: 'rs_rank', label: 'RS Rank', presets: [] },
  ] }
  const out = plainMeta(meta)
  expect(out.filters.map(f => f.label)).toEqual(['Avg daily range', 'RS Rank'])
  expect(out.filters[0].presets).toBe(meta.filters[0].presets)
  expect(out.filters[1]).toBe(meta.filters[1])
  expect(out.categories).toBe(meta.categories)
  expect(meta.filters[0].label).toBe('ADR %')           // the server's meta is not mutated
})
test('plainMeta hands back the same object when nothing moves, and passes a missing meta through', () => {
  const meta = { filters: [{ key: 'rs_rank', label: 'RS Rank' }] }
  expect(plainMeta(meta)).toBe(meta)
  expect(plainMeta(null)).toBe(null)
  expect(plainMeta(undefined)).toBe(undefined)
})

// Volume vs usual BY NOW (live `rvol_live`): the chart pane prefers it to the completed-session ratio.
test('the volume fact prefers the live by-now reading and falls back to the session ratio', async () => {
  const { volumeFact, plainColumnLabel } = await import('../plainWords')
  expect(volumeFact({ rvol_live: 2.34, vol_ratio: 0.8 })).toBe('Volume 2.3× usual by now')
  expect(volumeFact({ rvol_live: null, vol_ratio: 2.3 })).toBe('Volume 2.3× avg')
  expect(volumeFact({ vol_ratio: 2.3 })).toBe('Volume 2.3× avg')
  expect(volumeFact({})).toBe(null)
  expect(plainColumnLabel('rvol_live')).toBe('Volume vs usual by now')
})

// The live tier sets the high flags from the INTRADAY high while distances read the close.
test('the high flags say the stock HIT the high, not that it closed there', async () => {
  const { plainColumnLabel } = await import('../plainWords')
  expect(plainColumnLabel('new_52w_high')).toBe('Hit a 52-week high')
  expect(plainColumnLabel('new_ath')).toBe('Hit an all-time high')
})
test('sentenceCase lowers capitalised words after the first and keeps codes', async () => {
  const { sentenceCase } = await import('../plainWords')
  expect(sentenceCase('Flat Base')).toBe('Flat base')
  expect(sentenceCase('Cup with Handle')).toBe('Cup with handle')
  expect(sentenceCase('Buyable Gap-Up')).toBe('Buyable gap-up')
  expect(sentenceCase('Early entry inside a cup (3-C)')).toBe('Early entry inside a cup (3-C)')
  expect(sentenceCase('EMA Crossback')).toBe('EMA crossback')
})
test('structureSentence reads naturally for states, plurals and textbook names', async () => {
  const { structureSentence } = await import('../plainWords')
  expect(structureSentence('Declining Structure')).toBe('In a downtrend: lower highs and lows')
  expect(structureSentence('Undefined Structure')).toBe('No clear trend in its swings')
  expect(structureSentence('Three Weeks Tight')).toBe('Has three tight weekly closes')
  expect(structureSentence('Square Box')).toBe('Has a short boxy base')
  expect(structureSentence('Inside Day')).toBe('Has an Inside Day')
  for (const s of ['Advancing Structure', 'Declining Structure', 'Contracting Range', 'Expanding Range', 'Undefined Structure']) {
    expect(structureSentence(s)).not.toMatch(/^Has an? /)
  }
})
