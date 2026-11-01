// app/src/components/chart/engine/runtime/__tests__/runtimeRealtimeReview2.test.js
//
// ⭐⭐ P3 WS-F step 2 — the re-review's findings on 6099aef442, each a rail (RED there):
//   A   a run over OLDER prices than the latest recorded update counted as a new update, and the
//       shared ledger spread that count to every pane (a lagging pane, a stale refetch);
//   B   `varip l = q.mk()` (a method returning a drawing) and `varip x = f.l` (a field of a
//       drawing type) were not refused;
//   L1  a fixed-depth window that slides forward on each new bar (a framed instance's frame is
//       refetched whole at its depth) moved `rows[0].t` and reset the `varip` every new bar.
//       The adoption tried first was itself refused at re-review (M1, M2): sliding windows now
//       refuse a `varip` by name and ledgers are never adopted across history starts.
import { describe, it, expect, beforeEach } from 'vitest'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeLedgerStats, SLIDING_VARIP_WHY } from '../runtimeColumns.js'
import { workerRunner, resetRuntimeAsync } from '../runtimeAsync.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'

const doc = (body, outputs = { a: 0, b: 1 }) => ({
  id: 'rt-review2', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:rt-review2', outputs, source: `//@version=5\nindicator("r2")\n${body}` },
})
const bar = (i) => {
  const c = 100 + 3 * Math.sin(i / 4) + i * 0.05
  return { t: 1700000000 + i * 86400, o: c - 0.3, h: c + 1, l: c - 1, c, v: 1000 + i }
}
const mk = (n, from = 0) => Array.from({ length: n }, (_, j) => bar(j + from))
const LIVE = { tf: 'D', newestBarIsForming: true, historyFromListing: true }
const tick = (rows, dc) => {
  const last = rows[rows.length - 1]
  const c = last.c + dc
  return [...rows.slice(0, -1), { ...last, c, h: Math.max(last.h, c), l: Math.min(last.l, c), v: last.v + 7 }]
}
const fresh = (rows) => rows.map((b) => ({ ...b }))
const COUNTERS = doc('var int a = 0\na += 1\nvarip int b = 0\nb += 1\nplot(a)\nplot(b)\n')
const b49 = (rows) => computeRuntimeColumns(COUNTERS, fresh(rows), LIVE).b[rows.length - 1]

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

describe('A — an older update run after a newer one is a replay, on every pane', () => {
  const P = [mk(50)]
  for (let k = 1; k <= 4; k += 1) P.push(tick(P[k - 1], 0.1 * k))
  it('B stale, then catches up (A:P0, A:P1, B:P0, B:P1)', () => {
    expect([b49(P[0]), b49(P[1]), b49(P[0]), b49(P[1])]).toEqual([50, 51, 50, 51])
    expect(b49(P[2]), 'the next real update still counts once').toBe(52)
  })
  it('B lags one tick behind A', () => {
    const seq = [['A', 0], ['A', 1], ['B', 0], ['A', 2], ['B', 1], ['A', 3], ['B', 2], ['B', 3]]
    const got = { A: [], B: [] }
    for (const [who, k] of seq) got[who].push(b49(P[k]))
    expect(got.A).toEqual([50, 51, 52, 53])
    expect(got.B).toEqual([50, 51, 52, 53])
    expect(b49(P[4])).toBe(54)
  })
})

const HEAD = '//@version=6\nindicator("b", overlay = true)\n'
const refusal = (body) => {
  const b = buildRuntimeIr(HEAD + body, { bars: mk(10), objectsInRun: true, pane: true, realtimeLedger: true })
  return b.ok ? null : b.refusal
}

describe('B — a dotted read that can hold a drawing is refused', () => {
  const REFUSED = {
    'a method returning a line (`q.mk()`)': 'type Q\n    int n\nmethod mk(Q q) => line.new(bar_index, close, bar_index + 1, close)\nvar q = Q.new(0)\nvarip l = q.mk()\nplot(close)\n',
    'a field of a line type (`f.l`)': 'type F\n    line l\nvar f = F.new(na)\nvarip x = f.l\nplot(close)\n',
    'a field chain ending in a line (`g.f.l`)': 'type F\n    line l\ntype G\n    F f\nvar g = G.new(F.new(na))\nvarip y = g.f.l\nplot(close)\n',
    'a field whose record type holds a line (`g.f`)': 'type F\n    line l\ntype G\n    F f\nvar g = G.new(F.new(na))\nvarip y = g.f\nplot(close)\n',
    'a built-in method on a record with a line field (`f.copy()`: not a field, so unsure)': 'type F\n    line l\nvar f = F.new(na)\nvarip c = f.copy()\nplot(close)\n',
    'the script\'s own method on a receiver that is not a slot (`close.mk()`)': 'method mk(float x) => line.new(bar_index, x, bar_index + 1, x)\nvarip l = close.mk()\nplot(close)\n',
    'a dotted read off a collection (`ls.copy()`)':'var ls = array.new_line()\nvarip c = ls.copy()\nplot(close)\n',
  }
  for (const [name, body] of Object.entries(REFUSED)) {
    it(name, () => {
      const r = refusal(body)
      expect(r && r.guard, r && r.message).toBe('runtime:varip')
    })
  }
  it('CONTROL — a numeric field of a handle-free record builds', () => {
    const body = 'type P\n    float x\nvar p = P.new(1.0)\nvarip float z = p.x\nz += 1\nplot(z)\n'
    expect(refusal(body)).toBeNull()
  })
})

describe('L1 (re-review M1) — a ledger is never adopted across history starts', () => {
  it('pane B, the same depth one bar later, does not take pane A\'s ledger: A keeps counting', () => {
    let a = mk(60)
    const got = [b49(a)]
    a = tick(a, 0.2); got.push(b49(a))
    a = tick(a, 0.3); got.push(b49(a))
    expect(got).toEqual([60, 61, 62])
    const b = [...mk(60, 1).slice(0, -1), bar(60)]
    expect(b49(b), 'pane B: its own history, its forming bar run once').toBe(60)
    a = tick(a, 0.4)
    expect(b49(a), 'pane A\'s next tick').toBe(63)
  })
  it('a plain chart whose window moves is a reload (its own history), and moving back finds its old ledger', () => {
    const rows = mk(50)
    expect(b49(rows)).toBe(50)
    const slid = [...rows.slice(1), bar(50)]
    expect(b49(slid), 'the moved window: its own history').toBe(50)
    expect(b49(mk(50)), 'back to the first start: that ledger, untouched').toBe(50)
  })
  it('CONTROL — a shorter pane over the same feed is still its own history', () => {
    const long = mk(60)
    expect(b49(long)).toBe(60)
    expect(b49(mk(30, 30))).toBe(30)
  })
})

describe('M2 (re-review) — a window that slides is refused a `varip` by name', () => {
  it('a framed instance (`ctx.framed`)', () => {
    let err = null
    try { computeRuntimeColumns(COUNTERS, mk(30), { ...LIVE, framed: true }) } catch (e) { err = e }
    expect(err && err.guard).toBe('runtime:varip')
    expect(String(err.message)).toContain(SLIDING_VARIP_WHY)
  })
  it('even after the same script built with its ledger on a plain chart (sessions are kept apart)', () => {
    expect(b49(mk(30))).toBe(30)
    let err = null
    try { computeRuntimeColumns(COUNTERS, mk(30), { ...LIVE, framed: true }) } catch (e) { err = e }
    expect(err && err.guard).toBe('runtime:varip')
  })
  it('CONTROL — a framed instance of a script with no `varip` runs', () => {
    const d = doc('var int a = 0\na += 1\nplot(a)\nplot(close)\n')
    expect(computeRuntimeColumns(d, mk(30), { ...LIVE, framed: true }).a[29]).toBe(30)
  })
  it('the worker carries `framed` across, and the refusal comes back by name', async () => {
    const posted = []
    const factory = () => ({
      postMessage(msg) {
        posted.push(msg)
        queueMicrotask(() => {
          try { this.onmessage({ data: { id: msg.id, ok: true, columns: computeRuntimeColumns(msg.def, msg.rows, msg.ctx) } }) } catch (err) {
            this.onmessage({ data: { id: msg.id, ok: false, error: { name: err.name, message: err.message, guard: err.guard || null } } })
          }
        })
      },
      terminate() {},
    })
    const run = workerRunner(factory)
    const got = await new Promise((resolve) => run(COUNTERS, mk(30), { ...LIVE, framed: true }, (err, cols) => resolve({ err, cols })))
    expect(posted[0].ctx.framed).toBe(true)
    expect(got.err && got.err.guard).toBe('runtime:varip')
    resetRuntimeAsync()
  })
})

describe('L3 (re-review) — the ledger is bounded by bytes, and a closed bar drops its prices', () => {
  it('ticks grow the ledger; the close gives the seen prices back', () => {
    let rows = mk(40)
    b49(rows)
    for (let k = 1; k <= 20; k += 1) { rows = tick(rows, 0.01 * k); b49(rows) }
    const open = runtimeLedgerStats().approxBytes
    expect(open).toBeGreaterThan(0)
    computeRuntimeColumns(COUNTERS, rows, { ...LIVE, newestBarIsForming: false })
    expect(runtimeLedgerStats().approxBytes, 'after the close').toBeLessThan(open / 4)
  })
})
