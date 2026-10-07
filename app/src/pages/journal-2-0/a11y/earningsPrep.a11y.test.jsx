// app/src/pages/journal-2-0/a11y/earningsPrep.a11y.test.jsx
//
// Wave 13 lane 13C (earnings prep) through 8A's axe harness. The home and research recipes run
// with notebook_earnings_prep_enabled OFF, so they never render these controls -- hence recipes
// of their own here rather than a `coveredBy` entry that would be untrue. Each proves its state
// rendered before axe runs, so an empty screen can never pass as a clean one:
//   * reporting-soon                 -- two names, one already prepped, the partial-calendar note;
//   * reporting-soon-empty           -- no name reports this week (the one help line);
//   * reporting-soon-refused         -- the daily cap's sentence after a click (role=alert);
//   * ticker-research-earnings-prep  -- the research workspace with its Earnings prep button.
import { describe, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { installFetch, Providers } from './fixtures'
import { axeSurface } from './surface'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import ReportingSoon from '../components/notebook/ReportingSoon'
import TickerResearchWorkspace from '../components/notebook/TickerResearchWorkspace'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

const SOON = {
  windowDays: 7, today: '2026-10-02', partial: true, source: 'UCT earnings calendar', asOf: '2026-10-02T13:00:00Z',
  items: [
    { symbol: 'NVDA', date: '2026-10-05', daysAway: 3, timing: 'amc', sources: ['positions', 'watchlist'], prepNote: null },
    { symbol: 'AMD', date: '2026-10-06', daysAway: 4, timing: null, sources: ['flagged'],
      prepNote: { id: 'n-prep', title: 'Earnings Prep — AMD', createdAt: '2026-10-01T12:00:00Z' } },
  ],
}

const SUMMARY = {
  identity: { symbol: 'NVDA', displayName: 'NVIDIA Corporation', entityId: null, symbols: ['NVDA'] },
  notes: [], activeTheses: [], pastTheses: [], facts: [], documents: [],
  tradeSummary: { openPositions: 0, closedTrades: 0 },
}

describe('lane 13C surfaces (earnings prep)', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_earnings_prep_enabled: true })
  })
  afterEach(() => __resetNotebookFlags())

  axeSurface('reporting-soon', async () => {
    installFetch([[/^\/api\/j2\/earnings-prep\/soon$/, SOON]])
    render(<Providers><ReportingSoon onOpenNote={() => {}} /></Providers>)
    await screen.findByRole('button', { name: 'Create prep note for NVDA' })
    screen.getByRole('button', { name: 'Open the AMD prep note' })
    screen.getByRole('note')
  })

  axeSurface('reporting-soon-empty', async () => {
    installFetch([[/^\/api\/j2\/earnings-prep\/soon$/, { ...SOON, partial: false, items: [] }]])
    render(<Providers><ReportingSoon onOpenNote={() => {}} /></Providers>)
    await screen.findByText(/report in the next 7 days/)
  })

  axeSurface('reporting-soon-refused', async () => {
    installFetch([
      [/^\/api\/j2\/earnings-prep\/soon$/, { ...SOON, partial: false }],
      [/^\/api\/j2\/earnings-prep\/NVDA\/draft$/, [429, { detail: "You've drafted 20 earnings prep notes today, the daily limit. It resets at midnight Eastern." }]],
    ])
    render(<Providers><ReportingSoon onOpenNote={() => {}} /></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: 'Create prep note for NVDA' }))
    await screen.findByRole('alert')
    await settle()
  })

  axeSurface('ticker-research-earnings-prep', async () => {
    installFetch([[/^\/api\/j2\/notes\/research\/[^/]+\/summary$/, SUMMARY]])
    render(<Providers><TickerResearchWorkspace symbol="NVDA" onOpenNote={() => {}} /></Providers>)
    await screen.findByText('NVIDIA Corporation')
    screen.getByRole('button', { name: /Earnings prep/ })
  }, { level: 'page' })
})
