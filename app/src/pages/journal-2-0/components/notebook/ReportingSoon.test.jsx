// Wave 13 lane 13C -- Reporting soon on Research Home, and the research workspace's door.
//
//   * DARK: with the gate off the section renders nothing and fetches NOTHING.
//   * NO NOTE WITHOUT A CLICK: rendering the list issues one GET; no draft, no create, until a
//     member presses Create prep note -- then exactly one draft and one create, and the new
//     note is opened.
//   * A FAILED READ IS SAID, never shown as a quiet week; the empty week has its one help line.
//   * The research workspace shows Earnings prep only while the gate is on.
//
// CONTRACT: the list, the draft, the empty week and the refusals are the REAL server's answers
// (`__fixtures__/contract`, written by tools/notebook_contract_fixtures.py from
// GET /api/j2/earnings-prep/soon and POST /api/j2/earnings-prep/{symbol}/draft). The note-create
// and research-summary routes are older than this wave and keep small stand-ins.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../lib/offline/settleNoteWrite', () => ({ settleNoteWrite: vi.fn(async () => {}) }))

import ReportingSoon from './ReportingSoon'
import TickerResearchWorkspace from './TickerResearchWorkspace'
import { Providers } from '../../a11y/fixtures'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { contract, contractBody } from '../../__fixtures__/contract'

const SOON = contractBody('earnings-prep.soon')
const DRAFT = contractBody('earnings-prep.draft')
const item = (symbol) => SOON.items.find((i) => i.symbol === symbol)

const respond = (status, body) => Promise.resolve({ ok: status < 400, status, headers: { get: () => null }, json: () => Promise.resolve(body) })

function stub(routes) {
  const calls = []
  global.fetch = vi.fn((url, init = {}) => {
    const path = String(url).split('?')[0]
    calls.push(`${init.method || 'GET'} ${path}`)
    const hit = routes.find(([re]) => re.test(path))
    return hit ? respond(...(Array.isArray(hit[1]) ? hit[1] : [200, hit[1]])) : respond(200, {})
  })
  return calls
}

describe('the recorded week is the one these rows are worded from (non-vacuity)', () => {
  it('one name today with its prep note, one in two days in an open position, one a week out with no time', () => {
    expect(SOON).toMatchObject({ today: '2026-10-05', windowDays: 7, partial: false })
    expect(SOON.items.map((i) => [i.symbol, i.date, i.daysAway, i.timing, i.sources, Boolean(i.prepNote)])).toEqual([
      ['EPAM', '2026-10-05', 0, 'bmo', ['watchlist'], true],
      ['EPNV', '2026-10-07', 2, 'amc', ['positions', 'watchlist'], false],
      ['EPCR', '2026-10-12', 7, null, ['flagged'], false],
    ])
    expect(DRAFT.symbol).toBe('EPNV')
  })
})

describe('ReportingSoon', () => {
  beforeEach(() => { __resetNotebookFlags() })
  afterEach(() => { __resetNotebookFlags() })

  it('gate OFF: renders nothing and fetches nothing', async () => {
    const calls = stub([[/soon$/, SOON]])
    const { container } = render(<Providers><ReportingSoon onOpenNote={() => {}} /></Providers>)
    await new Promise((r) => setTimeout(r, 20))
    expect(container.querySelector('[data-reporting-soon]')).toBeNull()
    expect(calls).toEqual([])
  })

  it('lists the names, and NO note is drafted or created until the click', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    const calls = stub([
      [/\/api\/j2\/earnings-prep\/soon$/, SOON],
      [/\/api\/j2\/earnings-prep\/EPNV\/draft$/, DRAFT],
      [/^\/api\/j2\/notes$/, { note: { id: 'note-new' } }],
    ])
    const onOpenNote = vi.fn()
    render(<Providers><ReportingSoon onOpenNote={onOpenNote} /></Providers>)
    const create = await screen.findByRole('button', { name: 'Create prep note for EPNV' })
    expect(screen.getByText('Wed, Oct 7, after the close')).toBeTruthy()
    expect(screen.getByText('Today, before the open')).toBeTruthy()
    expect(screen.getByText('Mon, Oct 12, time not announced yet')).toBeTruthy()
    expect(screen.getAllByText('Open position')).toHaveLength(1)
    expect(screen.getAllByText('Watchlist')).toHaveLength(2)
    expect(screen.getAllByText('Flagged')).toHaveLength(1)
    // rendering read the list and nothing else
    expect(calls).toEqual(['GET /api/j2/earnings-prep/soon'])

    fireEvent.click(create)
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'note-new' })))
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([
      'POST /api/j2/earnings-prep/EPNV/draft', 'POST /api/j2/notes',
    ])
    // the list and the draft are read from the routes the answers were recorded from
    expect(contract('earnings-prep.soon')._contract.path).toBe('/api/j2/earnings-prep/soon')
    expect(contract('earnings-prep.draft')._contract.path.toUpperCase()).toBe('/API/J2/EARNINGS-PREP/EPNV/DRAFT')
  })

  it('a name already prepped opens that note instead of drafting another', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    const calls = stub([[/\/api\/j2\/earnings-prep\/soon$/, SOON]])
    const onOpenNote = vi.fn()
    render(<Providers><ReportingSoon onOpenNote={onOpenNote} /></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: 'Open the EPAM prep note' }))
    expect(onOpenNote).toHaveBeenCalledWith({ id: item('EPAM').prepNote.id })
    expect(screen.queryByRole('button', { name: 'Create prep note for EPAM' })).toBeNull()
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([])
  })

  it('a refused draft says the server sentence and creates nothing', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    const refusal = contract('earnings-prep.draft.daily-cap')
    const sentence = refusal.body.detail
    expect(sentence).toBe("You've drafted 20 earnings prep notes today, the daily limit. It resets at midnight Eastern.")
    const calls = stub([
      [/\/api\/j2\/earnings-prep\/soon$/, SOON],
      [/\/draft$/, [refusal._contract.status, refusal.body]],
    ])
    render(<Providers><ReportingSoon onOpenNote={() => {}} /></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: 'Create prep note for EPNV' }))
    expect((await screen.findByRole('alert')).textContent).toBe(sentence)
    expect(calls).not.toContain('POST /api/j2/notes')
  })

  it('a failed read is said, never shown as a quiet week', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    const refused = contract('earnings-prep.soon.free-plan')
    stub([[/\/api\/j2\/earnings-prep\/soon$/, [refused._contract.status, refused.body]]])
    render(<Providers><ReportingSoon onOpenNote={() => {}} /></Providers>)
    expect(await screen.findByText(/the earnings calendar for your names/)).toBeTruthy()
    expect(screen.queryByText(/report in the next/)).toBeNull()
  })

  it('an empty week carries its one help line', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    stub([[/\/api\/j2\/earnings-prep\/soon$/, contractBody('earnings-prep.soon.empty')]])
    render(<Providers><ReportingSoon onOpenNote={() => {}} /></Providers>)
    expect(await screen.findByText(/None of your watchlist, flagged or open-position names report in the next 7 days/)).toBeTruthy()
  })

  it('an empty week still carries the earnings-prep walkthrough\'s first anchor (W14-Q2)', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    stub([[/\/api\/j2\/earnings-prep\/soon$/, contractBody('earnings-prep.soon.empty')]])
    const { container } = render(<Providers><ReportingSoon onOpenNote={() => {}} /></Providers>)
    await screen.findByText(/None of your watchlist/)
    const anchors = container.querySelectorAll('[data-tour="reporting-soon-list"]')
    expect(anchors).toHaveLength(1)
    expect(anchors[0].tagName).toBe('SECTION')
    // the row steps stay absent on an empty week (the engine skips them)
    expect(container.querySelector('[data-tour="reporting-soon-when"]')).toBeNull()
  })
})

describe('the research workspace door', () => {
  const SUMMARY = {
    identity: { symbol: 'EPNV', displayName: 'EPNV Corp', entityId: null, symbols: ['EPNV'] },
    notes: [], activeTheses: [], pastTheses: [], facts: [], documents: [], tradeSummary: { openPositions: 0, closedTrades: 0 },
  }
  afterEach(() => { __resetNotebookFlags() })

  it('shows Earnings prep only while the gate is on, and a click drafts then creates', async () => {
    __resetNotebookFlags()
    stub([[/summary$/, SUMMARY]])
    const { unmount } = render(<Providers><TickerResearchWorkspace symbol="EPNV" onOpenNote={() => {}} /></Providers>)
    await screen.findByText('EPNV Corp')
    expect(screen.queryByRole('button', { name: /Earnings prep/ })).toBeNull()
    unmount()

    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    const calls = stub([
      [/summary$/, SUMMARY],
      [/\/api\/j2\/earnings-prep\/EPNV\/draft$/, DRAFT],
      [/^\/api\/j2\/notes$/, { note: { id: 'note-ws' } }],
    ])
    const onOpenNote = vi.fn()
    render(<Providers><TickerResearchWorkspace symbol="EPNV" onOpenNote={onOpenNote} /></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: /Earnings prep/ }))
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'note-ws' })))
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual(['POST /api/j2/earnings-prep/EPNV/draft', 'POST /api/j2/notes'])
  })
})

// Finish program, lane KEYS3 (Q15): earnings prep on a keyboard was 7 keys against a budget of
// 5 (which is also its floor): 2 Tabs to "Skip to notes list", Enter, then "Ask Notebook" and
// the name's research link before its prep button. The command palette's "Earnings prep"
// arrives on Research Home with "#prep", and this box puts focus on the first name's prep
// button.
describe('ReportingSoon: the "#prep" door lands on the first prep button (lane KEYS3)', () => {
  beforeEach(() => { __resetNotebookFlags(); latchNotebookFlags({ notebook_earnings_prep_enabled: true }) })
  afterEach(() => { __resetNotebookFlags() })

  it('with the door, focus goes to the first name\'s button once the list has loaded', async () => {
    stub([[/\/api\/j2\/earnings-prep\/soon$/, SOON]])
    render(<Providers route="/journal/notebook#prep"><ReportingSoon onOpenNote={() => {}} /></Providers>)
    const first = await screen.findByRole('button', { name: 'Open the EPAM prep note' })
    await waitFor(() => expect(document.activeElement).toBe(first))
  })

  it('CONTROL: without the door nothing takes focus', async () => {
    stub([[/\/api\/j2\/earnings-prep\/soon$/, SOON]])
    render(<Providers><ReportingSoon onOpenNote={() => {}} /></Providers>)
    await screen.findByRole('button', { name: 'Open the EPAM prep note' })
    await new Promise((r) => setTimeout(r, 40))
    expect(document.activeElement).toBe(document.body)
  })

  it('a week with no names: focus goes to the box\'s heading, where the reason is read', async () => {
    stub([[/\/api\/j2\/earnings-prep\/soon$/, contractBody('earnings-prep.soon.empty')]])
    render(<Providers route="/journal/notebook#prep"><ReportingSoon onOpenNote={() => {}} /></Providers>)
    const heading = await screen.findByRole('heading', { name: 'Reporting soon' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(heading.tabIndex).toBe(-1)
  })
})
