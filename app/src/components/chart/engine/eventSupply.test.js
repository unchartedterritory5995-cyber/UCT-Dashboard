// ─── ⭐⭐ T4 E2 — THE CHART'S EVENTS DOOR: ONE ASK PER SYMBOL, NEVER `/api/bars` ─────────────────────────────────
//
// `eventSupply.js` is the chart's cache of `GET /api/pine/events/<symbol>` (E1). What these rails hold:
//   * an event read is asked of THAT door only, once per symbol, and never of `/api/bars`, the exchange lookup or a
//     symbol input (coordinator ruling 2026-11-22 (2));
//   * the door's answers become the entry the bind reads: 200 available, 202 pending (asked again), 404 dark (a plain
//     named refusal, ruling (3), never asked again), a failure an error (asked again later), a switch-abort forgotten.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { ensureEvents, fetchEvents, clearEvents, eventsUrl, subscribeEvents } from './eventSupply'
import { ensureChartSources, eventsNeededBy } from './useSecondarySources'
import { EVENTS_KEY } from './pineEvents'
import { fetchableOtherSymbols } from './otherSymbols'
import { translatePine } from './ast/pine'
import { clearSecondaryBars } from './secondaryBars'

afterEach(() => { clearEvents(); clearSecondaryBars(); vi.useRealTimers() })

const DOC = { schema: 'uct.pine-events/v1', symbol: 'AAPL', state: 'ready', refreshedAt: 1763800000,
  families: { earnings: { state: 'ok', knownFrom: '2026-01-06', rows: [] } } }
const answer = (status, body) => () => {
  if (status >= 400) return Promise.reject(Object.assign(new Error(`HTTP ${status}`), { status }))
  return Promise.resolve(body)
}

describe('E2 — the events door', () => {
  it('asks /api/pine/events/<SYMBOL> once, and the answer is the entry the bind reads', async () => {
    const asked = []
    const fetcher = (url) => { asked.push(url); return Promise.resolve(DOC) }
    expect(ensureEvents('aapl', fetcher)).toMatchObject({ status: 'loading' })
    expect(ensureEvents('AAPL', fetcher)).toMatchObject({ status: 'loading' })
    await fetchEvents('AAPL', fetcher)
    const e = ensureEvents('AAPL', fetcher)
    expect(e).toMatchObject({ status: 'available', symbol: 'AAPL', events: DOC, rev: '1763800000' })
    expect(ensureEvents('AAPL', fetcher)).toBe(e)                 // the same object: no change, no repaint
    expect(asked).toEqual(['/api/pine/events/AAPL'])
    expect(eventsUrl('brk.b')).toBe('/api/pine/events/BRK.B')
  })

  it('404 (the door dark for this member) is `dark`, never asked again; 202 is `pending`, asked again', async () => {
    vi.useFakeTimers()
    let calls = 0
    await fetchEvents('MSFT', () => { calls += 1; return answer(404)() })
    expect(ensureEvents('MSFT', () => { calls += 1; return answer(404)() })).toMatchObject({ status: 'dark' })
    expect(calls).toBe(1)
    let landed = 0
    const off = subscribeEvents(() => { landed += 1 })
    await fetchEvents('NVDA', answer(200, { state: 'pending', symbol: 'NVDA' }))
    expect(ensureEvents('NVDA', answer(200, DOC))).toMatchObject({ status: 'pending' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(landed).toBeGreaterThan(1)                             // the retry came due and woke the chart
    ensureEvents('NVDA', answer(200, { ...DOC, symbol: 'NVDA' }))   // ... which asks again
    await vi.runAllTimersAsync()
    expect(ensureEvents('NVDA')).toMatchObject({ status: 'available', symbol: 'NVDA' })
    off()
  })

  it('a failure is `error` (asked again after its wait); a switch-abort is forgotten', async () => {
    await fetchEvents('JPM', answer(503))
    expect(ensureEvents('JPM')).toMatchObject({ status: 'error' })
    await fetchEvents('TSLA', () => Promise.reject(Object.assign(new Error('aborted'), { canceled: true })))
    let asked = 0
    expect(ensureEvents('TSLA', () => { asked += 1; return Promise.resolve(DOC) })).toMatchObject({ status: 'loading' })
    await Promise.resolve()
    expect(asked).toBe(1)                                         // asked again at once: an abort is no failure
  })
})

describe('E2 — an event read reaches the events door and nothing else (ruling (2))', () => {
  const def = () => {
    const t = translatePine(['//@version=5', 'indicator("e")',
      'plot(request.earnings(syminfo.tickerid, earnings.actual, barmerge.gaps_on, barmerge.lookahead_on))'].join('\n'), { strict: true })
    return { id: 'u_evtdoor', compute: { kind: 'ast', trees: { p0: t.outputs[0].ast } },
      meta: { recurrenceOrigin: 'pine', otherSymbols: t.otherSymbols } }
  }

  it('the chart needs the events key, never the read\'s ticker as a bars key', () => {
    const d = def()
    expect(eventsNeededBy([{ defId: 'x' }], () => d)).toBe(true)
    expect(fetchableOtherSymbols(d)).toEqual([])
  })

  it('ensureChartSources: the events key asks the events door with the chart\'s symbol, and the bars door nothing', async () => {
    const asked = []
    const fetcher = (url) => { asked.push(url); return Promise.resolve(url.startsWith('/api/pine/events/') ? DOC : { bars: [] }) }
    const out = ensureChartSources([EVENTS_KEY], 'D', 600, fetcher, 'AAPL')
    expect(out.get(EVENTS_KEY)).toMatchObject({ status: 'loading', symbol: 'AAPL' })
    await Promise.resolve(); await Promise.resolve()
    expect(asked).toEqual(['/api/pine/events/AAPL'])
    expect(asked.some((u) => u.startsWith('/api/bars'))).toBe(false)
  })
})
