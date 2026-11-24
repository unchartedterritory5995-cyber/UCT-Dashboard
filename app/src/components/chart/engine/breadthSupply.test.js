// ⭐⭐ T4 B2 — the chart's cache of the breadth door (`breadthSupply.js`): one ask per long spelling; 200 / 202 / 404 /
// refused / failure / abort; B1's rows as the bind reads bars (ADD close only, no volume); never `/api/bars`.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { ensureBreadth, fetchBreadth, breadthUrl, breadthBarsOf, clearBreadth, subscribeBreadth, PENDING_RETRIES } from './breadthSupply'

const READY = { schema: 'uct.pine-breadth/v1', spelling: 'USI:ADVN.NY', state: 'ready', source: 'ok', knownFrom: '2009-06-11',
  rows: [{ d: '2009-06-11', o: 900, h: 1900, l: 800, c: 1800 }, { d: '2009-06-12', o: 1000, h: 1200, l: 700, c: 900 }] }
const tick = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => { clearBreadth(); vi.useRealTimers() })

describe('B2 — the breadth door', () => {
  it('asks the LONG spelling\'s one URL (an alias reads its long spelling), never the bars route', () => {
    expect(breadthUrl('ADVN.NY')).toBe('/api/pine/breadth/USI%3AADVN.NY')
    expect(breadthUrl('ADV')).toBe('/api/pine/breadth/USI%3AADVN.NY')
    expect(breadthUrl('UVOL')).toBeNull()
  })

  it('one ask per spelling: a 200 becomes `available` with the rows as bars, the same object until it changes', async () => {
    const get = vi.fn(() => Promise.resolve(READY))
    expect(ensureBreadth('ADVN.NY', get)).toMatchObject({ status: 'loading' })
    expect(ensureBreadth('ADV', get)).toMatchObject({ status: 'loading' })
    await tick()
    expect(get).toHaveBeenCalledTimes(1)
    const e = ensureBreadth('ADVN.NY', get)
    expect(e).toMatchObject({ status: 'available', spelling: 'ADVN.NY', knownFrom: '2009-06-11', newestBarIsForming: false })
    expect(e.bars.map((b) => [b.t, b.o, b.h, b.l, b.c])).toEqual([['2009-06-11', 900, 1900, 800, 1800], ['2009-06-12', 1000, 1200, 700, 900]])
    expect(e.bars.every((b) => Number.isNaN(b.v))).toBe(true)
    expect(ensureBreadth('ADV', get)).toBe(e)
  })

  it('ADD holds the close only: open / high / low are NaN, never the close repeated', () => {
    const rows = [{ d: '2026-01-05', o: 5, h: 5, l: 5, c: 5 }]
    expect(breadthBarsOf(rows, 'ADD')[0]).toMatchObject({ t: '2026-01-05', c: 5 })
    expect(Number.isNaN(breadthBarsOf(rows, 'ADD')[0].h)).toBe(true)
    expect(breadthBarsOf(rows, 'ADVN.NY')[0].h).toBe(5)
  })

  it('202 pending: a wait, asked again on a timer, bounded', async () => {
    vi.useFakeTimers()
    const get = vi.fn(() => Promise.resolve({ state: 'pending' }))
    const heard = []
    subscribeBreadth((s) => heard.push(s))
    ensureBreadth('DECL.NY', get)
    await vi.runOnlyPendingTimersAsync()
    expect(ensureBreadth('DECL.NY', get)).toMatchObject({ status: 'pending' })
    expect(heard).toContain('DECL.NY')
    expect(PENDING_RETRIES).toBeGreaterThan(0)
  })

  it('404 (the stage dark for this member) is `dark`, never retried; a licence refusal is `refused` with its sentence', async () => {
    const dark = vi.fn(() => Promise.reject(Object.assign(new Error('HTTP 404'), { httpStatus: 404 })))
    await fetchBreadth('ADVN.NQ', dark)
    expect(ensureBreadth('ADVN.NQ', dark)).toMatchObject({ status: 'dark', httpStatus: 404 })
    expect(dark).toHaveBeenCalledTimes(1)
    const said = vi.fn(() => Promise.resolve({ state: 'refused', refusal: { guard: 'pine-data:licence', sentence: 'Not served: `UCT:`.' } }))
    await fetchBreadth('UNCH.NY', said)
    expect(ensureBreadth('UNCH.NY', said)).toMatchObject({ status: 'refused', said: 'Not served: `UCT:`.' })
  })

  it('a failure is `error` and asked again later; a switch-abort is forgotten', async () => {
    await fetchBreadth('ADDQ', () => Promise.reject(Object.assign(new Error('HTTP 500'), { httpStatus: 500 })))
    expect(ensureBreadth('ADDQ', () => Promise.resolve(READY))).toMatchObject({ status: 'error' })
    await fetchBreadth('DECL.NQ', () => Promise.reject(Object.assign(new Error('x'), { canceled: true })))
    expect(ensureBreadth('DECL.NQ', () => new Promise(() => {}))).toMatchObject({ status: 'loading' })
  })

  it('a ready answer with no rows is an error, never an empty series', async () => {
    await fetchBreadth('UNCH.NQ', () => Promise.resolve({ ...READY, rows: [] }))
    expect(ensureBreadth('UNCH.NQ', () => Promise.resolve(READY))).toMatchObject({ status: 'error' })
  })
})
