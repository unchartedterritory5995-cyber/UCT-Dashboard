// TIDEH's pure half: the URL, the typed scope, the answer read into one view, the day in words, the
// compact dollars, the bar lengths, the sums and their refusals, and the missing-session note.
// Every number is invented; the fixtures are the route's real shape
// (api/services/options_analytics/tide_history.py history()).
import { describe, it, expect } from 'vitest'
import {
  TIDE_HISTORY_CODE, TIDE_MISSING_NAMED, TIDE_ROWS_SHOWN, TIDE_SCOPES, TIDE_SCOPE_ARG_WORDS, TIDE_SESSIONS_ASKED, TIDE_SUM_WINDOWS,
  anyUnreadable, barWidth, barsFor, countText, cutLine, dayWords, leftOutText, missingNote, normTideScope, parseTideScope, premiumText, printsLine,
  signOf, storedLine, sumOver, summaryFor, throughWords, tideHistoryCommandArgs, tideHistoryRead, tideHistoryUrl,
} from './tideHistoryModel'

/** The weekdays of November 2026 before Thanksgiving, oldest first. */
const DAYS = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11',
  '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18']
const sess = (session, call, put, over = {}) => ({
  session, net_call_premium: call, net_put_premium: put, net_premium: call - put, prints_counted: 1200, prints_unsigned: 90,
  data_through: '15:59', stored_at: `${session}T21:33:04+00:00`, source: 'capture', ...over,
})
/** A history answer for these sessions (given oldest first; the route sends newest first). */
const body = (sessions, over = {}) => {
  const newest = [...sessions].reverse()
  return {
    scope: 'all', sessions: newest, sessions_stored: newest.length, sessions_asked: 250,
    history_began: newest.length ? newest[newest.length - 1].session : null, latest_session: newest.length ? newest[0].session : null,
    missing_sessions: [], missing_checked_through: newest.length ? newest[0].session : null, backfill: false,
    stored_note: 'Each session is stored once after its close, about 4:30 PM ET, and is not revised afterwards.',
    filters: 'The flow tape records option prints of 50+ contracts and $10K+ premium; smaller prints are not on it and are not in this tide.',
    method: 'Each print is signed by its side.', label: 'computed', ...over,
  }
}
const run = (n, over) => body(DAYS.slice(-n).map((d, i) => sess(d, 1_000_000 * (i + 1), 400_000)), over)

describe('the code, the URL and the typed scope', () => {
  it('asks the one route for the scope and the most sessions it serves', () => {
    expect(TIDE_HISTORY_CODE).toBe('TIDEH')
    expect(TIDE_SESSIONS_ASKED).toBe(250)
    expect(tideHistoryUrl('all')).toBe('/api/options/market-tide/history?scope=all&sessions=250')
    expect(tideHistoryUrl('etfs')).toBe('/api/options/market-tide/history?scope=etfs&sessions=250')
    expect(tideHistoryUrl('nonsense')).toBe('/api/options/market-tide/history?scope=all&sessions=250')
    expect(tideHistoryUrl()).toBe('/api/options/market-tide/history?scope=all&sessions=250')
  })

  it('reads the scope words, in any case, and nothing else', () => {
    expect(TIDE_SCOPE_ARG_WORDS).toEqual({ STOCKS: 'stocks', STOCK: 'stocks', ETFS: 'etfs' })
    expect(parseTideScope('stocks')).toBe('stocks')
    expect(parseTideScope(' Etfs ')).toBe('etfs')
    for (const no of ['ALL', 'ETF', 'toString', 'constructor', '', null, undefined, 'NVDA']) expect(parseTideScope(no), String(no)).toBeNull()
    expect(normTideScope('stocks')).toBe('stocks')
    expect(normTideScope('toString')).toBe('all')
    expect(normTideScope(undefined)).toBe('all')
  })

  it('writes a pick back as its token, and the default as the bare command', () => {
    expect(Object.keys(TIDE_SCOPES)).toEqual(['all', 'stocks', 'etfs'])
    expect(tideHistoryCommandArgs({ scope: 'all' })).toEqual([])
    expect(tideHistoryCommandArgs({ scope: 'stocks' })).toEqual(['STOCKS'])
    expect(tideHistoryCommandArgs({ scope: 'etfs' })).toEqual(['ETFS'])
    expect(tideHistoryCommandArgs()).toEqual([])
    for (const [key, spec] of Object.entries(TIDE_SCOPES)) if (spec.token) expect(parseTideScope(spec.token), key).toBe(key)
  })
})

describe('words for a day, a minute and a dollar figure', () => {
  it('a day reads as weekday, month and day, from the date itself', () => {
    expect(dayWords('2026-11-18')).toBe('Wed Nov 18')
    expect(dayWords('2026-11-02')).toBe('Mon Nov 2')
    expect(dayWords('2026-01-01')).toBe('Thu Jan 1')
    expect(dayWords('2026-12-31')).toBe('Thu Dec 31')
    for (const bad of ['2026-02-30', '2026-13-01', 'yesterday', '', null, undefined, 20261118]) expect(dayWords(bad), String(bad)).toBe('an unknown day')
  })

  it('the stored minute reads as a clock time in ET', () => {
    expect(throughWords('15:59')).toBe('3:59 PM ET')
    expect(throughWords('12:58')).toBe('12:58 PM ET')
    expect(throughWords('09:31')).toBe('9:31 AM ET')
    expect(throughWords('00:05')).toBe('12:05 AM ET')
    for (const bad of ['25:00', '12:61', '9:31', '', null, undefined]) expect(throughWords(bad), String(bad)).toBeNull()
  })

  it('dollars are compact and signed, and a missing figure is n/a, never $0', () => {
    expect(premiumText(4_200_000)).toBe('+$4.2M')
    expect(premiumText(-310_000)).toBe('-$310K')
    expect(premiumText(1_250_000_000)).toBe('+$1.25B')
    expect(premiumText(0)).toBe('$0')
    for (const missing of [null, undefined, NaN, Infinity, '5', true]) expect(premiumText(missing), String(missing)).toBe('n/a')
    expect(countText(12345)).toBe('12,345')
    expect(countText(null)).toBe('n/a')
  })

  it('a sign is the sign of the number, and a missing number has none', () => {
    expect(signOf(5)).toBe('up')
    expect(signOf(-0.01)).toBe('down')
    expect(signOf(0)).toBe('flat')
    for (const missing of [null, undefined, NaN, '5']) expect(signOf(missing), String(missing)).toBeNull()
  })
})

describe('reading the answer', () => {
  it('an answer that is not the route\'s shape is a failed read, never an empty history', () => {
    for (const bad of [null, undefined, 'x', [], {}, { scope: 'all' }, { sessions: [] }, { scope: 'all', sessions: 'none' }, { scope: 'bonds', sessions: [] },
      { error: 'warming' }]) {
      expect(tideHistoryRead(bad).state, JSON.stringify(bad)).toBe('failed')
    }
  })

  it('nothing stored is its own state, with nothing dated', () => {
    const view = tideHistoryRead(body([]))
    expect(view).toMatchObject({ state: 'none', scope: 'all', rows: [], stored: 0, began: null, latest: null, missing: [], checkedThrough: null })
    expect(storedLine(view)).toBe('No session is stored yet.')
  })

  it('keeps the route\'s order (newest first) and reads each row\'s three figures', () => {
    const view = tideHistoryRead(body([sess('2026-11-17', 2_500_000, 900_000), sess('2026-11-18', -300_000, 1_100_000, { data_through: '16:14', prints_counted: 2040 })]))
    expect(view.state).toBe('ok')
    expect(view.rows.map((r) => r.session)).toEqual(['2026-11-18', '2026-11-17'])
    expect(view.rows[0]).toEqual({ session: '2026-11-18', netCall: -300_000, netPut: 1_100_000, net: -1_400_000, prints: 2040, unsigned: 90, unreadable: null, through: '16:14' })
    expect(view).toMatchObject({ stored: 2, began: '2026-11-17', latest: '2026-11-18', checkedThrough: '2026-11-18', backfill: false })
    expect(view.filters).toContain('50+ contracts and $10K+ premium')
    expect(view.storedNote).toContain('stored once after its close')
    expect(view.method).toBe('Each print is signed by its side.')
  })

  it('the line under a day counts its prints, and names the unreadable ones only when there were any', () => {
    const view = tideHistoryRead(body([sess('2026-11-16', 1, 1, { prints_counted: 1, prints_unreadable: 0 }),
      sess('2026-11-17', 1, 1, { prints_counted: 2663, prints_unreadable: 0 }),
      sess('2026-11-18', 1, 1, { prints_counted: 2040, prints_unreadable: 3 })]))
    expect(view.rows[0].unreadable).toBe(3)
    expect(printsLine(view.rows[0])).toBe('2,040 prints')
    expect(view.rows.map(leftOutText)).toEqual(['3 left out', null, null])
    expect(leftOutText({ prints: 250_000, unreadable: 1200 })).toBe('1,200 left out')
    expect(leftOutText({ prints: null, unreadable: 3 })).toBeNull()             // no count to set it beside
    expect(leftOutText({ prints: 50, unreadable: null })).toBeNull()
    expect(printsLine(view.rows[1])).toBe('2,663 prints')
    expect(printsLine(view.rows[2])).toBe('1 print')
    expect(printsLine({ prints: null, unreadable: 3 })).toBe('n/a')
    expect(printsLine({ prints: 50, unreadable: null })).toBe('50 prints')
    expect(anyUnreadable(view.rows)).toBe(true)
    expect(anyUnreadable(view.rows.slice(1))).toBe(false)
    expect(anyUnreadable([])).toBe(false)
  })

  it('a figure the route did not send is missing, never 0, and a row with no day is dropped', () => {
    const view = tideHistoryRead(body([sess('2026-11-17', 1, 1), sess('2026-11-18', 5, 2, { net_premium: null, net_call_premium: 'x', prints_counted: undefined, data_through: 959 })],
      { sessions_stored: 2 }))
    expect(view.rows[0]).toMatchObject({ netCall: null, netPut: 2, net: null, prints: null, through: null })
    const dropped = tideHistoryRead({ ...body([sess('2026-11-18', 5, 2)]), sessions: [sess('2026-11-18', 5, 2), { net_premium: 4 }, null, sess('Nov 17', 1, 1)] })
    expect(dropped.rows.map((r) => r.session)).toEqual(['2026-11-18'])
  })

  it('the count stored is the server\'s when it holds more than it sent, and the first day is the server\'s', () => {
    const view = tideHistoryRead(run(3, { sessions_stored: 300, history_began: '2025-09-02' }))
    expect(view.stored).toBe(300)
    expect(view.began).toBe('2025-09-02')
    expect(view.latest).toBe('2026-11-18')
    // a count below what was sent, or a day that is not a day, falls back to the rows in hand
    const odd = tideHistoryRead(run(3, { sessions_stored: 1, history_began: 'x', latest_session: null, missing_sessions: ['2026-11-16', 'soon', null], missing_checked_through: 7 }))
    expect(odd).toMatchObject({ stored: 3, began: '2026-11-16', latest: '2026-11-18', missing: ['2026-11-16'], checkedThrough: null })
  })

  it('says how many sessions are stored and since which day', () => {
    expect(storedLine(tideHistoryRead(run(1)))).toBe('1 session stored, Wed Nov 18.')
    expect(storedLine(tideHistoryRead(run(13)))).toBe('13 sessions stored since Mon Nov 2.')
    expect(storedLine(tideHistoryRead(run(3, { sessions_stored: 1300, history_began: '2025-09-02' })))).toBe('1,300 sessions stored since Tue Sep 2.')
  })
})

describe('the bar', () => {
  const rows = (nets) => nets.map((net, i) => ({ session: DAYS[i], net }))

  it('each bar is the row\'s share of the largest absolute net among the rows given, on the side of its sign', () => {
    expect(barsFor(rows([2_000_000, -4_000_000, 1_000_000, 0]))).toEqual([
      { share: 0.5, dir: 'up' }, { share: 1, dir: 'down' }, { share: 0.25, dir: 'up' }, { share: 0, dir: 'flat' },
    ])
    // the scale is the rows on screen: drop the biggest and the others grow
    expect(barsFor(rows([2_000_000, 1_000_000]))).toEqual([{ share: 1, dir: 'up' }, { share: 0.5, dir: 'up' }])
  })

  it('a row with no net has no bar, and it never sets the scale; all zeros draw no length', () => {
    expect(barsFor(rows([null, -500, 250]))).toEqual([null, { share: 1, dir: 'down' }, { share: 0.5, dir: 'up' }])
    expect(barsFor(rows([0, 0]))).toEqual([{ share: 0, dir: 'flat' }, { share: 0, dir: 'flat' }])
    expect(barsFor([])).toEqual([])
  })

  it('the width is half the track at most: the track runs both ways from its middle', () => {
    expect(barWidth(1)).toBe('50.0%')
    expect(barWidth(0.5)).toBe('25.0%')
    expect(barWidth(0.25)).toBe('12.5%')
    expect(barWidth(0)).toBe('0.0%')
    for (const odd of [2, Infinity]) expect(barWidth(odd), String(odd)).toBe('50.0%')
    for (const odd of [-1, NaN, null, undefined, 'x']) expect(barWidth(odd), String(odd)).toBe('0.0%')
  })
})

describe('the sums', () => {
  it('offers five and twenty sessions', () => {
    expect(TIDE_SUM_WINDOWS).toEqual([5, 20])
  })

  it('sums the newest five stored sessions and names the first and last day', () => {
    // nets of the newest five of 13: (9..13)M - 0.4M each = 55M - 2M
    const s = sumOver(tideHistoryRead(run(13)), 5)
    expect(s).toMatchObject({ n: 5, label: 'Net, last 5 sessions', ok: true, sum: 53_000_000, from: '2026-11-12', to: '2026-11-18' })
    expect(s.text).toBe('+$53.0M, Thu Nov 12 to Wed Nov 18')
    expect([s.figure, s.range]).toEqual(['+$53.0M', 'Thu Nov 12 to Wed Nov 18'])
  })

  it('with fewer stored than the window it says how many are needed and how many there are', () => {
    expect(sumOver(tideHistoryRead(run(13)), 20)).toEqual({ n: 20, label: 'Net, last 20 sessions', ok: false, text: 'Needs 20 stored sessions; 13 are stored.' })
    expect(sumOver(tideHistoryRead(run(4)), 5).text).toBe('Needs 5 stored sessions; 4 are stored.')
    expect(sumOver(tideHistoryRead(run(1)), 5).text).toBe('Needs 5 stored sessions; 1 is stored.')
    // the server holds more than it sent: the sum still needs the rows themselves
    expect(sumOver(tideHistoryRead(run(4, { sessions_stored: 90 })), 5).ok).toBe(false)
  })

  it('a missing session inside the window refuses the sum and names the day', () => {
    const gap = DAYS.filter((d) => d !== '2026-11-16')
    const view = tideHistoryRead(body(gap.map((d) => sess(d, 1_000_000, 400_000)), { missing_sessions: ['2026-11-16'] }))
    const s = sumOver(view, 5)
    expect(s.ok).toBe(false)
    expect(s.sum).toBeUndefined()
    expect(s.text).toBe('Not summed: no tide was stored for Mon Nov 16, inside these 5 sessions.')
  })

  it('a missing session older than the window does not refuse it', () => {
    const gap = DAYS.filter((d) => d !== '2026-11-03')
    const view = tideHistoryRead(body(gap.map((d) => sess(d, 1_000_000, 400_000)), { missing_sessions: ['2026-11-03'] }))
    expect(sumOver(view, 5)).toMatchObject({ ok: true, sum: 3_000_000 })
    // the window's own first day is not "inside" it either: the edge is a stored day
    expect(sumOver({ ...view, missing: ['2026-11-12', '2026-11-18'] }, 5).ok).toBe(true)
  })

  it('when the trading calendar could not vouch for the window, there is no sum', () => {
    for (const checked of ['2026-11-13', null]) {
      const s = sumOver(tideHistoryRead(run(13, { missing_checked_through: checked })), 5)
      expect(s.ok, String(checked)).toBe(false)
      expect(s.text).toBe('Not summed: the trading calendar could not confirm that no session is missing inside these 5 sessions.')
    }
  })

  it('a stored session with no net figure refuses the sum: it is never added as 0', () => {
    const sessions = DAYS.slice(-6).map((d) => sess(d, 1_000_000, 400_000, d === '2026-11-17' ? { net_premium: null } : {}))
    const s = sumOver(tideHistoryRead(body(sessions)), 5)
    expect(s.ok).toBe(false)
    expect(s.text).toBe('Not summed: a stored session inside these 5 has no net figure.')
  })

  it('a negative total keeps its sign, and one stored session has no summary at all', () => {
    const view = tideHistoryRead(body(DAYS.slice(-5).map((d) => sess(d, 100_000, 400_000))))
    expect(sumOver(view, 5).text).toBe('-$1.5M, Thu Nov 12 to Wed Nov 18')
    expect(summaryFor(view).map((s) => [s.n, s.ok])).toEqual([[5, true], [20, false]])
    expect(summaryFor(tideHistoryRead(run(1)))).toEqual([])
  })
})

describe('missing sessions and the cut', () => {
  const withMissing = (missing) => ({ ...tideHistoryRead(run(13)), missing })

  it('names each missing session in one sentence, and says nothing when none is missing', () => {
    expect(missingNote(withMissing([]))).toBeNull()
    expect(missingNote(withMissing(['2026-11-16']))).toBe('No tide was stored for Mon Nov 16.')
    expect(missingNote(withMissing(['2026-11-13', '2026-11-16']))).toBe('No tide was stored for Fri Nov 13 or Mon Nov 16.')
    expect(missingNote(withMissing(['2026-11-11', '2026-11-13', '2026-11-16']))).toBe('No tide was stored for Wed Nov 11, Fri Nov 13 or Mon Nov 16.')
  })

  it('past six it counts them all and names the newest six', () => {
    expect(TIDE_MISSING_NAMED).toBe(6)
    const eight = DAYS.slice(1, 9)
    expect(missingNote(withMissing(eight))).toBe(
      'No tide was stored for 8 sessions between the first and the last stored day. The newest: Thu Nov 5, Fri Nov 6, Mon Nov 9, Tue Nov 10, Wed Nov 11, Thu Nov 12.')
  })

  it('the cut line says what is drawn against what is stored', () => {
    expect(TIDE_ROWS_SHOWN).toBe(20)
    const view = { rows: Array.from({ length: 45 }), stored: 45 }
    expect(cutLine(view, 20)).toBe('Showing the newest 20 of 45 stored sessions.')
    expect(cutLine(view, 45)).toBeNull()
    expect(cutLine({ rows: Array.from({ length: 250 }), stored: 1300 }, 250)).toBe('Showing the newest 250 of 1,300 stored sessions; this panel reads at most 250.')
    expect(cutLine({ rows: Array.from({ length: 3 }), stored: 3 }, 3)).toBeNull()
  })
})
