// ⭐⭐ THE IMPERATIVE SWITCH IN THE HANDOFF (stage 3, part 2; docs/charts/imperative-switch-design.md §3.4).
//
// A chart whose host hands the handoff a `painter` ref (the chart's `switchPort`) is SHOWN by its switch
// controller painting it, in the same task every sibling is shown in. The host's symbol (what the hook returns:
// the header, the badge) moves in that task too; the chart BODY's symbol (`painter.bodySym`) is held and follows
// after the paint. Each commit below is logged as `host:body/host:body` for the two charts.
//   (b) a linked group: every member's paint is in ONE task, through the key handler's decision (all members
//       asked before the first one paints); the round (the fallback) never paints, it shows every member through
//       React in one commit (review round 2, H2: a paint from the round lands a task before its label);
//   • H2, outside act(): nothing writes a chart's canvas in a task before the commit of its label;
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
// `columnsGate`: a promise the panes' late server columns resolve with (the round's wait), when a case needs one
const st = { ready: true, columns: true, columnsGate: null }
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
  whenColumnsReady: () => st.columnsGate || new Promise(() => {}),
  warmColumnsFor: () => {},
}))

import useSymbolHandoff from './useSymbolHandoff'
import { decideGroupShow, GROUP_HANG_MS, __resetHandoffGroupsForTests, __resetScopeForTests } from './handoffGroups'

const G = 'charts:A'
let scope
let events    // `${who}:${what}:${sym}@${tick}`
let notes     // what the hook tells a controller besides painting: `${who}:reconcile:${sym}`, `${who}:released`
let tick      // moves once per fake millisecond: two events with the same tick ran in the same task
let ticker
// (review round 2, H2) what each chart's host had COMMITTED as its label, and the ordering probe a case may install:
// called at each paint and each reconcile, it checks once every microtask of the calling task has run (React's own
// synchronous work included) whether the label committed for that symbol. A label that commits in a LATER task can
// be a presented frame behind the canvas, which the paint wrote now.
let labels
let probe
let order
// the real ones, captured at import, before a case's fake timers replace them
const realSetTimeout = globalThis.setTimeout
const realTurn = (ms = 0) => new Promise((r) => realSetTimeout(r, ms))
/** Run `fn` after every microtask queued so far, and every one those queue, up to `n` hops. */
const afterMicrotasks = (fn, n = 60) => { let p = Promise.resolve(); for (let i = 0; i < n; i++) p = p.then(() => {}); p.then(fn) }
beforeEach(() => {
  vi.useFakeTimers()
  // a frame, then a task: the deferred commit's own schedule, on the fake clock
  vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 16))
  st.ready = true
  st.columns = true
  st.columnsGate = null
  __resetHandoffGroupsForTests()
  scope = { board: 1 }
  events = []
  notes = []
  tick = 0
  ticker = setInterval(() => { tick += 1 }, 1)
  labels = {}
  probe = null
  order = []
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
      if (probe) probe(who, 'paint', sym)
      return 'applied'
    },
    pendingSym: () => pending,
    reactCaughtUp() { pending = null },
    reconcile(sym) { notes.push(`${who}:reconcile:${sym}`); if (probe) probe(who, 'reconcile', sym) },
    noteReleased() { notes.push(`${who}:released`) },
    noteRound(sym) { notes.push(`${who}:round:${sym}`) },
  }
}
/** The ordering probe: `${who}:${kind}:${sym}:${did its label commit in the same task}`. */
const sameTaskProbe = (who, kind, sym) => afterMicrotasks(() => order.push(`${who}:${kind}:${sym}:${labels[who] === sym}`))
// Two charts of one linked group in one tree (30m + 60m), each with its own painter ref.
function twoCharts({ a = null, b = null, withScope = true } = {}) {
  const commits = []
  const pa = { current: a }
  const pb = { current: b }
  const h = renderHook(({ s }) => {
    const x = useSymbolHandoff(s, '30', { group: G, scope: withScope ? scope : null, painter: pa })
    const y = useSymbolHandoff(s, '60', { group: G, scope: withScope ? scope : null, painter: pb })
    useLayoutEffect(() => { commits.push(`${x}:${pa.bodySym}/${y}:${pb.bodySym}`); labels.a = x; labels.b = y })
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

// ⛔ (review round 2, H2) THE ROUND NEVER PAINTS. It runs from a timer, a promise or a passive effect, where React
// renders the label (and every React-path sibling) in a LATER task than the one the paint writes the canvas in: the
// new candles could be presented under the old label, or beside a sibling still on the old symbol. Only the key
// handler's decision paints: its React work is synchronous in the same task (`useSyncExternalStore`), so the label
// and the candles are one frame by construction. The round takes today's React path: every member in one commit.
describe('(b) the round (no decision): no member is painted; every ready member is shown in ONE commit', () => {
  it('both charts take the symbol through React in the same commit, hosts and bodies; no controller is asked to paint', () => {
    const { h, commits } = twoCharts({ a: fakePainter('a'), b: fakePainter('b'), withScope: false })
    expect(press(h, 'BBB')).toBe(false)             // no scope: never decided
    expect(applies()).toEqual([])
    // the first commit that carries the label carries both bodies too: one frame, both charts
    expect(commits.find((c) => c.startsWith('BBB:'))).toBe('BBB:BBB/BBB:BBB')
    // …and each controller hears the switch went by the round (`diag.refused.round`)
    expect(notes).toEqual(expect.arrayContaining(['a:round:BBB', 'b:round:BBB']))
    afterPaint()
    expect(applies()).toEqual([])
  })

  it('a controller that refuses: the round is the same React show (it asks nothing)', () => {
    const { h, commits } = twoCharts({ a: fakePainter('a', false), b: fakePainter('b', false), withScope: false })
    press(h, 'BBB')
    expect(applies()).toEqual([])
    expect(commits.at(-1)).toBe('BBB:BBB/BBB:BBB')   // shown through React in the round's task, no timer needed
  })
})

// ⭐⭐ (review round 2, H2) THE ORDER, OUTSIDE act(). act() renders React's updates synchronously, so every rail above
// would pass a paint that lands a task ahead of its label. Here the round runs from a PROMISE (the panes' server
// columns landing late), outside act(), and React schedules its render as it does in the browser. The probe asks,
// at every paint and every reconcile (a replay writes the canvas too), once the calling task's microtasks have all
// run: did the label of that symbol commit in this same task? A later task can be a presented frame later.
// ⛔ What only a browser proves: that a frame is actually presented with both (the canary's pixels stamp). This rail
// proves the precondition jsdom can see: nothing writes the canvas in a task before its label's commit.
describe('H2: nothing writes a chart in a task before the commit of its label (outside act)', () => {
  it('the round, columns landing late (no decision): no chart is painted before its label commits; one commit carries both', async () => {
    st.columns = false
    let land
    st.columnsGate = new Promise((r) => { land = r })
    probe = sameTaskProbe
    const { h, commits } = twoCharts({ a: fakePainter('a'), b: fakePainter('b'), withScope: false })
    press(h, 'BBB')                                  // the request; the round waits on the columns
    expect(applies()).toEqual([])
    land(true)                                       // OUTSIDE act: the columns land, the round shows both
    for (let i = 0; i < 10 && labels.a !== 'BBB'; i++) await realTurn(5)
    await realTurn(5)
    expect(labels).toEqual({ a: 'BBB', b: 'BBB' })
    expect(order.filter((o) => o.endsWith(':false')), 'a canvas written a task before its label').toEqual([])
    expect(commits.find((c) => c.startsWith('BBB:'))).toBe('BBB:BBB/BBB:BBB')
  })

  it('the way back by the round (BBB painted, AAA refused by the controller): the replay is told in the commit of AAA\'s label', async () => {
    const can = (sym) => sym === 'BBB'
    probe = sameTaskProbe
    const { h } = twoCharts({ a: fakePainter('a', can), b: fakePainter('b', can) })
    expect(press(h, 'BBB')).toBe(true)              // the decision paints BBB; the bodies are held on AAA
    await realTurn(5)
    order.length = 0
    notes.length = 0
    st.columns = false                               // AAA's columns are late: no decision, the round
    let land
    st.columnsGate = new Promise((r) => { land = r })
    expect(press(h, 'AAA')).toBe(false)
    land(true)                                       // OUTSIDE act
    for (let i = 0; i < 10 && labels.a !== 'AAA'; i++) await realTurn(5)
    await realTurn(5)
    expect(labels).toEqual({ a: 'AAA', b: 'AAA' })
    expect(notes).toEqual(expect.arrayContaining(['a:reconcile:AAA', 'b:reconcile:AAA']))   // non-vacuity: told
    expect(order.filter((o) => /:reconcile:AAA:/.test(o)).length).toBeGreaterThanOrEqual(2)
    expect(order.filter((o) => o.endsWith(':false')), 'a replay a task before its label').toEqual([])
  })

  it('control: the key handler\'s decision paints, and the probe sees each label committed in the same task', async () => {
    probe = sameTaskProbe
    const { h } = twoCharts({ a: fakePainter('a'), b: fakePainter('b') })
    expect(press(h, 'BBB')).toBe(true)
    await realTurn(5)
    expect(order.filter((o) => /:paint:BBB:/.test(o))).toEqual(['a:paint:BBB:true', 'b:paint:BBB:true'])
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

describe('review of #2400: the release, and what the controller is told', () => {
  it('finding 5: a release scheduled by an OLDER paint does not release a newer paint\'s hold', () => {
    const { h, commits } = twoCharts({ a: fakePainter('a'), b: fakePainter('b') })
    press(h, 'BBB')                                  // its release is due at 16 ms
    act(() => { vi.advanceTimersByTime(10) })
    press(h, 'CCC')                                  // painted over the hold; its release is due at 26 ms
    act(() => { vi.advanceTimersByTime(10) })        // 20 ms: the older release has fired
    expect(commits.at(-1)).toBe('CCC:AAA/CCC:AAA')   // …and the bodies are still held: CCC is not presented yet
    act(() => { vi.advanceTimersByTime(20) })        // 40 ms: the newer paint's own release
    expect(commits.at(-1)).toBe('CCC:CCC/CCC:CCC')
    expect(notes.filter((n) => /released/.test(n))).toEqual(['a:released', 'b:released'])   // one release per chart
  })
  it('L3 (review round 2): a release whose hold a React show already cleared frees nothing and is not counted', () => {
    const can = (sym) => sym === 'BBB'
    const { h, commits } = twoCharts({ a: fakePainter('a', can), b: fakePainter('b', can) })
    expect(press(h, 'BBB')).toBe(true)              // painted; the bodies held on AAA
    expect(press(h, 'CCC')).toBe(true)              // refused by the controllers: React shows CCC, the hold cleared in render 1
    expect(commits.at(-1)).toBe('CCC:CCC/CCC:CCC')
    notes.length = 0
    afterPaint()                                     // BBB's release fires now: there is nothing left to release
    expect(notes.filter((n) => /released/.test(n))).toEqual([])
  })
  it('finding 1: a symbol the controller did not paint is shown through React, and the controller is told (reconcile)', () => {
    // BBB painted; AAA (back to the symbol the body is held on) refused by the controller
    const can = (sym) => sym === 'BBB'
    const { h } = twoCharts({ a: fakePainter('a', can), b: fakePainter('b', can), withScope: false })
    press(h, 'BBB')
    notes.length = 0
    press(h, 'AAA')
    expect(notes).toContain('a:reconcile:AAA')
    expect(notes).toContain('b:reconcile:AAA')
  })
  it('finding 1: at the release the controller is told what the host shows then', () => {
    const { h } = twoCharts({ a: fakePainter('a'), b: fakePainter('b') })
    press(h, 'BBB')
    afterPaint()
    expect(notes).toEqual(expect.arrayContaining(['a:released', 'a:reconcile:BBB', 'b:released', 'b:reconcile:BBB']))
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
