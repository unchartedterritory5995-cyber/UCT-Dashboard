// PUBR: one company's public records. Rails:
//   * loading, a failed read (error with Retry), signed out, no paid plan (locked, no Retry), a timeout and an answer
//     that is not the route's shape: none is "no records";
//   * "computing" is said in words and the panel asks again every 3 seconds, hourly once everything is held;
//   * a section that could not be read says why with Retry; a section with no match says so in words (never "none
//     exist") with the names it searched and the names it did not count; a company with no name says nothing was
//     searched;
//   * every section shows its matched names and how each matched, its source line with the agency's own requirements
//     (ClinicalTrials.gov's processing date and the fields shown, LDA.gov's sentence, D&B's attribution), its lede and
//     its rows; links open on the agency's own site;
//   * the all-sections view shows the first rows; a section view shows all of them and the closed trials; the chips and
//     "Show all" write `SYM PUBR TRIALS` back (or switch in state); no symbol says how to ask;
//   * how the ticker was matched is on screen; no hard-coded colour; axe.
// Every company, name and figure is invented.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import PublicRecordsPanel from './PublicRecordsPanel'
import { pubrUrl } from './publicRecordsModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const URL = pubrUrl('QQZA')
const NAMES = [
  { name: 'Kestrel Dynamics Corporation', source: 'site', source_words: "the site's company name", until: null },
  { name: 'KESTREL DYNAMICS CORP', source: 'sec', source_words: "the SEC's name for the company", until: null },
]
const section = (key, source, over = {}) => ({
  status: 'ok', state: 'matched', section: key, source, source_url: 'https://example.gov', read_at: '2030-05-14T14:42:00+00:00',
  searched_for: 'KESTREL DYNAMICS', names: NAMES,
  counted: [{ name: 'KESTREL DYNAMICS CORP', counted: true, how: 'same_name', how_words: 'Same name', against: 'KESTREL DYNAMICS CORP', amount: 1000, records: 1 },
    { name: 'DYNAMICS KESTREL', counted: true, how: 'same_words', how_words: 'Same words in another order', against: 'Kestrel Dynamics Corporation', amount: null, records: 1 }],
  not_counted: [{ name: 'SKYHOOK KESTREL LLC', counted: false, amount: 50, records: 1 }], not_counted_total: 2, dropped: 0, check: null, ...over,
})
const AWARD = (i, over = {}) => ({ award_id: `QZ${i}`, recipient: 'KESTREL DYNAMICS CORP', date: `2030-0${(i % 9) + 1}-02`, amount: 100000 * i,
  agency: 'Department of Imaginary Affairs', sub_agency: 'Office of Lanterns', description: `Lantern upkeep ${i}`, description_cut: i === 1,
  place: 'Maple Ford, OR', kind: 'DEFINITIVE CONTRACT', url: `https://www.usaspending.gov/award/CONT_AWD_QZ${i}`, ...over })
const TRIAL = (i, over = {}) => ({ nct_id: `NCT9000000${i}`, title: `Lantern oil study ${i}`, status: 'RECRUITING', phases: ['PHASE1', 'PHASE2'],
  conditions: ['Glow fatigue'], conditions_more: 1, start: { date: '2029-02', estimated: null }, primary_completion: { date: '2031-01-15', estimated: true },
  enrollment: 120, enrollment_estimated: true, last_update: '2030-05-01', url: `https://clinicaltrials.gov/study/NCT9000000${i}`, ...over })
const QUARTER = (i) => ({ year: 2030, quarter: 1, label: `Q${(i % 4) + 1} ${2030 - Math.floor(i / 4)}`, reports_due: i === 0, due: '2030-04-20',
  filings: 3, own: 400000, own_reports: 1, own_no_figure: 0, firms: i === 1 ? null : 30000, firm_reports: 2, firms_no_figure: i === 1 ? 2 : 0,
  firm_names: ['BRAMBLE & PARTNERS'], issues: [{ issue: 'Defense', filings: 3 }, { issue: 'Budget/Appropriations', filings: 1 }], issues_more: 0,
  links: ['https://lda.gov/filings/public/filing/f1/print/'] })
const BODY = (over = {}) => ({
  status: 'ok', sym: 'QQZA',
  company: { status: 'ok', cik: '0009990001', sec_state: 'ok', names: NAMES, read_at: '2030-05-14T14:40:00+00:00' },
  contracts: section('contracts', 'USAspending.gov (U.S. Department of the Treasury, Bureau of the Fiscal Service)', {
    recent_total: 1500000, prior_total: 1000000, windows: { recent: ['2029-05-15', '2030-05-14'], prior: ['2028-05-15', '2029-05-14'] },
    awards: [1, 2, 3, 4].map((i) => AWARD(i)), awards_cut: false, awards_more: true, recipients_more: true }),
  trials: section('trials', 'ClinicalTrials.gov (U.S. National Library of Medicine)', {
    active: [1, 2, 3, 4].map((i) => TRIAL(i)), closed: [TRIAL(8, { status: 'TERMINATED', phases: ['PHASE3'], last_update: '2030-03-03' })],
    active_matched: 4, closed_matched: 1, active_read: 4, active_total: 4, closed_read: 1, closed_total: 1,
    by_phase: { 'PHASE1+PHASE2': 4 }, by_status: { RECRUITING: 4, TERMINATED: 1 }, data_processed: '2030-05-13T10:00:05', closed_since: '2029-05-14' }),
  fda: section('fda', 'openFDA, Drugs@FDA (U.S. Food and Drug Administration)', {
    actions: [{ application: 'NDA990001', application_words: 'New drug application', sponsor: 'KESTREL DYNAMICS', drug: 'GLOWEX', drugs_more: 0,
      ingredients: 'EMBERINE', date: '2030-01-01', action: 'approval', priority: 'PRIORITY', class_words: 'Type 1 - New Molecular Entity',
      url: 'https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=990001' }],
    actions_cut: false, actions_matched: 1, other_changes: 2, since: '2028-05-14', data_as_of: '2030-05-12', notice: 'Invented agency notice.' }),
  lobbying: section('lobbying', 'LDA.gov, Lobbying Disclosure Act filings (Senate Office of Public Records)', {
    searched_for: 'kestrel dynamics', quarters: [0, 1, 2, 3, 4, 5, 6, 7].map(QUARTER), cut: false, filings_read: 24, filings_held: 24 }),
  ...over,
})

const httpError = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status, ...extra })
const PENDING = Symbol('pending')
function serve(routes) {
  jsonFetcher.mockImplementation((u) => {
    const hit = typeof routes[u] === 'function' ? routes[u]() : routes[u]
    if (hit === undefined) return Promise.reject(httpError(500))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
function renderPanel(props = { sym: 'QQZA' }, { code = null, rerun = vi.fn(), setFreshness = vi.fn() } = {}) {
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), rerun, publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}><PublicRecordsPanel {...props} /></TerminalPanelContext.Provider>
            : <PublicRecordsPanel {...props} />}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { rerun, setFreshness, container: view.container }
}
const frame = () => screen.getByTestId('terminal-pubr')
const cells = (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)
const lastReport = (setFreshness) => setFreshness.mock.calls.map(([r]) => r).filter(Boolean).pop()

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('PUBR states', () => {
  it('shows a loading skeleton and asks for the company\'s records', () => {
    serve({ [URL]: PENDING })
    renderPanel()
    expect(screen.getByTestId('terminal-pubr-loading').textContent).toContain('Loading public records for QQZA')
    expect(jsonFetcher.mock.calls.map(([u]) => u)).toEqual([URL])
  })

  it('with no symbol it says how to ask, and reads nothing', () => {
    renderPanel({})
    expect(screen.getByTestId('terminal-pubr-no-sym').textContent).toContain('NVDA PUBR')
    expect(jsonFetcher).not.toHaveBeenCalled()
  })

  it('a failed read is an error with Retry, never "no records"; a retry that works fills in', async () => {
    serve({})
    renderPanel()
    const err = await screen.findByTestId('terminal-pubr-error')
    expect(err.textContent).toContain('Public records could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no records.')
    serve({ [URL]: BODY() })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-pubr-contracts-table')).toBeTruthy()
  })

  it('signed out, a timeout, no paid plan and an unreadable answer each say so; only an error can be retried', async () => {
    for (const [hit, kind, words] of [
      [httpError(401), 'error', 'You are signed out, so public records cannot be read. Sign in again.'],
      [httpError(0, { timedOut: true }), 'error', 'Public records did not answer within 30 seconds.'],
      [httpError(402), 'locked', 'Public records needs a paid plan.'],
      [{ status: 'ok', contracts: {} }, 'error', 'Public records came back in a shape this panel cannot read.'],
    ]) {
      serve({ [URL]: hit })
      renderPanel()
      const box = await screen.findByTestId('terminal-pubr-error')
      expect(box.getAttribute('data-kind'), words).toBe(kind)
      expect(box.textContent, words).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
      cleanup()
    }
  })

  it('"computing" is said in words, and the panel asks again every 3 seconds until everything is held', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const computing = { status: 'computing', source: 'x' }
    let body = BODY({ company: { status: 'computing' }, contracts: computing, trials: computing, fda: computing, lobbying: computing })
    serve({ [URL]: () => body })
    renderPanel()
    expect((await screen.findByTestId('terminal-pubr-computing')).textContent).toBe('Loading, the server is preparing this.')
    expect(frame().getAttribute('data-state')).toBe('computing')
    expect(screen.getByTestId('terminal-pubr-trials-computing').textContent).toContain('The server is reading ClinicalTrials.gov for QQZA')
    expect(screen.getByTestId('terminal-pubr-company-computing')).toBeTruthy()
    const before = jsonFetcher.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    expect(jsonFetcher.mock.calls.length).toBeGreaterThan(before)
    body = BODY({ lobbying: computing })
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    await waitFor(() => expect(screen.getByTestId('terminal-pubr-contracts-table')).toBeTruthy())
    expect(screen.getByTestId('terminal-pubr-lobbying-computing')).toBeTruthy()
    body = BODY()
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    await waitFor(() => expect(screen.getByTestId('terminal-pubr-lobbying-table')).toBeTruthy())
    const held = jsonFetcher.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(jsonFetcher.mock.calls.length).toBe(held)
  })
})

describe('PUBR section states', () => {
  it('a section that could not be read says why with Retry, and the others still show', async () => {
    serve({ [URL]: BODY({ lobbying: { status: 'unavailable', reason: 'refused', http_status: 403, section: 'lobbying', source: 'LDA.gov' },
      fda: { status: 'failed', reason: 'budget', section: 'fda', source: 'openFDA' } }) })
    renderPanel()
    const lob = await screen.findByTestId('terminal-pubr-lobbying-failed')
    expect(lob.textContent).toContain("Lobbying could not be read. LDA.gov refused the server's request. That is not the same as no records.")
    expect(lob.getAttribute('data-reason')).toBe('refused')
    expect(within(lob).getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.getByTestId('terminal-pubr-fda-failed').textContent).toContain("daily allowance of reads from openFDA is used up")
    expect(screen.getByTestId('terminal-pubr-contracts-table')).toBeTruthy()
  })

  it('no match is said in words, never "none exist", with what was searched and the names not counted', async () => {
    serve({ [URL]: BODY({ trials: section('trials', 'ClinicalTrials.gov', { state: 'no_match', counted: [], active: [], closed: [] }) }) })
    renderPanel()
    const none = await screen.findByTestId('terminal-pubr-trials-none')
    expect(none.textContent).toBe('No trial that ClinicalTrials.gov returned for "KESTREL DYNAMICS" (active, or closed in the last year) has Kestrel Dynamics Corporation as its lead sponsor.')
    const trials = screen.getByTestId('terminal-pubr-trials')
    expect(trials.textContent).toContain('that is not the same as no record existing')
    expect(trials.textContent).not.toMatch(/none exist/i)
    expect(screen.getByTestId('terminal-pubr-trials-not-counted').textContent)
      .toBe('Not counted: 2 other names were returned and not counted (the first 1 are listed). SKYHOOK KESTREL LLC.')
    expect(screen.queryByTestId('terminal-pubr-trials-table')).toBeNull()
  })

  it('a company with no name says nothing was searched', async () => {
    const noName = (key) => ({ status: 'ok', state: 'no_name', section: key, source: key, searched_for: null, names: [], counted: [], not_counted: [], not_counted_total: 0 })
    serve({ [URL]: BODY({ company: { status: 'ok', cik: null, sec_state: 'no_cik', names: [] }, contracts: noName('contracts'), trials: noName('trials'),
      fda: noName('fda'), lobbying: noName('lobbying') }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-pubr-fda-none')).textContent).toBe('The server holds no company name for this stock to search openFDA with, so nothing was searched.')
    expect(screen.getByTestId('terminal-pubr-company').textContent).toContain('No company name held for QQZA')
    expect(screen.getByTestId('terminal-pubr-company').textContent).toContain('No SEC company number was found for this ticker.')
  })

  it('a held answer beside a refresh that failed says so', async () => {
    serve({ [URL]: BODY({ fda: { ...BODY().fda, check: { state: 'failed', reason: 'source', http_status: 503 } } }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-pubr-fda-stale')).textContent).toMatch(/^The server's latest look at openFDA did not go well; this is the answer it read before/)
  })
})

describe('PUBR the records', () => {
  it('how the ticker was matched is on screen: the names searched, the SEC number, the rule', async () => {
    serve({ [URL]: BODY() })
    renderPanel()
    const m = await screen.findByTestId('terminal-pubr-company')
    expect(m.querySelector('summary').textContent).toBe('Matched by name: Kestrel Dynamics Corporation and 1 more')
    expect(m.textContent).toContain("Names searched: Kestrel Dynamics Corporation (the site's company name); KESTREL DYNAMICS CORP (the SEC's name for the company).")
    expect(m.textContent).toContain('SEC company number (CIK) 0009990001.')
    expect(m.textContent).toContain('no parent or subsidiary is assumed')
  })

  it('the all-sections view: each lede, the first rows, the matched names and each source line with its agency\'s requirements', async () => {
    serve({ [URL]: BODY() })
    const { setFreshness } = renderPanel()
    expect((await screen.findByTestId('terminal-pubr-contracts-lede')).textContent)
      .toBe('Obligated to the matched names in the last 12 months (since May 15, 2029): $1.5M, against $1.0M in the 12 months before (+50%).')
    const awards = within(screen.getByTestId('terminal-pubr-contracts-table')).getAllByTestId('terminal-pubr-award')
    expect(awards).toHaveLength(3)
    expect(cells(awards[0])[0]).toBe('Feb 2, 2030')
    expect(cells(awards[0])[2]).toBe('$100K')
    expect(awards[0].querySelector('a').getAttribute('href')).toBe('https://www.usaspending.gov/award/CONT_AWD_QZ1')
    expect(awards[0].textContent).toContain('Lantern upkeep 1...')
    expect(screen.getByTestId('terminal-pubr-contracts-more').textContent).toBe('3 of 4 shown. Show all 4')
    expect(screen.getByTestId('terminal-pubr-contracts-names').textContent)
      .toContain('Matched names: KESTREL DYNAMICS CORP (same name); DYNAMICS KESTREL (same words in another order: Kestrel Dynamics Corporation)')
    expect(screen.getByTestId('terminal-pubr-contracts-source').textContent).toContain('Recipient names come in part from D&B Open Data (Dun & Bradstreet).')
    expect(screen.getByTestId('terminal-pubr-contracts-source').textContent).toContain('Searched for "KESTREL DYNAMICS".')
    expect(screen.getByTestId('terminal-pubr-trials-source').textContent).toContain('Data processed by ClinicalTrials.gov 2030-05-13 at 10:00:05.')
    expect(screen.getByTestId('terminal-pubr-trials-source').textContent).toContain('no text is changed')
    expect(screen.getByTestId('terminal-pubr-lobbying-source').textContent)
      .toContain('Senate Office of Public Records cannot vouch for the data or analyses derived from these data after the data have been retrieved from LDA.gov.')
    expect(screen.getByTestId('terminal-pubr-fda-source').textContent).toContain('Data provided by the U.S. Food and Drug Administration, updated May 12, 2030.')
    expect(screen.getByTestId('terminal-pubr-fda-notice').textContent).toBe("openFDA's note: Invented agency notice.")
    expect(screen.queryByTestId('terminal-pubr-closed-table')).toBeNull()             // closed trials: the trials view only
    expect(screen.queryByTestId('terminal-pubr-contracts-note')).toBeNull()           // notes: a section view only
    expect(screen.getByTestId('terminal-pubr-footer').textContent).toContain('none of it is a view or a forecast by UCT')
    expect(lastReport(setFreshness)).toMatchObject({ source: 'Government records' })
  })

  it('a section view shows every row, its notes, and for trials the closed ones too', async () => {
    serve({ [URL]: BODY() })
    renderPanel({ sym: 'QQZA', view: 'trials' })
    const rows = within(await screen.findByTestId('terminal-pubr-trials-table')).getAllByTestId('terminal-pubr-trial')
    expect(rows).toHaveLength(4)
    expect(cells(rows[0])).toEqual(['Lantern oil study 1NCT90000001 · Glow fatigue, and 1 more', 'Phase 1/2Recruiting', 'Jan 15, 2031 (estimated)', '120 (est.)'])
    const closed = within(screen.getByTestId('terminal-pubr-closed-table')).getAllByTestId('terminal-pubr-trial')
    expect(cells(closed[0]).slice(1)).toEqual(['Phase 3Terminated', 'Mar 3, 2030'])
    expect(screen.getByTestId('terminal-pubr-trials-lede').textContent)
      .toBe('4 active trials with the company as lead sponsor (Phase 1/2 4); 1 trial closed or updated as closed in the last year (terminated 1).')
    expect(screen.queryByTestId('terminal-pubr-contracts')).toBeNull()
    expect(frame().getAttribute('data-view')).toBe('trials')
    // the enrollment column folds on a phone, header and cell together
    const th = [...screen.getByTestId('terminal-pubr-trials-table').querySelectorAll('thead th')].pop()
    expect(th.className).toContain('phoneHide')
  })

  it('the FDA and lobbying sections draw their rows and their notes', async () => {
    serve({ [URL]: BODY({ contracts: { ...BODY().contracts } }) })
    renderPanel({ sym: 'QQZA', view: 'lobbying' })
    const qs = within(await screen.findByTestId('terminal-pubr-lobbying-table')).getAllByTestId('terminal-pubr-quarter')
    expect(qs).toHaveLength(8)
    expect(cells(qs[0])).toEqual(['Q1 2030reports due Apr 20, 2030', '$400K1 report', '$30K2 firm reports', 'Defense, Budget/Appropriations'])
    expect(cells(qs[1])[2]).toBe('No figure2 firm reports, 2 with no figure')
    expect(screen.getByTestId('terminal-pubr-lobbying-lede').textContent)
      .toBe("Last 4 quarters: $1.6M in the company's own reports, $90K reported by outside firms. The 4 before: $1.6M and $120K.")
    cleanup()
    serve({ [URL]: BODY() })
    renderPanel({ sym: 'QQZA', view: 'fda' })
    const a = within(await screen.findByTestId('terminal-pubr-fda-table')).getAllByTestId('terminal-pubr-fda-action')
    expect(cells(a[0])).toEqual(['Jan 1, 2030', 'GLOWEXEMBERINE · NDA990001', 'Approved (original application)priority review · Type 1 - New Molecular Entity'])
    cleanup()
    serve({ [URL]: BODY() })
    renderPanel({ sym: 'QQZA', view: 'contracts' })
    expect((await screen.findByTestId('terminal-pubr-contracts-note')).textContent).toContain('the first 100 by amount')
    expect(within(screen.getByTestId('terminal-pubr-contracts-table')).getAllByTestId('terminal-pubr-award')).toHaveLength(4)
  })
})

describe('PUBR picks', () => {
  it('inside the shell the chips and "Show all" write the stock\'s command back', async () => {
    serve({ [URL]: BODY() })
    const { rerun } = renderPanel({ sym: 'QQZA' }, { code: 'PUBR' })
    await screen.findByTestId('terminal-pubr-contracts-table')
    expect(screen.getByTestId('terminal-pubr-view-all').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-pubr-view-fda'))
    expect(rerun).toHaveBeenLastCalledWith('QQZA PUBR FDA')
    fireEvent.click(screen.getByTestId('terminal-pubr-open-lobbying'))
    expect(rerun).toHaveBeenLastCalledWith('QQZA PUBR LOBBYING')
    fireEvent.click(within(screen.getByTestId('terminal-pubr-contracts')).getByRole('button', { name: 'Show all 4' }))
    expect(rerun).toHaveBeenLastCalledWith('QQZA PUBR CONTRACTS')
  })

  it('outside the shell a chip switches in state, on the same read', async () => {
    serve({ [URL]: BODY() })
    renderPanel()
    await screen.findByTestId('terminal-pubr-contracts-table')
    fireEvent.click(screen.getByTestId('terminal-pubr-view-trials'))
    expect(frame().getAttribute('data-view')).toBe('trials')
    expect(screen.getByTestId('terminal-pubr-closed-table')).toBeTruthy()
    fireEvent.click(screen.getByTestId('terminal-pubr-view-all'))
    expect(frame().getAttribute('data-view')).toBe('all')
    expect(new Set(jsonFetcher.mock.calls.map(([u]) => u))).toEqual(new Set([URL]))
  })
})

describe('PUBR follows the member\'s theme', () => {
  it('the panel, its model and its sheet hold no hard-coded color, and the sheet keys on no screen width', () => {
    for (const f of ['PublicRecordsPanel.jsx', 'publicRecordsModel.js', 'publicRecordsPanel.module.css']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
    expect(fs.readFileSync(path.join(HERE, 'publicRecordsPanel.module.css'), 'utf8')).not.toMatch(/@media/)
  })
})

describe('PUBR accessibility', () => {
  it('the records, a section view, a failed section and a failed read pass axe (WCAG A and AA)', async () => {
    serve({ [URL]: BODY() })
    const ok = renderPanel({ sym: 'QQZA' }, { code: 'PUBR' })
    await screen.findByTestId('terminal-pubr-contracts-table')
    await expectNoAxeViolations(ok.container)
    cleanup()
    serve({ [URL]: BODY({ lobbying: { status: 'failed', reason: 'rate_limited', section: 'lobbying' } }) })
    const trials = renderPanel({ sym: 'QQZA', view: 'trials' })
    await screen.findByTestId('terminal-pubr-closed-table')
    await expectNoAxeViolations(trials.container)
    cleanup()
    serve({ [URL]: BODY({ lobbying: { status: 'failed', reason: 'rate_limited', section: 'lobbying' } }) })
    const failedSection = renderPanel({ sym: 'QQZA', view: 'lobbying' })
    await screen.findByTestId('terminal-pubr-lobbying-failed')
    await expectNoAxeViolations(failedSection.container)
    cleanup()
    serve({})
    const failed = renderPanel()
    await screen.findByTestId('terminal-pubr-error')
    await expectNoAxeViolations(failed.container)
  })
})
