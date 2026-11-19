// @vitest-environment node
import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import fixture from './__fixtures__/source.json'
import { parsePrefix, PieceError } from './piece'
import { createHistorySource, periodsFor, seriesFor, lakeSymbol, HistoryError, HEADER_NAME, MAX_PARALLEL } from './source'

// The fixture is built by the PYTHON encoder and reference (tools/history_lake/make_js_source_fixture.py):
// one synthetic symbol's pieces, its index with a split table, and the bars the reference returns.
// `edge()` answers the way edge/bars-edge-router/history.js does once the browser has inflated the body.
const INDEX = fixture.index
const SYM = fixture.symbol            // 'MU.LT' (the app's 'MU-LT')
const bytesOf = (b64) => new Uint8Array(Buffer.from(b64, 'base64'))

function edge(over = {}) {
  const pieces = new Map(fixture.pieces.map((p) => [`/api/hist/${p.relpath}`, bytesOf(p.b64)]))
  const calls = []
  let inFlight = 0
  let peak = 0
  const state = { index: over.index === undefined ? INDEX : over.index, indexStatus: 200, ...over, calls, peak: () => peak, pieces }
  const answer = async (url) => {
    const [path, query = ''] = url.split('?')
    if (state.indexes && Object.hasOwn(state.indexes, path)) return new Response(JSON.stringify(state.indexes[path]), { status: 200 })
    if (path === `/api/hist/${fixture.index_relpath}`) {
      if (state.indexStatus !== 200) return new Response('{}', { status: state.indexStatus })
      const doc = typeof state.index === 'function' ? state.index() : state.index
      return doc === null ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(doc), { status: 200 })
    }
    const data = pieces.get(path)
    if (!data) return new Response('{}', { status: 404 })
    const { header, offset } = parsePrefix(data)
    if (state.pieceStatus && state.pieceStatus(path)) return new Response('{}', { status: state.pieceStatus(path) })
    const q = new URLSearchParams(query)
    const c = q.get('c')
    if (!state.ignoreVersionKey && c !== null && c !== String(header.crc)) return new Response('{}', { status: 409 })
    // one symbol per pack in this fixture: the piece is the pack's first `n` bytes
    if (!state.ignoreVersionKey && (q.get('o') !== '0' || q.get('n') !== String(data.length))) return new Response('{}', { status: 409 })
    let body = new Uint8Array(zlib.brotliDecompressSync(data.subarray(offset)))
    let headerJson = JSON.stringify(header)
    if (state.tamper) ({ body, headerJson } = state.tamper(path, { body, headerJson, header }))
    return new Response(body, { status: 200, headers: headerJson == null ? {} : { [HEADER_NAME]: headerJson } })
  }
  state.fetch = async (url, init) => {
    calls.push({ url, init })
    inFlight++; peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 1))
    try { return await answer(url) } finally { inFlight-- }
  }
  return state
}

const expectBars = (got, series, which = 'adjusted') => {
  const want = fixture.expected[series]
  expect(Array.from(got.t)).toEqual(want.raw.t)
  expect(Array.from(got.n)).toEqual(want.raw.n)
  for (const k of ['o', 'h', 'l', 'c', 'v']) expect(Array.from(got[k])).toEqual(which === 'raw' ? want.raw[k] : want.adjusted[k])
}

describe('history-lake source', () => {
  it('has the fixture it claims to test against', () => {
    expect(Object.keys(INDEX.series['5'])).toEqual(['2026Q2', '2026Q3', '2026Q4'])
    expect(INDEX.splits.length).toBe(2)
    const w = fixture.expected['5']
    const moved = w.raw.c.filter((x, i) => x !== w.adjusted.c[i]).length
    expect(moved).toBeGreaterThan(0)
    expect(moved).toBeLessThan(w.raw.c.length)        // some bars are before the splits, some after
  })

  it('loads a whole series: every piece once, joined oldest first, split-adjusted like the reference', async () => {
    const e = edge()
    const src = createHistorySource({ fetch: e.fetch })
    const got = await src.loadBars('MU-LT', '5')
    expect(got).toMatchObject({ symbol: SYM, series: '5', pieces: 3, adjusted: true })
    expectBars(got, '5')
    expect(e.calls.map((c) => c.url)).toEqual([
      '/api/hist/v1/index/s-MU_2ELT.json',
      ...['2026Q2', '2026Q3', '2026Q4'].map((p) => `/api/hist/v1/5/s-MU_2ELT/${p}.ubh?c=${INDEX.series['5'][p].crc}&o=0&n=${INDEX.series['5'][p].bytes}`),
    ])
    expect(e.calls.every((c) => c.init.credentials === 'same-origin')).toBe(true)
  })

  it('raw: true leaves the vendor values alone', async () => {
    const src = createHistorySource({ fetch: edge().fetch })
    const got = await src.loadBars(SYM, '5', { raw: true })
    expect(got.adjusted).toBe(false)
    expectBars(got, '5', 'raw')
  })

  it('asks only for the pieces a time range touches, and the index only once', async () => {
    const e = edge()
    const src = createHistorySource({ fetch: e.fetch })
    const q = INDEX.series['5']
    const one = await src.loadBars(SYM, '5', { from: q['2026Q3'].first, to: q['2026Q3'].last })
    expect(one.pieces).toBe(1)
    expect(one.t[0]).toBe(q['2026Q3'].first)
    expect(one.t[one.t.length - 1]).toBe(q['2026Q3'].last)
    const two = await src.loadBars(SYM, '5', { from: q['2026Q3'].last })           // open-ended to the newest
    expect(two.pieces).toBe(2)
    expect((await src.loadBars(SYM, '5', { to: q['2026Q3'].first })).pieces).toBe(2)    // a range ending ON a piece's first bar holds it
    expect((await src.loadBars(SYM, '5', { from: q['2026Q3'].last })).pieces).toBe(2)   // and one starting ON a piece's last bar
    const edgeCase = await src.loadBars(SYM, '5', { to: q['2026Q2'].last })        // a range ending on a piece's last bar
    expect(edgeCase.pieces).toBe(1)
    expect((await src.loadBars(SYM, '5', { from: q['2026Q2'].last + 1, to: q['2026Q3'].first - 1 })).t.length).toBe(0)
    expect((await src.loadBars(SYM, '5', { to: q['2026Q2'].first - 1 })).pieces).toBe(0)
    expect(e.calls.filter((c) => c.url.includes('/index/')).length).toBe(1)
    // each adjusted the same way as in the whole series
    const whole = fixture.expected['5']
    const at = whole.raw.t.indexOf(one.t[0])
    expect(Array.from(one.c)).toEqual(whole.adjusted.c.slice(at, at + one.c.length))
  })

  it('maps the chart timeframe to a series, with the extended-hours 60m as its own', async () => {
    expect(['1', '5', '15', '30', '60'].map((tf) => seriesFor(tf))).toEqual(['1', '5', '15', '30', '60'])
    expect(seriesFor('60', { extended: true })).toBe('60e')
    expect(seriesFor(5)).toBe('5')
    for (const tf of ['D', 'W', 'M', '60e', '2', '', null, 'constructor']) expect(seriesFor(tf)).toBe(null)
    expect(lakeSymbol(' brk-b ')).toBe('BRK.B')
    const src = createHistorySource({ fetch: edge().fetch })
    expectBars(await src.loadBars(SYM, '60'), '60')
    expectBars(await src.loadBars(SYM, '60', { extended: true }), '60e')
    expect(await src.loadBars(SYM, 'D')).toBe(null)
    const quiet = edge()
    expect(await createHistorySource({ fetch: quiet.fetch }).loadBars(SYM, 'W')).toBe(null)
    expect(quiet.calls).toEqual([])                              // a timeframe the lake does not have asks nothing
    expect(await src.loadBars(SYM, '15')).toBe(null)             // the symbol has no such series
  })

  it('answers null for a symbol the lake does not hold, and keeps no failed index', async () => {
    const e = edge({ index: null })
    const src = createHistorySource({ fetch: e.fetch })
    expect(await src.loadBars(SYM, '5')).toBe(null)
    e.indexStatus = 503
    src.refreshIndex(SYM)
    await expect(src.loadBars(SYM, '5')).rejects.toMatchObject({ name: 'HistoryError', status: 503 })
    e.indexStatus = 200; e.index = INDEX
    expectBars(await src.loadBars(SYM, '5'), '5')                // the failure was not cached
    const wrong = createHistorySource({ fetch: edge({ index: { ...INDEX, symbol: 'OTHER' } }).fetch })
    await expect(wrong.loadBars(SYM, '5')).rejects.toThrow(/not this symbol's index/)
  })

  it('an out-of-date index is re-read once, then the failure is reported', async () => {
    const stale = JSON.parse(JSON.stringify(INDEX))
    stale.series['5']['2026Q3'].crc += 1
    let reads = 0
    const e = edge({ index: () => (++reads === 1 ? stale : INDEX) })
    const src = createHistorySource({ fetch: e.fetch })
    expectBars(await src.loadBars(SYM, '5'), '5')
    expect(reads).toBe(2)

    const always = edge({ index: stale })
    const src2 = createHistorySource({ fetch: always.fetch })
    await expect(src2.loadBars(SYM, '5')).rejects.toMatchObject({ name: 'HistoryError', stale: true, status: 409 })
    expect(always.calls.filter((c) => c.url.includes('/index/')).length).toBe(2)
  })

  it('refuses an answer that is not the piece it asked for, or not whole', async () => {
    const q3 = '/api/hist/v1/5/s-MU_2ELT/2026Q3.ubh'
    const run = (tamper, pieceStatus) => createHistorySource({ fetch: edge({ tamper, pieceStatus }).fetch }).loadBars(SYM, '5')
    await expect(run((p, x) => (p === q3 ? { ...x, headerJson: null } : x))).rejects.toThrow(/no piece header/)
    await expect(run((p, x) => (p === q3 ? { ...x, body: x.body.subarray(0, x.body.length - 3) } : x))).rejects.toThrow(PieceError)
    await expect(run((p, x) => { if (p !== q3) return x; const b = x.body.slice(); b[b.length >> 1] ^= 1; return { ...x, body: b } })).rejects.toThrow(PieceError)
    await expect(run((p, x) => (p === q3 ? { ...x, headerJson: JSON.stringify({ ...x.header, symbol: 'OTHER' }) } : x))).rejects.toThrow(/different piece/)
    await expect(run((p, x) => (p === q3 ? { ...x, headerJson: JSON.stringify({ ...x.header, period: '2025Q3' }) } : x))).rejects.toThrow(/different piece/)
    await expect(run(null, (p) => (p === q3 ? 500 : 0))).rejects.toMatchObject({ name: 'HistoryError', status: 500, stale: false })
    await expect(run(null, (p) => (p === q3 ? 401 : 0))).rejects.toMatchObject({ status: 401 })
    // an edge (or a cache in front of it) that ignores the version key and answers with other content
    const old = JSON.parse(JSON.stringify(INDEX))
    old.series['5']['2026Q3'].crc += 1
    await expect(createHistorySource({ fetch: edge({ index: old, ignoreVersionKey: true }).fetch }).loadBars(SYM, '5'))
      .rejects.toThrow(/different piece/)
    // a different piece's bytes under this piece's name (the index CRC is what catches it)
    const swapped = edge()
    swapped.pieces.set(q3, swapped.pieces.get('/api/hist/v1/5/s-MU_2ELT/2026Q2.ubh'))
    const idx = JSON.parse(JSON.stringify(INDEX))
    idx.series['5']['2026Q3'].crc = INDEX.series['5']['2026Q2'].crc
    idx.series['5']['2026Q3'].bytes = INDEX.series['5']['2026Q2'].bytes
    swapped.index = idx
    await expect(createHistorySource({ fetch: swapped.fetch }).loadBars(SYM, '5')).rejects.toThrow(/different piece/)
  })

  it('asks for each piece by its place in the pack, and treats an index without one as out of date', async () => {
    const e = edge()
    await createHistorySource({ fetch: e.fetch }).loadBars(SYM, '60')
    const e60 = INDEX.series['60']['2026']
    expect(e.calls.at(-1).url).toBe(`/api/hist/v1/60/s-MU_2ELT/2026.ubh?c=${e60.crc}&o=0&n=${e60.bytes}`)
    for (const bad of [undefined, -1, 1.5, '0']) {
      const idx = JSON.parse(JSON.stringify(INDEX))
      if (bad === undefined) delete idx.series['60']['2026'].off; else idx.series['60']['2026'].off = bad
      const w = edge({ index: idx })
      await expect(createHistorySource({ fetch: w.fetch }).loadBars(SYM, '60')).rejects.toMatchObject({ name: 'HistoryError', stale: true })
      expect(w.calls.filter((c) => c.url.includes('.ubh'))).toEqual([])          // never asked with a made-up place
    }
  })

  it('refuses pieces that overlap in time', async () => {
    const idx = JSON.parse(JSON.stringify(INDEX))
    const e = edge({ index: idx })
    // the index lists Q4 as if it were older than Q2: joined in that order the times go backwards
    idx.series['5']['2026Q4'].first = 1
    await expect(createHistorySource({ fetch: e.fetch }).loadBars(SYM, '5')).rejects.toThrow(/overlap in time/)
  })

  it('fetches pieces together, never more than the limit at once', async () => {
    const e = edge()
    await createHistorySource({ fetch: e.fetch }).loadBars(SYM, '5')
    expect(e.peak()).toBe(3)
    const e2 = edge()
    await createHistorySource({ fetch: e2.fetch, maxParallel: 2 }).loadBars(SYM, '5')
    expect(e2.peak()).toBe(2)
    expect(MAX_PARALLEL).toBeGreaterThanOrEqual(6)
  })

  it('passes the abort signal to every request', async () => {
    const e = edge()
    const ac = new AbortController()
    await createHistorySource({ fetch: e.fetch }).loadBars(SYM, '5', { signal: ac.signal })
    expect(e.calls.length).toBe(4)
    expect(e.calls.every((c) => c.init.signal === ac.signal)).toBe(true)
  })

  it('periodsFor reads only well-formed entries', () => {
    expect(periodsFor(null, '5')).toEqual([])
    expect(periodsFor({ series: {} }, '5')).toEqual([])
    const idx = { series: { 5: { b: { first: 20, last: 29, crc: 2 }, a: { first: 10, last: 19, crc: 1 }, bad: { first: 'x', last: 5 }, none: null } } }
    expect(periodsFor(idx, '5').map((p) => p.period)).toEqual(['a', 'b'])
    expect(periodsFor(idx, '5', { from: 19, to: 19 }).map((p) => p.period)).toEqual(['a'])
    expect(periodsFor(idx, '5', { from: 20 }).map((p) => p.period)).toEqual(['b'])
    expect(periodsFor(idx, '5', { from: 30 })).toEqual([])
    expect(new HistoryError('x').stale).toBe(false)
  })
})

// A reused ticker (tools/history_lake/identity.py): the index narrows a piece to the bars of THIS
// company (`from` / `until`), and names pieces stored under the symbol it traded as before (`sym`).
describe('history-lake source: identity windows and stitched history', () => {
  const Q = INDEX.series['5']
  const whole = fixture.expected['5']
  const pieceUrlOf = (p) => `/api/hist/v1/5/s-MU_2ELT/${p}.ubh?c=${Q[p].crc}&o=0&n=${Q[p].bytes}`
  const NEW_INDEX_PATH = '/api/hist/v1/index/s-NEWCO.json'

  it('a symbol whose history is another symbol\'s pieces reads them under that symbol, adjusted by its own table', async () => {
    const stitched = { v: 1, symbol: 'NEWCO', splits: INDEX.splits, series: { 5: Object.fromEntries(
      Object.entries(Q).map(([p, e]) => [`${p}~MU.LT`, { ...e, period: p, sym: SYM }])) } }
    const e = edge({ indexes: { [NEW_INDEX_PATH]: stitched } })
    const got = await createHistorySource({ fetch: e.fetch }).loadBars('NEWCO', '5')
    expect(got).toMatchObject({ symbol: 'NEWCO', pieces: 3 })
    expectBars(got, '5')
    expect(e.calls.slice(1).map((c) => c.url)).toEqual(['2026Q2', '2026Q3', '2026Q4'].map(pieceUrlOf))
  })

  it('an entry cut at `from` keeps only the bars from it on, and reports that window', async () => {
    const at = whole.raw.t.indexOf(Q['2026Q3'].first) + 7
    const cut = whole.raw.t[at]
    const idx = { ...INDEX, series: { 5: { '2026Q3': { ...Q['2026Q3'], from: cut }, '2026Q4': Q['2026Q4'] } } }
    expect(periodsFor(idx, '5')[0]).toMatchObject({ period: '2026Q3', first: cut, last: Q['2026Q3'].last })
    const got = await createHistorySource({ fetch: edge({ index: idx }).fetch }).loadBars(SYM, '5')
    expect(got.t[0]).toBe(cut)
    expect(Array.from(got.t)).toEqual(whole.raw.t.slice(at))
    expect(Array.from(got.c)).toEqual(whole.adjusted.c.slice(at))
    // a range wholly before the cut asks for nothing
    expect(periodsFor(idx, '5', { to: cut - 1 })).toEqual([])
  })

  it('one period from two pieces with complementary windows joins in order, every bar once', async () => {
    const lo = whole.raw.t.indexOf(Q['2026Q3'].first)
    const mid = whole.raw.t[lo + 11]
    const idx = { ...INDEX, series: { 5: {
      '2026Q3': { ...Q['2026Q3'], from: mid },                                   // this company's own piece
      '2026Q3~MU.LT': { ...Q['2026Q3'], period: '2026Q3', sym: SYM, until: mid },  // the earlier symbol's
    } } }
    expect(periodsFor(idx, '5').map((p) => [p.first, p.last])).toEqual([[Q['2026Q3'].first, mid - 1], [mid, Q['2026Q3'].last]])
    const got = await createHistorySource({ fetch: edge({ index: idx }).fetch }).loadBars(SYM, '5')
    const n = Q['2026Q3'].bars
    expect(Array.from(got.t)).toEqual(whole.raw.t.slice(lo, lo + n))
  })

  it('warms a stitched piece at the URL the read uses', async () => {
    const e = edge()
    const src = createHistorySource({ fetch: e.fetch })
    await src.warmPieces('NEWCO', '5', [{ ...Q['2026Q4'], period: '2026Q4', sym: SYM }])
    expect(e.calls.map((c) => c.url)).toEqual([pieceUrlOf('2026Q4')])
  })
})
