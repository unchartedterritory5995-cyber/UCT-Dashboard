// WHAT A MEMBER READS FOR A NAME THAT IS DELIBERATELY NOT AVAILABLE (memberReason.js).
//
// Run over the REAL vocabulary, so an entry added to the engine's table tomorrow is held to the
// same rules the day it lands.
import { describe, it, expect } from 'vitest'
import { buildVocabulary } from '../../components/chart/engine/ast/vocabulary'
import { parseFormula } from '../../components/chart/engine/ast/parse'
import { memberReason, memberExcluded, memberVocabulary } from './memberReason'

const vocab = buildVocabulary()
const shown = memberExcluded(vocab.excluded)
const names = (list) => new Set(list.map((e) => e.name))

describe('the member’s sentence', () => {
  it('is short and plain for every entry shown: none of the engine’s own notes', () => {
    expect(shown.length).toBeGreaterThan(60)
    for (const e of shown) {
      expect(e.says, e.name).toBeTruthy()
      expect(e.says.length, `${e.name}: ${e.says}`).toBeLessThanOrEqual(220)
      expect(e.says, e.name).not.toMatch(/[A-Z]{6,}/)                      // no shouted runs
      expect(e.says, e.name).not.toMatch(/\.(py|js|json|db)\b|`/)          // no file names, no code ticks
      expect(e.says, e.name).not.toMatch(/\b20\d\d-\d\d-\d\d\b|\bWave \d|\bW\d\b|\bR\d\b|\bDARK\b|production/i)
      expect(e.says.endsWith('.'), e.name).toBe(true)
    }
  })

  it('today every entry shown is a KNOWN kind: nothing falls through to the fallback', () => {
    // a new kind of reason in the engine’s table lands here, and somebody writes its sentence
    const fallback = shown.filter((e) => e.says === 'Not available to formulas.' || e.says === 'Not available as a formula function.')
    expect(fallback.map((e) => e.name)).toEqual([])
  })

  it('the Screener column families of 2026-11-23/24 say their true kind, never the fallback', () => {
    // 34 columns (hv_20, iv_rank, group_rank, factor_*, ...) showed members "Not available to formulas." on master
    const says = new Map(shown.map((e) => [e.name, e.says]))
    const notFilled = ['hv_20', 'hv_60', 'ad_net_25', 'pocket_pivots_20', 'days_since_pocket_pivot', 'corr_rel_last',
      'eps_surprise_last', 'eps_beat_streak', 'insider_buys_30d', 'insider_buy_value_30d', 'fund_net_adds',
      'iv_rank', 'iv_percentile', 'group_rank', 'group_rank_of', 'group_rank_chg_4w', 'short_interest_chg_pct',
      'days_to_ex_div', 'eps_rev_up_30d', 'eps_rev_down_30d', 'eps_rev_net_30d', 'days_to_lockup', 'seas_month_avg',
      'seas_month_up_pct', 'seas_month_years', 'post_earn_drift_5d', 'factor_mkt', 'factor_size', 'factor_growth',
      'factor_mom', 'factor_r2', 'up_capture_1y', 'down_capture_1y']
    for (const name of notFilled) expect(says.get(name), name).toMatch(/^Not filled in yet, so a formula cannot read it\./)
    expect(says.get('next_ex_div_date')).toBe('A date, not a number, so a formula cannot read it. Filter by it in the Screener.')
    // CONTROL: a column of those families held back for ANY OTHER reason is not called "not filled": it asks for its
    // own sentence (the fallback, which the rail above turns red)
    for (const family of ['VOLUME & VOLATILITY', 'BEATS, INSIDERS & FUNDS', 'HELD-STORE COLUMNS', 'ROW COLUMNS']) {
      expect(memberReason({ name: 'z', kind: 'scalar', reason: `${family}, 2026-11-24 -- held back for another reason.` }).says,
        family).toBe('Not available to formulas.')
    }
  })

  it('says the true thing for the kinds a member meets', () => {
    const by = Object.fromEntries(shown.map((e) => [e.name, e.says]))
    expect(by.sector).toMatch(/^Text, not a number/)
    expect(by.ipo_date).toMatch(/^A date, not a number/)
    expect(by.obv).toMatch(/^A running total from the first bar of history/)
    expect(by.pvi).toBe(by.obv)
    expect(by.hl2).toBe('No separate name is needed: it is a short formula.')
    expect(by.eps_ttm).toMatch(/^Not filled in yet/)
    expect(by.pct_vs_ema9).toMatch(/^A Screener filter, not a formula name yet/)
    expect(by.accdis).toMatch(/^A letter grade/)
    expect(by.ticker).toBe('The symbol itself, not a value a formula reads.')
  })
})

describe('what is left out of the member’s roster', () => {
  const leftOut = vocab.excluded.filter((e) => !names(shown).has(e.name))

  it('every unreleased or internal column, and every name that has since become available', () => {
    expect(leftOut.length).toBeGreaterThan(30)
    for (const e of leftOut) {
      expect(String(e.reason).replace(/^[^A-Za-z`]+/, ''), e.name)
        .toMatch(/^DARK\b|^TEXT, and DARK\b|ARCHIVE CONTEXT|^NOT A MEMBER COLUMN|^RS EXIT WARNINGS|^an operations timestamp|^an `as_of` SOURCE|^the same, for the bar-dated family|EXPANSION/)
    }
    // ⛔ nothing shown to a member is one of those
    for (const e of shown) {
      expect(String(e.reason), e.name).not.toMatch(/\bDARK, 20|ARCHIVE CONTEXT|NOT A MEMBER COLUMN/)
      expect(e.name).not.toMatch(/^archive_/)
    }
  })

  it('⛔ a name the formula language HAS is never listed as "not available"', () => {
    // the Bollinger band functions and the parabolic SAR are written as calls today
    for (const name of ['bbUpper', 'bbMiddle', 'bbLower']) {
      expect(parseFormula(`${name}(close, 20, 2) > 0`).ok || parseFormula(`${name}(close, 20) > 0`).ok, name).toBe(true)
      expect(names(shown).has(name), name).toBe(false)
    }
  })

  it('CONTROL: an ordinary absent name is still shown', () => {
    for (const name of ['sector', 'obv', 'hl2', 'ticker']) expect(names(shown).has(name), name).toBe(true)
  })
})

describe('the mechanics', () => {
  it('a kind nobody has written a sentence for gets the plain fallback, never the engine’s note', () => {
    expect(memberReason({ name: 'x', kind: 'function', reason: 'SOMETHING NEW AND INTERNAL, see foo.py' }))
      .toEqual({ leftOut: false, says: 'Not available as a formula function.' })
    expect(memberReason({ name: 'y', kind: 'scalar', reason: '⛔ ANOTHER NEW THING' }).says).toBe('Not available to formulas.')
    expect(memberReason(null)).toEqual({ leftOut: false, says: 'Not available to formulas.' })
  })

  it('leading symbols do not hide the kind', () => {
    expect(memberReason({ kind: 'function', reason: '⛔ A RANK, NOT A RANGE — and more' }).says).toMatch(/percentile rank/)
    expect(memberReason({ kind: 'scalar', reason: '⭐ DARK, 2026-11-14 (unit)' }).leftOut).toBe(true)
  })

  it('is idempotent, keeps the substitute, and leaves the rest of the vocabulary alone', () => {
    expect(memberExcluded(shown)).toEqual(shown)
    const v = memberVocabulary(vocab)
    expect(v.groups).toBe(vocab.groups)
    expect(v.excluded).toEqual(shown)
    const withInstead = shown.filter((e) => e.instead)
    expect(withInstead.length).toBeGreaterThan(3)
    for (const e of withInstead) expect(parseFormula(e.instead).ok, e.instead).toBe(true)
    expect(memberExcluded(null)).toEqual([])
  })
})
