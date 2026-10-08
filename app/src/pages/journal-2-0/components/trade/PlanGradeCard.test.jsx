// Wave 13 lane 13A — the Plan vs execution card. A fake server answers the plan-grade routes,
// so a card that never sends the request cannot pass on rendering alone.
// ⛔ Feedback is asserted by RENDERED TEXT, never by a state transition.
//
// CONTRACT: every answer the fake server gives is the one the REAL server gives
// (`__fixtures__/contract`, written by tools/notebook_contract_fixtures.py and held current by
// tests/test_notebook_contract_fixtures.py). Nothing here types a grade by hand. If one of these
// goes red after a regeneration, the server and the card disagree about a shape: report both,
// do not patch either to make it pass.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'
import PlanGradeCard from './PlanGradeCard'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { contract, contractBody, contractResponse } from '../../__fixtures__/contract'

let calls
let answer
beforeEach(() => {
  calls = []
  answer = { get: () => contractResponse('plan-grades.trade.planned'), relink: () => contractResponse('plan-grades.relink.note') }
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null })
    if (String(url).endsWith('/relink')) return answer.relink()
    return answer.get()
  })
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

const on = () => latchNotebookFlags({ notebook_plan_grading_enabled: true })
const renderCard = (props = {}) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <MemoryRouter>
      <PlanGradeCard tradeId="pg-planned" trade={{ id: 'pg-planned', symbol: 'PGNV' }} {...props} />
    </MemoryRouter>
  </SWRConfig>,
)
const check = (key) => within(document.querySelector(`[data-check="${key}"]`))

describe('PlanGradeCard', () => {
  it('renders nothing and fetches nothing while the gate is off', () => {
    const { container } = renderCard()
    expect(container.textContent).toBe('')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('words the four checks from the server grade', async () => {
    on()
    renderCard()
    expect(await screen.findByText('Plan vs execution')).toBeTruthy()
    await screen.findByText('Kept')
    expect(check('entry').getByText('Kept')).toBeTruthy()
    expect(check('stop').getByText('Not honoured')).toBeTruthy()
    expect(check('size').getByText('Oversized')).toBeTruthy()
    expect(check('target').getByText('—')).toBeTruthy()          // the best price is computed overnight
    expect(screen.getByText('Planned 100.00 · filled 100.50 (+0.13R)')).toBeTruthy()
    expect(screen.getByText('Stop 96.00 · exit 94.50 · line 95.00')).toBeTruthy()
    expect(screen.getByText('Planned 100 · entered 150 (+50.0%)')).toBeTruthy()
    expect(screen.getByText('Target 120.00 · the best price reached is computed overnight.')).toBeTruthy()
    expect(screen.getByText('Frozen when it was first matched. Editing the plan does not change this grade.')).toBeTruthy()
    // The source line: what kind of plan, how it was matched, a link to it, and the size of 1R.
    const source = document.querySelector('[data-tour="plan-grade-source"]')
    expect(source.textContent).toBe('Plan note · linked to this trade · PGNV plan · 1R = 4.00')
    expect(screen.getByRole('link', { name: 'PGNV plan' }).getAttribute('href')).toContain('note=pg-note-plan')
    expect(calls[0].url).toBe(contract('plan-grades.trade.planned')._contract.path)
  })

  it('words a target that was reached and not taken, and says the trade is judged by day', async () => {
    on()
    answer.get = () => contractResponse('plan-grades.trade.drawn-plan')
    renderCard({ tradeId: 'pg-drawn', trade: { id: 'pg-drawn', symbol: 'PGDR' } })
    expect(await screen.findByText('Reached, not taken')).toBeTruthy()
    expect(screen.getByText('Target 120.00 · exit 104.00 · best 121.00')).toBeTruthy()
    expect(check('stop').getByText('Honoured')).toBeTruthy()
    // The drawn plan names no share count: the size check is not graded, in words.
    expect(check('size').getByText('No planned shares.')).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'About this grade' })).getByText('Entry time unknown, so it is judged by day')).toBeTruthy()
    expect(document.querySelector('[data-tour="plan-grade-source"]').textContent)
      .toBe('Chart plan · written before entry · PGDR plan · 1R = 4.00')
  })

  it('says the stop is the plan’s when the broker sent a placeholder', async () => {
    on()
    answer.get = () => contractResponse('plan-grades.trade.placeholder-stop')
    renderCard({ tradeId: 'pg-placeholder', trade: { id: 'pg-placeholder', symbol: 'PGPH' } })
    expect(await screen.findByText('Your broker sent no stop, so the stop is your plan’s')).toBeTruthy()
    expect(screen.getByText('Stop 192.00 · exit 210.00 · line 190.00')).toBeTruthy()
    expect(screen.getByText('Planned 50 · entered 100 (+100.0%)')).toBeTruthy()
  })

  it('labels an unplanned trade and does not hide it', async () => {
    on()
    answer.get = () => contractResponse('plan-grades.trade.unplanned')
    renderCard({ tradeId: 'pg-unplanned', trade: { id: 'pg-unplanned', symbol: 'PGUN' } })
    expect(await screen.findByTestId('plan-grade-unplanned')).toBeTruthy()
    expect(screen.getByText(/No plan for this trade was written before entry/)).toBeTruthy()
    // No plan notes in the window either: Link a plan says so instead of an empty list.
    await userEvent.click(screen.getByRole('button', { name: 'Link a plan' }))
    expect(screen.getByText('No plan notes on PGUN from the 30 days before entry. Link one from the note itself.')).toBeTruthy()
  })

  it('a tie asks the member to pick, and the pick is sent as a Re-link', async () => {
    on()
    answer.get = () => contractResponse('plan-grades.trade.needs-pick')
    answer.relink = () => contractResponse('plan-grades.relink.pick')
    renderCard({ tradeId: 'pg-pick', trade: { id: 'pg-pick', symbol: 'PGPK' } })
    await screen.findByText(/More than one plan could be this trade/)
    expect(screen.getByRole('button', { name: /First plan/ }).textContent).toContain('Entry 100.00 · Stop 96.00')
    await userEvent.click(screen.getByRole('button', { name: /Other plan/ }))
    const sent = contract('plan-grades.relink.pick')._contract.requestBody
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.body?.noteId === sent.noteId)).toBe(true))
    expect(calls.find((c) => c.method === 'POST').body).toEqual(sent)
    expect(await screen.findByRole('link', { name: 'Other plan' })).toBeTruthy()
    expect(screen.getByText('Linked to “Other plan”. The grade above is for that plan.')).toBeTruthy()
    expect(document.querySelector('[data-tour="plan-grade-source"]').textContent).toContain('chosen by you')
  })

  it('Re-link lists the candidates and says when it has replaced the plan', async () => {
    on()
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: 'Re-link' }))
    await userEvent.click(screen.getByRole('button', { name: /Alternative plan/ }))
    expect(await screen.findByText(/then re-linked by you/)).toBeTruthy()
    const post = calls.find((c) => c.method === 'POST')
    expect(post.url).toBe(contract('plan-grades.relink.note')._contract.path)
    expect(post.body).toEqual(contract('plan-grades.relink.note')._contract.requestBody)
    // The grade on screen is now the alternative plan's: a tighter stop, a different verdict line.
    expect(screen.getByRole('link', { name: 'Alternative plan' }).getAttribute('href')).toContain('note=pg-note-alt')
    expect(contractBody('plan-grades.relink.note').checks.stop.planned).toBe(98)
    expect(check('stop').getByText(/^Stop 98\.00 · exit 94\.50/)).toBeTruthy()
  })

  it('marking a trade as having no plan says so', async () => {
    on()
    answer.relink = () => contractResponse('plan-grades.relink.none')
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: 'Re-link' }))
    await userEvent.click(screen.getByRole('button', { name: 'This trade had no plan' }))
    expect(await screen.findByText('You marked this trade as having no plan.')).toBeTruthy()
    expect(calls.find((c) => c.method === 'POST').body).toEqual({ none: true })
    expect(screen.getByText('Marked as a trade with no plan.')).toBeTruthy()
    expect(screen.getByTestId('plan-grade-unplanned')).toBeTruthy()
  })

  it('a failed Re-link says so in the server’s words', async () => {
    on()
    answer.relink = () => contractResponse('plan-grades.relink.unknown-note')
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: 'Re-link' }))
    await userEvent.click(screen.getByRole('button', { name: /Alternative plan/ }))
    const sentence = contractBody('plan-grades.relink.unknown-note').detail
    expect((await screen.findByRole('alert')).textContent).toBe(sentence)
    expect(screen.getByRole('link', { name: 'PGNV plan' })).toBeTruthy()      // the grade did not change
  })

  it('a failed read is an error with a retry, never an "unplanned"', async () => {
    on()
    answer.get = () => contractResponse('plan-grades.trade.not-found')
    renderCard()
    expect(await screen.findByText(/Couldn’t load the plan grade/)).toBeTruthy()
    expect(screen.queryByTestId('plan-grade-unplanned')).toBeNull()
    answer.get = () => contractResponse('plan-grades.trade.planned')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Kept')).toBeTruthy()
  })

  it('the setup chip tags the trade through the page’s own write', async () => {
    on()
    answer.get = () => contractResponse('plan-grades.trade.drawn-plan')
    const onTagSetup = vi.fn(async () => {})
    renderCard({ onTagSetup, tradeId: 'pg-drawn', trade: { id: 'pg-drawn', symbol: 'PGDR' } })
    const chip = await screen.findByTestId('plan-setup-chip')
    expect(chip.textContent).toBe('Tag setup: Breakout')
    await userEvent.click(chip)
    expect(onTagSetup).toHaveBeenCalledWith(contractBody('plan-grades.trade.drawn-plan').setupChip.setup)
  })

  it('offers no setup chip when the server sends none', async () => {
    on()
    expect(contractBody('plan-grades.trade.planned').setupChip).toBeNull()
    renderCard({ onTagSetup: vi.fn() })
    await screen.findByText('Kept')
    expect(screen.queryByTestId('plan-setup-chip')).toBeNull()
  })

  it('Write review note hands the grade to the page’s door', async () => {
    on()
    const onWriteReview = vi.fn(async () => ({ id: 'review-1' }))
    const onOpenNote = vi.fn()
    renderCard({ onWriteReview, onOpenNote })
    await userEvent.click(await screen.findByRole('button', { name: 'Write review note' }))
    expect(onWriteReview).toHaveBeenCalledWith(contractBody('plan-grades.trade.planned'), expect.objectContaining({ id: 'pg-planned' }))
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith('review-1'))
  })
})
