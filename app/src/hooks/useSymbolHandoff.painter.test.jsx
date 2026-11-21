// ⭐⭐ THE IMPERATIVE SWITCH IN THE HANDOFF (stage 3, part 2; docs/charts/imperative-switch-design.md §3.4).
//
// A chart whose host hands the handoff a `painter` ref (the chart's `switchPort`) is SHOWN by its switch
// controller painting it, in the same task every sibling is shown in. The host's symbol (what the hook returns:
// the header, the badge) moves in that task too; the chart BODY's symbol (`painter.bodySym`) is held and follows
// after the paint. Each commit below is logged as `host:body/host:body` for the two charts.
//   (b) a linked group: every member's paint is in ONE task, through the key handler's decision (all members
//       asked before the first one paints) and through the round (the fallback);
//   • the body's hold is released after the paint to whatever is displayed then: it never overwrites a switch
//     React committed meanwhile, and it never renders a symbol that was already replaced;
//   • a controller that refuses, or an empty ref, is today's path, unchanged;
//   • this hook imports nothing of the controller (the ref is the whole bridge).
// The controllers here are fakes that record what they were asked and when; the real one is railed on the real
// chart (components/StockChart.imperativeSwitch.test.jsx).
import { renderHook, act } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = { ready: true, columns: true }
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: (sym) => sym === 'AAA' || st.ready,
  lakePending: () => false,
  deepPending: () => false,
  holdsBars: () => true,
  heldRows: () => 0,
  prepareForDisplay: () => new Promise(() => {}),
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
import { decideGroupShow, GROUP_HANG_MS, __resetHandoffGroupsForTests, __resetScopeForTests } from './handoffGroups'

const G = 'charts:A'
let scope
let events    // `${who}:${what}:${sym}@${tick}`
let tick      // moves once per fake millisecond: two events with the same tick ran in the same task
let ticker
beforeEach(() => {
  vi.useFakeTimers()
  // a frame, then a task: the deferred commit's own schedule, on the fake clock
  vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 16))
  st.ready = true
  st.columns = true
  __resetHandoffGroupsForTests()
  scope = { board: 1 }
  events = []
  tick = 0
  ticker = setInterval(() => { tick += 1 }, 1)
})
afterEach(() => { clearInterval(ticker); __resetScopeForTests(scope); vi.unstubAllGlobals(); vi.useRealTimers() })

/** A switch controller's surface, recording. `can`: does it paint the symbol (a function of the symbol, or a flag)? */
function fakePainter(who, can = true) {
  let pending = null
  const yes = (sym) => (typeof can === 'function' ? can(sym) : can)
  return {
    canApply(sym) { events.push(`${who}:can:${sym}@${tick}`); return yes(sym) ? { ok: true, sym } : null },
    apply(sym, token) {
      events.push(`${who}:apply:${sym}@${tick}:${token ? 'token' : 'built'}`)
      if (!yes(sym)) return false
      pending = sym
      return 'applied'
    },
    pendingSym: () => pending,
    reactCaughtUp() { pending = null },
  }
}
// Two charts of one linked group in one tree (30m + 60m), each with its own painter ref.
function twoCharts({ a = null, b = null, withScope = true } = {}) {
  const commits = []
  const pa = { current: a }
  const pb = { current: b }
  const h = renderHook(({ s }) => {
    const x = useSymbolHandoff(s, '30', { group: G, scope: withScope ? scope : null, painter: pa })
    const y = useSymbolHandoff(s, '60', { group: G, scope: withScope ? scope : null, painter: pb })
    useLayoutEffect(() => { commits.push(`${x}:${pa.bodySym}/${y}:${pb.bodySym}`) })
    return [x, y]
  }, { initialProps: { s: 'AAA' } })
  commits.length = 0
  return { h, commits, pa, pb }
}
// the board's setGroupSym: decide, then write the symbol (one event)
function press(h, sym) {
  let decided
  act(() => { decided = decideGroupShow(scope, G, sym); h.rerender({ s: sym }) })
  return decided
}
const afterPaint = () => act(() => { vi.advanceTimersByTime(40) })
const ticksOf = (re) => events.filter((e) => re.test(e)).map((e) => Number(/@(\d+)/.exec(e)[1]))
const applies = () => events.filter((e) => /:apply:/.test(e))
/** Was a chart BODY ever rendered with `sym`, in any commit so far? */
const bodyEver = (commits, sym) => commits.some((c) => c.split('/').some((one) => one.split(':')[1] === sym))

describe('(b) the key handler\'s decision: every member of the group paints in one task', () => {
  it('both controllers are asked first, then both paint, in the press; the React state follows after the paint', () => {
    const { h, commits } = twoCharts({ a: fakePainter('a'), b: fakePainter('b') })
    expect(press(h, 'BBB')).toBe(true)
    // all the answers before the first paint, the paints from the tokens, all in one task
    expect(events).toEqual(['a:can:BBB@0', 'b:can:BBB@0', 'a:apply:BBB@0:token', 'b:apply:BBB@0:token'])
    // ONE commit in the press: both hosts show BBB (the label changes with the candles), and neither BODY was
    // rendered with it before the paint
    expect(commits).toEqual(['BBB:AAA/BBB:AAA'])
    afterPaint()
    expect(commits.at(-1)).toBe('BBB:BBB/BBB:BBB')
    // …and neither was shown a second time (no warm, no round, no second paint for a painted request)
    expect(applies()).toHaveLength(2)
    act(() => { vi.advanceTimersByTime(GROUP_HANG_MS + 100) })
    expect(applies()).toHaveLength(2)
    expect(commits.at(-1)).toBe('BBB:BBB/BBB:BBB')
  })

  it('a mixed group (one controller, one chart without): both are shown in the press, one by a paint, one by React', () => {
    const { h, commits } = twoCharts({ a: fakePainter('a'), b: null })
    expect(press(h, 'BBB')).toBe(true)
    expect(events).toEqual(['a:can:BBB@0', 'a:apply:BBB@0:token'])
    expect(commits).toEqual(['BBB:AAA/BBB:BBB'])   // one commit: b's body took it in render 1; a was painted, its body follows
    afterPaint()
    expect(commits.at(-1)).toBe('BBB:BBB/BBB:BBB')
  })

  it('a controller that refuses the symbol: that chart takes it in render 1, exactly as with no controller', () => {
    const { h, commits } = twoCharts({ a: fakePainter('a', false), b: fakePainter('b', false) })
    expect(press(h, 'BBB')).toBe(true)
    expect(events).toEqual(['a:can:BBB@0', 'b:can:BBB@0'])   // asked, refused, never told to paint
    expect(commits).toEqual(['BBB:BBB/BBB:BBB'])
  })

  it('one member cannot show it now (its rows are not ready): no decision, and no controller is asked to paint in the press', () => {
    st.ready = false
    const { h } = twoCharts({ a: fakePainter('a'), b: fakePainter('b') })
    expect(press(h, 'BBB')).toBe(false)
    expect(applies()).toEqual([])
  })
})

describe('(b) the round (no decision): every ready member paints in the round\'s one task', () => {
  it('both charts are painted in the same task, and the React state follows after the paint', () => {
    const { h, commits } = twoCharts({ a: fakePainter('a'), b: fakePainter('b'), withScope: false })
    expect(press(h, 'BBB')).toBe(false)             // no scope: never decided
    const t = ticksOf(/:apply:BBB/)
    expect(applies()).toEqual([`a:apply:BBB@${t[0]}:built`, `b:apply:BBB@${t[0]}:built`])
    expect(t[0]).toBe(t[1])
    expect(commits.at(-1)).toBe('BBB:AAA/BBB:AAA')   // both hosts show it; both bodies held
    expect(bodyEver(commits, 'BBB')).toBe(false)
    afterPaint()
    expect(commits.at(-1)).toBe('BBB:BBB/BBB:BBB')
    expect(applies()).toHaveLength(2)
  })

  it('a controller that refuses in the round: the state is set there, as before', () => {
    const { h, commits } = twoCharts({ a: fakePainter('a', false), b: fakePainter('b', false), withScope: false })
    press(h, 'BBB')
    expect(applies()).toHaveLength(2)                // asked once each, both refused
    expect(commits.at(-1)).toBe('BBB:BBB/BBB:BBB')   // shown through React in the round's task, no timer needed
  })
})

describe('the body\'s hold and its release', () => {
  it('a switch React shows meanwhile releases the hold in its own render, and the older release changes nothing', () => {
    // BBB is painted; CCC is refused by the controllers, so React shows it in render 1, before BBB's release runs
    const can = (sym) => sym === 'BBB'
    const { h, commits } = twoCharts({ a: fakePainter('a', can), b: fakePainter('b', can) })
    expect(press(h, 'BBB')).toBe(true)
    expect(press(h, 'CCC')).toBe(true)
    expect(commits.at(-1)).toBe('CCC:CCC/CCC:CCC')   // hosts and bodies, both charts, one commit
    const n = commits.length
    afterPaint()                                     // BBB's release runs now
    expect(commits.slice(n).every((c) => c === 'CCC:CCC/CCC:CCC')).toBe(true)
    expect(bodyEver(commits, 'BBB')).toBe(false)     // no body was ever rendered with the symbol that was replaced
  })

  it('two paints before the release: the body goes from the symbol it showed to the one on screen, once', () => {
    const { h, commits } = twoCharts({ a: fakePainter('a'), b: fakePainter('b') })
    press(h, 'BBB')
    press(h, 'CCC')
    expect(applies().map((e) => e.split('@')[0])).toEqual(['a:apply:BBB', 'b:apply:BBB', 'a:apply:CCC', 'b:apply:CCC'])
    expect(commits.at(-1)).toBe('CCC:AAA/CCC:AAA')
    afterPaint()
    expect(commits.at(-1)).toBe('CCC:CCC/CCC:CCC')
    expect(bodyEver(commits, 'BBB')).toBe(false)
  })
})

describe('no controller', () => {
  it('an empty ref is today\'s path: the first commit after the press shows the symbol on both charts', () => {
    const { h, commits } = twoCharts({ a: null, b: null })
    expect(press(h, 'BBB')).toBe(true)
    expect(commits).toEqual(['BBB:BBB/BBB:BBB'])
    expect(events).toEqual([])
  })
})

describe('the hook imports nothing of the controller', () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
  const importsOf = (src) => [...noComments(src).matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
  const banned = (list) => list.filter((p) => /switchController|switchFrame|imperativeSwitch|StockChart/.test(p))

  it('useSymbolHandoff.js and handoffGroups.js reach the controller only through the ref', () => {
    const hook = importsOf(readFileSync(join(HERE, 'useSymbolHandoff.js'), 'utf8'))
    expect(hook.length).toBeGreaterThan(3)   // the scan found the imports
    expect(banned(hook)).toEqual([])
    expect(importsOf(readFileSync(join(HERE, 'handoffGroups.js'), 'utf8'))).toEqual([])
  })

  it('self-check: an import in a comment is not an import, and a banned one is caught', () => {
    expect(importsOf("// import x from '../components/chart/switchController'\nimport y from './ok'\n")).toEqual(['./ok'])
    expect(banned(importsOf("import { a } from '../components/chart/switchController'\n"))).toEqual(['../components/chart/switchController'])
  })
})
