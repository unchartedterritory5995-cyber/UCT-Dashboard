// CACT's pure half. Every date, ratio, amount and former ticker here is invented; the bodies are
// the two routes' real shapes (api/services/corporate_actions_held.py, api/routers/research_notices.py).
import { describe, it, expect } from 'vitest'
import {
  CACT_CODE, CACT_NAMES_WHAT, CACT_ROWS_SHOWN, CACT_SOURCE, CACT_WHAT, NO_TICKER_NOW, amountWords, cactNamesUrl, cactRead, cactUrl,
  cutLine, dateWords, formerlyLine, heldLine, namesRead, previousLead, previousLine, splitWords,
} from './corporateActionsModel'

const held = (over = {}) => ({
  sym: 'ZZA', status: 'ok', held_at: '2026-11-17T14:02:11+00:00', source: 'massive', row_cap: 60,
  splits: { rows: [{ date: '2024-06-10', ratio: '10:1', to_factor: 10 }, { date: '2021-07-20', ratio: '4:1', to_factor: 4 }], total: 2, window_years: 45 },
  dividends: { rows: [{ date: '2026-09-10', amount: 0.0125 }, { date: '2026-06-11', amount: 0.01 }], total: 2, window_years: 5, basis: 'split_adjusted' },
  ...over,
})

describe('the names and the two routes', () => {
  it('names its code, the two things it reads, its source and how many rows it draws first', () => {
    expect(CACT_CODE).toBe('CACT')
    expect(CACT_WHAT).toBe('Corporate actions')
    expect(CACT_NAMES_WHAT).toBe('The name and ticker record')
    expect(CACT_SOURCE).toBe('Massive reference data, as held by UCT')
    expect(CACT_ROWS_SHOWN).toBe(12)
    expect(cactUrl('NVDA')).toBe('/api/research/corporate-actions/NVDA')
    expect(cactUrl('BRK-B')).toBe('/api/research/corporate-actions/BRK-B')
    expect(cactNamesUrl('NVDA')).toBe('/api/research/rename-notice/NVDA')
  })
})

describe('the words', () => {
  it('a day reads from its own parts', () => {
    expect(dateWords('2020-08-28')).toBe('Aug 28, 2020')
    expect(dateWords('2026-01-02')).toBe('Jan 2, 2026')
    for (const bad of [null, undefined, '', '2026-13-01', '2026-1-2', 'Aug 28', 20200828]) expect(dateWords(bad), String(bad)).toBe('an unknown day')
  })

  it('a split reads shares after for shares before, and says when it is a reverse split', () => {
    expect(splitWords('4:1')).toBe('4 for 1')
    expect(splitWords('3:2')).toBe('3 for 2')
    expect(splitWords('1.5:1')).toBe('1.5 for 1')
    expect(splitWords('1:10')).toBe('1 for 10 (reverse split)')
    expect(splitWords(' 2:1 ')).toBe('2 for 1')
    expect(splitWords('four for one')).toBe('four for one')           // shown as written
    expect(splitWords('0:1')).toBe('0:1')
    for (const none of [null, undefined, '', '  ', 4]) expect(splitWords(none), String(none)).toBe('Ratio not given')
  })

  it('an amount keeps the decimals it needs, and a missing or zero one is never $0', () => {
    expect(amountWords(0.25)).toBe('$0.25')
    expect(amountWords(1.4)).toBe('$1.40')
    expect(amountWords(0.0125)).toBe('$0.0125')
    expect(amountWords(0.005)).toBe('$0.0050')
    for (const none of [null, undefined, 0, -0.25, NaN, Infinity, '0.25']) expect(amountWords(none), String(none)).toBe('Amount not given')
  })
})

describe('the held record', () => {
  it('anything that is not the route\'s shape is a failed read, never an empty record', () => {
    for (const body of [undefined, null, [], 'x', 7, {}, { status: 'computing' }, { splits: { rows: [] } }]) {
      expect(cactRead(body), JSON.stringify(body)).toMatchObject({ state: 'failed', empty: true })
    }
  })

  it('nothing held is its own state, with the server\'s sentence', () => {
    const view = cactRead({ sym: 'ZZA', status: 'not_held', reason: 'No splits or dividends are held on this server for ZZA.', held_at: null })
    expect(view).toMatchObject({ state: 'not_held', reason: 'No splits or dividends are held on this server for ZZA.', heldAt: null })
    expect(cactRead({ status: 'not_held' }).reason).toBe('')
  })

  it('reads the splits and the dividends as held, with their totals, windows and the time the record was written', () => {
    const view = cactRead(held())
    expect(view.state).toBe('ok')
    expect(view.heldAt).toBe('2026-11-17T14:02:11+00:00')
    expect(view.empty).toBe(false)
    expect(view.splits).toEqual({ rows: [{ date: '2024-06-10', ratio: '10:1' }, { date: '2021-07-20', ratio: '4:1' }], total: 2, cut: false, years: 45 })
    expect(view.dividends).toEqual({ rows: [{ date: '2026-09-10', amount: 0.0125 }, { date: '2026-06-11', amount: 0.01 }], total: 2, cut: false, years: 5 })
  })

  it('a held total above the rows sent means the answer was cut', () => {
    const view = cactRead(held({ dividends: { rows: [{ date: '2026-09-10', amount: 0.5 }], total: 84, window_years: 5 } }))
    expect(view.dividends).toMatchObject({ total: 84, cut: true })
    // a total below the rows is not believed: the rows are what is there
    expect(cactRead(held({ splits: { rows: [{ date: '2024-06-10', ratio: '2:1' }], total: 0 } })).splits).toMatchObject({ total: 1, cut: false, years: null })
  })

  it('drops a row without a day, keeps a missing ratio or amount as missing, and reads a bad time as none', () => {
    const view = cactRead(held({
      held_at: 'not a time',
      splits: { rows: [{ date: 'x', ratio: '2:1' }, null, { date: '2020-01-02', ratio: 7 }], total: 1 },
      dividends: { rows: [{ date: '2025-05-06', amount: '0.25' }, { amount: 0.5 }, 'junk'], total: 1 },
    }))
    expect(view.heldAt).toBeNull()
    expect(view.splits.rows).toEqual([{ date: '2020-01-02', ratio: null }])
    expect(view.dividends.rows).toEqual([{ date: '2025-05-06', amount: null }])
  })

  it('a held record with neither in it is ok and empty, which is not the same as not held', () => {
    const view = cactRead(held({ splits: { rows: [], total: 0, window_years: 45 }, dividends: { rows: [], total: 0, window_years: 5 } }))
    expect(view).toMatchObject({ state: 'ok', empty: true })
    expect(cactRead(held({ splits: null, dividends: undefined }))).toMatchObject({ state: 'ok', empty: true })
  })

  it('the sentence above the tables counts what is held', () => {
    expect(heldLine('ZZA', cactRead(held()))).toBe('ZZA: 2 splits and 2 cash dividends held.')
    expect(heldLine('ZZA', cactRead(held({ splits: { rows: [], total: 0 }, dividends: { rows: [{ date: '2026-09-10', amount: 0.5 }], total: 1 } })))).toBe('ZZA: 1 cash dividend held.')
    expect(heldLine('ZZA', cactRead(held({ dividends: { rows: [], total: 0 }, splits: { rows: [{ date: '2024-06-10', ratio: '2:1' }], total: 1 } })))).toBe('ZZA: 1 split held.')
    expect(heldLine('ZZA', cactRead(held({ dividends: { rows: [{ date: '2026-09-10', amount: 0.5 }], total: 1200 }, splits: null })))).toBe('ZZA: 1,200 cash dividends held.')
    expect(heldLine('ZZA', cactRead(held({ splits: null, dividends: null })))).toBe('The record held for ZZA has no split and no dividend in it.')
  })

  it('the cut line says what is drawn against what is held, and why when the route itself cut it', () => {
    const section = (n, total) => ({ rows: Array.from({ length: n }, () => ({})), total, cut: total > n, years: 5 })
    expect(cutLine(section(8, 8), 8, 'dividends')).toBeNull()
    expect(cutLine(section(20, 20), 12, 'dividends')).toBe('Showing the newest 12 of 20 dividends held.')
    expect(cutLine(section(60, 84), 12, 'dividends')).toBe('Showing the newest 12 of 84 dividends held.')
    expect(cutLine(section(60, 84), 60, 'dividends')).toBe('Showing the newest 60 of 84 dividends held; this panel reads at most 60.')
    expect(cutLine(section(60, 61), 60, 'splits')).toBe('Showing the newest 60 of 61 splits held; this panel reads at most 60.')
  })
})

describe('the name and ticker record', () => {
  const record = (over = {}) => ({
    sym: 'ZZA', state: 'ok', source: 'entity_master',
    current: { entity_id: 'ent-1', ambiguous: false, formerly: [{ alias: 'zzo', valid_from: '2015-03-02', valid_to: '2022-06-09' }] },
    previous_holders: [
      { entity_id: 'ent-2', held_from: '2001-01-02', held_to: '2012-05-04', now_trades_as: [{ alias: 'QQZ', valid_from: '2012-05-04' }], lifecycle_state: 'active' },
      { entity_id: 'ent-3', held_from: null, held_to: '1999-12-31', now_trades_as: [], lifecycle_state: 'delisted' },
    ],
    ...over,
  })

  it('anything that is not the record\'s shape is a failed read', () => {
    for (const body of [undefined, null, [], 'x', {}, { state: 'weird' }]) expect(namesRead(body).state, JSON.stringify(body)).toBe('failed')
  })

  it('a record that could not be opened, and one with no entry, are each their own state', () => {
    expect(namesRead({ state: 'store_unavailable', reason: 'x' })).toEqual({ state: 'unavailable', formerly: [], previous: [] })
    expect(namesRead({ state: 'not_in_store' })).toEqual({ state: 'none', formerly: [], previous: [] })
  })

  it('reads the tickers this company used before and the companies that used this ticker before', () => {
    expect(namesRead(record())).toEqual({
      state: 'ok',
      formerly: [{ alias: 'ZZO', from: '2015-03-02', to: '2022-06-09' }],
      previous: [{ from: '2001-01-02', to: '2012-05-04', nowAs: ['QQZ'] }, { from: null, to: '1999-12-31', nowAs: [] }],
    })
  })

  it('more than one company under the ticker today is ambiguous; a clean record with nothing in it is ok and empty', () => {
    expect(namesRead(record({ current: { ambiguous: true, formerly: [] } })).state).toBe('ambiguous')
    expect(namesRead(record({ current: { ambiguous: false, formerly: [] }, previous_holders: [] }))).toEqual({ state: 'ok', formerly: [], previous: [] })
    expect(namesRead(record({ current: null, previous_holders: null }))).toEqual({ state: 'ok', formerly: [], previous: [] })
  })

  it('drops an alias with no ticker and a date that is not a day', () => {
    const view = namesRead(record({
      current: { formerly: [{ alias: '' }, null, { alias: 'OLDQ', valid_from: 'x', valid_to: null }] },
      previous_holders: [null, 'junk', { held_from: 'x', held_to: 7, now_trades_as: [{ alias: ' ' }, { alias: 'nwq' }] }],
    }))
    expect(view.formerly).toEqual([{ alias: 'OLDQ', from: null, to: null }])
    expect(view.previous).toEqual([{ from: null, to: null, nowAs: ['NWQ'] }])
  })

  it('one sentence per former ticker, with the dates the record gives and no more', () => {
    expect(formerlyLine('ZZA', { alias: 'ZZO', from: '2015-03-02', to: '2022-06-09' })).toBe('ZZA traded as ZZO from Mar 2, 2015 until Jun 9, 2022.')
    expect(formerlyLine('ZZA', { alias: 'ZZO', from: null, to: '2022-06-09' })).toBe('ZZA traded as ZZO until Jun 9, 2022.')
    expect(formerlyLine('ZZA', { alias: 'ZZO', from: '2015-03-02', to: null })).toBe('ZZA traded as ZZO from Mar 2, 2015.')
    expect(formerlyLine('ZZA', { alias: 'ZZO', from: null, to: null })).toBe('ZZA traded as ZZO on dates the record does not give.')
  })

  it('one sentence per company that used the ticker before, and where it trades now', () => {
    const p = { from: '2001-01-02', to: '2012-05-04', nowAs: ['QQZ', 'QQY'] }
    expect(previousLead('ZZA', p)).toBe('A different company used ZZA from Jan 2, 2001 until May 4, 2012.')
    expect(previousLine('ZZA', p)).toBe('A different company used ZZA from Jan 2, 2001 until May 4, 2012. It now trades as QQZ, QQY.')
    expect(NO_TICKER_NOW).toBe('It holds no ticker in the record today.')
    expect(previousLine('ZZA', { from: null, to: '1999-12-31', nowAs: [] })).toBe('A different company used ZZA until Dec 31, 1999. It holds no ticker in the record today.')
  })
})
