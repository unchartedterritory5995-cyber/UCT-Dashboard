// ONE FRAME FOR THE WHOLE GROUP (owner, hard rule, 2026-11-20). Two charts of one linked colour group switch
// A -> B: the one that is ready waits for its sibling, and both show B in the SAME render; past GROUP_SYNC_MS
// the ready one shows anyway (nothing hangs on a slow sibling), and the straggler follows when it is ready.
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = { ready: { '30': true, '60': true } }
const resolvers = {}
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: (sym, tf) => sym === 'AAA' || !!st.ready[tf],
  lakePending: () => false,
  deepPending: () => false,
  holdsBars: () => true,
  heldRows: () => 0,
  prepareForDisplay: (sym, tf) => new Promise((r) => { resolvers[tf] = r }),
  prepareDailyForDisplay: () => new Promise(() => {}),
  prefetchBarsToIDB: () => {},
}))
vi.mock('../utils/prefetchBars', () => ({ prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))
vi.mock('../utils/barsMemCache', () => ({ memPeek: () => null }))
vi.mock('../components/chart/engine/serverCompute', () => ({
  columnsReadyFor: () => true,
  whenColumnsReady: () => Promise.resolve(true),
  warmColumnsFor: () => {},
}))

import useSymbolHandoff, { GROUP_SYNC_MS, __resetGroupRoundsForTests } from './useSymbolHandoff'
import { GROUP_HANG_MS } from './handoffGroups'

beforeEach(() => { vi.useFakeTimers(); st.ready = { '30': true, '60': true }; for (const k of Object.keys(resolvers)) delete resolvers[k]; __resetGroupRoundsForTests() })
afterEach(() => { vi.useRealTimers() })

// Two charts in one tree (one commit renders both), the group's symbol driving both; every render's
// pair of shown symbols is logged, so a MIXED frame (one chart on B, its sibling still on A) is visible.
function twoCharts(group = 'charts:A') {
  const seen = []
  const h = renderHook(({ s }) => {
    const d = useSymbolHandoff(s, 'D' === 'x' ? 'D' : '30', { group })
    const h2 = useSymbolHandoff(s, '60', { group })
    seen.push(`${d}/${h2}`)
    return [d, h2]
  }, { initialProps: { s: 'AAA' } })
  return { h, seen }
}
const mixed = (seen) => seen.filter((p) => { const [a, b] = p.split('/'); return a !== b })

describe('a linked group shows the new symbol in one frame', () => {
  it('the ready chart waits for its sibling; both show B in the same render', async () => {
    st.ready['60'] = false                                   // the 60m chart prepares; the 30m one is ready
    const { h, seen } = twoCharts()
    act(() => { h.rerender({ s: 'BBB' }) })
    expect(h.result.current).toEqual(['AAA', 'AAA'])        // the ready 30m chart did NOT show B alone
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    expect(h.result.current).toEqual(['AAA', 'AAA'])
    await act(async () => { st.ready['60'] = true; resolvers['60']('current'); await Promise.resolve() })
    expect(h.result.current).toEqual(['BBB', 'BBB'])
    expect(mixed(seen)).toEqual([])                          // never one frame with the two charts apart
  })

  it('both ready at once: B in one render, no wait', () => {
    const { h, seen } = twoCharts()
    act(() => { h.rerender({ s: 'BBB' }) })
    expect(h.result.current).toEqual(['BBB', 'BBB'])
    expect(mixed(seen)).toEqual([])
  })

  it(`⛔⛔ NEVER A PART OF THE GROUP: a slow sibling (600 ms, past the old ${GROUP_SYNC_MS} ms split) holds both, then both show`, async () => {
    st.ready['60'] = false
    const { h, seen } = twoCharts()
    act(() => { h.rerender({ s: 'BBB' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(GROUP_SYNC_MS + 50) })
    expect(h.result.current).toEqual(['AAA', 'AAA'])        // the ready 30m chart did NOT show B alone
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(h.result.current).toEqual(['AAA', 'AAA'])
    await act(async () => { st.ready['60'] = true; resolvers['60']('current'); await Promise.resolve() })
    expect(h.result.current).toEqual(['BBB', 'BBB'])
    expect(mixed(seen)).toEqual([])                          // not one frame with the two apart
  })

  it('a sibling whose prepare never answers is bounded by its OWN hang guard: both show together then, never apart', async () => {
    st.ready['60'] = false
    const { h, seen } = twoCharts()
    act(() => { h.rerender({ s: 'BBB' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(3900) })
    expect(h.result.current).toEqual(['AAA', 'AAA'])
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })   // past HANDOFF_HANG_MS (4000)
    expect(h.result.current).toEqual(['BBB', 'BBB'])
    expect(mixed(seen)).toEqual([])
  })

  it(`only a member that never reports ready at all is let go, past GROUP_HANG_MS (${GROUP_HANG_MS} ms)`, async () => {
    const G = await import('./handoffGroups')
    const shown = []
    G.groupJoin('charts:Z', 'BBB', 1); G.groupJoin('charts:Z', 'BBB', 2)
    G.groupReady('charts:Z', 'BBB', 1, () => shown.push(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(GROUP_HANG_MS - 10) })
    expect(shown).toEqual([])                                // member 2 never reports: still held
    await act(async () => { await vi.advanceTimersByTimeAsync(20) })
    expect(shown).toEqual([1])
  })

  it('a newer symbol starts its OWN round: grouped again, and the old round never shows B late', async () => {
    st.ready['60'] = false
    const { h, seen } = twoCharts()
    act(() => { h.rerender({ s: 'BBB' }) })
    act(() => { h.rerender({ s: 'CCC' }) })                 // the 60m chart still not ready
    expect(h.result.current).toEqual(['AAA', 'AAA'])        // the ready 30m chart waits for it again
    await act(async () => { st.ready['60'] = true; resolvers['60']('current'); await Promise.resolve() })
    expect(h.result.current).toEqual(['CCC', 'CCC'])
    await act(async () => { await vi.advanceTimersByTimeAsync(GROUP_SYNC_MS * 2) })
    expect(h.result.current).toEqual(['CCC', 'CCC'])
    expect(mixed(seen)).toEqual([])
    expect(seen.some((p) => p.includes('BBB'))).toBe(false)
  })

  it('control: with no group each chart shows itself as before (the ready one at once)', () => {
    st.ready['60'] = false
    const { h } = twoCharts(null)
    act(() => { h.rerender({ s: 'BBB' }) })
    expect(h.result.current).toEqual(['BBB', 'AAA'])
  })
})
