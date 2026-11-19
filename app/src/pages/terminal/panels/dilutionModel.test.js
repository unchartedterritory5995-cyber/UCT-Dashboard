// DILU's pure half: the route's answer as the panel draws it, and every sentence it says. Rails:
//   * every state the server names is read as itself, and an answer that is not the route's is a
//     failed read, never "nothing filed";
//   * a row links only to a filing's page on sec.gov;
//   * a count the read does not reach back for is null, and is SAID, never drawn as a number;
//   * "live" is always said as an estimate; no sentence says what a company will do, and none
//     carries an amount;
//   * employee plans and material agreements are listed apart.
// The fixtures are the route's real shape (api/services/dilution_watch.py), with made-up filings.
import { describe, it, expect } from 'vitest'
import {
  DILUTION_CODE, KIND_NOTES, MINOR_KINDS, ROWS_SHOWN, SEC_FILING_PREFIX, SOURCE, dayText, dilutionRead, dilutionUrl, etDayOf,
  failedWords, horizonWords, liveShelfSentence, minorCount, notesFor, offeringsSentence, rowDetail, rowsFor, secUrl, shelfSentence,
  summarySentences, unavailableWords,
} from './dilutionModel'

const url = (n) => `https://www.sec.gov/Archives/edgar/data/1234567/00012345672600${String(n).padStart(4, '0')}/0001234567-26-00${String(n).padStart(4, '0')}-index.htm`
const SHELF_FILE = '333-270001'
const UNDER = { form: 'S-3', filed: '2025-03-04', shelf: true }
let seq = 0
const row = (date, form, kind, what, over = {}) => {
  seq += 1
  return { date, form, kind, what, accession: `0001234567-26-00${String(seq).padStart(4, '0')}`, url: url(seq), file_number: SHELF_FILE, items: [], under: null, ...over }
}
const SHELF = {
  form: 'S-3', what: 'Shelf registration', file_number: SHELF_FILE, filed: '2025-03-04', accession: '0001234567-25-000026', url: url(900),
  automatic: false, effective: '2025-03-12', effective_basis: 'notice', expires_estimate: '2028-03-12', state: 'live',
  withdrawal_requested: null, amendments: 1, offerings: 5, latest_offering: '2026-10-02',
}
const ROWS = () => [
  row('2026-10-02', '424B5', 'offering', 'Prospectus supplement', { under: UNDER }),
  row('2026-10-01', 'FWP', 'fwp', 'Free writing prospectus (offering material)', { under: UNDER }),
  row('2026-09-30', '8-K', 'unregistered', 'Unregistered sale of equity securities (8-K item 3.02)', { file_number: '001-30001', items: ['1.01', '3.02', '9.01'] }),
  row('2026-08-01', '8-K', 'agreement', 'Material agreement (8-K item 1.01)', { file_number: '001-30001', items: ['1.01', '9.01'] }),
  row('2025-03-12', 'EFFECT', 'effect', 'SEC notice that a registration took effect', { under: UNDER }),
  row('2025-03-04', 'S-3', 'shelf', 'Shelf registration'),
  row('2024-02-01', 'S-8', 'plan', 'Employee plan registration', { file_number: '333-260009' }),
]
const answer = (over = {}) => ({
  status: 'ok', sym: 'ZZA', cik: '0001234567', company: 'Acme Example Corp', entity_type: 'operating', fund_like: false,
  window: { years: 3, from: '2023-11-18', to: '2026-11-18', recent_months: 12, recent_from: '2025-11-18' },
  coverage: { complete: true, from: '2023-11-18', requests: 1, pages_unread: 0 },
  newest_filing: '2026-11-05',
  summary: {
    live_shelves: 1, newest_live_shelf: SHELF, pending_shelves: 0, newest_pending_shelf: null,
    offerings: { m12: 4, y3: 6, latest: '2026-10-02' }, unregistered: { m12: 1, y3: 1, latest: '2026-09-30' },
    registrations: { m12: 0, y3: 0, latest: null },
  },
  shelves: [SHELF], shelf_life_years: 3, rows: ROWS(), rows_total: 7, cut: false,
  counts: { offering: 1 }, read_at: '2026-11-18T16:02:11+00:00', source: SOURCE,
  ...over,
})
const NOTHING = () => answer({
  summary: { live_shelves: 0, newest_live_shelf: null, pending_shelves: 0, newest_pending_shelf: null,
    offerings: { m12: 0, y3: 0, latest: null }, unregistered: { m12: 0, y3: 0, latest: null }, registrations: { m12: 0, y3: 0, latest: null } },
  shelves: [], rows: [], rows_total: 0,
})
const PARTIAL = (over = {}) => answer({
  coverage: { complete: false, from: '2026-01-01', requests: 4, pages_unread: 2 },
  summary: { live_shelves: 0, newest_live_shelf: null, pending_shelves: 0, newest_pending_shelf: null,
    offerings: { m12: null, y3: null, latest: '2026-11-10' }, unregistered: { m12: null, y3: null, latest: null },
    registrations: { m12: null, y3: null, latest: null } },
  shelves: [], rows: [row('2026-11-10', '424B2', 'offering', 'Prospectus supplement')], rows_total: 1, ...over,
})

describe('DILU the names', () => {
  it('the code, the route and the source', () => {
    expect(DILUTION_CODE).toBe('DILU')
    expect(dilutionUrl('BRK-B')).toBe('/api/research/dilution-watch/BRK-B')
    expect(dilutionUrl('I:SPX')).toBe('/api/research/dilution-watch/I%3ASPX')
    expect(SOURCE).toBe('SEC EDGAR filings')
    expect(ROWS_SHOWN).toBe(20)
    expect([...MINOR_KINDS]).toEqual(['plan', 'agreement'])
  })

  it('a date is read as a calendar day, never through a time zone', () => {
    expect(dayText('2026-10-02')).toBe('Oct 2, 2026')
    expect(dayText('2026-01-31', { short: true })).toBe('Jan 31')
    expect(dayText(null)).toBe('')
    expect(dayText('soon')).toBe('soon')
    expect(etDayOf('2026-11-18T03:30:00+00:00')).toBe('2026-11-17')
    expect(etDayOf('not a time')).toBeNull()
  })

  it('a row links to a filing on sec.gov and nowhere else', () => {
    expect(SEC_FILING_PREFIX).toBe('https://www.sec.gov/Archives/edgar/data/')
    expect(secUrl(url(1))).toBe(url(1))
    for (const bad of ['http://www.sec.gov/Archives/edgar/data/1/x', 'https://www.sec.gov.example.test/Archives/edgar/data/1/x',
      'https://example.test/https://www.sec.gov/Archives/edgar/data/1', 'javascript:alert(1)', `${url(1)}" onclick="x`, '', null, 5]) {
      expect(secUrl(bad), String(bad)).toBeNull()
    }
  })
})

describe('DILU reads the answer', () => {
  it('an ok answer keeps the company, the window, the summary, the shelves and the rows', () => {
    const v = dilutionRead(answer({ refreshing: true }))
    expect(v.state).toBe('ok')
    expect(v).toMatchObject({ sym: 'ZZA', company: 'Acme Example Corp', entityType: 'operating', fundLike: false, refreshing: true,
      newestFiling: '2026-11-05', readAt: '2026-11-18T16:02:11+00:00', shelfLifeYears: 3, rowsTotal: 7, cut: false })
    expect(v.window).toEqual({ years: 3, from: '2023-11-18', to: '2026-11-18', recentMonths: 12 })
    expect(v.coverage).toEqual({ complete: true, from: null, pagesUnread: 0 })
    expect(v.summary.liveShelves).toBe(1)
    expect(v.summary.liveShelf).toMatchObject({ form: 'S-3', filed: '2025-03-04', effective: '2025-03-12', effectiveBasis: 'notice',
      expires: '2028-03-12', state: 'live', automatic: false, offerings: 5, latestOffering: '2026-10-02', amendments: 1 })
    expect(v.summary.offerings).toEqual({ m12: 4, y3: 6, latest: '2026-10-02' })
    expect(v.summary.unregistered).toEqual({ m12: 1, y3: 1, latest: '2026-09-30' })
    expect(v.rows.map((r) => [r.date, r.form, r.kind])).toEqual([
      ['2026-10-02', '424B5', 'offering'], ['2026-10-01', 'FWP', 'fwp'], ['2026-09-30', '8-K', 'unregistered'], ['2026-08-01', '8-K', 'agreement'],
      ['2025-03-12', 'EFFECT', 'effect'], ['2025-03-04', 'S-3', 'shelf'], ['2024-02-01', 'S-8', 'plan'],
    ])
    expect(v.rows[0]).toMatchObject({ what: 'Prospectus supplement', fileNumber: SHELF_FILE, under: { form: 'S-3', filed: '2025-03-04', shelf: true } })
    expect(v.rows[0].url).toBe(secUrl(v.rows[0].url))
    expect(v.rows[2].items).toEqual(['1.01', '3.02', '9.01'])
  })

  it('every other state the server names is read as itself', () => {
    expect(dilutionRead({ status: 'computing', sym: 'ZZA' })).toEqual({ state: 'computing', busy: false })
    expect(dilutionRead({ status: 'computing', sym: 'ZZA', busy: true })).toEqual({ state: 'computing', busy: true })
    expect(dilutionRead({ status: 'bad_symbol', sym: null })).toEqual({ state: 'bad-symbol' })
    expect(dilutionRead({ status: 'none', reason: 'no_cik' })).toEqual({ state: 'none', reason: 'no_cik' })
    expect(dilutionRead({ status: 'none', reason: 'no_filings', http_status: 404 })).toEqual({ state: 'none', reason: 'no_filings' })
    expect(dilutionRead({ status: 'unavailable', reason: 'refused', http_status: 403 })).toEqual({ state: 'unavailable', reason: 'refused', httpStatus: 403 })
    expect(dilutionRead({ status: 'unavailable', reason: 'shape', http_status: 200 })).toEqual({ state: 'unavailable', reason: 'shape', httpStatus: 200 })
    expect(dilutionRead({ status: 'failed', reason: 'rate_limited', http_status: 429 })).toEqual({ state: 'failed', reason: 'rate_limited', httpStatus: 429 })
    expect(dilutionRead({ status: 'failed', reason: 'timeout', http_status: null })).toEqual({ state: 'failed', reason: 'timeout', httpStatus: null })
    expect(dilutionRead({ status: 'failed' })).toEqual({ state: 'failed', reason: 'error', httpStatus: null })
  })

  it('an answer that is not this route\'s is a failed read, never "nothing filed"', () => {
    for (const body of [null, undefined, [], 'ok', { detail: 'something else' }, { status: 'ok' }, { status: 'ok', rows: [], summary: {} },
      { ...answer(), rows: 'none' }, { ...answer(), summary: null }, { ...answer(), window: { from: 'x', to: 'y' } },
      { ...answer(), rows: [{ form: '424B5' }, { date: '2026-13-99x', form: '' }] }]) {
      expect(dilutionRead(body), JSON.stringify(body)?.slice(0, 60)).toEqual({ state: 'failed', reason: null })
    }
  })

  it('a row or a shelf this code cannot read is left out, and an address that is not sec.gov is not a link', () => {
    const v = dilutionRead(answer({
      rows: [...ROWS(), { date: '2026-01-01' }, null, row('2026-07-07', 'X-17', 'something new', '', { url: 'https://example.test/x', items: ['1.01', 'bad', 7] })],
      shelves: [SHELF, { ...SHELF, state: 'on fire' }, { ...SHELF, filed: null }, null],
    }))
    expect(v.rows).toHaveLength(8)
    expect(v.rows[7]).toMatchObject({ form: 'X-17', kind: 'other', what: 'Form X-17', url: null, items: ['1.01'] })
    expect(v.shelves).toHaveLength(1)
    expect(v.rowsTotal).toBe(8)
  })

  it('the live and pending shelves are worked out from the shelves themselves', () => {
    const pending = { ...SHELF, filed: '2026-10-20', effective: null, effective_basis: null, expires_estimate: null, state: 'not_effective', offerings: 0, latest_offering: null }
    const v = dilutionRead(answer({ shelves: [pending, SHELF, { ...SHELF, filed: '2024-01-05', state: 'withdrawal_requested', withdrawal_requested: '2024-06-01' }] }))
    expect([v.summary.liveShelves, v.summary.pendingShelves]).toEqual([1, 1])
    expect(v.summary.pendingShelf.filed).toBe('2026-10-20')
    expect(v.shelves[2].withdrawalRequested).toBe('2024-06-01')
  })

  it('a count the read does not reach back for stays null', () => {
    const v = dilutionRead(PARTIAL())
    expect(v.coverage).toEqual({ complete: false, from: '2026-01-01', pagesUnread: 2 })
    expect(v.summary.offerings).toEqual({ m12: null, y3: null, latest: '2026-11-10' })
    expect(dilutionRead(answer({ summary: { ...answer().summary, offerings: { m12: -1, y3: 2.5, latest: 'x' } } })).summary.offerings)
      .toEqual({ m12: null, y3: null, latest: null })
  })
})

describe('DILU the sentences', () => {
  const SYM = 'ZZA'

  it('a live shelf and its offering documents, the brief\'s example', () => {
    const v = dilutionRead(answer())
    expect(summarySentences(SYM, v)).toEqual([
      'A shelf registration filed on Mar 4, 2025 appears to be live: the SEC\'s notice that it took effect is dated Mar 12, 2025, '
      + 'and a shelf may be used for 3 years from then, to about Mar 12, 2028 (an estimate from the dates).',
      'ZZA filed 4 offering documents (prospectuses and prospectus supplements) in the last 12 months and 6 in the last 3 years, the latest on Oct 2, 2026.',
      'It reported 1 unregistered sale of equity securities (8-K item 3.02) in the last 3 years, the latest on Sep 30, 2026.',
    ])
  })

  it('an automatic shelf says it took effect when filed, and more than one live shelf is counted', () => {
    const auto = dilutionRead(answer({ shelves: [{ ...SHELF, form: 'S-3ASR', automatic: true, filed: '2026-02-10', effective: '2026-02-10',
      effective_basis: 'automatic', expires_estimate: '2029-02-10' }, SHELF] }))
    expect(liveShelfSentence(auto.summary.liveShelf, auto.summary.liveShelves, 3)).toBe(
      'An automatic shelf registration filed on Feb 10, 2026 appears to be live: it took effect the day it was filed, '
      + 'and a shelf may be used for 3 years from then, to about Feb 10, 2029 (an estimate from the dates). It is the newest of 2 that appear to be live.')
    expect(liveShelfSentence(null, 0)).toBe('')
  })

  it('nothing filed is one plain sentence', () => {
    expect(summarySentences(SYM, dilutionRead(NOTHING()))).toEqual(['No shelf registration, offering document or unregistered sale was filed by ZZA in the last 3 years.'])
  })

  it('a shelf with no notice, a withdrawn one and a new registration each say what was filed', () => {
    const pending = { ...SHELF, filed: '2026-10-20', effective: null, effective_basis: null, expires_estimate: null, state: 'not_effective', offerings: 0, latest_offering: null }
    const base = NOTHING()
    const one = dilutionRead({ ...base, shelves: [pending], rows: [row('2026-10-20', 'S-3', 'shelf', 'Shelf registration')] })
    expect(summarySentences(SYM, one)).toEqual([
      'A shelf registration filed on Oct 20, 2026 has no SEC notice that it took effect in the filing index yet.',
      'No offering document (a prospectus or a prospectus supplement) was filed in the last 3 years.',
    ])
    // a live shelf AND a newer one with no notice: both are said
    const both = dilutionRead(answer({ shelves: [pending, SHELF] }))
    expect(summarySentences(SYM, both).slice(0, 2)).toEqual([
      'A shelf registration filed on Mar 4, 2025 appears to be live: the SEC\'s notice that it took effect is dated Mar 12, 2025, '
      + 'and a shelf may be used for 3 years from then, to about Mar 12, 2028 (an estimate from the dates).',
      'Another shelf registration, filed on Oct 20, 2026, has no SEC notice that it took effect in the filing index yet.',
    ])
    const gone = dilutionRead({ ...base, shelves: [{ ...SHELF, state: 'withdrawal_requested', withdrawal_requested: '2025-06-01' }], rows: [row('2025-06-01', 'RW', 'withdrawal', 'Request to withdraw a registration')] })
    expect(summarySentences(SYM, gone)[0]).toBe('No shelf registration filed in the last 3 years appears to be live.')
    const s1 = dilutionRead({ ...base, rows: [row('2026-05-05', 'S-1', 'registration', 'Registration statement')],
      summary: { ...base.summary, registrations: { m12: 1, y3: 2, latest: '2026-05-05' } } })
    expect(summarySentences(SYM, s1)).toEqual([
      'No shelf registration was filed in the last 3 years.',
      'No offering document (a prospectus or a prospectus supplement) was filed in the last 3 years.',
      'It filed 2 new registration statements (the Form S-1 or F-1 family) in the last 3 years, the latest on May 5, 2026.',
    ])
  })

  it('a read that does not reach back far enough says so and gives no count it cannot stand behind', () => {
    const v = dilutionRead(PARTIAL())
    expect(summarySentences(SYM, v)).toEqual([
      'No shelf registration appears in the filings read, which reach back only to Jan 1, 2026; a shelf filed before that would not show here.',
      'ZZA\'s latest offering document (a prospectus or a prospectus supplement) was filed on Nov 10, 2026. Counts are not given: the filings read reach back only to Jan 1, 2026.',
    ])
    const year = dilutionRead(PARTIAL({ coverage: { complete: false, from: '2025-05-05', requests: 2, pages_unread: 1 },
      summary: { ...PARTIAL().summary, offerings: { m12: 1, y3: null, latest: '2026-11-10' }, unregistered: { m12: null, y3: null, latest: '2026-03-03' } } }))
    expect(offeringsSentence(SYM, year)).toBe('ZZA filed 1 offering document (prospectuses and prospectus supplements) in the last 12 months, the latest on Nov 10, 2026. '
      + 'The 3-year count is not given: the filings read reach back only to May 5, 2025.')
    expect(summarySentences(SYM, year)[2]).toBe('It reported an unregistered sale of equity securities (8-K item 3.02) on Mar 3, 2026.')
    const none = dilutionRead(PARTIAL({ rows: [], summary: { ...PARTIAL().summary, offerings: { m12: null, y3: null, latest: null } } }))
    expect(offeringsSentence(SYM, none)).toBe('No offering document appears in the filings read. Counts are not given: the filings read reach back only to Jan 1, 2026.')
    // the facts list says the same, and never a number
    expect(horizonWords(v.summary.offerings, v)).toBe('Not counted: the filings read reach back only to Jan 1, 2026')
    expect(horizonWords(year.summary.offerings, year)).toBe('1 in the last 12 months; the 3-year count is not given')
    const full = dilutionRead(answer())
    expect(horizonWords(full.summary.offerings, full)).toBe('4 in the last 12 months, 6 in the last 3 years')
    expect(horizonWords({ m12: 0, y3: 2, latest: null }, full)).toBe('None in the last 12 months, 2 in the last 3 years')
    expect(horizonWords({ m12: 0, y3: 0, latest: null }, full)).toBe('None in the last 3 years')
  })

  it('no sentence says what a company will do, and none carries an amount', () => {
    const pending = { ...SHELF, filed: '2026-10-20', effective: null, effective_basis: null, expires_estimate: null, state: 'not_effective' }
    const all = [answer(), NOTHING(), PARTIAL(), answer({ shelves: [pending] })].flatMap((b) => {
      const v = dilutionRead(b)
      return [...summarySentences('ZZA', v), ...v.shelves.map((s) => shelfSentence(s)), ...v.rows.map(rowDetail)]
    }).concat(KIND_NOTES.flatMap(([, name, note]) => [name, note]))
    for (const s of all) {
      expect(s, s).not.toMatch(/\bwill\b|about to|is going to|plans to|\$|\bmillion\b|\bshares (?:sold|registered|offered)\b/i)
    }
    // every sentence that says "live" says it is an estimate
    for (const s of all.filter((x) => /\blive\b/.test(x) && /appears to be live:/.test(x))) expect(s).toContain('(an estimate from the dates)')
  })

  it('a shelf in one line: when it took effect, how long it may be used, what was filed under it', () => {
    const v = dilutionRead(answer())
    expect(shelfSentence(v.shelves[0], 3)).toBe('Took effect by the SEC\'s notice dated Mar 12, 2025. It may be used until about Mar 12, 2028, 3 years from then (an estimate from the dates). '
      + '5 offering documents filed under it, the latest Oct 2, 2026.')
    const read = (over) => dilutionRead(answer({ shelves: [{ ...SHELF, ...over }] })).shelves[0]
    expect(shelfSentence(read({ automatic: true, effective_basis: 'automatic', effective: '2025-03-04', expires_estimate: '2028-03-04', offerings: 1, latest_offering: '2025-04-01' })))
      .toBe('Took effect the day it was filed. It may be used until about Mar 4, 2028, 3 years from then (an estimate from the dates). 1 offering document filed under it, the latest Apr 1, 2025.')
    expect(shelfSentence(read({ state: 'not_effective', effective: null, effective_basis: null, expires_estimate: null, offerings: 0, latest_offering: null })))
      .toBe('No SEC notice that it took effect is in the filing index yet. No offering document filed under it in the filings read.')
    expect(shelfSentence(read({ state: 'withdrawal_requested', withdrawal_requested: '2025-06-01', offerings: 0 })))
      .toBe('The company asked to withdraw it on Jun 1, 2025. No offering document filed under it in the filings read.')
    expect(shelfSentence(read({ state: 'expired', expires_estimate: '2026-11-18' })))
      .toContain('Its 3 years ran to about Nov 18, 2026 (an estimate from the dates).')
  })

  it('a row\'s second line says what it was filed under, or its items, and nothing when there is nothing to add', () => {
    const v = dilutionRead(answer())
    expect(v.rows.map(rowDetail)).toEqual([
      'Under the shelf filed Mar 4, 2025', 'Under the shelf filed Mar 4, 2025', 'Items 1.01, 3.02, 9.01', 'Items 1.01, 9.01',
      'Under the shelf filed Mar 4, 2025', '', '',
    ])
    const more = dilutionRead(answer({ rows: [
      row('2026-01-01', 'EFFECT', 'effect', 'x', { file_number: '333-111111' }), row('2026-01-01', 'EFFECT', 'effect', 'x', { file_number: null }),
      row('2026-01-01', '424B4', 'offering', 'Prospectus', { under: { form: 'S-1', filed: '2025-12-01', shelf: false } }),
      row('2026-01-01', '8-K', 'unregistered', 'x', { items: ['3.02'] }),
    ] }))
    expect(more.rows.map(rowDetail)).toEqual([
      'File 333-111111; its registration statement is not among the filings read', '', 'Under the registration filed Dec 1, 2025', '',
    ])
  })

  it('employee plans and material agreements are listed apart, and each kind on screen is explained once', () => {
    const v = dilutionRead(answer())
    expect(minorCount(v.rows)).toBe(2)
    expect(rowsFor(v.rows, false).map((r) => r.kind)).toEqual(['offering', 'fwp', 'unregistered', 'effect', 'shelf'])
    expect(rowsFor(v.rows, true)).toHaveLength(7)
    expect(notesFor(rowsFor(v.rows, false)).map((n) => n.kind)).toEqual(['shelf', 'effect', 'offering', 'fwp', 'unregistered'])
    expect(notesFor(v.rows).map((n) => n.kind)).toEqual(['shelf', 'effect', 'offering', 'fwp', 'unregistered', 'plan', 'agreement'])
    expect(notesFor([])).toEqual([])
    const kinds = KIND_NOTES.map(([k]) => k)
    expect(new Set(kinds).size).toBe(kinds.length)
    expect(kinds).toEqual(['shelf', 'shelf_amendment', 'effect', 'offering', 'fwp', 'registration', 'registration_amendment', 'withdrawal',
      'unregistered', 'plan', 'agreement'])
    expect(KIND_NOTES.find(([k]) => k === 'shelf')[2]).toContain('It is the capacity to sell, not a sale.')
    expect(KIND_NOTES.find(([k]) => k === 'plan')[2]).toContain('Not a market offering.')
  })

  it('a refusal, a rate limit and a timeout each have their own plain words', () => {
    expect(unavailableWords('refused', 403)).toBe('SEC filings are not available right now: the SEC\'s website refused the server\'s request (it answered 403).')
    expect(unavailableWords('refused', null)).toBe('SEC filings are not available right now: the SEC\'s website refused the server\'s request.')
    expect(unavailableWords('shape', 200)).toBe('SEC filings are not available right now: the SEC\'s website answered, but not with a filing index this screen can read.')
    expect(failedWords('rate_limited', 'ZZA', 'ZZA DILU')).toMatchObject({ title: 'The SEC\'s website said the server was asking too often.', retry: false })
    expect(failedWords('rate_limited', 'ZZA').hint).toContain('waits about 15 minutes before it asks the SEC again')
    expect(failedWords('timeout', 'ZZA', 'ZZA DILU')).toEqual({ title: 'The SEC\'s website did not answer in time.', retry: true,
      hint: 'That is not the same as no filings. The server tries again within a minute; Retry, or run ZZA DILU again.' })
    for (const reason of ['source', 'error', null]) {
      expect(failedWords(reason, 'ZZA', 'ZZA DILU')).toEqual({ title: 'SEC filings for ZZA could not be read just now.', retry: true,
        hint: 'That is not the same as no filings. Retry, or run ZZA DILU again.' })
    }
  })
})
