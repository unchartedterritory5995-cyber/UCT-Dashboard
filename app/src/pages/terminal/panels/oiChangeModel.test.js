// OIC's pure half: the URL, the typed side, the answer read into one view, and every word a row or
// a line shows. Every number is invented; the fixtures are the route's real shape
// (api/services/options_analytics/oi_change.py), with a made-up ticker.
import { describe, it, expect } from 'vitest'
import {
  OI_CHANGE_CODE, OI_ROWS_SHOWN, OI_SIDES, OI_SIDE_ARG_WORDS, asOfWords, changeLines, contractText, countText, cutLine, dayWords,
  tradingDayWords,
  expiryText, limitNotes, normOiSide, oiChangeCommandArgs, oiChangeRead, oiChangeUrl, oiLines, parseOiSide, sideTotalText, signOf,
  signedText,
} from './oiChangeModel'

const row = (over = {}) => ({
  contract: 'O:ZZA261120C00100000', expiration: '2026-11-20', strike: 100, type: 'call', oi: 1600, kind: 'change',
  prior_oi: 1000, change: 600, change_pct: 60, volume: 700, ...over,
})
const NEW = row({ contract: 'O:ZZA261120C00105000', strike: 105, oi: 900, kind: 'new', prior_oi: null, change: null, change_pct: null, volume: null })
const answer = (over = {}) => ({
  symbol: 'ZZA', side: 'any', status: 'ok', session: '2026-11-18', prior_session: '2026-11-17', skipped_sessions: [],
  known: true, has_symbol: true, prior_has_symbol: true,
  rows: [row(), row({ contract: 'O:ZZA261120P00090000', strike: 90, type: 'put', oi: 1500, prior_oi: 2000, change: -500, change_pct: -25, volume: 450 })],
  matched: 2, shown: 2, max_rows: 50,
  summary: { call: { contracts: 2, oi: 1900, prior_oi: 1300, change: 600 }, put: { contracts: 1, oi: 1500, prior_oi: 2000, change: -500 }, contracts: 3, unchanged: 1 },
  new: { contracts: 0, oi: 0 }, gone: { contracts: 0, prior_oi: 0, expired: 0 }, not_reported: 0,
  volume_present: true, volume_session: '2026-11-17', built_at: '2026-11-18T21:40:00+00:00', ...over,
})

describe('the code, the URL and the typed side', () => {
  it('asks the one route, the ticker in capitals, the side only when one is picked', () => {
    expect(OI_CHANGE_CODE).toBe('OIC')
    expect(oiChangeUrl('zza')).toBe('/api/options-screener/oi-change/ZZA')
    expect(oiChangeUrl('ZZA', 'any')).toBe('/api/options-screener/oi-change/ZZA')
    expect(oiChangeUrl('ZZA', 'put')).toBe('/api/options-screener/oi-change/ZZA?side=put')
    expect(oiChangeUrl('BRK.B', 'C')).toBe('/api/options-screener/oi-change/BRK.B?side=call')
    expect(oiChangeUrl('')).toBeNull()
  })

  it('reads C and P and their words, in any case, and nothing else', () => {
    expect(Object.keys(OI_SIDE_ARG_WORDS).sort()).toEqual(['C', 'CALL', 'CALLS', 'P', 'PUT', 'PUTS'])
    for (const [word, side] of Object.entries(OI_SIDE_ARG_WORDS)) expect(parseOiSide(word.toLowerCase()), word).toBe(side)
    for (const no of ['', 'NVDA', 'BOTH', 'toString', 'constructor', null, undefined]) expect(parseOiSide(no), String(no)).toBeNull()
  })

  it('any value becomes a side, and the default writes no argument', () => {
    expect(normOiSide('put')).toBe('put')
    expect(normOiSide('CALLS')).toBe('call')
    for (const v of [undefined, null, '', 'both', 'constructor']) expect(normOiSide(v), String(v)).toBe('any')
    expect(oiChangeCommandArgs({ side: 'any' })).toEqual([])
    expect(oiChangeCommandArgs()).toEqual([])
    expect(oiChangeCommandArgs({ side: 'call' })).toEqual(['C'])
    expect(oiChangeCommandArgs({ side: 'put' })).toEqual(['P'])
    // every chip's token is a word the parser reads back as that chip
    for (const [key, spec] of Object.entries(OI_SIDES)) if (spec.token) expect(parseOiSide(spec.token)).toBe(key)
  })
})

describe('the answer read into one view', () => {
  it('the working states are states, never rows', () => {
    expect(oiChangeRead({ status: 'computing' })).toEqual({ state: 'computing' })
    expect(oiChangeRead({ status: 'no_sessions' })).toEqual({ state: 'no-sessions' })
    expect(oiChangeRead({ status: 'one_session', session: '2026-11-18' })).toEqual({ state: 'one-session', session: '2026-11-18' })
  })

  it('anything that is not the route\'s answer is a failed read, never an empty list', () => {
    for (const bad of [null, undefined, [], 'ok', {}, { status: 'ok' }, { status: 'ok', session: '2026-11-18', prior_session: '2026-11-17' },
      { status: 'ok', session: 'today', prior_session: '2026-11-17', rows: [] }, { status: 'unavailable' }]) {
      expect(oiChangeRead(bad).state, JSON.stringify(bad)).toBe('failed')
    }
  })

  it('a stock in neither record is unknown, with the two days it was looked for in', () => {
    const v = oiChangeRead(answer({ known: false, rows: [], matched: 0 }))
    expect(v).toMatchObject({ state: 'unknown', session: '2026-11-18', priorSession: '2026-11-17' })
    expect(v.rows).toBeUndefined()
  })

  it('rows keep the server\'s order and its numbers', () => {
    const v = oiChangeRead(answer())
    expect(v.state).toBe('ok')
    expect(v.rows.map((r) => [r.type, r.strike, r.oi, r.priorOi, r.change, r.changePct, r.volume])).toEqual([
      ['call', 100, 1600, 1000, 600, 60, 700], ['put', 90, 1500, 2000, -500, -25, 450],
    ])
    expect(v.call).toEqual({ contracts: 2, oi: 1900, priorOi: 1300, change: 600 })
    expect(v.put).toEqual({ contracts: 1, oi: 1500, priorOi: 2000, change: -500 })
    expect([v.compared, v.unchanged, v.matched, v.volumePresent, v.volumeSession]).toEqual([3, 1, 2, true, '2026-11-17'])
  })

  it('a new contract carries no change, no percent and no volume, whatever the answer holds', () => {
    const v = oiChangeRead(answer({ rows: [{ ...NEW, change: 900, change_pct: 100, prior_oi: 0, volume: 12 }] }))
    expect(v.rows[0]).toMatchObject({ kind: 'new', oi: 900, priorOi: null, change: null, changePct: null, volume: null })
  })

  it('a missing number stays missing: no 0 is made up', () => {
    const v = oiChangeRead(answer({
      rows: [row({ prior_oi: 0, change: 250, change_pct: null, volume: null })],
      summary: { call: { contracts: 1, oi: 250, prior_oi: 0, change: 250 }, put: { contracts: 0, oi: 0, prior_oi: 0, change: 0 }, contracts: 1, unchanged: 0 },
    }))
    expect(v.rows[0]).toMatchObject({ priorOi: 0, change: 250, changePct: null, volume: null })
    expect(v.put).toEqual({ contracts: 0, oi: null, priorOi: null, change: null })
    expect(v.call.change).toBe(250)
  })

  it('a row that cannot be read is dropped, and the count the server sent is kept', () => {
    const v = oiChangeRead(answer({ rows: [row(), { contract: 'x' }, row({ contract: 'y', type: 'straddle' }), row({ contract: 'z', change: null }), null], matched: 80 }))
    expect(v.rows).toHaveLength(1)
    expect(v.matched).toBe(80)
    expect(oiChangeRead(answer({ matched: 1 })).matched).toBe(2)       // never under the rows in hand
  })
})

describe('the words', () => {
  it('a recorded day is its weekday, month and day, read as the date it names', () => {
    expect(dayWords('2026-11-18')).toBe('Wed Nov 18')
    expect(dayWords('2026-11-17')).toBe('Tue Nov 17')
    expect(dayWords('2026-01-01')).toBe('Thu Jan 1')
    expect(dayWords('2026-02-30')).toBe('2026-02-30')        // not a date: shown as sent
    expect(dayWords('')).toBe('')
    expect(asOfWords(oiChangeRead(answer()))).toBe('Open interest recorded Wed Nov 18 against Tue Nov 17.')
  })

  it('the change is said to be from the earlier day\'s trading, and from no one day when a day is missing between', () => {
    expect(tradingDayWords(oiChangeRead(answer()))).toBe('The change is from trading on Tue Nov 17.')
    expect(tradingDayWords(oiChangeRead(answer({ prior_session: '2026-11-13', skipped_sessions: ['2026-11-16', '2026-11-17'] })))).toBeNull()
    expect(tradingDayWords({ state: 'computing' })).toBeNull()
  })

  it('an expiry names its year only when that is not the recorded day\'s', () => {
    expect(expiryText('2026-11-20', '2026-11-18')).toBe('Nov 20')
    expect(expiryText('2027-01-15', '2026-11-18')).toBe('Jan 15, 2027')
    expect(expiryText('2026-11-20', null)).toBe('Nov 20, 2026')
    expect(expiryText(null, '2026-11-18')).toBe('expiry not given')
  })

  it('a contract is its strike and its side', () => {
    expect(contractText({ strike: 100, type: 'call' })).toBe('$100 call')
    expect(contractText({ strike: 152.5, type: 'put' })).toBe('$152.50 put')
    expect(contractText({ strike: 1250, type: 'call' })).toBe('$1,250 call')
    expect(contractText({ strike: null, type: 'put' })).toBe('strike not given put')
  })

  it('counts are grouped, signed counts carry their sign, and an absent one is words', () => {
    expect(countText(1600)).toBe('1,600')
    expect(countText(0)).toBe('0')
    expect(countText(null)).toBe('n/a')
    expect(signedText(600)).toBe('+600')
    expect(signedText(-12500)).toBe('-12,500')
    expect(signedText(0)).toBe('0')
    expect(signedText(null)).toBe('n/a')
    expect([signOf(5), signOf(-5), signOf(0), signOf(null)]).toEqual(['up', 'down', null, null])
  })

  it('a row\'s two cells: the change with its percent, the figure with what it was', () => {
    const [up, down] = oiChangeRead(answer()).rows
    expect(changeLines(up)).toEqual(['+600', '+60.0%'])
    expect(changeLines(down)).toEqual(['-500', '-25.0%'])
    expect(oiLines(up)).toEqual(['1,600', 'was 1,000'])
    expect(changeLines({ kind: 'change', change: 250, changePct: null, priorOi: 0 })).toEqual(['+250', 'from 0'])
    expect(changeLines({ kind: 'change', change: 250, changePct: null, priorOi: 40 })).toEqual(['+250', 'percent not given'])
  })

  it('a new contract is the word New, never a change from 0', () => {
    const fresh = oiChangeRead(answer({ rows: [NEW] })).rows[0]
    expect(changeLines(fresh)).toEqual(['New', 'not in the earlier record'])
    expect(oiLines(fresh)).toEqual(['900', 'no earlier figure'])
    expect(changeLines(fresh).join(' ')).not.toMatch(/[+-]\d|%/)
  })

  it('a side total is its change with both figures, or words when the side has nothing to total', () => {
    const v = oiChangeRead(answer())
    expect(sideTotalText(v.call, 'call')).toBe('+600 (1,300 to 1,900, over 2 calls)')
    expect(sideTotalText(v.put, 'put')).toBe('-500 (2,000 to 1,500, over 1 put)')
    expect(sideTotalText({ contracts: 0, oi: null, priorOi: null, change: null }, 'put')).toBe('no put is in both records')
  })
})

describe('the cut line', () => {
  const many = (n, matched = n) => oiChangeRead(answer({
    rows: Array.from({ length: n }, (_, i) => row({ contract: `c${i}`, strike: 100 + i, change: 1000 - i })), matched,
  }))

  it('says nothing when every changed contract is on screen', () => {
    expect(cutLine(oiChangeRead(answer()), 2)).toBeNull()
    expect(cutLine(many(OI_ROWS_SHOWN), OI_ROWS_SHOWN)).toBeNull()
    expect(cutLine({ state: 'computing' }, 0)).toBeNull()
  })

  it('names how many are shown of how many, what the order is, and which end is cut', () => {
    expect(OI_ROWS_SHOWN).toBe(15)
    expect(cutLine(many(40), 15)).toBe('Showing the 15 biggest of 40 changed or new contracts, by number of contracts. The smaller ones are cut from the bottom.')
  })

  it('past the server\'s own cap it says how many were never sent', () => {
    expect(cutLine(many(50, 83), 50)).toBe('Showing the 50 biggest of 83 changed or new contracts, by number of contracts. The 33 smallest are not listed: the server sends the 50 biggest.')
    // before "Show more" the same answer still reads as a cut from the bottom
    expect(cutLine(many(50, 83), 15)).toContain('Showing the 15 biggest of 83')
  })

  it('names the side it counted', () => {
    const v = oiChangeRead(answer({ side: 'put', rows: Array.from({ length: 20 }, (_, i) => row({ contract: `p${i}`, type: 'put' })), matched: 20 }))
    expect(cutLine(v, 15)).toContain('of 20 changed or new puts')
  })
})

describe('the honest limits', () => {
  const keys = (over) => limitNotes(oiChangeRead(answer(over)), 'ZZA').map((n) => n.key)
  const text = (over, key) => limitNotes(oiChangeRead(answer(over)), 'ZZA').find((n) => n.key === key).text

  it('none applies to a clean pair of days, or to a state that is not an answer', () => {
    expect(keys({})).toEqual([])
    expect(limitNotes({ state: 'computing' }, 'ZZA')).toEqual([])
  })

  it('a missing day is named, with the day compared against', () => {
    expect(text({ prior_session: '2026-11-13', skipped_sessions: ['2026-11-16', '2026-11-17'] }, 'skipped'))
      .toBe('No record was stored for Mon Nov 16, Tue Nov 17, so this compares against Fri Nov 13, the last stored day, and the change covers more than one session.')
  })

  it('new contracts are counted with what they hold, and said to be out of the totals', () => {
    expect(text({ new: { contracts: 3, oi: 4200 } }, 'new'))
      .toBe('3 contracts are new: not in the Tue Nov 17 record, holding 4,200 open interest now. A new contract has no earlier figure, so it shows as new, never as a change from 0, and is left out of the totals.')
    expect(text({ new: { contracts: 1, oi: 900 } }, 'new')).toContain('1 contract is new')
  })

  it('contracts that left the record, and figures that were not reported, are counted', () => {
    expect(text({ gone: { contracts: 2, prior_oi: 740, expired: 1 } }, 'gone'))
      .toBe('2 contracts from the Tue Nov 17 record are not in the newer one (1 expired), holding 740 open interest then. They are left out of the totals.')
    expect(text({ gone: { contracts: 1, prior_oi: 40, expired: 0 } }, 'gone'))
      .toBe('1 contract from the Tue Nov 17 record is not in the newer one, holding 40 open interest then. It is left out of the totals.')
    expect(text({ not_reported: 2 }, 'not-reported'))
      .toBe('2 contracts have no open interest figure in one of the two records and are left out, not counted as 0.')
  })

  it('a stock missing from one record says which, and does not also list every contract as new', () => {
    expect(keys({ prior_has_symbol: false, new: { contracts: 4, oi: 100 } })).toEqual(['no-prior'])
    expect(text({ prior_has_symbol: false }, 'no-prior')).toBe('ZZA has no contract in the Tue Nov 17 record, so every contract here is new and there is no change to total.')
    expect(text({ has_symbol: false, gone: { contracts: 4, prior_oi: 10, expired: 4 } }, 'no-current')).toContain('ZZA has no contract in the Wed Nov 18 record')
  })

  it('the order is fixed: what it compares against, then what is left out', () => {
    expect(keys({ skipped_sessions: ['2026-11-16'], prior_session: '2026-11-13', new: { contracts: 1, oi: 5 }, gone: { contracts: 1, prior_oi: 5, expired: 0 }, not_reported: 1 }))
      .toEqual(['skipped', 'new', 'gone', 'not-reported'])
  })
})
