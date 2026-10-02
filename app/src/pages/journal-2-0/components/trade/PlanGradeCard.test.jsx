// Wave 13 lane 13A — the Plan vs execution card. A fake server answers the plan-grade routes,
// so a card that never sends the request cannot pass on rendering alone.
// ⛔ Feedback is asserted by RENDERED TEXT, never by a state transition.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'
import PlanGradeCard from './PlanGradeCard'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

const PLANNED = {
  tradeId: 't1', tradeRef: 'id:t1', symbol: 'NVDA', side: 'Long', status: 'planned', dateOnly: false,
  plan: { entry: 100, stop: 96, target: 120, shares: 100, source: 'text', sourceLabel: 'Plan note',
    matchTier: 'window', noteId: 'n1', noteTitle: 'NVDA plan', matchedAt: '2026-09-15T00:00:00Z',
    relinkedAt: null, roles: {} },
  checks: {
    r: 4,
    entry: { state: 'kept', planned: 100, actual: 100.5, chaseR: 0.125, deltaPct: 0.005, tolerance: 1 },
    stop: { state: 'missed', planned: 96, limit: 95, exit: 94.5, exitVsStopR: -0.375 },
    size: { state: 'missed', planned: 100, actual: 150, deltaPct: 0.5 },
    target: { state: 'reached_not_taken', planned: 120, hitLine: 119, exit: 94.5, mfePrice: 121 },
    followedPlan: false,
  },
  labels: ['stop_from_plan', 'date_only'],
  setupChip: { setup: 'Breakout' },
  candidates: [{ kind: 'note', id: 'n2', title: 'Other plan', tier: 'window', plan: { entry: 101, stop: 97 }, editedAfterEntry: false }],
}

let calls
let answer
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  calls = []
  answer = { get: () => json(PLANNED), relink: () => json({ ...PLANNED, plan: { ...PLANNED.plan, noteId: 'n2', noteTitle: 'Other plan', relinkedAt: 'x' } }) }
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null })
    if (String(url).endsWith('/relink')) return answer.relink()
    return answer.get()
  })
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

const renderCard = (props = {}) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <MemoryRouter><PlanGradeCard tradeId="t1" trade={{ id: 't1', symbol: 'NVDA' }} {...props} /></MemoryRouter>
  </SWRConfig>,
)

describe('PlanGradeCard', () => {
  it('renders nothing and fetches nothing while the gate is off', () => {
    const { container } = renderCard()
    expect(container.textContent).toBe('')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('words the four checks from the server grade', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    renderCard()
    expect(await screen.findByText('Plan vs execution')).toBeTruthy()
    await screen.findByText('Kept')
    expect(screen.getByText('Not honoured')).toBeTruthy()
    expect(screen.getByText('Oversized')).toBeTruthy()
    expect(screen.getByText('Reached, not taken')).toBeTruthy()
    expect(screen.getByText(/Planned 100\.00 · filled 100\.50 \(\+0\.13R\)/)).toBeTruthy()
    expect(screen.getByText(/Planned 100 · entered 150 \(\+50\.0%\)/)).toBeTruthy()
    expect(screen.getByText(/Your broker sent no stop/)).toBeTruthy()
    expect(screen.getByText(/judged by day/)).toBeTruthy()
    expect(screen.getByText(/Editing the plan does not change this grade/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'NVDA plan' }).getAttribute('href')).toContain('note=n1')
    expect(calls[0].url).toBe('/api/j2/plan-grades/trades/t1')
  })

  it('labels an unplanned trade and does not hide it', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    answer.get = () => json({ ...PLANNED, status: 'unplanned', plan: null, checks: null, labels: [], candidates: [] })
    renderCard()
    expect(await screen.findByTestId('plan-grade-unplanned')).toBeTruthy()
    expect(screen.getByText(/No plan for this trade was written before entry/)).toBeTruthy()
  })

  it('a tie asks the member to pick, and the pick is sent as a Re-link', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    answer.get = () => json({ ...PLANNED, status: 'needs_pick', plan: null, checks: null, labels: [],
      candidates: [{ kind: 'note', id: 'a', title: 'Plan A', plan: { entry: 100, stop: 95 } },
        { kind: 'note', id: 'b', title: 'Plan B', plan: { entry: 101, stop: 96 } }] })
    renderCard()
    await screen.findByText(/More than one plan could be this trade/)
    await userEvent.click(screen.getByRole('button', { name: /Plan B/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.body?.noteId === 'b')).toBe(true))
    expect(await screen.findByRole('link', { name: 'Other plan' })).toBeTruthy()
  })

  it('Re-link lists the candidates and says when it has replaced the plan', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: 'Re-link' }))
    await userEvent.click(screen.getByRole('button', { name: /Other plan/ }))
    expect(await screen.findByText(/then re-linked by you/)).toBeTruthy()
    expect(calls.find((c) => c.method === 'POST').url).toBe('/api/j2/plan-grades/trades/t1/relink')
  })

  it('a failed Re-link says so in words', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    answer.relink = () => json({ detail: 'That note names no entry, stop, target or shares' }, 400)
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: 'Re-link' }))
    await userEvent.click(screen.getByRole('button', { name: /Other plan/ }))
    expect(await screen.findByText('That note names no entry, stop, target or shares')).toBeTruthy()
  })

  it('a failed read is an error with a retry, never an "unplanned"', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    answer.get = () => json({ detail: 'boom' }, 500)
    renderCard()
    expect(await screen.findByText(/Couldn’t load the plan grade/)).toBeTruthy()
    expect(screen.queryByTestId('plan-grade-unplanned')).toBeNull()
  })

  it('the setup chip tags the trade through the page’s own write', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    const onTagSetup = vi.fn(async () => {})
    renderCard({ onTagSetup })
    await userEvent.click(await screen.findByTestId('plan-setup-chip'))
    expect(onTagSetup).toHaveBeenCalledWith('Breakout')
  })

  it('Write review note hands the grade to the page’s door', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    const onWriteReview = vi.fn(async () => ({ id: 'review-1' }))
    const onOpenNote = vi.fn()
    renderCard({ onWriteReview, onOpenNote })
    await userEvent.click(await screen.findByRole('button', { name: 'Write review note' }))
    expect(onWriteReview).toHaveBeenCalledWith(expect.objectContaining({ status: 'planned' }), expect.objectContaining({ id: 't1' }))
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith('review-1'))
  })
})
