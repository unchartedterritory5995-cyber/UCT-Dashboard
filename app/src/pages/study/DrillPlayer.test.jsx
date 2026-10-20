/**
 * DrillPlayer rails (spec §13.2 T1-T4, §13.7 D5/D6/D9/D18).
 *
 * StockChart is mocked (it is a 20k-line component): the stub prints the props
 * the lockdown recipe depends on, so the rails read them as rendered text.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

vi.mock('../../components/StockChart', () => ({
  default: (props) => (
    <div
      data-testid="stock-chart"
      data-sym={props.sym}
      data-bars={(props.barsOverride || []).length}
      data-first={props.barsOverride?.[0]?.t}
      data-entry={props.entryDate}
      data-exit={props.exitDate}
    >
      <span>chart:{props.sym}</span>
      <span>bars:{(props.barsOverride || []).length}</span>
      <span>studyMode:{String(!!props.studyMode)}</span>
      <span>frozen:{String(!!props.frozen)}</span>
      <span>liveUpdates:{String(props.liveUpdates)}</span>
      <span>hideWatermark:{String(!!props.hideWatermark)}</span>
      <span>showBrandMark:{String(props.showBrandMark)}</span>
      <span>drawingTools:{String(props.showDrawingTools)}</span>
      <span>feeds:{String(props.settingsOverride?.markers?.news)}/{String(props.settingsOverride?.markers?.desk)}</span>
    </div>
  ),
}))

import DrillPlayer, { LEAVE_COPY } from './DrillPlayer'
import { OUTBOX_KEY, readOutbox } from './studyOutbox'

function bars(n, start = '2025-01-02') {
  const out = []
  const d = new Date(`${start}T12:00:00Z`)
  for (let i = 0; i < n; i++) {
    const t = Number(d.toISOString().slice(0, 10).replace(/-/g, ''))
    out.push({ t, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 1000 + i })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

const item = (type, id, prompt, withBars = false) => ({
  id, type, prompt_json: prompt, ...(withBars ? { bars: { symbol: id, tf: 'D', bars: bars(20) } } : {}),
})

const recall = (id, q = 'What is a pivot?') => item('recall', id, { question: q, kind: 'mcq', choices: ['The buy point', 'The stop', 'The target', 'The low'] })
const spot = (id) => item('spot', id, { question: 'Which setup is this?', choices: ['VCP', 'Flat base', 'Cup'] }, true)
const walk = (id, order = 1) => item('walkthrough', id, { q: 'Regime', order, steps: ['The score maps to a band.', 'A band is permission, not prediction.'] })

function makeFetcher(payload, { postFail = 0 } = {}) {
  let fails = postFail
  const fn = vi.fn(async (url, opts = {}) => {
    if (url === '/api/study/today') return payload
    if (url === '/api/study/attempts' && opts.method === 'POST') {
      if (fails > 0) { fails -= 1; throw new TypeError('Failed to fetch') }
      if (String(opts.body.item_id).startsWith('si_walk')) {
        return {
          attempt_id: 9, item_id: opts.body.item_id, correct: true, score: null, unscored: true,
          reveal: { lesson: 'Say it that way every time.', detail: { seen: opts.body.answer?.seen, unscored: true } },
          progress: { xp_gained: 0, xp: 0, level: 1, streak: 0, streak_best: 0, due_at: null, weekly_xp: 0, daily_done: false },
        }
      }
      const correct = opts.body.answer?.choice === 'The buy point' || opts.body.answer?.choice === 'VCP'
      return {
        attempt_id: 1, item_id: opts.body.item_id, correct, score: correct ? 1 : 0,
        reveal: { sym: 'AAPL', asof: '2025-01-21', lesson: 'The pivot is where the buyers prove it.', answer: { answer: 'VCP' },
          provenance: { source_kind: 'fixture', source_ref: 'aapl_2025' }, forward_bars: bars(5, '2025-01-22') },
        progress: { xp_gained: 10, xp: 10, level: 1, streak: 1, streak_best: 1, due_at: null, weekly_xp: 10 },
      }
    }
    throw new Error(`unexpected ${url}`)
  })
  return fn
}

const tenSet = () => ({
  session_id: 'sess-1', kind: 'daily', day_et: '2026-10-17', answered_item_ids: [],
  items: [spot('si_1'), recall('si_2'), spot('si_3'), recall('si_4'), recall('si_5'), spot('si_6'), recall('si_7'), recall('si_8'), spot('si_9'), recall('si_10')],
})

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
})

async function answerChoice(label) {
  fireEvent.click(await screen.findByRole('radio', { name: label }))
  fireEvent.click(screen.getByTestId('primary-action'))
  await screen.findByText('Continue')
}

describe('DrillPlayer', () => {
  it('shows the ten-segment progress strip as "Question N of 10" and advances it', async () => {
    const fetcher = makeFetcher(tenSet())
    render(<DrillPlayer open onClose={() => {}} fetcher={fetcher} />)
    expect(await screen.findByText('Question 1 of 10')).toBeInTheDocument()
    expect(screen.getByTestId('progress-strip').querySelectorAll('li')).toHaveLength(10)

    await answerChoice('VCP')
    fireEvent.click(screen.getByTestId('primary-action'))
    expect(await screen.findByText('Question 2 of 10')).toBeInTheDocument()
    await answerChoice('The buy point')
    fireEvent.click(screen.getByTestId('primary-action'))
    await answerChoice('Flat base')
    fireEvent.click(screen.getByTestId('primary-action'))
    expect(await screen.findByText('Question 4 of 10')).toBeInTheDocument()
  })

  it('has ONE morphing button: Check (disabled until answerable) then Continue, then Check again', async () => {
    render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(tenSet())} />)
    const btn = await screen.findByTestId('primary-action')
    expect(btn).toHaveTextContent('Check')
    expect(btn).toBeDisabled()
    fireEvent.click(await screen.findByRole('radio', { name: 'VCP' }))
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    await waitFor(() => expect(screen.getByTestId('primary-action')).toHaveTextContent('Continue'))
    expect(screen.getByText('Correct')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('primary-action'))
    await waitFor(() => expect(screen.getByTestId('primary-action')).toHaveTextContent('Check'))
    expect(screen.getAllByTestId('primary-action')).toHaveLength(1)
  })

  it('mounts the chart with the lockdown recipe and keeps it mounted but hidden on a non-chart item', async () => {
    render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(tenSet())} />)
    const chart = await screen.findByTestId('stock-chart')
    expect(chart).toHaveAttribute('data-sym', 'si_1')
    expect(screen.getByText('studyMode:true')).toBeInTheDocument()
    expect(screen.getByText('frozen:true')).toBeInTheDocument()
    expect(screen.getByText('liveUpdates:false')).toBeInTheDocument()
    expect(screen.getByText('hideWatermark:true')).toBeInTheDocument()
    expect(screen.getByText('showBrandMark:false')).toBeInTheDocument()
    expect(screen.getByText('drawingTools:false')).toBeInTheDocument()
    expect(screen.getByText('feeds:false/false')).toBeInTheDocument()
    expect(chart).toHaveAttribute('data-first', '2025-01-02')
    expect(chart).toHaveAttribute('data-entry', '2025-01-02')
    expect(screen.getByTestId('chart-box')).toHaveAttribute('data-chart-visible', '1')
    expect(screen.getByText(/The ticker is hidden until you answer/)).toBeInTheDocument()

    await answerChoice('VCP')
    fireEvent.click(screen.getByTestId('primary-action'))
    await screen.findByText('What is a pivot?')
    // Item 2 has no chart: the SAME chart is still in the DOM, hidden, not unmounted.
    const box = screen.getByTestId('chart-box')
    expect(box).toHaveAttribute('data-chart-visible', '0')
    expect(box).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('stock-chart')).toBeInTheDocument()
    expect(screen.getAllByTestId('stock-chart')).toHaveLength(1)
  })

  it('appends the reveal forward bars to the same chart barsOverride', async () => {
    render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(tenSet())} />)
    const chart = await screen.findByTestId('stock-chart')
    expect(chart).toHaveAttribute('data-bars', '20')
    expect(screen.getByText('bars:20')).toBeInTheDocument()
    await answerChoice('VCP')
    await waitFor(() => expect(screen.getByTestId('stock-chart')).toHaveAttribute('data-bars', '25'))
    expect(screen.getByText('bars:25')).toBeInTheDocument()
    expect(screen.getByTestId('stock-chart')).toHaveAttribute('data-exit', '2025-01-26')
    expect(screen.getByText('AAPL')).toBeInTheDocument()
  })

  it('asks once before leaving mid-session, then closes without asking again', async () => {
    const onClose = vi.fn()
    render(<DrillPlayer open onClose={onClose} fetcher={makeFetcher(tenSet())} />)
    await screen.findByText('Question 1 of 10')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText(LEAVE_COPY)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }))
    expect(screen.queryByText(LEAVE_COPY)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText(LEAVE_COPY)).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('writes the answer to the outbox on Check, says so when the POST fails, and replays on online', async () => {
    const oneSet = { session_id: 'sess-2', kind: 'daily', answered_item_ids: [], items: [recall('si_only')] }
    const fetcher = makeFetcher(oneSet, { postFail: 1 })
    render(<DrillPlayer open onClose={() => {}} fetcher={fetcher} />)
    fireEvent.click(await screen.findByRole('radio', { name: 'The buy point' }))
    fireEvent.click(screen.getByTestId('primary-action'))
    await screen.findByTestId('post-failed')
    expect(screen.getByTestId('post-failed')).toHaveTextContent("Couldn't reach the server to load your answer.")
    expect(readOutbox()).toHaveLength(1)
    expect(readOutbox()[0].item_id).toBe('si_only')
    expect(JSON.parse(window.localStorage.getItem(OUTBOX_KEY))).toHaveLength(1)
    // The member continues: the set ends and the end card counts what landed.
    expect(screen.getByTestId('primary-action')).toHaveTextContent('Continue')
    fireEvent.click(screen.getByTestId('primary-action'))
    expect(await screen.findByTestId('end-score')).toHaveTextContent('0 of 1')
    // Back online: the row replays, lands, and the card updates.
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(readOutbox()).toHaveLength(0))
    await waitFor(() => expect(screen.getByTestId('end-score')).toHaveTextContent('1 of 1'))
    const posts = fetcher.mock.calls.filter(([u, o]) => u === '/api/study/attempts' && o?.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(posts[1][1].body).toMatchObject({ item_id: 'si_only', session_id: 'sess-2', answer: { choice: 'The buy point' } })
    expect(typeof posts[1][1].body.time_ms).toBe('number')
  })

  it('resumes past answered_item_ids and selects choices with the 1-4 keys and Enter', async () => {
    const set = tenSet()
    set.answered_item_ids = ['si_1', 'si_2']
    render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(set)} />)
    expect(await screen.findByText('Question 3 of 10')).toBeInTheDocument()
    await answerChoice('Flat base')
    fireEvent.click(screen.getByTestId('primary-action'))
    await screen.findByText('Question 4 of 10')
    fireEvent.keyDown(document.body, { key: '1' })
    await waitFor(() => expect(screen.getByRole('radio', { name: 'The buy point' })).toHaveAttribute('aria-checked', 'true'))
    fireEvent.keyDown(document.body, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('primary-action')).toHaveTextContent('Continue'))
    expect(screen.getByRole('status')).toHaveTextContent('Correct')
  })
})

describe('DrillPlayer walk-throughs (unscored, spec 13.9 #1)', () => {
  const unitSet = () => ({
    session_id: 'unit-1', kind: 'unit', answered_item_ids: [],
    items: [walk('si_walk_1'), recall('si_q1'), spot('si_q2')],
  })

  it('reads Continue from the start, enables on the last step, posts {seen}, shows no reveal and advances', async () => {
    const fetcher = makeFetcher(unitSet())
    render(<DrillPlayer open onClose={() => {}} fetcher={fetcher} />)
    expect(await screen.findByText('Question 1 of 3')).toBeInTheDocument()
    const btn = screen.getByTestId('primary-action')
    expect(btn).toHaveTextContent('Continue')
    expect(btn).toBeDisabled()
    expect(screen.queryByText('Check')).not.toBeInTheDocument()
    expect(screen.getByTestId('walkthrough')).toBeInTheDocument()
    expect(screen.getAllByTestId('walk-step')).toHaveLength(1)
    // no chart for a text walk-through: the box is hidden, nothing mounted yet
    expect(screen.getByTestId('chart-box')).toHaveAttribute('data-chart-visible', '0')

    fireEvent.click(screen.getByTestId('walk-next'))
    expect(screen.getAllByTestId('walk-step')).toHaveLength(2)
    expect(screen.queryByTestId('walk-next')).not.toBeInTheDocument()
    expect(screen.getByTestId('primary-action')).not.toBeDisabled()
    expect(screen.getByTestId('primary-action')).toHaveTextContent('Continue')

    fireEvent.click(screen.getByTestId('primary-action'))
    // straight to the next item: no "Correct", no "Not quite", no reveal card
    expect(await screen.findByText('Question 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('What is a pivot?')).toBeInTheDocument()
    expect(screen.queryByText('Correct')).not.toBeInTheDocument()
    expect(screen.queryByText('Not quite')).not.toBeInTheDocument()
    expect(screen.queryByText('Say it that way every time.')).not.toBeInTheDocument()
    expect(screen.getByTestId('primary-action')).toHaveTextContent('Check')
    const posts = fetcher.mock.calls.filter(([u, o]) => u === '/api/study/attempts' && o?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0][1].body).toMatchObject({ item_id: 'si_walk_1', session_id: 'unit-1', answer: { seen: 2 } })
    expect(typeof posts[0][1].body.time_ms).toBe('number')
    expect(screen.queryByTestId('combo-chip')).not.toBeInTheDocument()
  })

  it('Enter is Continue on the last step, and the end card scores the quiz items only', async () => {
    const set = { session_id: 'unit-2', kind: 'unit', answered_item_ids: [], items: [walk('si_walk_2'), recall('si_q9')] }
    render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(set)} />)
    await screen.findByText('Question 1 of 2')
    fireEvent.keyDown(document.body, { key: 'Enter' })          // not yet: the last step is not on screen
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('walk-next'))
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(await screen.findByText('Question 2 of 2')).toBeInTheDocument()
    await answerChoice('The buy point')
    fireEvent.click(screen.getByTestId('primary-action'))
    expect(await screen.findByTestId('end-score')).toHaveTextContent('1 of 1')
  })
})
