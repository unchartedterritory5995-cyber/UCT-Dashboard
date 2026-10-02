// Wave 13 lane 13A — the discipline record. R3's sample wording is asserted by RENDERED TEXT:
// under 10 "too few to judge" (the rate behind a reveal), 10-24 "thin sample" with a range,
// 25+ shown plainly.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import DisciplineRecord, { RateCell } from './DisciplineRecord'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

const stat = (k, n, band, range = null) => ({ k, n, rate: n ? k / n : null, band, range,
  wording: { too_few: 'too few to judge', thin: 'thin sample', normal: null }[band] })

const win = (size, over = {}) => ({
  size, trades: size, equity: size - 1, options: 1, planned: 12, unplanned: 6, needsPick: 0,
  planRate: stat(12, 18, 'thin', [0.44, 0.84]), editedAfterEntry: 1,
  entry: stat(5, 6, 'too_few'), stop: stat(10, 12, 'thin', [0.55, 0.95]), size_: stat(26, 30, 'normal'),
  target: { hit: 2, reachedNotTaken: 3, notReached: 4, unknown: 0, hitRate: stat(2, 9, 'too_few') },
  followedPlan: stat(4, 12, 'thin', [0.14, 0.61]),
  ...over,
})

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ windows: [win(20), win(60, { planned: 40 })] }) }))
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

const renderIt = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><DisciplineRecord accountId="acct-1" /></SWRConfig>,
)

describe('DisciplineRecord', () => {
  it('renders nothing and fetches nothing while the gate is off', () => {
    const { container } = renderIt()
    expect(container.textContent).toBe('')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('words each rate by its sample size (R3)', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    renderIt()
    await screen.findByText('Discipline record')
    expect(screen.getAllByText('too few to judge').length).toBe(2)
    expect(screen.getByText(/thin sample, likely 55% to 95%/)).toBeTruthy()
    expect(screen.getByText('87%')).toBeTruthy()     // 26 of 30, normal
    expect(screen.getByText(/1 option \(not graded yet\)/)).toBeTruthy()
    expect(screen.getByText(/reached your target 3 times without the exit taking it/)).toBeTruthy()
    expect(String(global.fetch.mock.calls[0][0])).toBe('/api/j2/plan-grades/discipline?accountId=acct-1')
  })

  it('switches between the last 20 and the last 60', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    renderIt()
    await screen.findByText(/12 planned/)
    await userEvent.click(screen.getByRole('button', { name: 'Last 60' }))
    expect(screen.getByText(/40 planned/)).toBeTruthy()
  })

  it('keeps a too-few rate behind a reveal', () => {
    render(<RateCell stat={stat(2, 3, 'too_few')} />)
    const summary = screen.getByText('too few to judge')
    expect(summary.closest('details')).toBeTruthy()
    expect(screen.getByText(/67% \(2 of 3\)/)).toBeTruthy()
  })
})
