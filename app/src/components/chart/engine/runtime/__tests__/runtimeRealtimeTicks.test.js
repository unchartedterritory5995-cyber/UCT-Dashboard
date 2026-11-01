// app/src/components/chart/engine/runtime/__tests__/runtimeRealtimeTicks.test.js
//
// ⭐⭐ P3 WS-F — THE REALTIME MODEL, REPLAYED TICK BY TICK ON DETERMINISTIC BARS.
//
// A live capture cannot be taken every day, so the realtime rules are railed here by
// replaying a chart's life through the product path (`computeRuntimeColumns`, sessions on):
// a full load with the newest bar forming, ticks that move only the forming bar, the bar
// closing as the next one opens, a fetch that stops calling the newest bar forming, and a
// history re-run the resume cannot cross. Each rule is Pine's (`PHASE3-RUNTIME-PLAN.md` 3.2):
//   * `var` and every plain variable ROLL BACK on each tick to the state committed at the
//     previous bar's close;
//   * `varip` does NOT: each tick starts where the previous update of the bar left it;
//   * `barstate.isnew` is 1 on a bar's first execution only (history included).
// ⚠️ WHAT IS PINNED BY READING, NOT BY A CAPTURE (`docs/pine/capture-queue-2026-10-31-wsf-realtime.md`):
// the bar CLOSE is one more execution of the closed bar (this lane learns the bar closed
// from the next fetch and runs it confirmed); `varip`'s `[1]` is the closed bar's last value.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeIncrementalOf, runtimeRealtimeOf,
} from '../runtimeColumns.js'
import { isNewByBar } from '../../ast/pineRuntimeClock.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'

const doc = (body, outputs = { a: 0, b: 1 }) => ({
  id: 'rt-ticks', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:rt-ticks', outputs, source: `//@version=5\nindicator("ticks")\n${body}` },
})
const mk = (n) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 3 * Math.sin(i / 4) + i * 0.05
  return { t: 1700000000 + i * 86400, o: c - 0.3, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const LIVE = { tf: 'D', newestBarIsForming: true, historyFromListing: true }
const CLOSED = { ...LIVE, newestBarIsForming: false }
const run = (d, rows, ctx = LIVE, opts = {}) => computeRuntimeColumns(d, rows, ctx, opts)
const tick = (rows, dc) => {
  const last = rows[rows.length - 1]
  const c = last.c + dc
  return [...rows.slice(0, -1), { ...last, c, h: Math.max(last.h, c), l: Math.min(last.l, c) }]
}
const open = (rows) => {
  const prev = rows[rows.length - 1]
  return [...rows, { t: prev.t + 86400, o: prev.c, h: prev.c + 0.5, l: prev.c - 0.5, c: prev.c + 0.1, v: 500 }]
}

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

const COUNTERS = doc('var int a = 0\na += 1\nvarip int b = 0\nb += 1\nplot(a)\nplot(b)\n')

describe('⭐⭐ `var` rolls back on every tick; `varip` keeps each update', () => {
  it('history: `varip` is `var` (one execution per bar)', () => {
    const out = run(COUNTERS, mk(50))
    for (let i = 0; i < 50; i += 1) { expect(out.a[i]).toBe(i + 1); expect(out.b[i]).toBe(i + 1) }
  })

  it('three ticks of the forming bar: `var` stays, `varip` counts every update — and only the forming bar moves', () => {
    let rows = mk(50)
    const first = run(COUNTERS, rows)
    for (let k = 1; k <= 3; k += 1) {
      rows = tick(rows, 0.1 * k)
      const out = run(COUNTERS, rows)
      expect(runtimeIncrementalOf(out).resumedFrom, 'the tick resumed from the last confirmed bar').toBe(48)
      expect(out.a[49], '`var` rolled back to the close of bar 48, then ran once').toBe(50)
      expect(out.b[49], '`varip` kept the previous update').toBe(50 + k)
      expect(out.a.slice(0, 49)).toEqual(first.a.slice(0, 49))
      expect(out.b.slice(0, 49)).toEqual(first.b.slice(0, 49))
    }
  })

  it('the bar closes as the next opens: the closing update is one more execution, and the new bar starts from it', () => {
    let rows = mk(50)
    run(COUNTERS, rows)
    rows = tick(rows, 0.2); run(COUNTERS, rows)
    rows = tick(rows, 0.3); run(COUNTERS, rows)        // bar 49: three executions so far (b = 52)
    rows = open(rows)
    const out = run(COUNTERS, rows)
    expect(runtimeIncrementalOf(out).resumedFrom).toBe(48)
    expect(out.a[49]).toBe(50)
    expect(out.b[49], 'closed bar 49: its fourth execution').toBe(53)
    expect(out.a[50]).toBe(51)
    expect(out.b[50], 'bar 50 begins from bar 49\'s close').toBe(54)
    rows = tick(rows, 0.1)
    const t2 = run(COUNTERS, rows)
    expect(runtimeIncrementalOf(t2).resumedFrom, 'the checkpoint moved to the closed bar').toBe(49)
    expect([t2.a[50], t2.b[49], t2.b[50]]).toEqual([51, 53, 55])
  })

  it('the fetch stops calling the newest bar forming: its close is counted once, and a repeat of the same closed fetch changes nothing', () => {
    let rows = mk(50)
    run(COUNTERS, rows)
    rows = tick(rows, 0.2); run(COUNTERS, rows)        // b[49] = 51
    const closed = run(COUNTERS, rows, CLOSED)
    expect(closed.b[49]).toBe(52)
    expect(closed.a[49]).toBe(50)
    expect(run(COUNTERS, rows.map((b) => ({ ...b })), CLOSED).b[49], 'a closed bar replays, never re-counts').toBe(52)
  })

  it('a history re-run the resume cannot cross (an old bar corrected): every closed realtime bar keeps what its updates made', () => {
    const d = doc('varip int b = 0\nb += 1\nplot(b)\nplot(close)\n')
    const fix = (rows) => rows.map((b, i) => (i === 5 ? { ...b, c: b.c + 0.25 } : b))
    let rows = mk(40)
    run(d, rows)
    for (let k = 0; k < 2; k += 1) { rows = tick(rows, 0.1); run(d, rows) }   // bar 39: 3 updates
    rows = fix(open(rows))
    const out = run(d, rows)
    expect(runtimeIncrementalOf(out).resumedFrom, 'bar 5 changed: a full run').toBeNull()
    expect(out.a[39], 'bar 39 = its three updates and its close').toBe(43)
    expect(out.a[40]).toBe(44)
    rows = open(tick(rows, 0.1)).map((b, i) => (i === 6 ? { ...b, c: b.c + 0.25 } : b))
    const again = run(d, rows)
    expect(runtimeIncrementalOf(again).resumedFrom).toBeNull()
    expect([again.a[39], again.a[40], again.a[41]], 'a replay of closed bars changes nothing; bar 40 closed with 2 executions').toEqual([43, 45, 46])
  })

  it('`var` with an accumulating sum: a tick never accumulates into the next (the rollback, pinned)', () => {
    const d = doc('var float s = 0.0\ns += close\nvarip float p = 0.0\np += close\nplot(s)\nplot(p)\n')
    let rows = mk(30)
    const base = run(d, rows)
    const s28 = base.a[28]
    const closes = []
    for (let k = 1; k <= 4; k += 1) {
      rows = tick(rows, k)
      closes.push(rows[29].c)
      const out = run(d, rows)
      expect(out.a[29]).toBe(s28 + rows[29].c)
    }
    const out = run(d, rows)          // the same bars again: the same update, nothing advances (review H1)
    const total = closes.reduce((m, c) => m + c, base.b[28] + mk(30)[29].c)
    expect(out.b[29]).toBeCloseTo(total, 9)
  })

  it('a `varip` array grows by one element per update; the closed bar\'s array is not shared with the next run', () => {
    const d = doc('varip a = array.new_float(0)\narray.push(a, close)\nplot(array.size(a))\nplot(array.sum(a))\n')
    let rows = mk(20)
    run(d, rows)
    rows = tick(rows, 1); run(d, rows)
    rows = tick(rows, 1)
    const out = run(d, rows)
    expect(out.a[19]).toBe(22)
    const same = run(d, rows.map((b) => ({ ...b })))
    expect(same.a[19], 'the same prices again: the same update, from the ledger\'s own copy (review H1)').toBe(22)
    rows = tick(rows, 1)
    expect(run(d, rows).a[19], 'the next real update: one more element').toBe(23)
  })

  it('⛔ a run with no session (`incremental: false`) has no ledger, so a `varip` refuses there by name (review M3)', () => {
    let err = null
    try { run(COUNTERS, mk(50), LIVE, { incremental: false }) } catch (e) { err = e }
    expect(err && err.guard).toBe('runtime:varip')
    expect(String(err.message)).toMatch(/no realtime ledger/)
    expect(run(COUNTERS, mk(50)).b[49], 'control: the same script with its session runs').toBe(50)
  })

  it('⛔ a script with no `varip` and no `barstate.isnew` keeps no ledger', () => {
    const out = run(doc('var int a = 0\na += 1\nplot(a)\nplot(close)\n'), mk(20))
    expect(runtimeRealtimeOf(out)).toBeNull()
  })

  it('⛔ the ledger is per identity: another symbol or other settings start clean', () => {
    let rows = mk(30)
    run(COUNTERS, rows)
    rows = tick(rows, 0.5); run(COUNTERS, rows)
    expect(run(COUNTERS, rows, { ...LIVE, symbol: { ticker: 'MSFT', exchange: 'NASDAQ' } }).b[29]).toBe(30)
    rows = tick(rows, 0.5)
    expect(run(COUNTERS, rows).b[29], 'the original identity keeps counting').toBe(32)
  })
})

describe('⭐ `barstate.isnew` — the producer and the ledger (the name stays refused: an owner ruling)', () => {
  it('isNewByBar: every bar new until it has run; a ledger time is not', () => {
    const rows = mk(5)
    expect(Array.from(isNewByBar(rows, null))).toEqual([1, 1, 1, 1, 1])
    expect(Array.from(isNewByBar(rows, new Set([rows[4].t])))).toEqual([1, 1, 1, 1, 0])
    expect(Array.from(isNewByBar([], new Set()))).toEqual([])
  })
  it('through a chart\'s life: 1 on history and on a bar\'s first update; 0 on its later updates and its close', () => {
    let rows = mk(30)
    const first = runtimeRealtimeOf(run(COUNTERS, rows)).isNew
    expect(first.every((x) => x === 1)).toBe(true)
    rows = tick(rows, 0.1)
    const t1 = runtimeRealtimeOf(run(COUNTERS, rows)).isNew
    expect([t1[28], t1[29]]).toEqual([1, 0])
    rows = open(rows)
    const o = runtimeRealtimeOf(run(COUNTERS, rows)).isNew
    expect([o[29], o[30]], 'the close of 29 is not new; 30\'s first update is').toEqual([0, 1])
  })
  it('⛔ `barstate.isnew` is still refused by name on this lane (`closedTable.json::_barstate.refused`)', () => {
    expect(() => run(doc('plot(barstate.isnew ? 1 : 0)\nplot(close)\n'), mk(10))).toThrow(/isnew|per-tick/)
  })
})

describe('⛔ `varip` the ledger cannot carry is refused by name', () => {
  it('inside a function body', () => {
    let err = null
    try { run(doc('f() =>\n    varip int n = 0\n    n += 1\n    n\nplot(f())\nplot(close)\n'), mk(10)) } catch (e) { err = e }
    expect(err && err.guard).toBe('runtime:varip')
    expect(String(err.message)).toMatch(/inside a function/)
  })
  it('holding a drawing', () => {
    const src = '//@version=5\nindicator("t")\nvarip line l = na\nif na(l)\n    l := line.new(bar_index, close, bar_index + 1, close)\nplot(close)\n'
    const built = buildRuntimeIr(src, { bars: mk(10), objectsInRun: true, pane: true, realtimeLedger: true })
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('runtime:varip')
    expect(String(built.refusal.message)).toMatch(/holding a drawing/)
  })
  it('a plain `varip` builds, and its slot is marked on the IR (the ledger finds it there)', () => {
    const built = buildRuntimeIr('//@version=5\nindicator("t")\nvarip float x = 0.0\nx += close\nplot(x)\n', { bars: mk(10), pane: true, realtimeLedger: true })
    expect(built.ok).toBe(true)
    expect(built.ir.slots.filter((sl) => sl.varip === true).map((sl) => sl.name)).toEqual(['x'])
  })
})
