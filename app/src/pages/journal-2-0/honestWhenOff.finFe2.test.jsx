// Finish program, lane FE2, findings P7 and P9 (frontend halves) — say plainly what is missing
// and why, and never point at a door the member cannot open.
//
//  P7a  review drafts ON, plan grading OFF: the draft had no discipline part and said nothing,
//       while the Insights box promised "the discipline record".
//  P7b  setups board ON, chart plan OFF: the empty line said "Draw an entry line on a chart in a
//       plan note", which needs the chart plan panel that is switched off.
//  P9   "Find more like this" on an Example card said "this one is matched tonight"; the
//       overnight run leaves sample charts out by design.
// Each surface reads the SAME latched flags object its components already read.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { latchNotebookFlags, __resetNotebookFlags } from './lib/offline/notebookFlags'
import { buildDraftBlocks } from './lib/reviewDrafts'
import { ReviewDraftsSection } from './components/insights/InsightsHub'
import { emptyBoardText } from './components/notebook/SetupsBoard'
import BoardCard from './components/notebook/BoardCard'
import SimilarNames from './components/notebook/SimilarNames'

vi.mock('../../components/StockChart', () => ({ default: () => null }))

const wrap = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <MemoryRouter>{children}</MemoryRouter>
  </SWRConfig>
)
const textOf = (blocks) => JSON.stringify(blocks)
const realFetch = global.fetch
beforeEach(() => { __resetNotebookFlags() })
afterEach(() => { __resetNotebookFlags(); global.fetch = realFetch; vi.restoreAllMocks() })

const AGG = { trades: 3, wins: 2, losses: 1, win_rate: 0.66, avg_r: 0.5, net_pnl_dollar: 120, profit_factor: 1.4 }

describe('P7a — a review draft without plan grading', () => {
  it('the draft itself says the discipline record is not in it, and why (it used to say nothing)', () => {
    const t = textOf(buildDraftBlocks({ aggregates: AGG, discipline: null }))
    expect(t).toContain('Discipline record')
    expect(t).toContain('Not in this draft. The discipline record comes from plan grading, which is not switched on for your account.')
    expect(t).not.toContain('Plan rate:')                      // never a row of zeros
  })

  it('CONTROL — with grading on the real section is there and that sentence is not', () => {
    const t = textOf(buildDraftBlocks({ aggregates: AGG, discipline: { plannedCount: 2, unplannedCount: 1 } }))
    expect(t).toContain('Planned: 2')
    expect(t).not.toContain('Not in this draft')
  })

  it('the Insights box does not promise the discipline record while grading is off, and says why', () => {
    latchNotebookFlags({ notebook_review_drafts_enabled: true, notebook_plan_grading_enabled: false })
    render(<ReviewDraftsSection accountId="a1" />, { wrapper: wrap })
    const box = screen.getByTestId('review-drafts-section')
    expect(box.textContent).not.toMatch(/drafts the trades and P&L, the discipline record/)
    expect(box.textContent).toContain('The discipline record is left out: it comes from plan grading, which is not switched on for your account.')
  })

  it('CONTROL — with grading on the box promises it and carries no such sentence', () => {
    latchNotebookFlags({ notebook_review_drafts_enabled: true, notebook_plan_grading_enabled: true })
    render(<ReviewDraftsSection accountId="a1" />, { wrapper: wrap })
    const box = screen.getByTestId('review-drafts-section')
    expect(box.textContent).toContain('the discipline record')
    expect(box.textContent).not.toContain('is left out')
  })
})

describe('P7b — the setups board without the chart plan', () => {
  it('with the chart plan on, the empty line tells the member how to make a setup', () => {
    expect(emptyBoardText({ chartPlanOn: true })).toMatch(/Draw an entry line on a chart in a plan note/)
  })

  it('with it off, the line names no step the member cannot take, and says what is missing', () => {
    const t = emptyBoardText({ chartPlanOn: false })
    expect(t).not.toMatch(/Draw an entry line/)
    expect(t).toBe('No open setups yet. A setup comes from a chart whose lines are marked as the entry and the stop, and marking lines is not switched on for your account.')
  })
})

describe('P9 — an Example card and "Find more like this"', () => {
  const card = (example) => ({
    noteId: 'n1', symbol: 'MSFT', noteTitle: 'Example plan', similarEmbedKey: 'ex-plan', example,
    entry: 100, stop: 95, lastClose: 99, distancePct: 1, daysSincePlan: 2, setupTag: 'Flat Base Breakout',
  })
  const renderCard = (c) => render(<ul><BoardCard card={c} mounted={false} onBarsReady={() => {}} onFindSimilar={vi.fn()} /></ul>, { wrapper: wrap })

  it('an Example card does not offer it, and says examples are not matched', () => {
    renderCard(card(true))
    expect(screen.queryByRole('button', { name: 'Find more like MSFT' })).toBeNull()
    expect(screen.getByText('Examples are not matched against the day’s names.')).toBeInTheDocument()
  })

  it('CONTROL — the member’s own card still offers it', () => {
    renderCard(card(false))
    expect(screen.getByRole('button', { name: 'Find more like MSFT' })).toBeInTheDocument()
    expect(screen.queryByText(/Examples are not matched/)).toBeNull()
  })

  it('opened on an example anyway (a saved link), the sheet does not promise a match tonight', async () => {
    latchNotebookFlags({ notebook_find_similar_enabled: true })
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ status: 'pending', template: { symbol: 'MSFT', setupTag: 'Flat Base Breakout' } }) }))
    render(<SimilarNames noteId="n1" embedKey="ex-plan" example />, { wrapper: wrap })
    expect(await screen.findByText('This is an example chart. Examples are not matched; tag one of your own charts with a setup and it is matched in the nightly run.')).toBeInTheDocument()
    expect(screen.queryByText(/this one is matched tonight/)).toBeNull()
  })

  it('CONTROL — the member’s own pending chart keeps the "matched tonight" sentence', async () => {
    latchNotebookFlags({ notebook_find_similar_enabled: true })
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ status: 'pending', template: { symbol: 'AMD', setupTag: 'VCP' } }) }))
    render(<SimilarNames noteId="n2" embedKey="e2" />, { wrapper: wrap })
    expect(await screen.findByText(/this one is matched tonight/)).toBeInTheDocument()
  })
})
