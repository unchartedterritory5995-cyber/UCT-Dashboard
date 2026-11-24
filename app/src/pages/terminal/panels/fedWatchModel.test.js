// FED's pure half (fedWatchModel.js). Every value here is invented in the route's shape
// (api/services/fed_watch.py): made-up rates, statement words, survey answers and headlines.
import { describe, it, expect } from 'vitest'
import {
  BOARD_CITE, FED_CODE, FED_URL, boardMissingWords, chanceText, daysToGoWords, fedRead, headlineCutWords, holdsToday,
  meetingWords, projectionText, rangeText, rateMissingWords, rateText, redlineAlt, redlineParagraphs, redlineSummary,
  shownBuckets, showsRedline, surveyLine, surveyRate, weekdayText,
} from './fedWatchModel'

const B = 'https://www.federalreserve.gov'
const body = (over = {}) => ({
  status: 'ok',
  statement: {
    state: 'ok', date: '2031-03-04', url: `${B}/newsevents/pressreleases/monetary20310304a.htm`,
    implementation_note_url: `${B}/newsevents/pressreleases/monetary20310304a1.htm`,
    minutes: { meeting: 'January 27-28, 2031', url: `${B}/newsevents/pressreleases/monetary20310218a.htm`, date: '2031-02-18' },
    paragraphs: ['The Committee kept an invented stance.'],
    redline: { state: 'ok', added: 2, removed: 1, previous: { date: '2031-01-28', url: `${B}/x.htm` },
      segments: [{ op: 'same', text: 'The Committee' }, { op: 'removed', text: 'kept' }, { op: 'added', text: 'eased its' },
        { op: 'same', text: 'invented stance.' }, { op: 'break', text: '' }, { op: 'same', text: 'Second paragraph.' },
        { op: 'bogus', text: 'dropped' }] },
  },
  speeches: { state: 'ok', items: [{ kind: 'speech', speaker: 'Quillfeather', title: 'Invented notes', url: 'https://example.test/a' }], total: 1 },
  headlines: { state: 'ok', items: [{ seq: 3, text: 'Fed invented headline', received_at_ms: 1_900_000_000_000, tickers: ['ZZZQ', 'bad ticker'] }], matched: 1, scanned: 900 },
  calendar: { today: '2031-03-20', week_start: '2031-03-17', week_end: '2031-03-21',
    next_meeting: { state: 'ok', date: '2031-04-29', time: '2:00 PM', event: 'FOMC Statement', days_to_go: 40, source: 'the economic calendar' },
    this_week: { state: 'ok', items: [{ date: '2031-03-19', time: '9:00 AM', event: 'Fed Brindlewood Speech' }], total: 1 } },
  rates: { state: 'ok', effective: { value: 9.12, date: '2031-03-18' }, upper: { value: 9.25, date: '2031-03-18' }, lower: { value: 9.0, date: '2031-03-18' } },
  projections: { state: 'ok', date: '2031-03-04', medians: [{ label: '2031', value: 7.4 }, { label: 'bad', value: null }] },
  survey: { state: 'ok', survey: 'March 2031', path: [], distributions: [] },
  board_cite: BOARD_CITE,
  built_at: '2031-03-20T15:00:00+00:00',
  ...over,
})

describe('fedRead', () => {
  it('names its code and route, and a body that is not the route\'s shape is a failed read', () => {
    expect(FED_CODE).toBe('FED')
    expect(FED_URL).toBe('/api/research/fed-watch')
    for (const b of [null, [], { status: 'computing' }, 'x']) expect(fedRead(b)).toEqual({ state: 'failed', computing: false })
  })

  it('reads every block, keeps only Board and New York Fed links and drops what is not the shape', () => {
    const v = fedRead(body())
    expect(v.state).toBe('ok')
    expect(v.statement.redline.segments.map((s) => s.op)).toEqual(['same', 'removed', 'added', 'same', 'break', 'same'])
    expect(v.statement.minutes.meeting).toBe('January 27-28, 2031')
    expect(v.speeches.items[0].url).toBeNull()                                   // not a Board link
    expect(v.headlines.items[0].tickers).toEqual(['ZZZQ'])
    expect(v.projections.medians).toEqual([{ label: '2031', value: 7.4 }])
    expect(v.computing).toBe(false)
  })

  it('is computing while any Board or survey block, or the statement before, is still being read', () => {
    expect(fedRead(body({ survey: { state: 'computing' } })).computing).toBe(true)
    expect(fedRead(body({ statement: { state: 'ok', redline: { state: 'computing' } } })).computing).toBe(true)
    expect(fedRead(body({ headlines: { state: 'off' } })).computing).toBe(false)
  })

  it('is computing while the server still reads its first headlines or rates (speed pass 3), never while they are off', () => {
    expect(fedRead(body({ headlines: { state: 'computing', items: [] } })).computing).toBe(true)
    expect(fedRead(body({ rates: { state: 'computing' } })).computing).toBe(true)
    expect(fedRead(body({ rates: { state: 'off' }, headlines: { state: 'not_started' } })).computing).toBe(false)
  })
})

describe('words', () => {
  it('a rate and the range are percent with two decimals, and a missing one is words, never 0', () => {
    const v = fedRead(body())
    expect(rangeText(v.rates)).toBe('9.00% to 9.25%')
    expect(rateText(9.12)).toBe('9.12%')
    expect(rateText(null)).toBe('No figure')
    const off = fedRead(body({ rates: { state: 'off', effective: { value: null, reason: 'econ_off' }, upper: { value: null }, lower: { value: null } } })).rates
    expect(rangeText(off)).toBeNull()
    expect(rateMissingWords(off)).toBe('Not shown: the economic data feature is not switched on for this server.')
    const half = fedRead(body({ rates: { state: 'ok', effective: {}, upper: { value: 9.25 }, lower: { value: null } } })).rates
    expect(rangeText(half)).toBe('up to 9.25% (the lower end is not held)')
  })

  it('the next meeting reads as a date, a time and the days to go', () => {
    const v = fedRead(body())
    expect(meetingWords(v.calendar.nextMeeting)).toBe('Apr 29, 2031, 2:00 PM ET (in 40 days)')
    expect([daysToGoWords(0), daysToGoWords(1), daysToGoWords(-1), daysToGoWords(null)]).toEqual(['today', 'tomorrow', '', ''])
    expect(meetingWords(fedRead(body({ calendar: {} })).calendar.nextMeeting)).toBe('No FOMC decision ahead is in the calendar the server holds.')
  })

  it('the redline summary says what changed against which statement, and every other state in words', () => {
    const st = fedRead(body()).statement
    expect(redlineSummary(st)).toBe('Against the statement of Jan 28, 2031: 2 words added, 1 word removed.')
    expect(showsRedline(st)).toBe(true)
    const with_ = (redline) => ({ ...st, redline: redline && { segments: [], added: 0, removed: 0, previous: { date: '2031-01-28' }, ...redline } })
    expect(redlineSummary(with_({ state: 'same', segments: [{ op: 'same', text: 'x' }] }))).toBe('Not one word changed from the statement of Jan 28, 2031.')
    expect(redlineSummary(with_({ state: 'no_previous', previous: null }))).toBe('There is no earlier statement held to compare it with, so the whole statement is shown.')
    expect(redlineSummary(with_({ state: 'computing' }))).toBe('Reading the statement before it (Jan 28, 2031) to compare.')
    expect(redlineSummary(with_({ state: 'unreadable' }))).toContain('could not be read, so the whole statement is shown.')
    expect(redlineSummary(with_({ state: 'too_long' }))).toContain('too long to compare')
    expect(showsRedline(with_({ state: 'no_previous' }))).toBe(false)
    expect(redlineSummary({ ...st, redline: null })).toContain('no earlier statement')
  })

  it('the redline splits into paragraphs and reads in order with the words "added" and "removed"', () => {
    const paras = redlineParagraphs(fedRead(body()).statement.redline.segments)
    expect(paras).toHaveLength(2)
    expect(redlineAlt(paras[0])).toBe('The Committee removed: kept added: eased its invented stance.')
    expect(redlineParagraphs([{ op: 'break', text: '' }, { op: 'same', text: 'a' }, { op: 'break' }, { op: 'break' }])).toEqual([[{ op: 'same', text: 'a' }]])
  })

  it('the survey: today\'s range is the bucket holding the upper end, zero buckets are counted, rates as printed', () => {
    expect(holdsToday({ low: 9.01, high: 9.25 }, 9.25)).toBe(true)
    expect(holdsToday({ low: 9.26, high: null }, 9.25)).toBe(false)
    expect(holdsToday({ low: null, high: 8.5 }, 7)).toBe(true)
    expect(holdsToday({ low: 9.01, high: 9.25 }, null)).toBe(false)
    const { shown, hidden } = shownBuckets({ buckets: [{ range: 'a', probability: 0 }, { range: 'b', probability: 12.5 }, { range: 'c', probability: null }] })
    expect(shown.map((b) => b.range)).toEqual(['b'])
    expect(hidden).toBe(2)
    expect([surveyRate(7.13), surveyRate(null), chanceText(27), chanceText(12.5), projectionText(7.4)]).toEqual(['7.13%', 'No figure', '27%', '12.5%', '7.4%'])
    expect(surveyLine({ survey: 'March 2031', responsesDue: '2031-02-21', beforeMeeting: { label: 'Mar. 3-4 2031' } }))
      .toBe('New York Fed Survey of Market Expectations, March 2031, responses due Feb 21, 2031, taken before the Mar. 3-4 2031 meeting.')
  })

  it('the headline cut says how many were searched and how many are shown', () => {
    expect(headlineCutWords({ scanned: 3000, matched: 45, items: new Array(30) })).toBe('Picked from the newest 3,000 headlines on the wire: 45 are about the Fed, the newest 30 are shown.')
    expect(headlineCutWords({ scanned: 900, matched: 2, items: [1, 2] })).toBe('Picked from the newest 900 headlines on the wire.')
    expect(headlineCutWords({ scanned: null, matched: 0, items: [] })).toBeNull()
  })

  it('a weekday and a Board block that could not be read are plain words', () => {
    expect(weekdayText('2031-03-19')).toBe('Wed Mar 19')
    expect(weekdayText('nope')).toBe('')
    expect(boardMissingWords('computing', 'the statement')).toBe("Reading the statement from the Board's website. This fills in on its own.")
    expect(boardMissingWords('unavailable', 'the statement')).toContain('did not let the server read the statement')
    expect(boardMissingWords('unreadable', 'the projections')).toBe("The projections could not be read from the Board's page.")
    expect(boardMissingWords('failed', 'the speeches')).toBe('The speeches could not be read just now.')
  })
})
