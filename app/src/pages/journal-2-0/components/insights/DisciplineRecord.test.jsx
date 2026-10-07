// Wave 13 lane 13A — the discipline record. R3's sample wording is asserted by RENDERED TEXT:
// under 10 "too few to judge" (the rate behind a reveal), 10-24 "thin sample" with a range,
// 25+ shown plainly.
//
// CONTRACT: every record here is the one the SERVER really sends
// (`__fixtures__/contract`, written by tools/notebook_contract_fixtures.py). The sampled record
// is thirty closed trades, twelve of them planned, so all three bands appear in one answer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import DisciplineRecord, { RateCell } from './DisciplineRecord'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { contractBody, contractResponse } from '../../__fixtures__/contract'

const sampled = () => contractBody('plan-grades.discipline.sampled')
const windowOf = (size) => sampled().windows.find((w) => w.size === size)

let answer
beforeEach(() => {
  answer = () => contractResponse('plan-grades.discipline.sampled')
  global.fetch = vi.fn(async () => answer())
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

  it('the recorded answer carries all three sample bands (non-vacuity)', () => {
    const bands = new Set()
    for (const w of sampled().windows) for (const k of ['planRate', 'entry', 'stop', 'size_', 'followedPlan']) bands.add(w[k].band)
    expect([...bands].sort()).toEqual(['normal', 'thin', 'too_few'])
  })

  it('words each rate by its sample size (R3)', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    renderIt()
    await screen.findByText('Discipline record')
    // Last 20: six planned of twenty. The plan rate is a thin sample with its range; every
    // check has six graded trades, which is too few to judge.
    expect(screen.getByText('20 closed trades: 6 planned, 14 unplanned.')).toBeTruthy()
    expect(windowOf(20).planRate).toMatchObject({ band: 'thin', k: 6, n: 20, range: [0.145, 0.519] })
    // 0.145 is 14.4999… as a float, so it reads 14%, in the client and in Python alike.
    expect(screen.getByText(/\(6 of 20\) · thin sample, likely 14% to 52%/)).toBeTruthy()
    expect(screen.getAllByText('too few to judge').length).toBeGreaterThanOrEqual(4)
    expect(String(global.fetch.mock.calls[0][0])).toBe('/api/j2/plan-grades/discipline?accountId=acct-1')
  })

  it('switches between the last 20 and the last 60', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    renderIt()
    await screen.findByText(/6 planned/)
    await userEvent.click(screen.getByRole('button', { name: 'Last 60' }))
    // Last 60 holds all thirty: the plan rate is a normal sample and is shown plainly.
    expect(screen.getByText('30 closed trades: 12 planned, 18 unplanned.')).toBeTruthy()
    expect(windowOf(60).planRate).toMatchObject({ band: 'normal', k: 12, n: 30, rate: 0.4 })
    expect(screen.getByText('40%')).toBeTruthy()
    expect(screen.getByText('(12 of 30)')).toBeTruthy()
    // Entry: eight of twelve, a thin sample with the server's range.
    expect(windowOf(60).entry).toMatchObject({ band: 'thin', k: 8, n: 12, range: [0.391, 0.862] })
    expect(screen.getByText(/\(8 of 12\) · thin sample, likely 39% to 86%/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Last 60' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('says how often price reached the target without the exit taking it', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    renderIt()
    await screen.findByText(/6 planned/)
    expect(windowOf(20).target.reachedNotTaken).toBe(0)
    expect(screen.queryByText(/reached your target/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Last 60' }))
    expect(windowOf(60).target.reachedNotTaken).toBe(3)
    expect(screen.getByText('Price reached your target 3 times without the exit taking it.')).toBeTruthy()
  })

  it('a member with no closed trades is told how to start, not shown a table of zeros', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    answer = () => contractResponse('plan-grades.discipline.empty')
    renderIt()
    expect(await screen.findByText(
      'Close a trade to start your record. Each one is checked against the plan you wrote before it.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a failed read says so and offers Try again; it is never the empty state', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    answer = () => contractResponse('plan-grades.discipline.signed-out')
    renderIt()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t load your discipline record.')
    expect(screen.queryByText(/Close a trade to start your record/)).toBeNull()
    answer = () => contractResponse('plan-grades.discipline.sampled')
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/6 planned/)).toBeTruthy()
  })

  it('counts options the server says it did not grade', async () => {
    // The recorded member holds no option trade. One scalar is overridden on the real record.
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    answer = () => {
      const record = sampled()
      record.windows[0].options = 1
      return { ok: true, status: 200, json: async () => record }
    }
    renderIt()
    expect(await screen.findByText(/, 1 option \(not graded yet\)\./)).toBeTruthy()
  })

  it('keeps a too-few rate behind a reveal', () => {
    const stat = windowOf(20).entry                             // four of six: too few to judge
    expect(stat).toMatchObject({ band: 'too_few', k: 4, n: 6 })
    render(<RateCell stat={stat} />)
    const summary = screen.getByText('too few to judge')
    expect(summary.closest('details')).toBeTruthy()
    expect(screen.getByText(/67% \(4 of 6\)/)).toBeTruthy()
  })

  it('a check with no graded trade says so instead of printing a rate', () => {
    const stat = windowOf(20).target.hitRate                    // n is 0: the overnight job has not run
    expect(stat).toMatchObject({ n: 0, rate: null })
    render(<RateCell stat={stat} />)
    expect(screen.getByText('no graded trades')).toBeTruthy()
  })
})
