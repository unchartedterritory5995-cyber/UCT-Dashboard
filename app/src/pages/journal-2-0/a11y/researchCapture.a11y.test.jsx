// app/src/pages/journal-2-0/a11y/researchCapture.a11y.test.jsx
//
// Wave 13 lane 13G-1 (research capture) through 8A's axe harness. The home and research recipes
// run with both 13G gates OFF, so they never render these controls -- hence recipes of their own.
// Each proves its state rendered before axe runs, so an empty screen can never pass as clean:
//   * ticker-research-transcript   -- the workspace with its "Save from a transcript" door;
//   * save-transcript-passage      -- the sheet: a held call, its turns, a picked turn's editor;
//   * save-transcript-saved        -- the same sheet after a save (the citation line);
//   * save-transcript-not-held     -- no held transcript (the one help line);
//   * passed-setups                -- scored, gapped and no-bars rows + the traded count;
//   * passed-setups-empty          -- nothing yet (the help line and the add form).
import { describe, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { installFetch, Providers } from './fixtures'
import { axeSurface } from './surface'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import TickerResearchWorkspace from '../components/notebook/TickerResearchWorkspace'
import SaveTranscriptPassage from '../components/notebook/SaveTranscriptPassage'
import PassedSetups from '../components/notebook/PassedSetups'

vi.mock('../lib/offline/settleNoteWrite', () => ({ settleNoteWrite: vi.fn(async () => null) }))

const SUMMARY = {
  identity: { symbol: 'NVDA', displayName: 'NVIDIA Corporation', entityId: null, symbols: ['NVDA'] },
  notes: [{ id: 'n1', title: 'NVDA thesis', updatedAt: '2026-10-01T00:00:00Z' }],
  activeTheses: [], pastTheses: [], facts: [], documents: [],
  tradeSummary: { openPositions: 0, closedTrades: 0 },
}
const QUARTERS = { symbol: 'NVDA', source: 'FMP transcript', quarters: [
  { quarter: '2026Q2', year: 2026, q: 2, callDate: '2026-08-27', held: 'store' },
] }
const TRANSCRIPT = {
  symbol: 'NVDA', quarter: '2026Q2', year: 2026, q: 2, callDate: '2026-08-27', held: 'store', source: 'FMP transcript',
  turns: [
    { turn: 1, speaker: 'Operator', text: 'Operator: Welcome to the call.' },
    { turn: 2, speaker: 'Colette Kress', text: 'Colette Kress: Gross margin was 72.4%.' },
  ],
}
const SAVED = {
  excerpt: { id: 'ex1', documentName: 'NVDA earnings call FY2026 Q2 · 2026-08-27 · FMP transcript', pageNumber: 2 },
  note: { id: 'n1', updatedAt: 'x' }, deduped: false, turn: 2, speaker: 'Colette Kress',
}
const T_ROUTES = [
  [/\/research-capture\/transcripts\/save$/, SAVED],
  [/\/research-capture\/transcripts\/NVDA\/quarters$/, QUARTERS],
  [/\/research-capture\/transcripts\/NVDA\/2026Q2$/, TRANSCRIPT],
]

const o = (key, sessions, pct, missing = null, label = null) => ({ key, sessions, pct, missing, label })
const PASSED = {
  horizons: [1, 5, 10, 20], bestWindow: 20, tradedWithin: 10, lookbackDays: 60, tradedCount: 1,
  items: [
    { id: 'a', symbol: 'NVDA', source: 'scanner', savedDay: '2026-08-10', baseDate: '2026-08-07', status: 'scored',
      noBarsLabel: null, outcomes: [o('r1', 1, 1), o('r5', 5, 5), o('r10', 10, 10), o('r20', 20, 20), o('best20', 20, 20.5)] },
    { id: 'b', symbol: 'AMD', source: 'watchlist', savedDay: '2026-09-28', baseDate: '2026-09-26', status: 'pending',
      noBarsLabel: null, outcomes: [o('r1', 1, 0.4), o('r5', 5, null, 'missing', 'Bars missing from the store'),
        o('r10', 10, null, 'pending', 'Not yet'), o('r20', 20, null, 'pending', 'Not yet'), o('best20', 20, null, 'pending', 'Not yet')] },
    { id: 'c', symbol: 'ZZZZ', source: 'manual', savedDay: '2026-09-29', baseDate: null, status: 'no_bars',
      noBarsLabel: 'No stored daily bars for this name on or before the save', outcomes: [] },
  ],
}

describe('lane 13G-1 surfaces (research capture)', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_transcript_capture_enabled: true, notebook_passed_setups_enabled: true })
  })
  afterEach(() => __resetNotebookFlags())

  axeSurface('ticker-research-transcript', async () => {
    installFetch([[/^\/api\/j2\/notes\/research\/[^/]+\/summary$/, SUMMARY]])
    render(<Providers><TickerResearchWorkspace symbol="NVDA" onOpenNote={() => {}} /></Providers>)
    await screen.findByText('NVIDIA Corporation')
    screen.getByRole('button', { name: /Save from a transcript/ })
  }, { level: 'page' })

  axeSurface('save-transcript-passage', async () => {
    installFetch(T_ROUTES)
    render(<Providers><SaveTranscriptPassage open onClose={() => {}} symbol="NVDA"
      notes={SUMMARY.notes} /></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: 'Quote from turn 2' }))
    screen.getByLabelText(/Passage from turn 2/)
    screen.getByRole('combobox', { name: 'Destination note' })
  })

  axeSurface('save-transcript-saved', async () => {
    installFetch(T_ROUTES)
    render(<Providers><SaveTranscriptPassage open onClose={() => {}} symbol="NVDA"
      notes={SUMMARY.notes} /></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: 'Quote from turn 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save passage' }))
    await screen.findByText(/Cited as/)
  })

  axeSurface('save-transcript-not-held', async () => {
    installFetch([[/\/research-capture\/transcripts\/NVDA\/quarters$/, { ...QUARTERS, quarters: [] }]])
    render(<Providers><SaveTranscriptPassage open onClose={() => {}} symbol="NVDA" notes={[]} /></Providers>)
    await screen.findByText(/does not hold a NVDA call transcript yet/)
  })

  axeSurface('passed-setups', async () => {
    installFetch([[/^\/api\/j2\/research-capture\/passed-setups$/, PASSED]])
    render(<Providers><PassedSetups /></Providers>)
    await screen.findByText('$NVDA')
    screen.getByText('Bars missing from the store')
    screen.getByText(/No stored daily bars/)
    screen.getByRole('note')
  })

  axeSurface('passed-setups-empty', async () => {
    installFetch([[/^\/api\/j2\/research-capture\/passed-setups$/, { ...PASSED, tradedCount: 0, items: [] }]])
    render(<Providers><PassedSetups /></Providers>)
    await screen.findByText(/Nothing here yet/)
  })
})
