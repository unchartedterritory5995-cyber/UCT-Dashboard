// @vitest-environment node
// ⭐ (2026-11-26, the typed ticker) ONE REQUEST PER PIECE IN FLIGHT. The typed warm primes the lake (`warmPieces`) and seeds
// it (`loadBars`) off the same index answer, so both asked every piece at the same instant: two requests per piece (the
// second answered behind the first by the browser's cache lock, still holding one of the `maxParallel` slots). Measured on
// production: every 5m quarter of AMD / TSLA / META / AAPL / MSFT requested twice, 140-450 ms before Enter.
//   F1 (red first) a warm and a read of the same pieces at once: every piece asked ONCE, the bars exactly the reference's
//   F2 two reads at once: every piece once, both answers exact
//   F3 nothing is kept once settled: a later read asks again (the browser's cache answers it, as before)
//   F4 a read given up while it waits on another's request rejects at once, and that request still answers its owner
//   F5 a request given up by ITS owner is asked again for a read that still wants the piece
//   F6 (review of #2852) ...however deep: A owns, B and C join, A gives up, B (asking again) gives up, C still gets the bytes
import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import fixture from './__fixtures__/source.json'
import { parsePrefix } from './piece'
import { createHistorySource, HEADER_NAME } from './source'

const INDEX = fixture.index
const SYM = fixture.symbol
const Q = INDEX.series['5']
const QUARTERS = ['2026Q2', '2026Q3', '2026Q4']
const INDEX_URL = `/api/hist/${fixture.index_relpath}`
const pieceUrlOf = (p) => `/api/hist/v1/5/s-MU_2ELT/${p}.ubh?c=${Q[p].crc}&o=0&n=${Q[p].bytes}`
const bytesOf = (b64) => new Uint8Array(Buffer.from(b64, 'base64'))
const entries = () => QUARTERS.map((p) => ({ ...Q[p], period: p }))

// The edge as source.test.js answers it, with a fetch that honours its signal while the answer is on the way.
function edge({ delayMs = 5 } = {}) {
  const pieces = new Map(fixture.pieces.map((p) => [`/api/hist/${p.relpath}`, bytesOf(p.b64)]))
  const calls = []
  const answer = (url) => {
    const [path] = url.split('?')
    if (path === INDEX_URL) return new Response(JSON.stringify(INDEX), { status: 200 })
    const data = pieces.get(path)
    if (!data) return new Response('{}', { status: 404 })
    const { header, offset } = parsePrefix(data)
    const body = new Uint8Array(zlib.brotliDecompressSync(data.subarray(offset)))
    return new Response(body, { status: 200, headers: { [HEADER_NAME]: JSON.stringify(header) } })
  }
  const fetch = (url, init = {}) => new Promise((resolve, reject) => {
    calls.push(url)
    const sig = init.signal
    const fail = () => reject(sig.reason ?? new DOMException('aborted', 'AbortError'))
    if (sig?.aborted) { fail(); return }
    const t = setTimeout(() => resolve(answer(url)), delayMs)
    sig?.addEventListener('abort', () => { clearTimeout(t); fail() }, { once: true })
  })
  return { fetch, calls, pieceCalls: () => calls.filter((u) => u !== INDEX_URL) }
}

const expectBars = (got) => {
  const want = fixture.expected['5']
  expect(Array.from(got.t)).toEqual(want.raw.t)
  for (const k of ['o', 'h', 'l', 'c', 'v']) expect(Array.from(got[k])).toEqual(want.adjusted[k])
}
const countOf = (calls, url) => calls.filter((u) => u === url).length

describe('history-lake source: one request per piece in flight', () => {
  it('F1 (red first) a warm and a read of the same pieces at once ask every piece ONCE, and the bars are exact', async () => {
    const e = edge()
    const src = createHistorySource({ fetch: e.fetch, yieldTask: () => null })
    await src.loadIndex(SYM)
    const [, got] = await Promise.all([src.warmPieces(SYM, '5', entries()), src.loadBars(SYM, '5')])
    expectBars(got)
    for (const p of QUARTERS) expect(countOf(e.calls, pieceUrlOf(p)), `${p} was asked more than once`).toBe(1)
  })

  it('F2 two reads at once ask every piece once, and both answers are exact', async () => {
    const e = edge()
    const src = createHistorySource({ fetch: e.fetch, yieldTask: () => null })
    await src.loadIndex(SYM)
    const [a, b] = await Promise.all([src.loadBars(SYM, '5'), src.loadBars(SYM, '5')])
    expectBars(a)
    expectBars(b)
    expect(e.pieceCalls().length).toBe(QUARTERS.length)
  })

  it('F3 nothing is kept once settled: a later read asks every piece again', async () => {
    const e = edge()
    const src = createHistorySource({ fetch: e.fetch, yieldTask: () => null })
    expectBars(await src.loadBars(SYM, '5'))
    expectBars(await src.loadBars(SYM, '5'))
    expect(e.pieceCalls().length).toBe(2 * QUARTERS.length)
  })

  it('F4 a read given up while it waits on a warm\'s request rejects at once; the warm still gets its pieces', async () => {
    const e = edge({ delayMs: 20 })
    const src = createHistorySource({ fetch: e.fetch, yieldTask: () => null })
    await src.loadIndex(SYM)
    const warm = src.warmPieces(SYM, '5', entries())
    const ctl = new AbortController()
    const read = src.loadBars(SYM, '5', { signal: ctl.signal })
    await new Promise((r) => setTimeout(r, 2))
    ctl.abort()
    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    await warm
    expect(e.pieceCalls().length).toBe(QUARTERS.length)   // the warm's requests, not one more
  })

  it('F5 a request given up by its owner is asked again for a read that still wants the piece', async () => {
    const e = edge({ delayMs: 20 })
    const src = createHistorySource({ fetch: e.fetch, yieldTask: () => null })
    await src.loadIndex(SYM)
    const ctl = new AbortController()
    const owner = src.loadBars(SYM, '5', { signal: ctl.signal })
    const other = src.loadBars(SYM, '5')
    await new Promise((r) => setTimeout(r, 2))
    ctl.abort()
    await expect(owner).rejects.toMatchObject({ name: 'AbortError' })
    expectBars(await other)
    expect(e.pieceCalls().length).toBe(2 * QUARTERS.length)   // the owner's (given up), then the other read's own
  })

  it('F6 (red first) a re-ask given up in turn is asked again: A owns, B and C join, A gives up, then B, and C still gets the bytes', async () => {
    const e = edge({ delayMs: 20 })
    const src = createHistorySource({ fetch: e.fetch, yieldTask: () => null })
    await src.loadIndex(SYM)
    const ca = new AbortController()
    const cb = new AbortController()
    const a = src.loadBars(SYM, '5', { signal: ca.signal })
    const b = src.loadBars(SYM, '5', { signal: cb.signal })
    const c = src.loadBars(SYM, '5')
    await new Promise((r) => setTimeout(r, 2))
    ca.abort()                                            // B asks again with its own signal, C joins B's request
    await expect(a).rejects.toMatchObject({ name: 'AbortError' })
    await new Promise((r) => setTimeout(r, 2))
    cb.abort()                                            // B gives up its request: C, whose signal never fired, asks again
    await expect(b).rejects.toMatchObject({ name: 'AbortError' })
    expectBars(await c)
  })
})
