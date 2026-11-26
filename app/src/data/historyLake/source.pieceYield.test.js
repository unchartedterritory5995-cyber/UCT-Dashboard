// @vitest-environment node
/**
 * SMOOTHNESS PART 2, ITEM (2b): ONE LAKE PIECE PER TASK (2026-11-26).
 *
 * Trace (local dist 4bc325e4ae, 1m+15m board, 5 traced switches): the deep history's pieces decoded back to back in one
 * main-thread task (18-27 ms, 160-215 ms after both charts showed the new symbol: a dropped frame each). `loadPiece` now
 * waits for a later task between a piece's bytes arriving and its decode, so pieces that land together are decoded in
 * tasks of their own.
 *   Y1 a series of three pieces waits for a later task once per piece, each after that piece's bytes arrived, and loads
 *      exactly the bars it loaded before (the fixture's, from the Python reference) (red before the change: no wait)
 *   Y2 the default wait (`nextTask`) resolves after the microtasks queued before it, in a later task, and a load through it
 *      returns the same bars
 */
import { describe, it, expect } from 'vitest'
import fixture from './__fixtures__/source.json'
import { parsePrefix } from './piece'
import { createHistorySource, nextTask, HEADER_NAME } from './source'
import zlib from 'node:zlib'

const bytesOf = (b64) => new Uint8Array(Buffer.from(b64, 'base64'))

// the edge, as source.test.js answers it: the header as JSON, the body already inflated
function edge() {
  const pieces = new Map(fixture.pieces.map((p) => [`/api/hist/${p.relpath}`, bytesOf(p.b64)]))
  const st = { bodies: 0 }
  st.fetch = async (url) => {
    const [path] = url.split('?')
    if (path === `/api/hist/${fixture.index_relpath}`) return new Response(JSON.stringify(fixture.index), { status: 200 })
    const data = pieces.get(path)
    if (!data) return new Response('{}', { status: 404 })
    const { header, offset } = parsePrefix(data)
    const body = new Uint8Array(zlib.brotliDecompressSync(data.subarray(offset)))
    const res = new Response(body, { status: 200, headers: { [HEADER_NAME]: JSON.stringify(header) } })
    const ab = res.arrayBuffer.bind(res)
    res.arrayBuffer = async () => { const out = await ab(); st.bodies += 1; return out }
    return res
  }
  return st
}

const want = fixture.expected['5']
const expectBars = (got) => {
  expect(Array.from(got.t)).toEqual(want.raw.t)
  for (const k of ['o', 'h', 'l', 'c', 'v']) expect(Array.from(got[k])).toEqual(want.adjusted[k])
}

describe('one lake piece per task', () => {
  it('Y1 a three-piece series waits once per piece, after its bytes, and loads the same bars', async () => {
    const e = edge()
    const waits = []
    const src = createHistorySource({ fetch: e.fetch, yieldTask: () => { waits.push(e.bodies); return Promise.resolve() } })
    const got = await src.loadBars('MU-LT', '5')
    expect(got.pieces).toBe(3)
    expectBars(got)
    expect(waits).toHaveLength(3)
    waits.forEach((bodiesRead, i) => expect([i, bodiesRead >= i + 1]).toEqual([i, true]))   // the i-th wait follows its bytes
  })

  it('Y2 the default wait resolves in a later task, and a load through it returns the same bars', async () => {
    let hops = 0
    const spin = async () => { for (let i = 0; i < 500; i++) { await Promise.resolve(); hops += 1 } }
    const spinning = spin()
    await nextTask()
    expect(hops).toBe(500)                               // every microtask queued before it ran first
    await spinning
    const got = await createHistorySource({ fetch: edge().fetch }).loadBars('MU-LT', '5')
    expectBars(got)
  })
})
