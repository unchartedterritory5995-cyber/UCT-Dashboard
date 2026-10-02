// Wave 13 lane 13C -- Reporting soon on Research Home, and the research workspace's door.
//
//   * DARK: with the gate off the section renders nothing and fetches NOTHING.
//   * NO NOTE WITHOUT A CLICK: rendering the list issues one GET; no draft, no create, until a
//     member presses Create prep note -- then exactly one draft and one create, and the new
//     note is opened.
//   * A FAILED READ IS SAID, never shown as a quiet week; the empty week has its one help line.
//   * The research workspace shows Earnings prep only while the gate is on.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../lib/offline/settleNoteWrite', () => ({ settleNoteWrite: vi.fn(async () => {}) }))

import ReportingSoon from './ReportingSoon'
import TickerResearchWorkspace from './TickerResearchWorkspace'
import { Providers } from '../../a11y/fixtures'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

const SOON = {
  windowDays: 7, today: '2026-10-02', partial: false, items: [
    { symbol: 'NVDA', date: '2026-10-05', daysAway: 3, timing: 'amc', sources: ['positions'], prepNote: null },
    { symbol: 'AMD', date: '2026-10-02', daysAway: 0, timing: null, sources: ['watchlist', 'flagged'],
      prepNote: { id: 'n-amd', title: 'Earnings Prep — AMD' } },
  ],
}
const DRAFT = {
  symbol: 'NVDA', frozenAt: '2026-10-02T14:00:00Z',
  report: { date: { value: '2026-10-05', source: 'UCT earnings calendar', asOf: null, missing: null },
    timing: { value: 'amc', source: 'UCT earnings calendar', asOf: null, missing: null } },
}

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
      [/\/api\/j2\/earnings-prep\/NVDA\/draft$/, DRAFT],
      [/^\/api\/j2\/notes$/, { note: { id: 'note-new' } }],
    ])
    const onOpenNote = vi.fn()
    render(<Providers><ReportingSoon onOpenNote={onOpenNote} /></Providers>)
    const create = await screen.findByRole('button', { name: 'Create prep note for NVDA' })
    expect(screen.getByText('Mon, Oct 5, after the close')).toBeTruthy()
    expect(screen.getByText('Today, time not announced yet')).toBeTruthy()
    expect(screen.getByText('Open position')).toBeTruthy()
    // rendering read the list and nothing else
    expect(calls).toEqual(['GET /api/j2/earnings-prep/soon'])

    fireEvent.click(create)
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'note-new' })))
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([
      'POST /api/j2/earnings-prep/NVDA/draft', 'POST /api/j2/notes',
    ])
  })

  it('a name already prepped opens that note instead of drafting another', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    const calls = stub([[/\/api\/j2\/earnings-prep\/soon$/, SOON]])
    const onOpenNote = vi.fn()
    render(<Providers><ReportingSoon onOpenNote={onOpenNote} /></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: 'Open the AMD prep note' }))
    expect(onOpenNote).toHaveBeenCalledWith({ id: 'n-amd' })
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([])
  })

  it('a refused draft says the server sentence and creates nothing', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    const sentence = "You've drafted 20 earnings prep notes today, the daily limit. It resets at midnight Eastern."
    const calls = stub([
      [/\/api\/j2\/earnings-prep\/soon$/, SOON],
      [/\/draft$/, [429, { detail: sentence }]],
    ])
    render(<Providers><ReportingSoon onOpenNote={() => {}} /></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: 'Create prep note for NVDA' }))
    expect((await screen.findByRole('alert')).textContent).toBe(sentence)
    expect(calls).not.toContain('POST /api/j2/notes')
  })

  it('a failed read is said, never shown as a quiet week', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    stub([[/\/api\/j2\/earnings-prep\/soon$/, [500, {}]]])
    render(<Providers><ReportingSoon onOpenNote={() => {}} /></Providers>)
    expect(await screen.findByText(/the earnings calendar for your names/)).toBeTruthy()
    expect(screen.queryByText(/report in the next/)).toBeNull()
  })

  it('an empty week carries its one help line', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    stub([[/\/api\/j2\/earnings-prep\/soon$/, { ...SOON, items: [] }]])
    render(<Providers><ReportingSoon onOpenNote={() => {}} /></Providers>)
    expect(await screen.findByText(/None of your watchlist, flagged or open-position names report in the next 7 days/)).toBeTruthy()
  })
})

describe('the research workspace door', () => {
  const SUMMARY = {
    identity: { symbol: 'NVDA', displayName: 'NVIDIA Corporation', entityId: null, symbols: ['NVDA'] },
    notes: [], activeTheses: [], pastTheses: [], facts: [], documents: [], tradeSummary: { openPositions: 0, closedTrades: 0 },
  }
  afterEach(() => { __resetNotebookFlags() })

  it('shows Earnings prep only while the gate is on, and a click drafts then creates', async () => {
    __resetNotebookFlags()
    stub([[/summary$/, SUMMARY]])
    const { unmount } = render(<Providers><TickerResearchWorkspace symbol="NVDA" onOpenNote={() => {}} /></Providers>)
    await screen.findByText('NVIDIA Corporation')
    expect(screen.queryByRole('button', { name: /Earnings prep/ })).toBeNull()
    unmount()

    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
    const calls = stub([
      [/summary$/, SUMMARY],
      [/\/api\/j2\/earnings-prep\/NVDA\/draft$/, DRAFT],
      [/^\/api\/j2\/notes$/, { note: { id: 'note-ws' } }],
    ])
    const onOpenNote = vi.fn()
    render(<Providers><TickerResearchWorkspace symbol="NVDA" onOpenNote={onOpenNote} /></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: /Earnings prep/ }))
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'note-ws' })))
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual(['POST /api/j2/earnings-prep/NVDA/draft', 'POST /api/j2/notes'])
  })
})
