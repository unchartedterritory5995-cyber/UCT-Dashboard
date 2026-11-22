// PUBR's pure half: reading the route's answer, the words for each state, the ledes, the notes and the argument words.
// Every company, name and figure is invented.
import { describe, it, expect } from 'vitest'
import {
  NOT_NONE, PUBR_COMPUTING_POLL_MS, PUBR_HELD_POLL_MS, PUBR_PREVIEW_ROWS, contractsLede, dateWords, fdaActionWords, fdaLede,
  httpsOnly, issuesWords, lobbyingLede, lobbyingSums, moneyWords, noMatchWords, normPubrView, notCountedWords, parsePubrView,
  phaseKeyWords, phaseWords, pubrCommandArgs, pubrPollMs, pubrRead, pubrUrl, quarterFigureWords, readWhen, sectionFailWords,
  sectionNoteWords, sectionRows, staleWords, statusWords, trialDateWords, trialsLede,
} from './publicRecordsModel'

const names = [{ name: 'Kestrel Dynamics Corporation', source: 'site', source_words: "the site's company name", until: null }]
const base = (key, over = {}) => ({ status: 'ok', state: 'matched', section: key, source: `${key} source`, read_at: '2030-05-14T14:42:00+00:00',
  searched_for: 'KESTREL DYNAMICS', names, counted: [{ name: 'KESTREL DYNAMICS CORP', how: 'same_name', how_words: 'Same name', amount: 10, records: 1 }],
  not_counted: [{ name: 'SKYHOOK KESTREL LLC', amount: 5 }], not_counted_total: 3, dropped: 0, check: null, ...over })
const BODY = (over = {}) => ({
  status: 'ok', sym: 'QQZA',
  company: { status: 'ok', cik: '0009990001', sec_state: 'ok', names, read_at: '2030-05-14T14:40:00+00:00' },
  contracts: base('contracts', { recent_total: 1500000, prior_total: 1000000, windows: { recent: ['2029-05-15', '2030-05-14'], prior: ['2028-05-15', '2029-05-14'] },
    awards: [{ award_id: 'QZ1', recipient: 'KESTREL DYNAMICS CORP', date: '2030-04-02', amount: 700000, agency: 'Department of Imaginary Affairs',
      sub_agency: 'Office of Lanterns', description: 'Lantern upkeep', description_cut: false, place: 'Maple Ford, OR', kind: 'DEFINITIVE CONTRACT',
      url: 'https://www.usaspending.gov/award/CONT_AWD_QZ1' }, { award_id: 'QZ2', date: 'not a day' }],
    awards_cut: false, awards_more: true, recipients_more: false }),
  trials: base('trials', { active: [{ nct_id: 'NCT90000001', title: 'Lantern oil in glow fatigue', status: 'RECRUITING', phases: ['PHASE3'],
    conditions: ['Glow fatigue'], conditions_more: 0, start: { date: '2029-02', estimated: null }, primary_completion: { date: '2031-01-15', estimated: true },
    enrollment: 120, enrollment_estimated: true, last_update: '2030-05-01', url: 'https://clinicaltrials.gov/study/NCT90000001' }, { nct_id: 'BAD' }],
  closed: [], active_matched: 1, closed_matched: 2, active_read: 3, active_total: 9, closed_read: 1, closed_total: 1, by_phase: { PHASE3: 1, 'PHASE1+PHASE2': 2 },
  by_status: { RECRUITING: 1, TERMINATED: 2 }, data_processed: '2030-05-13T10:00:05', closed_since: '2029-05-14' }),
  fda: base('fda', { actions: [{ application: 'NDA990001', application_words: 'New drug application', drug: 'GLOWEX', drugs_more: 0, ingredients: 'EMBERINE',
    date: '2030-01-01', action: 'new_use', priority: 'PRIORITY', class_words: 'Efficacy', url: 'https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?ApplNo=990001' }],
  actions_cut: false, actions_matched: 1, other_changes: 4, since: '2028-05-14', data_as_of: '2030-05-12', notice: 'Invented notice.' }),
  lobbying: base('lobbying', { quarters: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ year: 2030, quarter: 1, label: `Q${i}`, reports_due: i === 1, due: '2030-04-20',
    filings: 2, own: i <= 4 ? 100000 : null, own_reports: 1, own_no_figure: 0, firms: 20000, firm_reports: 1, firms_no_figure: 0, firm_names: ['FIRM'],
    issues: [{ issue: 'Defense', filings: 2 }], issues_more: i === 2 ? 3 : 0, links: ['https://lda.gov/filings/x/print/', 'https://elsewhere.test/x'] })),
  cut: true, filings_read: 300, filings_held: 340 }),
  ...over,
})

describe('PUBR words and arguments', () => {
  it('reads each section word and runs the bare command for all four', () => {
    expect(['CONTRACTS', 'awards', 'Trials', 'FDA', 'approvals', 'lobbying'].map(parsePubrView)).toEqual(['contracts', 'contracts', 'trials', 'fda', 'fda', 'lobbying'])
    expect(parsePubrView('ALL')).toBeNull()
    expect([normPubrView('trials'), normPubrView('nope'), normPubrView(undefined)]).toEqual(['trials', 'all', 'all'])
    expect([pubrCommandArgs('all'), pubrCommandArgs('fda'), pubrCommandArgs('lobbying')]).toEqual([[], ['FDA'], ['LOBBYING']])
    expect(pubrUrl('BRK.B')).toBe('/api/research/public-records/BRK.B')
  })
})

describe('PUBR reading the answer', () => {
  it('reads every section, drops rows it cannot read, and keeps links on the agency\'s own site', () => {
    const r = pubrRead(BODY())
    expect(r.state).toBe('ok')
    expect(r.company).toMatchObject({ state: 'ok', cik: '0009990001', names: [{ name: 'Kestrel Dynamics Corporation', sourceWords: "the site's company name" }] })
    const c = r.sections.contracts
    expect(c.awards.map((a) => a.awardId)).toEqual(['QZ1'])
    expect(c.notCounted[0]).toMatchObject({ name: 'SKYHOOK KESTREL LLC', counted: false })
    expect(r.sections.trials.active.map((t) => t.nctId)).toEqual(['NCT90000001'])
    expect(r.sections.lobbying.quarters[0].links).toEqual(['https://lda.gov/filings/x/print/'])
    expect(httpsOnly('http://www.usaspending.gov/x', 'https://www.usaspending.gov/')).toBeNull()
  })

  it('is not an answer without every section, and a section in an unknown state reads as failed', () => {
    expect(pubrRead(null).state).toBe('failed')
    expect(pubrRead({ status: 'ok', contracts: {} }).state).toBe('failed')
    expect(pubrRead([]).state).toBe('failed')
    const r = pubrRead(BODY({ fda: { status: 'ok', state: 'weird' }, lobbying: { status: 'unavailable', reason: 'refused', http_status: 403, source: 'LDA' } }))
    expect(r.sections.fda).toMatchObject({ state: 'failed', reason: 'shape' })
    expect(r.sections.lobbying).toMatchObject({ state: 'failed', reason: 'refused', httpStatus: 403 })
    expect(pubrRead(BODY({ company: { status: 'computing' } })).company.state).toBe('computing')
  })

  it('asks again in 3 seconds while anything is still being read, else hourly', () => {
    expect(pubrPollMs(BODY())).toBe(PUBR_HELD_POLL_MS)
    expect(pubrPollMs(BODY({ trials: { status: 'computing' } }))).toBe(PUBR_COMPUTING_POLL_MS)
    expect(pubrPollMs(BODY({ company: { status: 'computing' } }))).toBe(PUBR_COMPUTING_POLL_MS)
    expect(pubrPollMs(null)).toBe(PUBR_HELD_POLL_MS)
  })
})

describe('PUBR words', () => {
  const r = pubrRead(BODY())
  it('money, dates and trial dates are words, never 0 for a missing figure', () => {
    expect(moneyWords(1500000)).toBe('$1.5M')
    expect(moneyWords(null)).toBe('No figure')
    expect([dateWords('2030-04-02'), dateWords('2029-02'), dateWords('soon')]).toEqual(['Apr 2, 2030', 'Feb 2029', ''])
    expect(trialDateWords({ date: '2031-01-15', estimated: true })).toBe('Jan 15, 2031 (estimated)')
    expect(trialDateWords({ date: '2031-01-15', estimated: false })).toBe('Jan 15, 2031 (actual)')
    expect(trialDateWords({ date: null })).toBe('Not given')
    expect(readWhen('2030-05-14T14:42:00+00:00')).toMatch(/May 14, 10:42 AM ET$/)
    expect(readWhen('nope')).toBe('')
  })

  it('phases, statuses and FDA actions in plain words', () => {
    expect([phaseWords(['PHASE1', 'PHASE2']), phaseWords([]), phaseWords(['EARLY_PHASE1']), phaseKeyWords('NONE'), phaseKeyWords('PHASE2+PHASE3')])
      .toEqual(['Phase 1/2', 'No phase given', 'Early phase 1', 'No phase given', 'Phase 2/3'])
    expect([statusWords('ACTIVE_NOT_RECRUITING'), statusWords('SOME_NEW_STATE'), statusWords(null)]).toEqual(['Active, not recruiting', 'Some new state', 'Status not given'])
    expect([fdaActionWords('approval'), fdaActionWords('new_use'), fdaActionWords('tentative')])
      .toEqual(['Approved (original application)', 'New use approved (efficacy supplement)', 'Tentative approval'])
  })

  it('each section\'s lede says what was found', () => {
    expect(contractsLede(r.sections.contracts)).toBe('Obligated to the matched names in the last 12 months (since May 15, 2029): $1.5M, against $1.0M in the 12 months before (+50%).')
    expect(trialsLede(r.sections.trials)).toBe('1 active trial with the company as lead sponsor (Phase 1/2 2, Phase 3 1); 2 trials closed or updated as closed in the last year (terminated 2).')
    expect(fdaLede(r.sections.fda)).toBe('1 approval or new use since May 14, 2028; the latest: GLOWEX, Jan 1, 2030. 4 labeling or manufacturing changes were approved too (not listed).')
    expect(lobbyingSums(r.sections.lobbying.quarters)).toEqual({ recentOwn: 400000, recentFirms: 80000, priorOwn: null, priorFirms: 80000 })
    expect(lobbyingLede(r.sections.lobbying)).toBe("Last 4 quarters: $400K in the company's own reports, $80K reported by outside firms. The 4 before: No figure and $80K.")
  })

  it('a section with no match never says that none exist, and one with no name says nothing was searched', () => {
    const none = { ...r.sections.contracts, state: 'no_match' }
    expect(noMatchWords(none, 'Kestrel Dynamics Corporation')).toBe('No contract recipient that USAspending.gov returned for "KESTREL DYNAMICS" in the last 24 months matched Kestrel Dynamics Corporation\'s names.')
    expect(noMatchWords({ ...r.sections.fda, state: 'no_match' }, 'K')).toContain('since May 14, 2028')
    expect(noMatchWords({ ...r.sections.lobbying, state: 'no_name' }, 'K')).toBe('The server holds no company name for this stock to search LDA.gov with, so nothing was searched.')
    for (const k of ['contracts', 'trials', 'fda', 'lobbying']) expect(noMatchWords({ ...r.sections[k], state: 'no_match' }, 'K')).not.toMatch(/no records exist|none exist/i)
    expect(NOT_NONE).toContain('not the same as no record existing')
  })

  it('a failed section says why, and that it is not the same as no records', () => {
    for (const [reason, words] of [['refused', 'refused the server'], ['rate_limited', 'slow down'], ['budget', 'daily allowance'], ['shape', 'form the server could not read'],
      ['busy', 'other companies'], ['company', "names were not ready"], ['timeout', 'did not answer in time'], [null, 'could not be read just now']]) {
      const w = sectionFailWords({ key: 'trials', short: 'ClinicalTrials.gov', reason })
      expect(w.title).toBe('Clinical trials it leads could not be read.')
      expect(w.body).toContain(words)
      expect(w.body).toContain('not the same as no records')
    }
  })

  it('names not counted, cut sections and a stale answer are said', () => {
    expect(notCountedWords(r.sections.contracts)).toBe('3 other names were returned and not counted (the first 1 are listed).')
    expect(notCountedWords({ notCounted: [], notCountedTotal: 0 })).toBe('')
    expect(sectionNoteWords(r.sections.contracts)).toContain('100 largest new awards')
    expect(sectionNoteWords(r.sections.trials)).toContain('holds 9 active trials')
    expect(sectionNoteWords(r.sections.lobbying)).toContain('oldest quarters may be incomplete')
    expect(sectionNoteWords({ ...r.sections.fda, dropped: 2 })).toBe('2 records in the answer could not be read and are not shown.')
    expect(staleWords(r.sections.fda)).toBe('')
    expect(staleWords({ ...r.sections.fda, check: { state: 'failed' } })).toMatch(/^The server's latest look at openFDA did not go well/)
  })

  it('the all-sections view shows the first rows, a section view all of them', () => {
    const many = { ...r.sections.lobbying }
    expect(sectionRows(many, 'all')).toMatchObject({ more: 8 - PUBR_PREVIEW_ROWS, total: 8 })
    expect(sectionRows(many, 'all').rows).toHaveLength(PUBR_PREVIEW_ROWS)
    expect(sectionRows(many, 'lobbying')).toMatchObject({ more: 0, total: 8 })
    expect(issuesWords(many.quarters[1])).toBe('Defense, and 3 more')
    expect(issuesWords({ issues: [], filings: 0 })).toBe('')
    expect(quarterFigureWords(null, 2, 2, 'report', 'reports')).toEqual({ amount: 'No figure', detail: '2 reports, 2 with no figure' })
    expect(quarterFigureWords(null, 0, 0, 'report', 'reports')).toEqual({ amount: 'None filed', detail: null })
  })
})
