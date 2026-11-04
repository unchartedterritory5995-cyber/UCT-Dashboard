// app/src/components/chart/engine/runtime/__tests__/runtimeRealtimeReview.test.js
//
// ⭐⭐ P3 WS-F — THE INDEPENDENT REVIEW'S SCENARIOS (NO-GO of f011aeeb91), each a rail.
// Every scenario rail here was RED against f011aeeb91's runtimeColumns.js + front end and is
// green after the fix; the CONTROLs, and the flip-flop no-double-count rail (which guards the
// fix rather than reproducing the defect), were green on both:
//   H1  the `varip` ledger counted RUNS, not updates: a second pane, a refetch or a remount of
//       the same bars, and older history prepended each advanced a `varip` counter;
//   M2  a bar called closed and then forming again froze its `varip` for the rest of the bar;
//   M1  a `varip` holding drawings through a collection or a record was not refused;
//   M3  every door with no ledger ran a `varip` as a plain `var`;
//   L3  the kept build was not counted against the session byte cap.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeRealtimeOf, runtimeSessionStats,
  probeRuntimeProgram, probeObjectRuntime, runtimeObjectValues,
} from '../runtimeColumns.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'

const doc = (body, outputs = { a: 0, b: 1 }) => ({
  id: 'rt-review', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:rt-review', outputs, source: `//@version=5\nindicator("r")\n${body}` },
})
const mk = (n, from = 0) => Array.from({ length: n }, (_, j) => {
  const i = j + from
  const c = 100 + 3 * Math.sin(i / 4) + i * 0.05
  return { t: 1700000000 + i * 86400, o: c - 0.3, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const LIVE = { tf: 'D', newestBarIsForming: true, historyFromListing: true }
const CLOSED = { ...LIVE, newestBarIsForming: false }
const run = (d, rows, ctx = LIVE, opts = {}) => computeRuntimeColumns(d, rows, ctx, opts)
const fresh = (rows) => rows.map((b) => ({ ...b }))
const tick = (rows, dc) => {
  const last = rows[rows.length - 1]
  const c = last.c + dc
  return [...rows.slice(0, -1), { ...last, c, h: Math.max(last.h, c), l: Math.min(last.l, c), v: last.v + 7 }]
}
const COUNTERS = doc('var int a = 0\na += 1\nvarip int b = 0\nb += 1\nplot(a)\nplot(b)\n')

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

describe('H1 — a `varip` counts the bar\'s UPDATES, not how many times it was run', () => {
  it('two panes of the same script on the same symbol and timeframe show the same value, tick for tick', () => {
    let rows = mk(50)
    expect(run(COUNTERS, rows).b[49], 'pane 1').toBe(50)
    expect(run(COUNTERS, fresh(rows)).b[49], 'pane 2, the same bars').toBe(50)
    rows = tick(rows, 0.2)
    expect(run(COUNTERS, rows).b[49], 'pane 1 after one tick').toBe(51)
    expect(run(COUNTERS, fresh(rows)).b[49], 'pane 2 after the same tick').toBe(51)
  })
  it('the same bars re-run as fresh arrays (a refetch, a remount): the value holds', () => {
    const rows = mk(50)
    const got = [run(COUNTERS, fresh(rows)), run(COUNTERS, fresh(rows)), run(COUNTERS, fresh(rows))].map((o) => o.b[49])
    expect(got).toEqual([50, 50, 50])
  })
  it('older history prepended with no tick: the forming bar has not updated, and a cold count agrees', () => {
    expect(run(COUNTERS, mk(50, 10)).b[49]).toBe(50)
    const longer = run(COUNTERS, mk(60, 0))
    expect(longer.b[59], 'one execution per bar, the forming bar once').toBe(60)
    expect(longer.a[59]).toBe(60)
  })
  it('two panes over different spans of history keep their own ledgers, each counting the same ticks once', () => {
    let long = mk(60, 0)
    let short = mk(30, 30)
    expect([run(COUNTERS, long).b[59], run(COUNTERS, short).b[29]]).toEqual([60, 30])
    for (let k = 1; k <= 2; k += 1) {
      long = tick(long, 0.1 * k)
      short = [...short.slice(0, -1), long[long.length - 1]]
      expect([run(COUNTERS, long).b[59], run(COUNTERS, short).b[29]], `tick ${k}`).toEqual([60 + k, 30 + k])
    }
  })
  it('the same update run again keeps `barstate.isnew` as that update had it', () => {
    const d = doc('varip int b = 0\nb += 1\nplot(b)\nplot(barstate.isnew ? 1 : 0)\n')
    // the name is still refused (an owner ruling), so the PRODUCER is read off the run
    const src = doc('varip int b = 0\nb += 1\nplot(b)\nplot(close)\n')
    let rows = mk(30)
    expect(runtimeRealtimeOf(run(src, rows)).isNew[29], 'the bar\'s first update').toBe(1)
    expect(runtimeRealtimeOf(run(src, fresh(rows))).isNew[29], 'that update again').toBe(1)
    rows = tick(rows, 0.3)
    expect(runtimeRealtimeOf(run(src, rows)).isNew[29], 'its next update').toBe(0)
    expect(runtimeRealtimeOf(run(src, fresh(rows))).isNew[29], 'that update again').toBe(0)
    expect(d.compute.source).toMatch(/barstate\.isnew/)
  })
})

describe('M2 — a bar the feed calls closed and then forming again keeps counting', () => {
  it('tick, closed fetch, then forming ticks: one more per real update, no freeze', () => {
    let rows = mk(50)
    run(COUNTERS, rows)
    rows = tick(rows, 0.2)
    expect(run(COUNTERS, rows).b[49]).toBe(51)
    expect(run(COUNTERS, rows, CLOSED).b[49], 'the close: one more execution').toBe(52)
    expect(run(COUNTERS, rows).b[49], 'forming again at the same prices: no new update').toBe(52)
    const seen = []
    for (let k = 1; k <= 3; k += 1) { rows = tick(rows, 0.1 * k); seen.push(run(COUNTERS, rows).b[49]) }
    expect(seen, 'three real updates after the reopening').toEqual([53, 54, 55])
    expect(run(COUNTERS, rows, CLOSED).b[49], 'and it closes again: one more').toBe(56)
  })
  it('flip-flopping with no price change never double-counts', () => {
    let rows = mk(50)
    run(COUNTERS, rows)
    rows = tick(rows, 0.2)
    const got = [run(COUNTERS, rows), run(COUNTERS, rows, CLOSED), run(COUNTERS, rows), run(COUNTERS, rows, CLOSED), run(COUNTERS, rows)]
      .map((o) => o.b[49])
    expect(got).toEqual([51, 52, 52, 52, 52])
  })
})

const HEAD = '//@version=6\nindicator("m1", overlay = true)\n'
const built = (body) => buildRuntimeIr(HEAD + body, { bars: mk(10), objectsInRun: true, pane: true, realtimeLedger: true })
const refusal = (body) => { const b = built(body); return b.ok ? null : b.refusal }

describe('M1 — a `varip` that can hold a drawing is refused by TYPE', () => {
  const REFUSED = {
    'an array of lines (`array.new_line`)': 'varip ls = array.new_line()\narray.push(ls, line.new(bar_index, close, bar_index + 1, close))\nplot(close)\n',
    'an array of lines (`array.new<line>`)': 'varip ls = array.new<line>()\nplot(close)\n',
    'a typed array of lines': 'varip array<line> ls = array.new<line>()\nplot(close)\n',
    'a record with a line field': 'type Foo\n    line l\n    int n\nvarip Foo f = Foo.new(na, 0)\nplot(close)\n',
    'a record with a line field, untyped declaration': 'type Foo\n    line l\n    int n\nvarip f = Foo.new(na, 0)\nplot(close)\n',
    'a record holding a record with a label field (transitively)': 'type Inner\n    label lb\ntype Outer\n    Inner i\nvarip Outer o = Outer.new(na)\nplot(close)\n',
    'an array of such records': 'type Foo\n    line l\nvarip array<Foo> fs = array.new<Foo>()\nplot(close)\n',
    'a matrix (its element type is not checked)': 'varip m = matrix.new<float>(2, 2, 0.0)\nplot(close)\n',
    'a user function\'s result': 'f() => line.new(bar_index, close, bar_index + 1, close)\nvarip l = f()\nplot(close)\n',
    'a drawing family\'s live list': 'varip a = line.all\nplot(close)\n',
    'another slot holding drawings': 'var ls = array.new_line()\nvarip c = ls\nplot(close)\n',
  }
  for (const [name, body] of Object.entries(REFUSED)) {
    it(name, () => {
      const r = refusal(body)
      expect(r && r.guard, r && r.message).toBe('runtime:varip')
    })
  }
  it('CONTROL — scalars, text, colours and arrays of numbers still build', () => {
    for (const body of [
      'varip float x = 0.0\nx += close\nplot(x)\n',
      'varip int n = 0\nn += 1\nplot(n)\n',
      'varip string s = ""\nplot(close)\n',
      'varip a = array.new_float(0)\narray.push(a, close)\nplot(array.size(a))\n',
      'type P\n    float x\n    int n\nvarip P p = P.new(0.0, 0)\nplot(close)\n',
    ]) {
      const b = built(body)
      expect(b.ok, `${body} -> ${b.refusal && b.refusal.message}`).toBe(true)
    }
  })
})

describe('M3 — only a door with the ledger serves a `varip`; every other refuses it by name', () => {
  const SRC = '//@version=5\nindicator("m3")\nvarip int b = 0\nb += 1\nplot(b)\n'
  it('the front end, asked without the ledger', () => {
    const b = buildRuntimeIr(SRC, { bars: mk(10), pane: true })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:varip')
    expect(String(b.refusal.message)).toMatch(/no realtime ledger/)
  })
  it('a run with no session (`incremental: false`) and a measurement run (`opts.limits`)', () => {
    for (const opts of [{ incremental: false }, { limits: {} }]) {
      let err = null
      try { run(COUNTERS, mk(20), LIVE, opts) } catch (e) { err = e }
      expect(err && err.guard, JSON.stringify(opts)).toBe('runtime:varip')
    }
  })
  it('the host object lane\'s compile check (`probeObjectRuntime`)', () => {
    const r = probeObjectRuntime(SRC, [])
    expect(r.ok).toBe(false)
    expect(r.refusal.message).toMatch(/runtime:varip|varip/)
  })
  describe('the host object lane (C18)', () => {
    afterEach(() => { vi.unstubAllEnvs() })
    const H = '//@version=6\nindicator("m3h", overlay = true)\n'
    const WHILE_SUM = 'if barstate.islast\n    int i = 0\n    float s = 0.0\n    while i < 3\n        s += close[i]\n'
      + '        i += 1\n    if s > 0\n        label.new(bar_index, s, "sum")\n'
    const door = (src) => {
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      return memberPaneDefinition({ source: H + src, id: 'u_wsf_m3', name: 'm3' })
    }
    const BARS = mk(12)
    it('CONTROL — a drawing whose value only the runtime computes is handed the runtime lane', () => {
      const d = door(WHILE_SUM)
      const rt = d.definition.objects.runtime
      expect(rt).toBeTruthy()
      expect(runtimeObjectValues(rt, BARS, { tf: 'D', fromListing: true, atDefaults: true }).served).toBe(true)
    })
    it('the values door itself, handed a program with a `varip`, withholds by name', () => {
      const rt = door(WHILE_SUM).definition.objects.runtime
      const withVarip = { ...rt, source: `${rt.source}\nvarip int zz = 0\nzz += 1\n` }
      const got = runtimeObjectValues(withVarip, BARS, { tf: 'D', fromListing: true, atDefaults: true })
      expect(got.served).toBe(false)
      expect(got.reason).toBe('runtime:varip')
    })
  })
  it('CONTROL — the pane\'s own compile check and its run (which carry the ledger) accept it', () => {
    expect(probeRuntimeProgram(SRC).ok).toBe(true)
    expect(run(COUNTERS, mk(20)).b[19]).toBe(20)
  })
})

describe('L3 — the kept build counts against the session byte cap', () => {
  it('a long script over few bars: the build dominates the estimate', () => {
    const body = Array.from({ length: 150 }, (_, i) => `s += ta.sma(close, ${i + 2}) - ta.ema(high, ${i + 3})`).join('\n')
    const d = doc(`var float s = 0.0\n${body}\nplot(s)\nplot(close)\n`)
    run(d, mk(5))
    expect(runtimeSessionStats().sessions).toBe(1)
    // the rows, columns and checkpoint of 5 bars are a few kilobytes; the build is far more
    expect(runtimeSessionStats().approxBytes).toBeGreaterThan(100000)
  })
})
