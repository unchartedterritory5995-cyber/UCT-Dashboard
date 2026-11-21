// ⭐⭐ ONE SYNCHRONOUS PASS FROM THE KEYDOWN (2026-11-21). The board's setGroupSym asks the linked group's charts,
// before it writes the symbol, whether EVERY one can show it in this task (handoffGroups.decideGroupShow). When
// they all can, the charts take the symbol in the render it arrives in: the FIRST commit after the request already
// shows it on both (today's path needs a second commit: the effect's setState). When any one cannot, nothing is
// decided and every chart takes today's path (its handoff, then the group round), unchanged.
// Commits are logged from a layout effect, so "one commit" and "never a mixed frame" are both read directly.
import { renderHook, act } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = { ready: { '30': true, '60': true, '15': true }, columns: true }
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
  columnsReadyFor: () => st.columns,
  whenColumnsReady: () => new Promise(() => {}),
  warmColumnsFor: () => {},
}))

import useSymbolHandoff from './useSymbolHandoff'
import { decideGroupShow, decisionFor, registerMember, createSettleClock, settleClock, DECISION_TTL_MS, __resetHandoffGroupsForTests, __resetScopeForTests } from './handoffGroups'
import { BURST_SETTLE_MS, QUIET_MS } from './useSymbolSettle'

const G = 'charts:A'
let scope
beforeEach(() => {
  vi.useFakeTimers()
  st.ready = { '30': true, '60': true, '15': true }
  st.columns = true
  for (const k of Object.keys(resolvers)) delete resolvers[k]
  __resetHandoffGroupsForTests()
  scope = { board: 1 }
})
afterEach(() => { __resetScopeForTests(scope); vi.useRealTimers() })

// Two charts of one linked group in one tree (30m + 60m), the board's symbol and the first chart's timeframe as props.
function twoCharts({ settle = null, withScope = true } = {}) {
  const commits = []
  const h = renderHook(({ s, tf1 }) => {
    const a = useSymbolHandoff(s, tf1, { group: G, scope: withScope ? scope : null, settle })
    const b = useSymbolHandoff(s, '60', { group: G, scope: withScope ? scope : null, settle })
    useLayoutEffect(() => { commits.push(`${a}/${b}`) })
    return [a, b]
  }, { initialProps: { s: 'AAA', tf1: '30' } })
  commits.length = 0
  return { h, commits }
}
// the board's setGroupSym: decide, then write the symbol (one event)
function press(h, sym, props = {}) {
  let decided
  act(() => { decided = decideGroupShow(scope, G, sym); h.rerender({ s: sym, tf1: '30', ...props }) })
  return decided
}
const mixed = (commits) => commits.filter((p) => { const [a, b] = p.split('/'); return a !== b })

describe('the key handler decides the group switch', () => {
  it('every member can show it now: the FIRST commit after the press shows it on both charts', () => {
    const { h, commits } = twoCharts()
    expect(press(h, 'BBB')).toBe(true)
    expect(commits[0]).toBe('BBB/BBB')          // one commit; today's path commits AAA/AAA first
    expect(commits).toEqual(['BBB/BBB'])
  })

  it("a member that painted it itself ('applied') does not take it in render", () => {
    const { h, commits } = twoCharts()
    act(() => {
      expect(decideGroupShow(scope, G, 'BBB')).toBe(true)
      const d = decisionFor(scope, G)
      for (const id of Object.keys(d.tfs)) d.applied[id] = true   // as an imperative controller would answer
      h.rerender({ s: 'BBB', tf1: '30' })
    })
    expect(commits[0]).toBe('AAA/AAA')                 // React's copy follows on its own path, not in render 1
  })

  it('control, today\'s path (no scope: never decided): the first commit still shows the old symbol', () => {
    const { h, commits } = twoCharts({ withScope: false })
    expect(press(h, 'BBB')).toBe(false)
    expect(commits[0]).toBe('AAA/AAA')
    expect(commits[commits.length - 1]).toBe('BBB/BBB')
    expect(mixed(commits)).toEqual([])
  })

  it('one member cannot (its rows are not ready): no decision; both take the round and show it together', async () => {
    st.ready['60'] = false
    const { h, commits } = twoCharts()
    expect(press(h, 'BBB')).toBe(false)
    expect(decisionFor(scope, G)).toBe(null)
    expect(h.result.current).toEqual(['AAA', 'AAA'])   // the ready 30m chart did NOT show B alone
    await act(async () => { st.ready['60'] = true; resolvers['60']('current'); await Promise.resolve() })
    expect(h.result.current).toEqual(['BBB', 'BBB'])
    expect(mixed(commits)).toEqual([])
  })

  it('a member whose panes\' server columns have not landed cannot show it now: no decision', () => {
    st.columns = false
    const { h, commits } = twoCharts()
    expect(press(h, 'BBB')).toBe(false)
    expect(commits[0]).toBe('AAA/AAA')
  })

  it('the settle rule says defer (a cold row inside a burst): no decision, today\'s path defers it', async () => {
    const settle = { debounceMs: 90, isWarm: () => false }
    const { h, commits } = twoCharts({ settle })
    expect(press(h, 'BBB')).toBe(true)                 // after a quiet spell: now
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    commits.length = 0
    expect(press(h, 'CCC')).toBe(false)                // 50 ms later, not warm: the rule defers it
    expect(commits[0]).toBe('BBB/BBB')
    expect(h.result.current).toEqual(['BBB', 'BBB'])   // held: the charts' handoffs read the GROUP's clock too
    await act(async () => { await vi.advanceTimersByTimeAsync(BURST_SETTLE_MS + 5) })
    expect(h.result.current).toEqual(['CCC', 'CCC'])
    expect(mixed(commits)).toEqual([])
  })

  it('a warm row inside a burst: decided when the last applied one is BURST_SETTLE_MS old, not before', async () => {
    const settle = { debounceMs: 90, isWarm: () => true }
    const { h } = twoCharts({ settle })
    expect(QUIET_MS).toBeGreaterThan(BURST_SETTLE_MS + 10)
    expect(press(h, 'BBB')).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(BURST_SETTLE_MS + 10) })
    expect(press(h, 'CCC')).toBe(true)                 // inside the burst, warm, BBB applied 130 ms ago: now
    expect(h.result.current).toEqual(['CCC', 'CCC'])
    await act(async () => { await vi.advanceTimersByTimeAsync(40) })
    expect(press(h, 'DDD')).toBe(false)                // warm, but CCC was applied 40 ms ago: the rule defers it
  })

  it('ALL OR NOTHING: a timeframe changed in the same event never splits the group (both take it, one commit)', () => {
    const { h, commits } = twoCharts()
    expect(press(h, 'BBB', { tf1: '15' })).toBe(true)  // decided while the first chart was on 30m; it is on 15m now
    expect(commits).toEqual(['BBB/BBB'])               // a per-chart refusal here was a mixed frame (AAA/BBB)
  })

  it('a chart that was not asked (not a member when the group decided) does not take the decision', () => {
    const commits = []
    const h = renderHook(({ s, on }) => {
      const a = useSymbolHandoff(s, '30', { group: G, scope, enabled: on })
      useLayoutEffect(() => { commits.push(a) })
      return a
    }, { initialProps: { s: 'AAA', on: false } })
    // the group decides while this chart is not a member (disabled: never registered); only a stand-in answers
    const u = registerMember(scope, G, 99, { tf: () => '30', canShowNow: () => true, showDecided: () => {} })
    act(() => { expect(decideGroupShow(scope, G, 'BBB')).toBe(true) })
    expect(Object.keys(decisionFor(scope, G).tfs)).toEqual(['99'])
    commits.length = 0
    act(() => { h.rerender({ s: 'BBB', on: true }) })   // it becomes a member in the render the symbol arrives in
    expect(commits[0]).toBe('AAA')                     // it was not asked: today's path commits it next
    expect(commits[commits.length - 1]).toBe('BBB')
    u()
  })

  it('a newer press wins, and a lapsed decision is never taken by a request that comes back to its symbol', async () => {
    const { h, commits } = twoCharts()
    expect(press(h, 'BBB')).toBe(true)
    expect(press(h, 'CCC')).toBe(true)
    expect(h.result.current).toEqual(['CCC', 'CCC'])
    // a writer that does not decide (a layout restore) moves the group while CCC's decision is still fresh:
    // DDD was never checked, so it is not taken in render (today's path shows it, a commit later)
    commits.length = 0
    act(() => { h.rerender({ s: 'DDD', tf1: '30' }) })
    expect(commits[0]).toBe('CCC/CCC')
    expect(h.result.current).toEqual(['DDD', 'DDD'])
    await act(async () => { await vi.advanceTimersByTimeAsync(DECISION_TTL_MS + 10) })
    commits.length = 0
    act(() => { h.rerender({ s: 'CCC', tf1: '30' }) })
    expect(commits[0]).toBe('DDD/DDD')                 // the old decision lapsed: today's path, not adopted
    expect(commits[commits.length - 1]).toBe('CCC/CCC')
  })
})

describe('handoffGroups: the decision', () => {
  const member = (log, id, { can = true, shows, tf = '30' } = {}) => ({
    tf: () => tf,
    canShowNow: () => { log.push(`ask:${id}`); if (can instanceof Error) throw can; return can },
    showDecided: (sym, d, token) => { log.push(`show:${id}:${String(token)}:${d === decisionFor(scope, G) ? 'published' : 'unpublished'}`); if (shows instanceof Error) throw shows; return shows },
  })

  it('every member answers before the first showDecided, which gets its own token; published after', () => {
    const log = []
    const u1 = registerMember(scope, G, 1, member(log, 1, { can: 'frame-1' }))
    const u2 = registerMember(scope, G, 2, member(log, 2, { can: 'frame-2' }))
    expect(decideGroupShow(scope, G, 'BBB')).toBe(true)
    expect(log).toEqual(['ask:1', 'ask:2', 'show:1:frame-1:unpublished', 'show:2:frame-2:unpublished'])
    expect(decisionFor(scope, G)).toMatchObject({ sym: 'BBB', tfs: { 1: '30', 2: '30' } })
    u1(); u2()
  })

  it('one no, or a throw while answering, is no decision for anyone; nobody is shown', () => {
    const log = []
    const u1 = registerMember(scope, G, 1, member(log, 1))
    const u2 = registerMember(scope, G, 2, member(log, 2, { can: new Error('boom') }))
    expect(decideGroupShow(scope, G, 'BBB')).toBe(false)
    expect(log.filter((x) => x.startsWith('show'))).toEqual([])
    expect(decisionFor(scope, G)).toBe(null)
    u2()
    const u3 = registerMember(scope, G, 3, member(log, 3, { can: 0 }))
    expect(decideGroupShow(scope, G, 'CCC')).toBe(false)
    u1(); u3()
  })

  it("'applied' is recorded per member; another answer or a throw leaves that member to adopt in render", () => {
    const log = []
    const u1 = registerMember(scope, G, 1, member(log, 1, { shows: 'applied' }))
    const u2 = registerMember(scope, G, 2, member(log, 2, { shows: new Error('controller declined') }))
    const u3 = registerMember(scope, G, 3, member(log, 3, { shows: 'later' }))
    expect(decideGroupShow(scope, G, 'BBB')).toBe(true)
    expect(decisionFor(scope, G).applied).toEqual({ 1: true })
    u1(); u2(); u3()
  })

  it('a member of another board (another scope) is never asked nor shown', () => {
    const log = []
    const other = { board: 2 }
    const u1 = registerMember(scope, G, 1, member(log, 1))
    const u2 = registerMember(other, G, 2, member(log, 2))
    expect(decideGroupShow(scope, G, 'BBB')).toBe(true)
    expect(log.some((x) => x.endsWith(':2') || x.includes(':2:'))).toBe(false)
    expect(decisionFor(other, G)).toBe(null)
    u1(); u2()
  })

  it('no members: no decision', () => {
    expect(decideGroupShow(scope, G, 'BBB')).toBe(false)
  })
})

describe('the settle clock: one snapshot per request for the whole group', () => {
  it('the same request again (a sibling, or the round after the decision) gets the same snapshot', () => {
    const c = createSettleClock()
    const a = c.request('BBB', 1000)
    c.applied(1000)
    expect(c.request('BBB', 1010)).toBe(a)             // a sibling classifies it alike, applied or not
    const b = c.request('CCC', 1100)
    expect(b).toEqual({ lastRequestAt: 1000, lastAppliedAt: 1000 })
  })
  it('one clock per (scope, group)', () => {
    expect(settleClock(scope, G)).toBe(settleClock(scope, G))
    expect(settleClock(scope, G)).not.toBe(settleClock({}, G))
    expect(settleClock(null, G)).toBe(null)
  })
})
