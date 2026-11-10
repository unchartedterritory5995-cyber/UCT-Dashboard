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

// UCT Relative Strength (Phase 2a, 2a-08): every RS column has a plain name, and a fact reads as
// one sentence a member would say — "RS rating 94 of 99, up 6 in a week".
// UCT RS Phase 3 (unit 3-11): the three columns have plain names; only the quadrant says "weekly",
// because only the quadrant is read on weekly bars. The Clenow score is a fraction, never a percent.
test('the Phase 3 RS columns have plain names and the Clenow fact prints the fraction', async () => {
  const { plainColumnLabel, plainFact } = await import('../plainWords')
  expect(plainColumnLabel('rrg_quadrant')).toBe('Rotation vs SPY (weekly)')
  expect(plainColumnLabel('clenow_score')).toBe('Clenow trend score (90 days)')
  expect(plainColumnLabel('vars_state')).toBe('Volatility-adjusted RS vs SPY')
  expect(plainColumnLabel('clenow_score')).not.toMatch(/weekly/i)
  expect(plainColumnLabel('vars_state')).not.toMatch(/weekly/i)
  expect(plainFact('clenow_score', 0.8512)).toBe('Clenow trend score 0.85 over 90 sessions')
  expect(plainFact('clenow_score', -0.1234)).toBe('Clenow trend score -0.12 over 90 sessions')
  expect(plainFact('clenow_score', null)).toBe(null)
  expect(plainFact('rrg_quadrant', 'Leading')).toBe(null)    // a text column has no numeric fact
})

test('the RS columns have plain names and their facts read as one sentence each', async () => {
  const { plainColumnLabel, plainFact, rsRatingFact, rsLineFact, focusChipLabel } = await import('../plainWords')
  const cols = ['rs_new_high', 'rs_nh_before_price', 'rs_nh_red_day', 'rs_nh_bars_ago', 'green_on_red_20',
    'rs_line_above_ma', 'rs_cross_up_bars_ago', 'mansfield', 'mansfield_cross_bars_ago', 'rs_benchmark_agree',
    'rs_rating_ibd', 'rs_rating_chg_5', 'rs_rating_chg_20', 'rs_rating_1m', 'rs_rating_3m', 'rs_rating_6m', 'rs_rating_9m', 'rs_rating_12m']
  for (const c of cols) expect(plainColumnLabel(c), c).toBeTruthy()
  for (const c of cols) expect(plainColumnLabel(c), c).not.toMatch(/weekly/i)
  expect(plainFact('rs_nh_before_price', 1)).toBe('RS line at a 52-week high while price is not')
  expect(plainFact('rs_nh_before_price', 0)).toBe(null)      // the pane says what IS
  expect(plainFact('rs_nh_before_price', null)).toBe(null)
  expect(plainFact('rs_nh_bars_ago', 0)).toBe('RS line at a 52-week high today')
  expect(plainFact('rs_nh_bars_ago', 1)).toBe('RS high 1 session ago')
  expect(plainFact('rs_nh_bars_ago', 12)).toBe('RS high 12 sessions ago')
  expect(plainFact('green_on_red_20', 4)).toBe('Up on 4 down days in the last 20 sessions')
  expect(plainFact('mansfield', 3.214)).toBe('Mansfield RS +3.21% vs its 200-day avg')
  expect(plainFact('mansfield', -0.5)).toBe('Mansfield RS -0.50% vs its 200-day avg')
  expect(plainFact('rs_rating_ibd', 94)).toBe('RS rating 94 of 99')
  expect(rsRatingFact({ rs_rating_ibd: 94, rs_rating_chg_5: 6 })).toBe('RS rating 94 of 99, up 6 in a week')
  expect(rsRatingFact({ rs_rating_ibd: 94, rs_rating_chg_5: -2 })).toBe('RS rating 94 of 99, down 2 in a week')
  expect(rsRatingFact({ rs_rating_ibd: 94, rs_rating_chg_5: 0 })).toBe('RS rating 94 of 99, unchanged in a week')
  expect(rsRatingFact({ rs_rating_ibd: 94 })).toBe('RS rating 94 of 99')
  expect(rsRatingFact({ rs_rating_ibd: null, rs_rating_chg_5: 6 })).toBe(null)   // no rating, no sentence
  // one RS-line fact: the most specific flag that fired, else the phase
  expect(rsLineFact({ rs_nh_before_price: 1, rs_nh_red_day: 1, rs_new_high: 1, rs_line_above_ma: 1 })).toBe('RS line at a 52-week high while price is not')
  expect(rsLineFact({ rs_nh_before_price: 0, rs_nh_red_day: 1, rs_new_high: 1, rs_line_above_ma: 1 })).toBe('RS line at a 52-week high on a red day')
  expect(rsLineFact({ rs_nh_before_price: 0, rs_nh_red_day: 0, rs_new_high: 1, rs_line_above_ma: 1 })).toBe('RS line at a 52-week high')
  expect(rsLineFact({ rs_nh_before_price: 0, rs_nh_red_day: 0, rs_new_high: 0, rs_line_above_ma: 0 })).toBe('RS line below its 21-day avg')
  expect(rsLineFact({})).toBe(null)
  // the chip reads the plain name with the operator lowered, the family word kept
  expect(focusChipLabel({ key: 'rs_rating_ibd', label: 'RS Rating (IBD-style)', presets: [] }, { op: 'gte', min: 90 })).toBe('RS rating (IBD-style): ≥ 90')
})
