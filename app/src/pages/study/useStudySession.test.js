/** useStudySession rails (spec §13.2 T5/T6, §13.7 D7, D18). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useStudySession, { normalizeBars, appendForwardBars, isUnscoredItem, SET_CACHE_KEY, TODAY_URL, ATTEMPTS_URL } from './useStudySession'
import { OUTBOX_KEY, readOutbox } from './studyOutbox'

const item = (id, type = 'recall', extra = {}) => ({ id, type, prompt_json: { question: id, choices: ['a', 'b'] }, ...extra })
const chartItem = (id) => item(id, 'spot', { bars: { symbol: id, tf: 'D', bars: [{ t: 20250102, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }, { t: 20250103, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] } })

const payload = () => ({ session_id: 'sess-9', kind: 'daily', answered_item_ids: [], items: [item('a'), chartItem('b'), item('c')] })

function fetcherFor(p, { failPost = 0 } = {}) {
  let fails = failPost
  return vi.fn(async (url, opts = {}) => {
    if (url === TODAY_URL) return p
    if (url === ATTEMPTS_URL) {
      if (fails > 0) { fails -= 1; throw new TypeError('Failed to fetch') }
      return { attempt_id: 7, item_id: opts.body.item_id, correct: opts.body.answer.choice === 'a', score: 1,
        reveal: { sym: 'NVDA', asof: '2025-01-03', forward_bars: opts.body.item_id === 'b' ? [{ t: 20250106, o: 1, h: 1, l: 1, c: 1, v: 1 }] : undefined },
        progress: { xp_gained: 10 } }
    }
    if (url === '/api/study/items/z/bars') return { symbol: 'z', tf: 'D', bars: [{ t: 20250110, o: 1, h: 1, l: 1, c: 1, v: 1 }] }
    throw new Error(`unexpected ${url}`)
  })
}

beforeEach(() => { window.localStorage.clear() })

describe('normalizeBars / appendForwardBars', () => {
  it('turns YYYYMMDD integers into ISO dates and accepts both payload shapes', () => {
    expect(normalizeBars([{ t: 20250102, o: 1, h: 2, l: 0.5, c: 1.5, v: 3 }])[0]).toEqual({ t: '2025-01-02', o: 1, h: 2, l: 0.5, c: 1.5, v: 3 })
    expect(normalizeBars({ bars: [{ t: '2025-01-02', o: '1', h: '2', l: '0.5', c: '1.5' }] })[0]).toEqual({ t: '2025-01-02', o: 1, h: 2, l: 0.5, c: 1.5, v: 0 })
    expect(normalizeBars(null)).toEqual([])
  })
  it('appends in order and never duplicates a date', () => {
    const out = appendForwardBars(normalizeBars([{ t: 20250102, o: 1, h: 1, l: 1, c: 1, v: 1 }]), [{ t: 20250102, o: 2, h: 2, l: 2, c: 2, v: 2 }, { t: 20250103, o: 3, h: 3, l: 3, c: 3, v: 3 }])
    expect(out.map((b) => b.t)).toEqual(['2025-01-02', '2025-01-03'])
  })
})

describe('useStudySession', () => {
  it('loads today, caches the set on the device, and starts at the first unanswered item', async () => {
    const fetcher = fetcherFor(payload())
    const { result } = renderHook(() => useStudySession({ fetcher }))
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.sessionId).toBe('sess-9')
    expect(result.current.items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(result.current.index).toBe(0)
    expect(result.current.current.id).toBe('a')
    expect(JSON.parse(window.localStorage.getItem(SET_CACHE_KEY)).session_id).toBe('sess-9')
    expect(result.current.barsFor('b')[0]).toEqual({ t: '2025-01-02', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 })
    expect(result.current.barsFor('a')).toBeNull()
  })

  it('resumes past answered_item_ids and counts them in the summary', async () => {
    const p = payload(); p.answered_item_ids = ['a', 'b']
    const { result } = renderHook(() => useStudySession({ fetcher: fetcherFor(p) }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.index).toBe(2)
    expect(result.current.current.id).toBe('c')
    expect(result.current.summary.answered).toBe(2)
    expect(result.current.finished).toBe(false)
  })

  it('answers: writes the outbox first, POSTs with time_ms, appends forward bars to the SAME item bars, tracks the combo', async () => {
    const fetcher = fetcherFor(payload())
    const { result } = renderHook(() => useStudySession({ fetcher }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let res
    await act(async () => { res = await result.current.answer({ choice: 'a' }, 1234) })
    expect(res.correct).toBe(true)
    expect(result.current.results.a.correct).toBe(true)
    expect(result.current.combo).toBe(1)
    expect(readOutbox()).toHaveLength(0)
    const post = fetcher.mock.calls.find(([u]) => u === ATTEMPTS_URL)[1]
    expect(post).toMatchObject({ method: 'POST', body: { item_id: 'a', session_id: 'sess-9', answer: { choice: 'a' }, time_ms: 1234 } })
    act(() => result.current.next())
    expect(result.current.current.id).toBe('b')
    expect(result.current.barsFor('b')).toHaveLength(2)
    await act(async () => { await result.current.answer({ choice: 'b' }) })
    expect(result.current.results.b.correct).toBe(false)
    expect(result.current.combo).toBe(0)
    expect(result.current.barsFor('b').map((x) => x.t)).toEqual(['2025-01-02', '2025-01-03', '2025-01-06'])
    expect(result.current.summary).toMatchObject({ total: 3, correct: 1, answered: 2, xp: 20 })
  })

  it('a failed POST keeps the row in the ten-row outbox, marks the item pending, and replays on online', async () => {
    const fetcher = fetcherFor(payload(), { failPost: 1 })
    const { result } = renderHook(() => useStudySession({ fetcher }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let res
    await act(async () => { res = await result.current.answer({ choice: 'a' }) })
    expect(res.failed).toBe(true)
    expect(result.current.results.a).toMatchObject({ pending: true, failed: true })
    expect(readOutbox()).toHaveLength(1)
    expect(readOutbox()[0]).toMatchObject({ id: 'sess-9:a', item_id: 'a', session_id: 'sess-9', answer: { choice: 'a' } })
    expect(result.current.summary.pending).toBe(1)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(readOutbox()).toHaveLength(0))
    expect(result.current.results.a.correct).toBe(true)
    expect(result.current.summary.pending).toBe(0)
  })

  it('the outbox keeps ten rows, dropping the oldest', async () => {
    const fetcher = fetcherFor({ session_id: 's', answered_item_ids: [], items: Array.from({ length: 12 }, (_, i) => item(`i${i}`)) }, { failPost: 12 })
    const { result } = renderHook(() => useStudySession({ fetcher }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    for (let i = 0; i < 12; i++) {
      await act(async () => { await result.current.answer({ choice: 'b' }) })
      act(() => result.current.next())
    }
    const rows = JSON.parse(window.localStorage.getItem(OUTBOX_KEY))
    expect(rows).toHaveLength(10)
    expect(rows[0].item_id).toBe('i2')
    expect(rows[9].item_id).toBe('i11')
    expect(result.current.finished).toBe(true)
  })

  it('defer moves the current item to the end (D7 "Skip this one"), and ensureBars fetches a missing window', async () => {
    const p = payload(); p.items.push(item('z', 'spot', { has_chart: true }))
    const fetcher = fetcherFor(p)
    const { result } = renderHook(() => useStudySession({ fetcher }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.defer())
    expect(result.current.items.map((i) => i.id)).toEqual(['b', 'c', 'z', 'a'])
    expect(result.current.current.id).toBe('b')
    let bars
    await act(async () => { bars = await result.current.ensureBars('z') })
    expect(bars).toEqual([{ t: '2025-01-10', o: 1, h: 1, l: 1, c: 1, v: 1 }])
    expect(result.current.barsFor('z')).toHaveLength(1)
  })

  it('falls back to the cached set when /today cannot be reached, and reports an error without one', async () => {
    window.localStorage.setItem(SET_CACHE_KEY, JSON.stringify(payload()))
    const failing = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const { result } = renderHook(() => useStudySession({ fetcher: failing }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.offline).toBe(true)
    expect(result.current.items).toHaveLength(3)

    window.localStorage.clear()
    const { result: r2 } = renderHook(() => useStudySession({ fetcher: failing }))
    await waitFor(() => expect(r2.current.status).toBe('error'))
    expect(r2.current.error).toBeInstanceOf(TypeError)
  })

  it('uses a payload handed in (a practice set) without fetching today', async () => {
    const fetcher = fetcherFor(payload())
    const initial = { session_id: 'practice-1', kind: 'refresher', answered_item_ids: [], items: [item('p1')] }
    const { result } = renderHook(() => useStudySession({ initial, fetcher }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.sessionId).toBe('practice-1')
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('useStudySession walk-throughs (unscored, spec 13.9 #1)', () => {
  const walk = (id) => ({ id, type: 'walkthrough', prompt_json: { q: 'Regime', order: 1, steps: ['One.', 'Two.'] } })

  function fetcherWithWalks(p) {
    return vi.fn(async (url, opts = {}) => {
      if (url === TODAY_URL) return p
      if (url === ATTEMPTS_URL) {
        if (String(opts.body.item_id).startsWith('w')) {
          return { attempt_id: 1, item_id: opts.body.item_id, correct: true, score: null, unscored: true, reveal: {}, progress: { xp_gained: 0 } }
        }
        return { attempt_id: 2, item_id: opts.body.item_id, correct: opts.body.answer.choice === 'a', score: 1, reveal: {}, progress: { xp_gained: 10 } }
      }
      throw new Error(`unexpected ${url}`)
    })
  }

  it('a seen walk-through keeps the combo, counts in summary.seen, never in total / correct / xp', async () => {
    const p = { session_id: 's', kind: 'unit', answered_item_ids: [], items: [item('a'), walk('w1'), item('c')] }
    const { result } = renderHook(() => useStudySession({ fetcher: fetcherWithWalks(p) }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(isUnscoredItem(walk('w1'))).toBe(true)
    expect(isUnscoredItem(item('a'))).toBe(false)
    expect(result.current.summary).toMatchObject({ total: 2, seen: 0 })
    await act(async () => { await result.current.answer({ choice: 'a' }) })
    expect(result.current.combo).toBe(1)
    act(() => result.current.next())
    expect(result.current.current.id).toBe('w1')
    let res
    await act(async () => { res = await result.current.answer({ seen: 2 }) })
    expect(res.unscored).toBe(true)
    expect(result.current.combo).toBe(1)                       // untouched by a seen row
    expect(result.current.results.w1).toMatchObject({ answered: true, unscored: true })
    expect(result.current.summary).toMatchObject({ total: 2, correct: 1, answered: 1, seen: 1, xp: 10 })
    act(() => result.current.next())
    await act(async () => { await result.current.answer({ choice: 'b' }) })
    expect(result.current.combo).toBe(0)
    expect(result.current.summary).toMatchObject({ total: 2, correct: 1, answered: 2, seen: 1, xp: 20 })   // the stub pays 10 either way
  })

  it('a failed post on a walk-through stays pending without resetting the combo', async () => {
    const p = { session_id: 's', kind: 'unit', answered_item_ids: [], items: [item('a'), walk('w2')] }
    const fetcher = fetcherWithWalks(p)
    const { result } = renderHook(() => useStudySession({ fetcher }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => { await result.current.answer({ choice: 'a' }) })
    act(() => result.current.next())
    fetcher.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch') })
    await act(async () => { await result.current.answer({ seen: 2 }) })
    expect(result.current.results.w2).toMatchObject({ pending: true, failed: true })
    expect(result.current.combo).toBe(1)
    expect(result.current.summary).toMatchObject({ total: 1, correct: 1, seen: 0, pending: 0 })
    expect(readOutbox()).toHaveLength(1)
  })
})
