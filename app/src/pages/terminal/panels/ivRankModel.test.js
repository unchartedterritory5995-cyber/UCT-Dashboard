// OSCR RICH / OSCR CHEAP's pure half. Every symbol and number is invented; the answers are the route's real shape
// (api/services/research/iv_rank_leaders.py get_leaders).
import { describe, it, expect } from 'vitest'
import {
  IV_RANK_BUILDING_POLL_MS, IV_RANK_POLL_MS, IV_RANK_URL, OSCR_CODE, OSCR_VIEWS, OSCR_VIEW_ARG_WORDS, builtText, countsText,
  cutText, ivRankPollMs, ivRankRead, ivText, leftOutText, logText, normOscrView, notBuiltText, oiText, oscrViewCommandArgs, parseOscrView,
  percentileText, rangeText, rankText, rankedText, sessionsText, viewOfSide,
} from './ivRankModel'

const row = (symbol, rank, over = {}) => ({
  symbol, atm_iv: 0.482, iv_rank: rank, iv_percentile: 97.1, rank_word: 'High', low: 0.21, high: 0.501, sessions: 35,
  atm_dte: 28, open_interest: 1_234_000, ...over,
})
const OK = {
  status: 'ok', session: '2026-11-20', built_at: '2026-11-21T01:45:12+00:00', next_run: '2026-11-21T20:45-05:00',
  logging_began: '2026-09-30', sessions_logged: 36, rankable_sessions: 35, legacy_sessions: ['2026-09-30'],
  unread_sessions: [], missing_sessions: ['2026-10-01'], rank_min_sessions: 20, rank_window: 252, max_per_side: 100,
  counts: { ranked: 4812, below_min: 1022, flat: 3, not_in_latest: 41, latest_rows: 6034, latest_no_atm_iv: 156, symbols_logged: 5878 },
  high: [row('QRSX', 100), row('TUVX', 97.4, { rank_word: 'High' })],
  low: [row('WXYX', 0, { rank_word: 'Very low', iv_percentile: 0 })],
  method: 'IV rank = where the latest session\'s ATM IV sits between its lowest and highest.',
  high_order: 'Highest IV rank first.', low_order: 'Lowest IV rank first.', building: false, last_run: { at: 'x', ok: true },
}

describe('the view words', () => {
  it('RICH and CHEAP, and the bare command is the option screener', () => {
    expect(OSCR_CODE).toBe('OSCR')
    expect(IV_RANK_URL).toBe('/api/options-screener/iv-rank')
    expect(OSCR_VIEW_ARG_WORDS).toEqual({ RICH: 'rich', CHEAP: 'cheap' })
    expect(parseOscrView('rich')).toBe('rich')
    expect(parseOscrView(' CHEAP ')).toBe('cheap')
    for (const no of ['', 'RICHER', 'toString', 'HIGH', null, undefined]) expect(parseOscrView(no), String(no)).toBeNull()
    expect(normOscrView('cheap')).toBe('cheap')
    expect(normOscrView('screen')).toBeNull()
    expect(oscrViewCommandArgs({ view: 'rich' })).toEqual(['RICH'])
    expect(oscrViewCommandArgs({ view: 'cheap' })).toEqual(['CHEAP'])
    expect(oscrViewCommandArgs({ view: null })).toEqual([])
    expect(oscrViewCommandArgs()).toEqual([])
    expect([viewOfSide('high'), viewOfSide('low'), viewOfSide(undefined)]).toEqual(['rich', 'cheap', 'rich'])
    expect(OSCR_VIEWS.rich).toMatchObject({ label: 'Highest IV rank', token: 'RICH', side: 'high' })
    expect(OSCR_VIEWS.cheap).toMatchObject({ label: 'Lowest IV rank', token: 'CHEAP', side: 'low' })
  })
})

describe('reading the answer', () => {
  it('an answer of the route\'s shape is ok, with each row\'s numbers and nothing invented', () => {
    const v = ivRankRead(OK)
    expect(v.state).toBe('ok')
    expect(v.session).toBe('2026-11-20')
    expect(v.high.map((r) => r.sym)).toEqual(['QRSX', 'TUVX'])
    expect(v.high[0]).toEqual({ key: 'QRSX', sym: 'QRSX', order: 0, ivRank: 100, ivPercentile: 97.1, word: 'High', atmIv: 0.482,
      low: 0.21, high: 0.501, sessions: 35, dte: 28, openInterest: 1_234_000 })
    expect(v.counts).toEqual({ ranked: 4812, belowMin: 1022, flat: 3, notInLatest: 41, latestRows: 6034, latestNoIv: 156 })
    expect(v.legacy).toEqual(['2026-09-30'])
    expect(v.missing).toEqual(['2026-10-01'])
    expect(v.minSessions).toBe(20)
  })

  it('a row with no symbol or no rank is dropped; a missing number stays missing, never 0', () => {
    const v = ivRankRead({ ...OK, high: [row('', 50), row('ABQX', null), row('cdqx', 40, { open_interest: null, iv_percentile: 'x' }), 'junk'] })
    expect(v.high.map((r) => r.sym)).toEqual(['CDQX'])
    expect(v.high[0].openInterest).toBeNull()
    expect(v.high[0].ivPercentile).toBeNull()
  })

  it('not built, no log, and a shape this panel cannot read', () => {
    expect(ivRankRead({ status: 'not_built', building: true, next_run: '2026-11-21T20:45-05:00', last_run: null, rank_min_sessions: 20 }))
      .toEqual({ state: 'not_built', building: true, nextRun: '2026-11-21T20:45-05:00', lastRun: null, minSessions: 20 })
    expect(ivRankRead({ status: 'no_log', built_at: 'b' }).state).toBe('no_log')
    for (const bad of [null, undefined, [], 'x', { status: 'ok' }, { status: 'ok', high: [], low: 'x' }, { status: 'weird' }]) {
      expect(ivRankRead(bad).state, JSON.stringify(bad)).toBe('failed')
    }
  })

  it('asks every minute only while the first build runs', () => {
    expect(ivRankPollMs({ status: 'not_built', building: true })).toBe(IV_RANK_BUILDING_POLL_MS)
    expect(ivRankPollMs({ status: 'not_built', building: false })).toBe(IV_RANK_POLL_MS)
    expect(ivRankPollMs(OK)).toBe(IV_RANK_POLL_MS)
    expect(ivRankPollMs(undefined)).toBe(IV_RANK_POLL_MS)
  })
})

describe('the words', () => {
  it('each cell in words; a missing number says so', () => {
    expect(rankText(97.4)).toBe('97')
    expect(rankText(null)).toBe('n/a')
    expect(ivText(0.482)).toBe('48.2%')
    expect(ivText(null)).toBe('not logged')
    expect(rangeText({ low: 0.21, high: 0.501 })).toBe('21.0% to 50.1%')
    expect(rangeText({ low: null, high: 0.5 })).toBe('')
    expect(percentileText(97.1)).toBe('97')
    expect(percentileText(null)).toBe('n/a')
    expect(sessionsText(35)).toBe('35')
    expect(sessionsText(null)).toBe('n/a')
    expect(oiText(1_234_000)).toBe('1.2M')
    expect(oiText(null)).toBe('not given')
    expect(oiText(0)).toBe('0')
  })

  it('what was left out, in numbers: the symbols under 20 sessions are counted, never ranked', () => {
    const v = ivRankRead(OK)
    expect(countsText(v)).toBe('4,812 symbols ranked on the Nov 20 session. 1,022 symbols have fewer than 20 logged sessions and are '
      + 'left out. 3 symbols left out because the ATM IV has not moved across their sessions, so there is no rank. 41 symbols logged '
      + 'before had no ATM IV on Nov 20 and are left out. 156 of the 6,034 underlyings logged on Nov 20 had no ATM IV (no expiry 7 to '
      + '90 days out).')
    const one = ivRankRead({ ...OK, counts: { ranked: 1, below_min: 1, flat: 0, not_in_latest: 0, latest_rows: 2, latest_no_atm_iv: 0 } })
    expect(countsText(one)).toBe('1 symbol ranked on the Nov 20 session. 1 symbol has fewer than 20 logged sessions and is left out.')
    expect(rankedText(one)).toBe('1 symbol ranked on the Nov 20 session.')
    const none = ivRankRead({ ...OK, counts: { ranked: 7, below_min: 0, flat: 0, not_in_latest: 0, latest_rows: 7, latest_no_atm_iv: 0 } })
    expect(leftOutText(none)).toBe('')
    expect(countsText(none)).toBe('7 symbols ranked on the Nov 20 session.')
  })

  it('the cut says from which end, and says nothing when nothing was cut', () => {
    const v = ivRankRead(OK)
    expect(cutText(v, 'high')).toBe('Showing the 2 highest of 4,812; the rest are left off this list.')
    expect(cutText(v, 'low')).toBe('Showing the 1 lowest of 4,812; the rest are left off this list.')
    expect(cutText(ivRankRead({ ...OK, counts: { ...OK.counts, ranked: 2 } }), 'high')).toBe('')
  })

  it('when it was built and when the next build is; a failed last build is said', () => {
    const v = ivRankRead(OK)
    expect(builtText(v)).toBe('From the end-of-day snapshot of Nov 20, built Fri Nov 20, 8:45 PM ET. The next build is Sat Nov 21, 8:45 PM ET.')
    expect(builtText({ ...v, lastRun: { ok: false } })).toContain('The last build could not read the options log, so this is the list before it.')
  })

  it('the log: where it began, the rule, and every day not counted', () => {
    const v = ivRankRead({ ...OK, unread_sessions: ['2026-11-03'] })
    expect(logText(v)).toBe('The log began Sep 30; 35 sessions are read under the current ATM rule, and a rank uses each symbol\'s last 252 '
      + 'at most. Sep 30 was read under the first run\'s 20 to 45 day rule and is not counted. Nov 3 could not be read and is not counted. '
      + '1 trading session was not logged (Oct 1); a missed day is a gap, never filled in.')
  })

  it('a list no evening has built: when the build is, or that it is running', () => {
    expect(notBuiltText({ building: false, nextRun: '2026-11-21T20:45-05:00', lastRun: null }))
      .toBe('The list is built each evening from the site\'s own options log; the next build is Sat Nov 21, 8:45 PM ET.')
    expect(notBuiltText({ building: true })).toBe('The first evening build is running now. This panel asks again every minute.')
    expect(notBuiltText({ building: false, nextRun: null, lastRun: { ok: false } }))
      .toBe('The list is built each evening from the site\'s own options log. The last build could not read the options log.')
  })
})
