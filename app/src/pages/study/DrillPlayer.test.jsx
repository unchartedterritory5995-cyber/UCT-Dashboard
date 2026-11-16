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
      data-markers={(props.markers || []).map((m) => m.text).join('|')}
      data-marker-days={(props.markers || []).map((m) => `${m.text}@${m.time}`).join('|')}
      data-marker-sides={(props.markers || []).map((m) => `${m.text}:${m.position}`).join('|')}
      data-annotations={(props.annotations || []).length}
      data-ann-chips={(props.annotations || []).map((a) => String(!!a.showPriceLabel)).join('|')}
      data-price-lines={(props.priceLines || []).map((p) => `${p.title || '-'}@${p.price}`).join('|')}
      data-pad={String(props.frameRightPadFrac || 0)}
      data-tick-chars={String(props.tickLabelChars ?? '-')}
      data-show-volume={String(props.showVolume)}
      data-volume-removed={String(props.settingsOverride?.volume?.removed)}
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
      <span>instances:{(props.settingsOverride?.indicatorInstances || []).map((i) => i.instanceId).join('|') || '-'}</span>
      {/* the library's click, which a touch tap also raises: a BusinessDay time, the cursor's price, the point */}
      <button type="button" data-testid="chart-lib-tap" onClick={() => props.onChartTap?.({ time: { year: 2025, month: 1, day: 6 }, price: 104.2, point: { x: 40, y: 20 } })}>lib-tap</button>
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
const tap = (id) => item('tap', id, { question: 'Tap the pivot.', target: 'the pivot' }, true)
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
  // owner 2026-11-14 ("a visual along with it ... Using our tick by tick", he picked "chart + replay after"): after the
  // answer the bars after the decision day run on (Hard mode's engine), with Skip and Replay; the full chart is the end.
  it('replays the bars after the answer, with Skip to the end and Replay', async () => {
    render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(tenSet())} />)
    const before = Number((await screen.findByTestId('stock-chart')).getAttribute('data-bars'))
    await answerChoice('VCP')
    fireEvent.click(screen.getByTestId('drill-takeover-go'))
    const skip = await screen.findByTestId('drill-replay-skip')
    // the replay starts from the decision day: no forward bar is on the chart yet
    expect(Number(screen.getByTestId('stock-chart').getAttribute('data-bars'))).toBe(before)
    fireEvent.click(skip)
    await waitFor(() => expect(Number(screen.getByTestId('stock-chart').getAttribute('data-bars'))).toBe(before + 5))
    const again = screen.getByTestId('drill-replay-again')
    expect(again).toHaveTextContent('Replay what happened')
    fireEvent.click(again)
    await screen.findByTestId('drill-replay-skip')
  })

  // the visuals plan (2026-11-14): a course question bought on the chart's last day carries its trade from the research
  // (courses_lib chart.trade -> reveal.trade); after the answer the entry and stop are drawn and the trade's marks land as
  // the replay reaches their day: BOUGHT at once, STOPPED only when the stop's day has played
  it('draws the trade of a course chart after the answer, its marks landing with the replay', async () => {
    const set = tenSet()
    set.items[0] = item('recall', 'si_c1', { question: 'Where is the stop?', kind: 'mcq', choices: ['The buy point', 'The stop', 'The target', 'The low'] }, true)
    const base = makeFetcher(set)
    const fetcher = vi.fn(async (url, opts = {}) => {
      const r = await base(url, opts)
      if (url === '/api/study/attempts' && opts.body?.item_id === 'si_c1') {
        r.reveal = { ...r.reveal, trade: { entry: 119.5, stop: 110, t1: 148, t2: 167, direction: 'bullish', enters_intraday: true, trim_r: [3, 5] } }
      }
      return r
    })
    render(<DrillPlayer open onClose={() => {}} fetcher={fetcher} />)
    await screen.findByTestId('stock-chart')
    expect(screen.getByTestId('stock-chart').getAttribute('data-markers')).toBe('')
    await answerChoice('The buy point')
    fireEvent.click(screen.getByTestId('drill-takeover-go'))
    await screen.findByTestId('drill-replay-skip')
    expect(screen.getByTestId('drill-key')).toHaveTextContent('Entry')
    expect(Number(screen.getByTestId('stock-chart').getAttribute('data-annotations'))).toBeGreaterThan(0)
    const before = screen.getByTestId('stock-chart').getAttribute('data-markers')
    expect(before).toContain('BOUGHT')
    expect(before).not.toContain('STOPPED')
    fireEvent.click(screen.getByTestId('drill-replay-skip'))
    await waitFor(() => expect(screen.getByTestId('stock-chart').getAttribute('data-markers')).toContain('STOPPED'))
  })

  // The Study screen check (2026-11-14): the levels were unlabeled stubs (the ray's own chip was dropped when the entry and
  // the stop sat close), STOPPED printed on the BOUGHT text a day apart, and a mark on the last bar was cut by the price
  // scale while the replay ran. The levels now print on the price axis (named once the replay lands), the marks keep their
  // words apart, and the answered chart leaves blank room right of its last bar.
  it('prints the trade levels on the price axis, keeps the marks apart and leaves room after the last bar', async () => {
    const set = tenSet()
    set.items[0] = item('recall', 'si_c6', { question: 'Where is the stop?', kind: 'mcq', choices: ['The buy point', 'The stop', 'The target', 'The low'] }, true)
    const base = makeFetcher(set)
    const fetcher = vi.fn(async (url, opts = {}) => {
      const r = await base(url, opts)
      if (url === '/api/study/attempts' && opts.body?.item_id === 'si_c6') {
        r.reveal = { ...r.reveal, trade: { entry: 119.5, stop: 110, t1: 148, t2: 167, direction: 'bullish', enters_intraday: true, trim_r: [3, 5] } }
      }
      return r
    })
    render(<DrillPlayer open onClose={() => {}} fetcher={fetcher} />)
    const chart = await screen.findByTestId('stock-chart')
    expect(chart.getAttribute('data-price-lines')).toBe('')
    expect(chart.getAttribute('data-pad')).toBe('0')            // the question's frame is the window as asked
    await answerChoice('The buy point')
    fireEvent.click(screen.getByTestId('drill-takeover-go'))
    await screen.findByTestId('drill-replay-skip')
    const live = screen.getByTestId('stock-chart')
    // while the replay runs: the prices on the axis, no names over the newest candles; the rays carry no chip of their own
    expect(live.getAttribute('data-price-lines')).toBe('-@119.5|-@110|-@148|-@167')
    expect(live.getAttribute('data-ann-chips')).toBe('false|false|false|false')
    expect(Number(live.getAttribute('data-pad'))).toBeGreaterThan(0)
    fireEvent.click(screen.getByTestId('drill-replay-skip'))
    // landed: each tag carries the chart key's name for its level
    await waitFor(() => expect(screen.getByTestId('stock-chart').getAttribute('data-price-lines')).toBe('ENTRY@119.5|STOP@110|3R@148|5R@167'))
    // stopped the session after the buy: STOPPED stands above its bar, clear of the BOUGHT word under the buy bar
    expect(screen.getByTestId('stock-chart').getAttribute('data-marker-sides')).toBe('BOUGHT:belowBar|STOPPED:aboveBar')
  })

  // The same check: the lesson's stamp read "Named it" on a number or an R question. It says "Right", on the takeover and
  // on the verdict line, a word every question type fits.
  it('stamps a right answer "Right", never "Named it"', async () => {
    const { container } = render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(tenSet())} />)
    await answerChoice('VCP')
    // the verdict line's seal under the takeover, and the takeover's own
    expect([...container.ownerDocument.querySelectorAll('[data-word]')].map((e) => e.getAttribute('data-word'))).toEqual(['Right', 'Right'])
    fireEvent.click(screen.getByTestId('drill-takeover-go'))
    const words = [...container.ownerDocument.querySelectorAll('[data-word]')].map((e) => e.getAttribute('data-word'))
    expect(words).toEqual(['Right'])
    expect(container.ownerDocument.body.textContent).not.toMatch(/Named it/)
  })

  // the reveal carries the first 20 bars after the decision; a course chart that wants more (prompt chart.forward_bars)
  // fetches the rest once from POST /attempts/{id}/step and the replay runs on through them
  it('fetches the rest of a course chart replay past the reveal bars', async () => {
    const set = tenSet()
    set.items[0] = item('recall', 'si_c3', { question: 'What is a pivot?', kind: 'mcq', choices: ['The buy point', 'The stop', 'The target', 'The low'], chart: { window_bars: 20, tf: 'D', forward_bars: 8 } }, true)
    const base = makeFetcher(set)
    const fetcher = vi.fn(async (url, opts = {}) => {
      if (url === '/api/study/attempts/1/step') return { bars: bars(3, '2025-01-27'), next_offset: 8, done: true, forward_total: 8 }
      const r = await base(url, opts)
      if (url === '/api/study/attempts' && opts.body?.item_id === 'si_c3') r.reveal = { ...r.reveal, forward_total: 8 }
      return r
    })
    render(<DrillPlayer open onClose={() => {}} fetcher={fetcher} />)
    const before = Number((await screen.findByTestId('stock-chart')).getAttribute('data-bars'))
    await answerChoice('The buy point')
    fireEvent.click(screen.getByTestId('drill-takeover-go'))
    fireEvent.click(await screen.findByTestId('drill-replay-skip'))
    await waitFor(() => expect(Number(screen.getByTestId('stock-chart').getAttribute('data-bars'))).toBe(before + 8))
    expect(fetcher).toHaveBeenCalledWith('/api/study/attempts/1/step', expect.objectContaining({ method: 'POST', body: { offset: 5, n: 3 } }))
  })

  // screen check 2026-11-14: the decision day was counted back from the reveal's own 20 bars after the top-up had added
  // more, so BOUGHT and the levels sat 40 days late on a 60-day replay. The decision day is the question's last bar.
  it('keeps BOUGHT on the decision day after the replay is topped up past the reveal bars', async () => {
    const set = tenSet()
    set.items[0] = item('recall', 'si_c4', { question: 'Where is the stop?', kind: 'mcq', choices: ['The buy point', 'The stop', 'The target', 'The low'], chart: { window_bars: 20, tf: 'D', forward_bars: 8 } }, true)
    const base = makeFetcher(set)
    const fetcher = vi.fn(async (url, opts = {}) => {
      if (url === '/api/study/attempts/1/step') return { bars: bars(3, '2025-01-27'), next_offset: 8, done: true, forward_total: 8 }
      const r = await base(url, opts)
      if (url === '/api/study/attempts' && opts.body?.item_id === 'si_c4') {
        r.reveal = { ...r.reveal, forward_total: 8, trade: { entry: 119.5, stop: 118, t1: 124, t2: 127, direction: 'bullish', enters_intraday: true, trim_r: [3, 5] } }
      }
      return r
    })
    render(<DrillPlayer open onClose={() => {}} fetcher={fetcher} />)
    const before = Number((await screen.findByTestId('stock-chart')).getAttribute('data-bars'))
    await answerChoice('The buy point')
    // under the verdict: only the question's bars, and no mark has landed yet
    expect(Number(screen.getByTestId('stock-chart').getAttribute('data-bars'))).toBe(before)
    fireEvent.click(screen.getByTestId('drill-takeover-go'))
    fireEvent.click(await screen.findByTestId('drill-replay-skip'))
    await waitFor(() => expect(Number(screen.getByTestId('stock-chart').getAttribute('data-bars'))).toBe(before + 8))
    // the question's last bar is 2025-01-21 (20 days from 01-02): BOUGHT stays there
    await waitFor(() => expect(screen.getByTestId('stock-chart').getAttribute('data-marker-days')).toMatch(/BOUGHT@2025-01-21/))
  })

  // 2026-11-14: a course chart is a dated real example, so the server sends no ticker with it (hide_ticker); the badge
  // and watermark appear once the answer is scored, named by the reveal
  it('shows a course chart ticker only from the answer on', async () => {
    const set = tenSet()
    set.items[0] = item('recall', 'si_c5', { question: 'Take it?', kind: 'mcq', choices: ['The buy point', 'The stop', 'The target', 'The low'], chart: { window_bars: 20, tf: 'D', forward_bars: 5, hide_ticker: true } }, true)
    render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(set)} />)
    await screen.findByTestId('stock-chart')
    expect(screen.queryByTestId('chart-identity')).not.toBeInTheDocument()
    expect(screen.getByText('hideWatermark:true')).toBeInTheDocument()
    await answerChoice('The buy point')
    fireEvent.click(screen.getByTestId('drill-takeover-go'))
    expect(await screen.findByTestId('chart-identity')).toHaveTextContent('AAPL')
  })

  it('marks the decision day on a course chart with no trade once the bars after it play', async () => {
    const set = tenSet()
    set.items[0] = item('recall', 'si_c2', { question: 'What is a pivot?', kind: 'mcq', choices: ['The buy point', 'The stop', 'The target', 'The low'] }, true)
    render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(set)} />)
    await screen.findByTestId('stock-chart')
    await answerChoice('The buy point')
    fireEvent.click(screen.getByTestId('drill-takeover-go'))
    await screen.findByTestId('drill-replay-skip')
    expect(screen.getByTestId('stock-chart').getAttribute('data-markers')).toBe('DECISION DAY')
    expect(screen.queryByTestId('drill-key')).not.toBeInTheDocument()
  })

  it('calls an intraday course chart\'s decision point the decision BAR', async () => {
    const set = tenSet()
    const intraday = item('recall', 'si_c5', { question: 'What is a pivot?', kind: 'mcq', choices: ['The buy point', 'The stop', 'The target', 'The low'] }, true)
    const t0 = 1789479000   // 2026-09-15 09:30 New York
    intraday.bars = { symbol: 'si_c5', tf: '5', bars: Array.from({ length: 20 }, (_, i) => ({ t: t0 + i * 300, o: 100, h: 101, l: 99, c: 100.5, v: 1000 })) }
    set.items[0] = intraday
    render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(set)} />)
    await screen.findByTestId('stock-chart')
    await answerChoice('The buy point')
    fireEvent.click(screen.getByTestId('drill-takeover-go'))
    await screen.findByTestId('drill-replay-skip')
    expect(screen.getByTestId('stock-chart').getAttribute('data-markers')).toBe('DECISION BAR')
    // on the decision bar itself, in the chart's own intraday time (New York wall clock as UTC), never the bar's raw
    // unix time, which StockChart would draw four hours late (on the newest bar while the replay plays)
    const decisionT = 1789479000 + 19 * 300
    expect(screen.getByTestId('stock-chart').getAttribute('data-marker-days')).toBe(`DECISION BAR@${decisionT - 14400}`)
    // its time labels get a five-character slot, so the times survive between the days on a phone (2026-11-16)
    expect(screen.getByTestId('stock-chart').getAttribute('data-tick-chars')).toBe('5')
    // its bars carry volume, so the volume pane is the member's own setting
    expect(screen.getByTestId('stock-chart').getAttribute('data-show-volume')).toBe('undefined')
    expect(screen.getByTestId('stock-chart').getAttribute('data-volume-removed')).toBe('undefined')
  })

  // the 2026-11-16 screen check: a Russell 2000 history chart (its source volume was another index's, stored as zeros)
  // drew an empty "Volume 0" pane of flat stubs; a chart with no volume at all hides the pane
  it('hides the volume pane on a chart whose bars carry no volume', async () => {
    const set = tenSet()
    const idx = item('recall', 'si_rut', { question: 'What is a pivot?', kind: 'mcq', choices: ['The buy point', 'The stop', 'The target', 'The low'] }, true)
    idx.bars = { symbol: 'si_rut', tf: 'D', bars: Array.from({ length: 20 }, (_, i) => ({ t: 20240601 + i, o: 2000, h: 2010, l: 1990, c: 2005, v: 0 })) }
    set.items[0] = idx
    render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(set)} />)
    await screen.findByTestId('stock-chart')
    expect(screen.getByTestId('stock-chart').getAttribute('data-show-volume')).toBe('false')
    // removed, not hidden: a hidden volume keeps a "Vol 0" row in the desktop legend (the second screen check)
    expect(screen.getByTestId('stock-chart').getAttribute('data-volume-removed')).toBe('true')
  })

  // the visuals plan, step 3 (2026-11-15): a computed question shows its picture card (prompt_json.visual) under the
  // question; the answer slot asks until the verdict screen closes, then fills from the reveal's calc with the working
  it('fills a computed question\'s card only once the verdict screen closes', async () => {
    const visual = { kind: 'ladder', side: 'long', find: { label: '3R', as: 'price' }, r: { entry: 50, stop: 47.5 },
      levels: [{ key: 'stop', label: 'Stop', price: 47.5 }, { key: 'entry', label: 'Entry', price: 50 }] }
    const q = item('recall', 'si_calc', { q: 'Entry $50, stop $47.50. Where is the 3R price?', kind: 'mcq', choices: ['57.50', '55.00', '60.00', '52.50'], visual })
    const fetcher = vi.fn(async (url) => {
      if (url === '/api/study/today') return { session_id: 'sess-c', kind: 'daily', day_et: '2026-11-15', answered_item_ids: [], items: [q, recall('si_n')] }
      if (url === '/api/study/attempts') {
        return { attempt_id: 3, item_id: 'si_calc', correct: true, score: 1,
          reveal: { why: 'One R is 2.50, so 3R is 7.50 over the entry.', answer: { answer: '57.50' },
            facts: { calc: { fn: 'arith', args: { expr: 'entry + 3 * (entry - stop)', entry: 50, stop: 47.5 }, result: 57.5 } } },
          progress: { xp_gained: 10, xp: 10, level: 1, streak: 1, streak_best: 1, due_at: null, weekly_xp: 10 } }
      }
      throw new Error(`unexpected ${url}`)
    })
    render(<DrillPlayer open onClose={() => {}} fetcher={fetcher} />)
    const card = await screen.findByTestId('calc-card')
    expect(card).toHaveTextContent('47.50')
    expect(card).not.toHaveTextContent('57.50')
    expect(screen.getByTestId('calc-ask')).toBeInTheDocument()
    await answerChoice('57.50')
    expect(screen.getByTestId('drill-takeover')).toBeInTheDocument()
    expect(screen.queryByTestId('calc-answer')).toBeNull()          // under the verdict screen nothing fills
    fireEvent.click(screen.getByTestId('drill-takeover-go'))
    await waitFor(() => expect(screen.getByTestId('calc-answer')).toHaveTextContent('57.50'))
    expect(screen.getByTestId('calc-working')).toHaveTextContent('50 + 3 × (50 − 47.5) = 57.50')
  })

  it('shows the status line as "Question N of 10" and advances it', async () => {
    const fetcher = makeFetcher(tenSet())
    render(<DrillPlayer open onClose={() => {}} fetcher={fetcher} />)
    expect(await screen.findByText('Question 1 of 10')).toBeInTheDocument()
    // Hard mode's status line (2026-11-08): ten stops on the track, the step named in words
    expect(screen.getByRole('group', { name: 'Lesson, question 1 of 10, 0 right' })).toBeInTheDocument()

    await answerChoice('VCP')
    // the answer just scored counts at once, under the verdict (it read "0 right" over a correct answer)
    expect(screen.getByRole('group', { name: /question 1 of 10, 1 right/ })).toBeInTheDocument()
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
    // the answer takes over the screen (rule 15), with the verdict; its button opens the lesson
    expect(screen.getByTestId('drill-takeover')).toHaveTextContent('Correct')
    fireEvent.click(screen.getByTestId('drill-takeover-go'))
    expect(screen.queryByTestId('drill-takeover')).not.toBeInTheDocument()
    expect(screen.getByText('Correct')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('primary-action'))
    await waitFor(() => expect(screen.getByTestId('primary-action')).toHaveTextContent('Check'))
    expect(screen.getAllByTestId('primary-action')).toHaveLength(1)
  })

  it('carries the E4H (4-EMA of highs) on a Slingshot item\'s chart, before the answer, and on no other', async () => {
    const set = tenSet()
    set.items[0] = { ...spot('si_1'), skill_id: 'setup.family4.slingshot' }
    render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(set)} />)
    await screen.findByTestId('stock-chart')
    expect(screen.getByText('instances:study:slingshot-e4h')).toBeInTheDocument()
  })

  it('carries no E4H instance on a chart item of any other skill', async () => {
    render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(tenSet())} />)
    await screen.findByTestId('stock-chart')
    expect(screen.getByText('instances:-')).toBeInTheDocument()
  })

  it('mounts the chart with the lockdown recipe and keeps it mounted but hidden on a non-chart item', async () => {
    render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(tenSet())} />)
    const chart = await screen.findByTestId('stock-chart')
    expect(chart).toHaveAttribute('data-sym', 'si_1')
    expect(screen.getByText('studyMode:true')).toBeInTheDocument()
    expect(screen.getByText('frozen:true')).toBeInTheDocument()
    expect(screen.getByText('liveUpdates:false')).toBeInTheDocument()
    expect(screen.getByText('hideWatermark:true')).toBeInTheDocument()
    // rule 1 of the owner's principles (docs/study/OWNER_PRINCIPLES.md): the member's own widget, with our logo
    expect(screen.getByText('showBrandMark:true')).toBeInTheDocument()
    expect(screen.getByText('drawingTools:false')).toBeInTheDocument()
    expect(screen.getByText('feeds:false/false')).toBeInTheDocument()
    expect(chart).toHaveAttribute('data-first', '2025-01-02')
    expect(chart).toHaveAttribute('data-entry', '2025-01-02')
    // a 20-bar frame fits no even month spacing (tickLabelCharsFor): the library keeps its own label slot
    expect(chart).toHaveAttribute('data-tick-chars', '-')
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
    // the verdict holds the screen first: the replay has not started under it (0.8 s is two replay days at RUN_ON_MS)
    await new Promise((r) => setTimeout(r, 800))
    expect(screen.getByTestId('stock-chart')).toHaveAttribute('data-bars', '20')
    fireEvent.click(screen.getByTestId('drill-takeover-go'))
    fireEvent.click(await screen.findByTestId('drill-replay-skip'))
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
    // Every digit in the drill's chord reaches it: 3 and 4 pick the third and fourth choice.
    fireEvent.keyDown(document.body, { key: '3' })
    await waitFor(() => expect(screen.getByRole('radio', { name: 'The target' })).toHaveAttribute('aria-checked', 'true'))
    fireEvent.keyDown(document.body, { key: '4' })
    await waitFor(() => expect(screen.getByRole('radio', { name: 'The low' })).toHaveAttribute('aria-checked', 'true'))
    // A modified digit is not a choice key (review M4): Ctrl/Cmd+1 is the browser's tab switch,
    // Alt+1 the terminal's panel key. The 4th choice stays picked.
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      fireEvent.keyDown(document.body, { key: '1', ...mod })
      expect(screen.getByRole('radio', { name: 'The low' })).toHaveAttribute('aria-checked', 'true')
    }
    fireEvent.keyDown(document.body, { key: '1' })
    await waitFor(() => expect(screen.getByRole('radio', { name: 'The buy point' })).toHaveAttribute('aria-checked', 'true'))
    fireEvent.keyDown(document.body, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('primary-action')).toHaveTextContent('Continue'))
    // Enter belongs to the takeover while it holds the screen: it opens the lesson, it never skips it
    expect(screen.getByTestId('drill-takeover')).toHaveTextContent('Correct')
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByTestId('drill-takeover')).not.toBeInTheDocument())
    expect(screen.getByTestId('primary-action')).toHaveTextContent('Continue')
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

describe('DrillPlayer screen feedback (owner 2026-10-21)', () => {
  it('a reviewer gets the screen door in the top bar, named for the question and then the reveal', async () => {
    render(<DrillPlayer open reviewer onClose={() => {}} fetcher={makeFetcher(tenSet())} />)
    await screen.findByText('Question 1 of 10')
    expect(screen.getByTestId('screen-feedback').dataset.screen).toBe('question')
    await answerChoice('VCP')
    expect(screen.getByTestId('screen-feedback').dataset.screen).toBe('reveal')
  })

  it('a member never sees it', async () => {
    render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(tenSet())} />)
    await screen.findByText('Question 1 of 10')
    expect(screen.queryByTestId('screen-feedback')).not.toBeInTheDocument()
  })

  it('typing the note never drives the drill: Enter and the digit keys stay in the box', async () => {
    render(<DrillPlayer open reviewer onClose={() => {}} fetcher={makeFetcher(tenSet())} />)
    await screen.findByText('Question 1 of 10')
    fireEvent.click(screen.getByRole('radio', { name: 'VCP' }))
    fireEvent.click(screen.getByTestId('screen-feedback-open'))
    const box = screen.getByLabelText('Your note')
    fireEvent.keyDown(box, { key: '2' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByTestId('primary-action')).toHaveTextContent('Check')       // not checked
    expect(screen.getByRole('radio', { name: 'VCP' })).toHaveAttribute('aria-checked', 'true')
  })

  it('a chart tap from the library (a touch tap on a phone) places the marker without a crosshair move', async () => {
    const set = { ...tenSet(), items: [tap('si_tap1'), recall('si_2')] }
    render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(set)} />)
    expect(await screen.findByTestId('tap-hud')).toHaveTextContent('Tap the pivot')
    // no crosshair payload was ever delivered; the touch tap is the only event
    fireEvent.click(screen.getByTestId('chart-lib-tap'))
    expect(screen.getByTestId('tap-hud')).toHaveTextContent('Tap Check, or tap again to move')
    // (this fixture's bars carry raw YYYYMMDD keys; the product's go through normalizeBars to YYYY-MM-DD)
    expect(screen.getByTestId('tap-status')).toHaveTextContent(/Marker on 2025-?01-?06 at 104\.20\./)
    // the container click right after the library's click is the SAME click (mouse): it must not double-handle
    fireEvent.click(screen.getByTestId('chart-box'))
    expect(screen.getByTestId('tap-status')).toHaveTextContent(/Marker on 2025-?01-?06 at 104\.20\./)
  })
})
