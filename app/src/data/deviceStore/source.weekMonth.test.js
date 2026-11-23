// @vitest-environment node
// H1 (review of #2537): W AND M ARE NOT SERVED BY THE DEVICE. They were derived on the device from its D bars
// (resample.js), which hold ~350 sessions and, on a weekday, no bar for today: the newest week (and, on almost
// every day, the newest month) was dropped, the copy was shallow, and it still read fresh and painted at once.
// No derivation from the seed can equal the server's W/M bars (the period in progress and the full depth), so the
// device serves D and the intraday session grid only (tfs.SERVED_TFS). Here, the device's own doors: the list, the
// source (what persist.js asks, and what the handoff's diagnostics ask) and the page's client.
import { describe, it, expect, vi } from 'vitest'
import { SERVED_TFS, STORED_TFS } from './tfs'
import { createDeviceSource } from './source'
import { createDeviceClient } from './client'

const COLS = () => ({ t: new Float64Array([1, 2]), o: new Float64Array([1, 1]), h: new Float64Array([1, 1]), l: new Float64Array([1, 1]),
  c: new Float64Array([1, 1]), v: new Float64Array([1, 1]), build: '20261121T2359Z', through: 3 })

describe('H1 the device serves D and the intraday session grid, never W or M', () => {
  it('the served list is the stored list: no derived timeframe', () => {
    expect([...SERVED_TFS].sort()).toEqual([...STORED_TFS].sort())
    expect(SERVED_TFS).not.toContain('W')
    expect(SERVED_TFS).not.toContain('M')
  })

  it('the source asks the client nothing for W or M: peek, read and the diagnostics\' why', async () => {
    const client = { peekBars: vi.fn(() => COLS()), getBars: vi.fn(async () => COLS()), why: vi.fn(async () => 'ok') }
    const load = vi.fn(async () => client)
    const src = createDeviceSource({ load, current: () => client })
    for (const tf of ['W', 'M']) {
      expect(src.peek('AAA', tf)).toBeNull()
      expect(await src.read('AAA', tf)).toBeNull()
      expect(await src.read('AAA', tf, { urgent: true })).toBeNull()
      expect(await src.why('AAA', tf)).toBe('tf')
    }
    expect(client.peekBars).not.toHaveBeenCalled()
    expect(client.getBars).not.toHaveBeenCalled()
    expect(client.why).not.toHaveBeenCalled()
    // ...and a source whose client has not loaded yet does not load it for them
    const cold = createDeviceSource({ load, current: () => null })
    expect(cold.peek('AAA', 'W')).toBeNull()
    expect(await cold.why('AAA', 'M')).toBe('tf')
    expect(load).not.toHaveBeenCalled()
    // (D is still served)
    expect(src.peek('AAA', 'D')?.n).toBe(2)
  })

  it('the page\'s client sends the worker nothing for W or M', async () => {
    const w = { onmessage: null, onerror: null, posted: [], terminate: vi.fn(), postMessage(m) { this.posted.push(m) } }
    const c = createDeviceClient({ makeWorker: () => w, afterPaint: () => {} })
    const asked = []
    for (const tf of ['W', 'M']) {
      asked.push(c.getBars('AAA', tf), c.getBars('AAA', tf, { urgent: true }), c.warm(['AAA', 'BBB'], tf))
      expect(c.peekBars('AAA', tf)).toBeNull()
    }
    // (checked before anything is awaited: a read the worker never answers would hold the test, not fail it)
    expect(w.posted).toEqual([])
    expect(await Promise.all(asked)).toEqual([null, null, 0, null, null, 0])
  })
})
