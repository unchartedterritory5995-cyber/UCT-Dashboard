/* GROUP-META-TRUNCATED-AT-500 — the "we only asked for 500" rail.
 *
 * `api/routers/breadth_monitor.py` caps /api/breadth/industries at 500 tickers
 * per call and returns the truncated map with NO indication it truncated. The
 * hook used to POST the whole list in one request, so a 2,667-name universe
 * drill (measured live 2026-09-07: 2,667 sent, 500 answered, 2,167 absent) fed
 * `groupItems` a map missing 81% of its tickers. Those all bucket as
 * `Unclassified`, which SORTS LAST, so the screen showed a few real industries
 * above a 2,167-strong pile that reads as "the data has no industry for these".
 *
 * A question we never asked and a gap in the data are indistinguishable on
 * screen, and only one of them is true. Hence chunking.
 *
 * ⛔ The cap must NOT be raised to fix this: the theme half is one SQLite query
 * per ticker on the single shared web pod (500 measured at 3.2s), so one 2,667
 * request would park ~17s of sequential SQLite on an anyio worker — the
 * 2026-07-01 threadpool-exhaustion class.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import useGroupMeta, { CHUNK } from './useGroupMeta'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROUTER = resolve(HERE, '../../../../../api/routers/breadth_monitor.py')

/** The server's own cap, read out of the router rather than retyped here. */
function serverCap() {
  const py = readFileSync(ROUTER, 'utf8')
  const m = py.match(/tickers\s*=\s*\[[^\]]*\]\[:(\d+)\]/)
  return m ? Number(m[1]) : null
}

/** A fake endpoint that truncates exactly like the real one. */
function makeServer({ cap = 500, industryFor = (t) => `Ind:${t[0]}` } = {}) {
  const calls = []
  let inFlight = 0
  let peak = 0
  const fetchMock = async (_url, init) => {
    const sent = JSON.parse(init.body).tickers
    calls.push(sent)
    inFlight++; peak = Math.max(peak, inFlight)
    await new Promise(r => setTimeout(r, 5))
    inFlight--
    const kept = sent.slice(0, cap)          // ← the silent truncation
    const industries = {}, sectors = {}, themes = {}
    for (const t of kept) { industries[t] = industryFor(t); sectors[t] = 'Tech'; themes[t] = null }
    return { ok: true, json: async () => ({ industries, sectors, themes }) }
  }
  return { fetchMock, calls, peak: () => peak }
}

const syms = (n, p = 'T') => Array.from({ length: n }, (_, i) => `${p}${i}`)

afterEach(() => { vi.unstubAllGlobals() })

describe('CONTROL — the rail is reasoning about a cap that still exists', () => {
  test('the router still truncates, and CHUNK does not exceed its cap', () => {
    const cap = serverCap()
    expect(cap, 'no `[:N]` cap found in breadth_monitor.py — if the cap moved or ' +
      'went away, re-derive CHUNK instead of leaving this rail guarding nothing').not.toBeNull()
    expect(CHUNK).toBeLessThanOrEqual(cap)
  })

  test('the fake server really does truncate (else every test below is vacuous)', async () => {
    const { fetchMock } = makeServer({ cap: 500 })
    const r = await fetchMock('/x', { body: JSON.stringify({ tickers: syms(700) }) })
    expect(Object.keys((await r.json()).industries)).toHaveLength(500)
  })
})

describe('every ticker gets answered, however long the list', () => {
  test('1,200 tickers against a 500-cap server: none are silently dropped', async () => {
    const { fetchMock, calls } = makeServer({ cap: 500 })
    vi.stubGlobal('fetch', fetchMock)
    const list = syms(1200)
    const { result } = renderHook(() => useGroupMeta(list))
    await waitFor(() => expect(Object.keys(result.current.industries)).toHaveLength(1200))

    // The pre-fix behaviour was ONE call of 1,200 answering 500.
    expect(calls.length).toBeGreaterThan(1)
    for (const c of calls) expect(c.length).toBeLessThanOrEqual(CHUNK)
    const unanswered = list.filter(s => !(s in result.current.industries))
    expect(unanswered, 'these tickers would render as Unclassified').toEqual([])
  })

  test('a list at exactly CHUNK still goes in one call', async () => {
    const { fetchMock, calls } = makeServer()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useGroupMeta(syms(CHUNK)))
    await waitFor(() => expect(Object.keys(result.current.industries)).toHaveLength(CHUNK))
    expect(calls).toHaveLength(1)
  })

  test('never more than 2 requests in flight (the pod shares one threadpool)', async () => {
    const { fetchMock, peak } = makeServer()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useGroupMeta(syms(2500)))
    await waitFor(() => expect(Object.keys(result.current.industries)).toHaveLength(2500))
    expect(peak()).toBeLessThanOrEqual(2)
  })

  test('a failed slice does not lose the slices around it', async () => {
    const { fetchMock } = makeServer()
    let n = 0
    vi.stubGlobal('fetch', async (u, i) => {
      if (++n === 1) throw new Error('network')
      return fetchMock(u, i)
    })
    const { result } = renderHook(() => useGroupMeta(syms(1200)))
    // 1,200 minus the one dropped slice still lands, rather than the hook aborting.
    await waitFor(() => expect(Object.keys(result.current.industries).length).toBeGreaterThanOrEqual(700))
  })

  test('an UNSTABLE array prop does not restart the fetch on every render', async () => {
    // The footgun this hook is keyed on content to avoid: a caller building its
    // list inline hands a new array identity every render. Keyed on identity the
    // effect re-runs, setMeta renders, and it re-runs again - forever.
    const { fetchMock, calls } = makeServer()
    vi.stubGlobal('fetch', fetchMock)
    const { result, rerender } = renderHook(() => useGroupMeta(syms(120)))
    await waitFor(() => expect(Object.keys(result.current.industries)).toHaveLength(120))
    rerender(); rerender(); rerender()
    await new Promise(r => setTimeout(r, 60))
    expect(calls, 'same tickers, so no re-fetch however the array is built').toHaveLength(1)
  })

  test('the retry pass is BOUNDED, so a mostly-unclassified list is not re-asked in full', async () => {
    // A universe-sized list where the server legitimately knows no industry: every
    // ticker comes back null. Unbounded, the retry would re-send all 2,500.
    vi.useRealTimers()
    const { fetchMock, calls } = makeServer({ industryFor: () => null })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useGroupMeta(syms(2500)))
    await waitFor(() => expect(Object.keys(result.current.industries)).toHaveLength(2500))
    const firstPass = calls.length
    await new Promise(r => setTimeout(r, 3200))       // past the 2.5s retry delay
    const retried = calls.slice(firstPass).reduce((n, c) => n + c.length, 0)
    expect(retried, 'retry must not replay the whole list').toBeLessThanOrEqual(CHUNK * 2)
  }, 15000)
})
