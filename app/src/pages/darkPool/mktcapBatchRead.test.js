// TERM-033: the Dark Pool market-cap batch read names its failure and hands the names back.
//
//     cd app && npx vitest run src/pages/darkPool/mktcapBatchRead.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readMktcapBatch, MKTCAP_BATCH_FAILED, isMktcapBatchFailed } from './mktcapBatchRead'

const res = (status, body, { badJson = false } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: badJson ? () => Promise.reject(new SyntaxError('bad')) : () => Promise.resolve(body),
})

afterEach(() => vi.restoreAllMocks())

describe('readMktcapBatch', () => {
  it('asks for the batch and resolves the body; the attempted set is untouched', async () => {
    const body = { mktcap: { AAPL: 3e12, MSFT: 3.1e12 } }
    const f = vi.fn(() => Promise.resolve(res(200, body)))
    const attempted = new Set(['AAPL', 'MSFT'])
    await expect(readMktcapBatch('', ['AAPL', 'MSFT'], attempted, f)).resolves.toBe(body)
    expect(f).toHaveBeenCalledWith('/api/schwab/mktcap-batch?symbols=AAPL,MSFT')
    expect([...attempted]).toEqual(['AAPL', 'MSFT'])
  })

  it('a batch the server answered with no caps is an answer, not a failure', async () => {
    const out = await readMktcapBatch('', ['ZZZZ'], new Set(['ZZZZ']), () => Promise.resolve(res(200, { mktcap: {} })))
    expect(isMktcapBatchFailed(out)).toBe(false)
  })

  it.each([
    ['a non-OK status', () => Promise.resolve(res(502, null)), 'HTTP 502'],
    ['a network error', () => Promise.reject(new Error('reset')), 'network: reset'],
    ['an unreadable body', () => Promise.resolve(res(200, null, { badJson: true })), 'unreadable body'],
  ])('%s resolves the sentinel, says why, and hands the symbols back for a retry', async (_l, f, why) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const attempted = new Set(['AAPL', 'MSFT', 'KEEP'])
    const out = await readMktcapBatch('', ['AAPL', 'MSFT'], attempted, f)
    expect(out).toBe(MKTCAP_BATCH_FAILED)
    expect([...attempted]).toEqual(['KEEP'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain(why)
    expect(warn.mock.calls[0][0]).toContain('2 symbol(s)')
  })

  it("the sentinel carries no `mktcap`, so the page's merge loop skips it as before", () => {
    const merged = {}
    for (const data of [MKTCAP_BATCH_FAILED, { mktcap: { A: 1 } }]) {
      if (data?.mktcap) Object.assign(merged, data.mktcap)
    }
    expect(merged).toEqual({ A: 1 })
    expect(Object.isFrozen(MKTCAP_BATCH_FAILED)).toBe(true)
  })
})
