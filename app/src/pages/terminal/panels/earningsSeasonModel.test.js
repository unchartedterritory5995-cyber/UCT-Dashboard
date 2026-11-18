// ERNS, the pure half. Rails:
//   * the typed words: TODAY / TONIGHT / TOMORROW, a date, `MM/DD` as the NEAREST such day;
//   * a choice is always whole, `tonight` is today after the close, and a date that is today or
//     the next session is that word (so a saved board keeps its meaning);
//   * what a choice writes into the command reads back as the same choice;
//   * the route's answer: every status, and a row whose missing numbers stay missing (never 0);
//   * priced against moved is only said when both numbers are real.
// The fixtures are the route's real shape (api/services/earnings_season.py `assemble_day`).
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_EARNINGS_DAY, DEFAULT_EARNINGS_SESSION, EARNINGS_DAYS, EARNINGS_DAY_ARG_WORDS, EARNINGS_SEASON_CODE,
  EARNINGS_SESSIONS, EARNINGS_SESSION_ARG_WORDS, NEAREST_DAY_REACH, PAST_MOVES_DRAWN, SESSION_HEADINGS, SESSION_ORDER,
  TONIGHT_TOKEN, earningsChoice, earningsSeasonCommandArgs, earningsSeasonRead, earningsSeasonUrl, parseEarningsDay,
  parseEarningsSession, requestDate, shownGroups, stepDay, tallyRows, tomorrowChip, tomorrowOf,
} from './earningsSeasonModel'

const TODAY = '2026-11-17'      // a Tuesday
const FRIDAY = '2026-11-20'

const row = (sym, over = {}) => ({
  sym, name: `${sym} Corp`, session: 'amc', mc_b: 10, eps_est: 1.1, eps_act: null, rev_est: 100, rev_act: null,
  reported: false, verdict: null, priced: null, past: null, past_state: 'not_held', move: null, move_state: null, ...over,
})
const body = (sessions, over = {}) => ({
  status: 'ok', date: TODAY, today: TODAY, day_kind: 'today', default: false, range: { from: '2026-11-09', to: '2026-11-27' },
  sessions: { bmo: [], amc: [], tbd: [], ...sessions },
  counts: { scheduled: 0, reported: 0, priced: 0, priced_withheld: 0, with_past: 0, past_not_held: 0, moved: 0 },
  priced_state: 'read', moves_state: null, calendar_as_of: '2026-11-17T14:00:00+00:00', built_at: '2026-11-17T14:05:00+00:00',
  capture: { hour_et: 16, minute_et: 35 }, ...over,
})

describe('ERNS the route and the code', () => {
  it('asks one route, with the day only when one is named', () => {
    expect(EARNINGS_SEASON_CODE).toBe('ERNS')
    expect(earningsSeasonUrl()).toBe('/api/calendar/earnings-season')
    expect(earningsSeasonUrl(null)).toBe('/api/calendar/earnings-season')
    expect(earningsSeasonUrl('2026-11-18')).toBe('/api/calendar/earnings-season?date=2026-11-18')
    expect(earningsSeasonUrl('2026-02-30')).toBe('/api/calendar/earnings-season')
    expect(earningsSeasonUrl('tomorrow')).toBe('/api/calendar/earnings-season')
  })
})

describe('ERNS typed words', () => {
  it.each([
    ['TODAY', 'today'], ['today', 'today'], [' Tonight ', 'tonight'], ['TOMORROW', 'tomorrow'],
    ['2026-11-18', '2026-11-18'], ['2026-02-30', null], ['2026-13-01', null],
    ['11/19', '2026-11-19'], ['1/5', '2027-01-05'], ['12/30', '2026-12-30'], ['5/20', '2026-05-20'],
    ['5/18', '2026-05-18'], ['5/17', '2027-05-17'], ['2/30', null], ['13/1', null],   // 183 days back is the edge
    ['NVDA', null], ['', null], [null, null], ['NEXT', null], ['11-19', null],
  ])('a day: %s -> %s', (token, want) => {
    expect(parseEarningsDay(token, { today: TODAY })).toBe(want)
  })

  it('MM/DD is the nearest such day either way, and needs a today to be read', () => {
    expect(NEAREST_DAY_REACH).toBe(183)
    // early January: a December date is the one just gone, not eleven months ahead
    expect(parseEarningsDay('12/30', { today: '2027-01-04' })).toBe('2026-12-30')
    expect(parseEarningsDay('1/8', { today: '2027-01-04' })).toBe('2027-01-08')
    expect(parseEarningsDay('11/19')).toBeNull()
    expect(parseEarningsDay('TODAY')).toBe('today')
  })

  it('a part of the day, and no word is in both maps', () => {
    for (const [word, value] of Object.entries(EARNINGS_SESSION_ARG_WORDS)) {
      expect(parseEarningsSession(word)).toBe(value)
      expect(parseEarningsSession(word.toLowerCase())).toBe(value)
    }
    expect(parseEarningsSession('TODAY')).toBeNull()
    expect(parseEarningsSession('constructor')).toBeNull()
    expect(parseEarningsDay('constructor', { today: TODAY })).toBeNull()
    const words = [...Object.keys(EARNINGS_DAY_ARG_WORDS), ...Object.keys(EARNINGS_SESSION_ARG_WORDS)]
    expect(new Set(words).size).toBe(words.length)
    // every chip token is a word its map takes
    for (const [key, d] of Object.entries(EARNINGS_DAYS)) if (d.token) expect(parseEarningsDay(d.token)).toBe(key)
    for (const [key, s] of Object.entries(EARNINGS_SESSIONS)) if (s.token) expect(parseEarningsSession(s.token)).toBe(key)
    expect(parseEarningsDay(TONIGHT_TOKEN)).toBe('tonight')
  })
})

describe('ERNS choices', () => {
  it('a choice is always whole, and anything unknown is the default', () => {
    expect(earningsChoice({}, TODAY)).toEqual({ day: DEFAULT_EARNINGS_DAY, session: DEFAULT_EARNINGS_SESSION })
    expect(earningsChoice({ day: 'nonsense', session: 7 }, TODAY)).toEqual({ day: 'next', session: 'all' })
    expect(earningsChoice(undefined, TODAY)).toEqual({ day: 'next', session: 'all' })
    expect(earningsChoice({ day: 'TODAY' }, TODAY)).toEqual({ day: 'today', session: 'all' })
    expect(earningsChoice({ day: 'tomorrow', session: 'BMO' }, TODAY)).toEqual({ day: 'tomorrow', session: 'bmo' })
    expect(earningsChoice({ day: 'next', session: 'amc' }, TODAY)).toEqual({ day: 'next', session: 'amc' })
  })

  it('tonight is today after the close, unless a part of the day is named beside it', () => {
    expect(earningsChoice({ day: 'tonight' }, TODAY)).toEqual({ day: 'today', session: 'amc' })
    expect(earningsChoice({ day: 'TONIGHT', session: 'bmo' }, TODAY)).toEqual({ day: 'today', session: 'bmo' })
  })

  it('a date that is today or the next session is that word; any other date stays a date', () => {
    expect(earningsChoice({ day: TODAY }, TODAY)).toEqual({ day: 'today', session: 'all' })
    expect(earningsChoice({ day: '2026-11-18' }, TODAY)).toEqual({ day: 'tomorrow', session: 'all' })
    expect(earningsChoice({ day: '2026-11-19' }, TODAY)).toEqual({ day: '2026-11-19', session: 'all' })
    // on a Friday the next session is Monday
    expect(tomorrowOf(FRIDAY)).toBe('2026-11-23')
    expect(earningsChoice({ day: '2026-11-23' }, FRIDAY)).toEqual({ day: 'tomorrow', session: 'all' })
    expect(earningsChoice({ day: '2026-11-21' }, FRIDAY)).toEqual({ day: '2026-11-21', session: 'all' })
    // the day before Thanksgiving: the next session is the Friday
    expect(tomorrowOf('2026-11-25')).toBe('2026-11-27')
  })

  it('the date asked of the server: none for the next reports, else the day', () => {
    expect(requestDate({ day: 'next' }, TODAY)).toBeNull()
    expect(requestDate({ day: 'today' }, TODAY)).toBe(TODAY)
    expect(requestDate({ day: 'tomorrow' }, TODAY)).toBe('2026-11-18')
    expect(requestDate({ day: 'tomorrow' }, FRIDAY)).toBe('2026-11-23')
    expect(requestDate({ day: '2026-11-12' }, TODAY)).toBe('2026-11-12')
    expect(requestDate({ day: 'garbage' }, TODAY)).toBeNull()
    expect(requestDate(null, TODAY)).toBeNull()
  })

  it('what a choice writes into the command reads back as the same choice', () => {
    expect(earningsSeasonCommandArgs({}, TODAY)).toEqual([])
    expect(earningsSeasonCommandArgs({ day: 'today', session: 'amc' }, TODAY)).toEqual(['TONIGHT'])
    expect(earningsSeasonCommandArgs({ day: 'today', session: 'bmo' }, TODAY)).toEqual(['TODAY', 'BMO'])
    expect(earningsSeasonCommandArgs({ day: 'tomorrow' }, TODAY)).toEqual(['TOMORROW'])
    expect(earningsSeasonCommandArgs({ day: 'next', session: 'amc' }, TODAY)).toEqual(['AMC'])
    expect(earningsSeasonCommandArgs({ day: '2026-11-12', session: 'bmo' }, TODAY)).toEqual(['2026-11-12', 'BMO'])
    expect(earningsSeasonCommandArgs({ day: TODAY }, TODAY)).toEqual(['TODAY'])
    for (const day of ['next', 'today', 'tomorrow', '2026-11-12']) {
      for (const session of ['all', 'bmo', 'amc']) {
        const tokens = earningsSeasonCommandArgs({ day, session }, TODAY)
        const typed = { day: tokens.map((t) => parseEarningsDay(t, { today: TODAY })).find(Boolean) ?? null,
          session: tokens.map(parseEarningsSession).find(Boolean) ?? null }
        expect(earningsChoice(typed, TODAY), `${day} ${session}`).toEqual({ day, session })
      }
    }
  })

  it('stepping a day skips the weekend and stops at the edge of the server\'s reach', () => {
    const range = { from: '2026-11-09', to: '2026-11-27' }
    expect(stepDay(TODAY, 1, range)).toBe('2026-11-18')
    expect(stepDay(TODAY, -1, range)).toBe('2026-11-16')
    expect(stepDay(FRIDAY, 1, range)).toBe('2026-11-23')
    expect(stepDay('2026-11-09', -1, range)).toBeNull()
    expect(stepDay('2026-11-27', 1, range)).toBeNull()
    expect(stepDay('2026-11-27', 1)).toBe('2026-11-30')
    expect(stepDay('nonsense', 1, range)).toBeNull()
  })

  it('the Tomorrow chip names the weekday when the next session is not tomorrow', () => {
    expect(tomorrowChip(TODAY)).toBe('Tomorrow')
    expect(tomorrowChip(FRIDAY)).toBe('Next session (Mon)')
    expect(tomorrowChip('2026-11-25')).toBe('Next session (Fri)')
    expect(tomorrowChip(null)).toBe('Tomorrow')
  })
})

describe('ERNS the route\'s answer', () => {
  it('every status that is not a list is its own state, with the day and the reach it came with', () => {
    expect(earningsSeasonRead({ status: 'computing', date: TODAY, default: false })).toMatchObject({ state: 'computing', date: TODAY })
    expect(earningsSeasonRead({ status: 'computing', date: null, default: true })).toMatchObject({ state: 'computing', date: null, isDefault: true })
    expect(earningsSeasonRead({ status: 'unavailable', reason: 'calendar', date: TODAY })).toMatchObject({ state: 'unavailable', date: TODAY })
    expect(earningsSeasonRead({ status: 'no_day', weekend: true, date: '2026-11-21' })).toMatchObject({ state: 'no-day', weekend: true })
    expect(earningsSeasonRead({ status: 'no_day', weekend: false, date: '2026-11-26' })).toMatchObject({ state: 'no-day', weekend: false })
    expect(earningsSeasonRead({ status: 'out_of_range', date: '2026-12-25', range: { from: '2026-11-09', to: '2026-11-27' } }))
      .toMatchObject({ state: 'out-of-range', date: '2026-12-25', range: { from: '2026-11-09', to: '2026-11-27' } })
  })

  it.each([null, undefined, 'x', [], {}, { status: 'ok' }, { status: 'ok', date: TODAY }, { status: 'ok', date: 'x', sessions: {} },
    { status: 'bad_date', date: null }, { error: 'warming' }, { status: 'weird', date: TODAY, sessions: {} }])('not this route\'s answer: %j', (b) => {
    expect(earningsSeasonRead(b).state).toBe('failed')
  })

  it('a day is read into its three groups, in the server\'s order, each stock once', () => {
    const view = earningsSeasonRead(body({
      bmo: [row('BIG', { session: 'bmo' }), row('SML', { session: 'bmo' })],
      amc: [row('AAA'), row('BIG'), { sym: '' }, 'junk', row('bad sym!')],
      tbd: [row('LATE', { session: 'tbd' })],
    }, { refreshing: true, default: true, counts: { priced_withheld: 2 } }))
    expect(view.state).toBe('ok')
    expect([view.date, view.today, view.dayKind, view.isDefault, view.refreshing]).toEqual([TODAY, TODAY, 'today', true, true])
    expect(view.groups.bmo.map((r) => r.sym)).toEqual(['BIG', 'SML'])
    expect(view.groups.amc.map((r) => r.sym)).toEqual(['AAA'])
    expect(view.groups.tbd.map((r) => r.sym)).toEqual(['LATE'])
    expect(view.total).toBe(4)
    expect(view.unread).toBe(3)
    expect(view.pricedWithheld).toBe(2)
    expect(view.range).toEqual({ from: '2026-11-09', to: '2026-11-27' })
    expect([view.calendarAsOf, view.builtAt, view.captureClock]).toEqual(['2026-11-17T14:00:00+00:00', '2026-11-17T14:05:00+00:00', '4:35 PM'])
    expect(SESSION_ORDER).toEqual(['bmo', 'amc', 'tbd'])
    expect(Object.keys(SESSION_HEADINGS)).toEqual(SESSION_ORDER)
  })

  it('a missing number stays missing: never 0, never a made-up state', () => {
    const view = earningsSeasonRead(body({ amc: [
      row('NOTHING', { mc_b: null, eps_est: null, name: '' }),
      row('ZERO', { priced: { pct: 0, dollar: 0 }, past: { moves: [], avg_abs: 0, n: 0 }, move: 0 }),
      row('TEXT', { priced: { pct: 'n/a' }, past: { moves: [{ date: 'x', pct: 1 }, { date: '2026-08-18', pct: null }] }, eps_act: '' }),
    ] }))
    const [nothing, zero, text] = view.groups.amc
    expect(nothing).toMatchObject({ name: null, capB: null, epsEst: null, epsAct: null, reported: false, verdict: null, priced: null,
      past: null, pastState: 'not_held', move: null, moveState: null, against: null })
    expect(zero.priced).toBeNull()
    expect(zero.past).toBeNull()
    expect(zero.move).toBeNull()                       // not reported, so the server's 0 is not a move
    expect(text.priced).toBeNull()
    expect(text.past).toBeNull()
    expect(text.reported).toBe(false)
    expect([view.priced, view.withPast, view.moved, view.reported]).toEqual([0, 0, 0, 0])
  })

  it('a priced move, past reports and a result are read as sent', () => {
    const view = earningsSeasonRead(body({ bmo: [row('AAA', {
      session: 'bmo', eps_act: 1.25, rev_act: 110, reported: true, verdict: 'beat',
      priced: { pct: 6.2, dollar: 12.4, captured_at: '2026-11-16T16:35:04-05:00', expiry: '2026-11-20' },
      past: { moves: [{ date: '2026-05-19', pct: -2 }, { date: '2026-08-18', pct: 3.1 }, { date: '2026-08-18', pct: 9 }], avg_abs: 2.55, n: 2 },
      past_state: 'ok', move: 8.12, move_state: 'live',
    })] }, { moves_state: 'live' }))
    const r = view.groups.bmo[0]
    expect(r.priced).toEqual({ pct: 6.2, dollars: 12.4, capturedDay: '2026-11-16', expiry: '2026-11-20' })
    expect(r.past).toEqual({ moves: [{ day: '2026-08-18', pct: 3.1 }, { day: '2026-05-19', pct: -2 }], avgAbs: 2.55, n: 2 })
    expect([r.reported, r.verdict, r.move, r.moveState, r.against]).toEqual([true, 'beat', 8.12, 'live', 'beyond'])
    expect([view.reported, view.priced, view.withPast, view.moved, view.movesState]).toEqual([1, 1, 1, 1, 'live'])
    expect(PAST_MOVES_DRAWN).toBe(4)
  })

  it.each([
    [{ move: 4.5, move_state: 'settled' }, { pct: 6.2 }, 4.5, 'settled', 'within'],
    [{ move: -6.21, move_state: 'settled' }, { pct: 6.2 }, -6.21, 'settled', 'beyond'],
    [{ move: 6.2, move_state: 'live' }, { pct: 6.2 }, 6.2, 'live', 'within'],
    [{ move: 4.5, move_state: 'settled' }, null, 4.5, 'settled', null],           // nothing priced: nothing compared
    [{ move: null, move_state: 'next_close' }, { pct: 6.2 }, null, 'next_close', null],
    [{ move: null, move_state: 'not_held' }, { pct: 6.2 }, null, 'not_held', null],
    [{ move: null, move_state: 'failed' }, null, null, 'failed', null],
    [{ move: null, move_state: 'live' }, null, null, 'none', null],               // a state that claims a number must have one
    [{ move: null, move_state: 'surprise' }, null, null, 'none', null],
    [{ move: 3, move_state: 'next_close' }, null, 3, 'settled', null],            // a number needs a state that explains it
    [{ move: 0, move_state: 'settled' }, { pct: 6.2 }, 0, 'settled', 'within'],   // a REAL zero move is a move
  ])('the move of a reported stock: %j priced %j', (over, priced, move, state, against) => {
    const view = earningsSeasonRead(body({ amc: [row('AAA', { eps_act: 1, reported: true, priced, ...over })] }))
    const r = view.groups.amc[0]
    expect([r.move, r.moveState, r.against]).toEqual([move, state, against])
  })

  it('a verdict is only one of the three words, and only for a reported stock', () => {
    const view = earningsSeasonRead(body({ amc: [
      row('A', { eps_act: 1, verdict: 'mixed' }), row('B', { eps_act: 1, verdict: 'Pending' }), row('C', { verdict: 'beat' }),
    ] }))
    expect(view.groups.amc.map((r) => r.verdict)).toEqual(['mixed', null, null])
  })

  it('the capture time is said only when it is a real clock time', () => {
    expect(earningsSeasonRead(body({}, { capture: { hour_et: 0, minute_et: 5 } })).captureClock).toBe('12:05 AM')
    expect(earningsSeasonRead(body({}, { capture: { hour_et: 12, minute_et: 0 } })).captureClock).toBe('12:00 PM')
    expect(earningsSeasonRead(body({}, { capture: { hour_et: 25, minute_et: 0 } })).captureClock).toBeNull()
    expect(earningsSeasonRead(body({}, { capture: null })).captureClock).toBeNull()
    expect(earningsSeasonRead(body({}, { priced_state: 'failed', moves_state: 'not_held' })))
      .toMatchObject({ pricedState: 'failed', movesState: 'not_held' })
  })
})

describe('ERNS groups and counts', () => {
  const view = earningsSeasonRead(body({
    bmo: [row('B1', { session: 'bmo', eps_act: 1, reported: true, move: 2, move_state: 'live', priced: { pct: 5 } })],
    amc: [row('A1', { eps_act: 1, reported: true, move_state: 'next_close' }), row('A2', { past: { moves: [{ date: '2026-08-18', pct: 3 }] }, past_state: 'ok' })],
  }))

  it('a part of the day shows its own group, the whole day every group that has a row', () => {
    expect(shownGroups(view, 'all').map((g) => [g.session, g.rows.length])).toEqual([['bmo', 1], ['amc', 2]])
    expect(shownGroups(view, 'amc').map((g) => g.session)).toEqual(['amc'])
    expect(shownGroups(view, 'bmo').map((g) => g.session)).toEqual(['bmo'])
    expect(shownGroups(view).map((g) => g.session)).toEqual(['bmo', 'amc'])
    expect(shownGroups({ state: 'computing' }, 'all')).toEqual([])
    expect(shownGroups(null)).toEqual([])
  })

  it('the tally counts what each row really has', () => {
    expect(tallyRows(shownGroups(view, 'all').flatMap((g) => g.rows)))
      .toEqual({ total: 3, reported: 2, priced: 1, withPast: 1, pastNotHeld: 2, moved: 1, awaitingClose: 1 })
    expect(tallyRows(null)).toEqual({ total: 0, reported: 0, priced: 0, withPast: 0, pastNotHeld: 0, moved: 0, awaitingClose: 0 })
  })
})
