// app/src/lib/bootSecondaryBars.test.js
//
// ─── THE OTHER-SYMBOL BARS A CHART PAGE NEEDED ARE ASKED AS THE PAGE LOADS (2026-11-26, Fred RS load time) ──────────
//   B1 a page that needed SP:SPX last time asks for it at boot, before any chart mounts; another page, a stale record,
//      a signed-out browser or a non-bars URL asks for nothing
//   B2 the chart's own fetch of that window ADOPTS the boot answer: one request, not two (`secondaryBars`)
//   B3 a failed boot request is "no answer": the chart fetches as before
//   B4 the record is the page's CURRENT need: written from `useSecondarySources`' needed set (`secondaryNeedUrls` names the
//      same windows `ensureChartSources` asks), rewritten when it changes, removed when nothing is needed; an unmount
//      does not rewrite it
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import BOOT_START_SRC from './bootFetchStart.js?raw'
import MAIN_SRC from '../main.jsx?raw'
import {
  SECONDARY_NEEDS_KEY, SECONDARY_NEEDS_MAX_AGE_MS, BOOT_SECONDARY_MAX_AGE_MS, startBootSecondaryBars, takeBootSecondaryBars,
  noteSecondaryNeeds, forgetSecondaryNeeds, rememberedSecondaryNeeds, __resetBootSecondaryForTests,
} from './bootSecondaryBars'
import { ensureSecondaryBars, cachedBars, clearSecondaryBars, SOURCE_STATUS } from '../components/chart/engine/secondaryBars'
import { secondaryNeedUrls, ensureChartSources, useSecondarySources } from '../components/chart/engine/useSecondarySources'

const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }
}
const SPX = '/api/bars/SPX?tf=D&bars=20000'
const record = (over = {}) => JSON.stringify({ path: '/charts', at: Date.now(), urls: [SPX], ...over })
const okResponse = (payload) => ({ ok: true, json: () => Promise.resolve(payload) })
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)) }
const rows = [{ t: '2026-11-24', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }, { t: '2026-11-25', o: 1.5, h: 2.5, l: 1, c: 2, v: 11 }]

afterEach(() => { __resetBootSecondaryForTests(); clearSecondaryBars(); vi.useRealTimers() })

describe('boot: the windows this page needed last time leave with the entry bundle', () => {
  it('B1 asks the remembered window at boot, and nothing for another page, a stale record, a signed-out browser or a non-bars URL', () => {
    const f = vi.fn(() => Promise.resolve(okResponse({ bars: rows })))
    const signedIn = { 'uct.signedIn.v1': '1' }
    expect(startBootSecondaryBars({ fetchImpl: f, path: '/charts', storage: memStorage({ ...signedIn, [SECONDARY_NEEDS_KEY]: record() }) })).toBe(1)
    __resetBootSecondaryForTests()
    expect(startBootSecondaryBars({ fetchImpl: f, path: '/dashboard', storage: memStorage({ ...signedIn, [SECONDARY_NEEDS_KEY]: record() }) })).toBe(0)
    expect(startBootSecondaryBars({ fetchImpl: f, path: '/charts', storage: memStorage({ [SECONDARY_NEEDS_KEY]: record() }) })).toBe(0)
    expect(startBootSecondaryBars({ fetchImpl: f, path: '/charts',
      storage: memStorage({ ...signedIn, [SECONDARY_NEEDS_KEY]: record({ at: Date.now() - SECONDARY_NEEDS_MAX_AGE_MS - 1 }) }) })).toBe(0)
    expect(rememberedSecondaryNeeds('/charts', { storage: memStorage({ [SECONDARY_NEEDS_KEY]: record({ urls: ['/api/auth/me', SPX] }) }) }))
      .toEqual([SPX])
    return settle().then(() => expect(f.mock.calls.map((c) => c[0])).toEqual([SPX]))
  })

  it('B2 the chart adopts the boot answer: ONE request for the window, the entry AVAILABLE', async () => {
    const boot = vi.fn(() => Promise.resolve(okResponse({ bars: rows })))
    startBootSecondaryBars({ fetchImpl: boot, path: '/charts', storage: memStorage({ 'uct.signedIn.v1': '1', [SECONDARY_NEEDS_KEY]: record() }) })
    const chart = vi.fn(() => Promise.resolve({ bars: rows }))
    ensureSecondaryBars('SPX', 'D', 20000, chart)
    await settle()
    expect(boot).toHaveBeenCalledTimes(1)
    expect(chart).not.toHaveBeenCalled()
    const e = cachedBars('SPX', 'D', 20000)
    expect(e.status).toBe(SOURCE_STATUS.AVAILABLE)
    expect(e.bars).toEqual(rows)
    expect(takeBootSecondaryBars(SPX)).toBe(null)                    // one use
  })

  it('B3 a failed boot request is "no answer": the chart fetches as before', async () => {
    startBootSecondaryBars({ fetchImpl: () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }), path: '/charts',
      storage: memStorage({ 'uct.signedIn.v1': '1', [SECONDARY_NEEDS_KEY]: record() }) })
    const chart = vi.fn(() => Promise.resolve({ bars: rows }))
    ensureSecondaryBars('SPX', 'D', 20000, chart)
    await settle()
    expect(chart).toHaveBeenCalledWith(SPX)
    expect(cachedBars('SPX', 'D', 20000).bars).toEqual(rows)
  })

  it('B3b a boot answer older than its age limit is never handed out', () => {
    vi.useFakeTimers({ toFake: ['performance', 'Date'] })
    startBootSecondaryBars({ fetchImpl: () => Promise.resolve(okResponse({ bars: rows })), path: '/charts',
      storage: memStorage({ 'uct.signedIn.v1': '1', [SECONDARY_NEEDS_KEY]: record() }) })
    vi.advanceTimersByTime(BOOT_SECONDARY_MAX_AGE_MS + 1)
    expect(takeBootSecondaryBars(SPX)).toBe(null)
  })

  it('B4 the record follows the needed set: the same windows ensureChartSources asks, rewritten on change, removed when empty, kept on unmount', async () => {
    const storage = memStorage()
    const run = (fn) => fn()
    // Fred RS on a 1D chart: SPX at the chart's timeframe; on a 1W chart: SPX's daily rows under the held key
    const urls1D = secondaryNeedUrls(['SPX'], 'D', 20000, 'AGL', 0, false)
    expect(urls1D).toEqual([SPX])
    const asked = []
    ensureChartSources(['SPX'], 'D', 20000, (u) => { asked.push(u); return Promise.resolve({ bars: rows }) }, 'AGL', 0, false)
    await settle()
    expect(asked).toEqual(urls1D)
    const slot = {}
    noteSecondaryNeeds(slot, urls1D, { storage, path: '/charts', schedule: run })
    expect(JSON.parse(storage.getItem(SECONDARY_NEEDS_KEY))).toMatchObject({ path: '/charts', urls: [SPX] })
    noteSecondaryNeeds(slot, ['/api/bars/SPX?tf=D&bars=12500'], { storage, path: '/charts', schedule: run })
    expect(JSON.parse(storage.getItem(SECONDARY_NEEDS_KEY)).urls).toEqual(['/api/bars/SPX?tf=D&bars=12500'])
    forgetSecondaryNeeds(slot)
    expect(JSON.parse(storage.getItem(SECONDARY_NEEDS_KEY)).urls).toEqual(['/api/bars/SPX?tf=D&bars=12500'])
    const slot2 = {}
    noteSecondaryNeeds(slot2, [SPX], { storage, path: '/charts', schedule: run })
    noteSecondaryNeeds(slot2, [], { storage, path: '/charts', schedule: run })
    expect(storage.getItem(SECONDARY_NEEDS_KEY)).toBe(null)
  })

  it('B5 the chart hook writes the record: a chart whose script reads SPY leaves its window for the next load', async () => {
    const SPY_TREE = { type: 'op', name: '/', args: [{ type: 'series', name: 'close' },
      { type: 'sym', value: 'SPY', args: [{ type: 'series', name: 'close' }] }] }
    const SAVED = { id: 'u_aaaaaaaaaaaa', meta: {}, compute: { kind: 'ast', ast: SPY_TREE } }
    const defOf = (id) => (id === SAVED.id ? SAVED : null)
    const instances = () => [{ instanceId: `inst:${SAVED.id}:1`, defId: SAVED.id }]
    window.localStorage.removeItem(SECONDARY_NEEDS_KEY)
    const fetcher = () => Promise.resolve({ bars: rows })
    const hook = renderHook(() => useSecondarySources(instances, defOf, 'D', 600, fetcher, 0))
    await settle()
    const rec = JSON.parse(window.localStorage.getItem(SECONDARY_NEEDS_KEY))
    expect(rec.urls).toEqual(['/api/bars/SPY?tf=D&bars=600'])
    expect(rec.path).toBe(window.location.pathname)
    hook.unmount()
    window.localStorage.removeItem(SECONDARY_NEEDS_KEY)
  })

  it('B6 the entry bundle starts it: main.jsx imports bootFetchStart FIRST, and bootFetchStart calls startBootSecondaryBars', () => {
    expect(MAIN_SRC.split(/\r?\n/).find((l) => /^import /.test(l))).toMatch(/^import '\.\/lib\/bootFetchStart'/)
    expect(BOOT_START_SRC).toMatch(/^import \{ startBootSecondaryBars \} from '\.\/bootSecondaryBars'$/m)
    expect(BOOT_START_SRC).toMatch(/^startBootSecondaryBars\(\)$/m)
  })
})
