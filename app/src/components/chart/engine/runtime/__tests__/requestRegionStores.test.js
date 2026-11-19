// app/src/components/chart/engine/runtime/__tests__/requestRegionStores.test.js
//
// ⭐⭐⭐ (engine 85) — A REQUEST REGION STORES WHAT IT READS.
//
// A request runs as its own sub-run (`vm.js::runRequest`): a fresh `execute` from the region's entry, over the
// requested bars. ⚰️ From engine 82 (#1952, U-FGS F1) a helper's `ta.change(x)` inlined into a request declared its
// series into the MAIN program, so `request.security(sym, tf, v(close))` with `v(x) => u(x) + ta.change(x)` drew `na`
// on every bar with nothing red (it had drawn exactly before e82, through the shared frame), and `ta.change(close * 2)`
// in a request's value had done the same since requests could hoist. The fix: a request's value hoists into its own
// region (`pineRuntimeFrontend.js`, the request lowering's `stmtHoistSink`). The class guard: a region that reads a
// main-frame value it never stores is refused at build, by name (`program.js::requestRegionUnstoredRead`).
//
// THE ORACLE IS EXACT: on a daily chart whose bars share SPY's timestamps, `request.security("AMEX:SPY", period, e)`
// is SPY's own `e`, bar for bar, so each request must equal `plot(e)` on SPY's chart bit for bit (`Object.is`), on
// both runtime lanes (the pane, and a run half that draws its own objects).
import { describe, it, expect } from 'vitest'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtimeColumns'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend'
import { lowerIrProgram } from '../lowerIr'
import { OP, makeProgram, requestRegionUnstoredRead, REQUEST_UNSTORED_GUARD } from '../program'

function weekdays(n, from = '2016-01-04') {
  const out = []
  const d = new Date(`${from}T00:00:00Z`)
  while (out.length < n) {
    if (![0, 6].includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const priced = (times, base, k = 1) => times.map((t, i) => {
  const c = base + k * (Math.sin(i / 11) * 6 + Math.cos(i / 29) * 3 + i * 0.01)
  return { t, o: c - 0.4 * k, h: c + 1.1 * k + (i % 5) * 0.01, l: c - 1.2 * k, c, v: 1e6 + (i % 13) * 1000 }
})
const CHART = priced(weekdays(1500), 100).slice(-400)
const SPY = priced(weekdays(1500), 400, 1.3).slice(-400)
const REQ_CTX = () => ({
  tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' },
  secondary: new Map([['SPY', { bars: SPY, status: 'available' }]]), exchangeOf: (t) => (t === 'SPY' ? 'NYSE Arca' : null),
})
const OWN_CTX = () => ({ tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'SPY', exchange: 'NYSE Arca' } })
const HEAD = '//@version=6\nindicator("stores", overlay = false)\n'
const LANES = { pane: false, 'run half': true }
const doc = (source, objects) => ({
  id: 'stores', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:stores', outputs: { a: 0 }, source, ...(objects ? { objects: true } : {}) },
})
const columnOf = (source, bars, ctx, objects) => {
  resetRuntimeSessions(); resetRuntimeLedgers()
  return Array.from(computeRuntimeColumns(doc(source, objects), bars, ctx).a)
}

/** [label, helper lines, the requested expression]. Each one drew `na` on every requested bar from e82 to e84, or
 *  (S2, S4, S12) before that too; the first is the member's report. */
const SHAPES = [
  ['a helper calling a helper, with ta.change of its parameter', 'u(x) => ta.rsi(x, 5)\nv(x) => u(x) + ta.change(x)\n', 'v(close)'],
  ['ta.change of a parameter, alone', 'w(x) => ta.change(x)\n', 'w(close)'],
  ['ta.change of two parameters', 'w(x, y) => ta.change(x) - ta.change(y)\n', 'w(close, open)'],
  ['ta.change of an expression over a parameter', 'w(x) => ta.change(x * 2)\n', 'w(close)'],
  ['ta.change of an expression in the value itself', '', 'ta.change(close * 2)'],
  ['ta.change of a root binding', 'pl = close * 2\n', 'ta.change(pl)'],
  ['a statement-form helper: ta.change of a body local', 'w(x) =>\n    d = x * 2\n    ta.change(d)\n', 'w(close)'],
  ['a statement-form helper: ta.change on its last line', 'w(x) =>\n    d = x * 2\n    d + ta.change(x * 2)\n', 'w(close)'],
  ['the helper in a ?: arm', 'w(x) => ta.change(x)\n', 'close > open ? w(close) : 0'],
]

describe('a request draws its symbol\'s own series: bit for bit what that symbol\'s chart draws, on both lanes', () => {
  for (const [lane, objects] of Object.entries(LANES)) {
    for (const [label, defs, expr] of SHAPES) {
      it(`${lane}: ${label}`, () => {
        const requested = columnOf(`${HEAD}${defs}plot(request.security("AMEX:SPY", timeframe.period, ${expr}))\n`, CHART, REQ_CTX(), objects)
        const own = columnOf(`${HEAD}${defs}plot(${expr})\n`, SPY, OWN_CTX(), objects)
        // non-vacuous: the oracle draws (an all-`na` pair would agree with itself)
        expect(own.filter(Number.isFinite).length).toBeGreaterThan(380)
        const bad = []
        for (let i = 0; i < own.length; i += 1) if (!Object.is(requested[i], own[i])) bad.push(`${i}: ${requested[i]} vs ${own[i]}`)
        expect(bad.slice(0, 5), label).toEqual([])
      })
    }
  }

  it('a tuple of helpers: each element is its own symbol\'s series', () => {
    const defs = 'w(x) => ta.change(x)\n'
    const requested = columnOf(`${HEAD}${defs}[a, b] = request.security("AMEX:SPY", timeframe.period, [w(close), w(open)])\nplot(b)\n`, CHART, REQ_CTX(), false)
    const own = columnOf(`${HEAD}${defs}plot(w(open))\n`, SPY, OWN_CTX(), false)
    expect(own.filter(Number.isFinite).length).toBeGreaterThan(380)
    for (let i = 0; i < own.length; i += 1) expect(Object.is(requested[i], own[i]), `bar ${i}`).toBe(true)
  })

  it('the request\'s hoists stay in its region, and a root hoist on the same line stays in the main program', () => {
    // both halves of one line hoist: the request's into its region, the root's (`ta.change` of an expression over a
    // `var`, which no column can hold) into the main program, whichever comes first on the line
    const ROOT = 'var float acc = 0.0\nacc += close\n'
    const req = 'request.security("AMEX:SPY", timeframe.period, ta.change(close * 2))'
    const left = columnOf(`${HEAD}plot(ta.change(close * 2))\n`, SPY, OWN_CTX(), false)
    const right = columnOf(`${HEAD}${ROOT}plot(ta.change(acc * 3))\n`, CHART, OWN_CTX(), false)
    expect(right.filter(Number.isFinite).length).toBeGreaterThan(380)
    for (const line of [`plot(${req} + ta.change(acc * 3))`, `plot(ta.change(acc * 3) + ${req})`]) {
      const mixed = columnOf(`${HEAD}${ROOT}${line}\n`, CHART, REQ_CTX(), false)
      const want = line.startsWith(`plot(${req}`) ? (i) => left[i] + right[i] : (i) => right[i] + left[i]
      for (let i = 0; i < mixed.length; i += 1) expect(Object.is(mixed[i], want(i)), `${line}: bar ${i}`).toBe(true)
    }
  })
})

// ─── the lowering: the region holds its own store and ring ─────────────────────────────────────────────────────────
const lowered = (src) => {
  const built = buildRuntimeIr(src, { bars: CHART, inputs: {}, objectTrees: [], pane: true, tf: 'D', basePeriod: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' } })
  expect(built.ok, JSON.stringify(built.refusal)).toBe(true)
  return lowerIrProgram(built.ir, { historyFromListing: true })
}
const regionOf = (p, k = 0) => {
  const starts = [...p.functions.map((f) => f.entry), ...p.requests.map((r) => r.entry)].sort((a, b) => a - b)
  const entry = p.requests[k].entry
  const end = starts.find((e) => e > entry) || p.instructions
  const ops = []
  for (let pc = entry; pc < end; pc += 1) ops.push([p.code[pc * 3], p.code[pc * 3 + 1], p.code[pc * 3 + 2]])
  return ops
}

describe('the hoisted series is the REGION\'s: stored and committed inside it', () => {
  for (const [label, defs, expr] of SHAPES) {
    it(label, () => {
      const p = lowered(`${HEAD}${defs}plot(request.security("AMEX:SPY", timeframe.period, ${expr}))\n`)
      const ops = regionOf(p)
      const stored = new Set(ops.filter(([op]) => op === OP.STORE_LOCAL).map(([, a]) => a))
      const rings = ops.filter(([op]) => op === OP.READ_HIST_SLOT).map(([, a]) => p.history[a]).filter((h) => h.site === null)
      // the class's own shape: a main-frame ring read in the region, whose live slot the region stores
      expect(rings.length, label).toBeGreaterThan(0)
      for (const h of rings) expect(stored.has(h.slot), `${label}: ${h.name}`).toBe(true)
      expect(requestRegionUnstoredRead(p)).toBe(null)
    })
  }
})

// ─── ⛔ the class guard ─────────────────────────────────────────────────────────────────────────────────────────────
describe('⛔ a request region that reads what it never stores is refused at build, by name', () => {
  // main: HALT. A function body after it, then the request region.
  const prog = (code, { functions = [], requests = [{ entry: 1 }], history = [] } = {}) => ({ code: code.flat(), instructions: code.length, functions, requests, history })

  it('a local slot: read without a store is a hole; with one anywhere in the region it is not', () => {
    const hole = prog([[OP.HALT, 0, 0], [OP.LOAD_LOCAL, 0, 0], [OP.EMIT, 0, 0], [OP.HALT, 0, 0]])
    expect(requestRegionUnstoredRead(hole)).toEqual({ request: 0, pc: 1, what: 'local slot 0' })
    const stores = prog([[OP.HALT, 0, 0], [OP.READ_SERIES, 3, 0], [OP.STORE_LOCAL, 0, 0], [OP.LOAD_LOCAL, 0, 0], [OP.EMIT, 0, 0], [OP.HALT, 0, 0]])
    expect(requestRegionUnstoredRead(stores)).toBe(null)
    // the MAIN program's store is not the region's: a sub-run never runs it
    const mainStores = prog([[OP.READ_SERIES, 3, 0], [OP.STORE_LOCAL, 0, 0], [OP.HALT, 0, 0], [OP.LOAD_LOCAL, 0, 0], [OP.EMIT, 0, 0], [OP.HALT, 0, 0]], { requests: [{ entry: 3 }] })
    expect(requestRegionUnstoredRead(mainStores)).toEqual({ request: 0, pc: 3, what: 'local slot 0' })
  })

  it('a persistent slot, the same rule', () => {
    const hole = prog([[OP.HALT, 0, 0], [OP.LOAD_PERSIST, 2, 0], [OP.EMIT, 0, 0], [OP.HALT, 0, 0]])
    expect(requestRegionUnstoredRead(hole)).toEqual({ request: 0, pc: 1, what: 'persistent slot 2' })
    const stores = prog([[OP.HALT, 0, 0], [OP.CONST, 0, 0], [OP.STORE_PERSIST, 2, 0], [OP.LOAD_PERSIST, 2, 0], [OP.EMIT, 0, 0], [OP.HALT, 0, 0]])
    expect(requestRegionUnstoredRead(stores)).toBe(null)
  })

  it('a main-frame ring: its live slot must be stored in the region; a call site\'s ring is its function\'s', () => {
    const history = [{ name: 'ta.change src 0', slot: 0, persist: false, depth: 1, site: null }]
    const hole = prog([[OP.HALT, 0, 0], [OP.READ_HIST_SLOT, 0, 1], [OP.EMIT, 0, 0], [OP.HALT, 0, 0]], { history })
    expect(requestRegionUnstoredRead(hole)).toEqual({ request: 0, pc: 1, what: '`ta.change src 0`\'s committed series' })
    const stores = prog([[OP.HALT, 0, 0], [OP.READ_SERIES, 3, 0], [OP.STORE_LOCAL, 0, 0], [OP.READ_HIST_SLOT, 0, 1], [OP.EMIT, 0, 0], [OP.HALT, 0, 0]], { history })
    expect(requestRegionUnstoredRead(stores)).toBe(null)
    const site = prog([[OP.HALT, 0, 0], [OP.READ_HIST_SLOT, 0, 1], [OP.EMIT, 0, 0], [OP.HALT, 0, 0]], { history: [{ ...history[0], site: 0 }] })
    expect(requestRegionUnstoredRead(site)).toBe(null)
  })

  it('a function the region calls reads the sub-run\'s main frame through LOAD_GLOBAL_*; a function only main calls does not count', () => {
    // pc 1-2: function 0 (reads global local 1); region at 3
    const viaCall = prog([[OP.HALT, 0, 0], [OP.LOAD_GLOBAL_LOCAL, 1, 0], [OP.RET, 0, 0], [OP.CALL, 0, 0], [OP.EMIT, 0, 0], [OP.HALT, 0, 0]],
      { functions: [{ entry: 1, name: 'g' }], requests: [{ entry: 3 }] })
    expect(requestRegionUnstoredRead(viaCall)).toEqual({ request: 0, pc: 1, what: 'the global local slot 1 (in `g`)' })
    const viaCallP = prog([[OP.HALT, 0, 0], [OP.LOAD_GLOBAL_PERSIST, 0, 0], [OP.RET, 0, 0], [OP.CALL, 0, 0], [OP.EMIT, 0, 0], [OP.HALT, 0, 0]],
      { functions: [{ entry: 1, name: 'g' }], requests: [{ entry: 3 }] })
    expect(requestRegionUnstoredRead(viaCallP)).toEqual({ request: 0, pc: 1, what: 'the global persistent slot 0 (in `g`)' })
    // through a second function
    const deep = prog([[OP.HALT, 0, 0], [OP.LOAD_GLOBAL_LOCAL, 1, 0], [OP.RET, 0, 0], [OP.CALL, 0, 0], [OP.RET, 0, 0], [OP.CALL, 1, 0], [OP.EMIT, 0, 0], [OP.HALT, 0, 0]],
      { functions: [{ entry: 1, name: 'g' }, { entry: 3, name: 'h' }], requests: [{ entry: 5 }] })
    expect(requestRegionUnstoredRead(deep)).toEqual({ request: 0, pc: 1, what: 'the global local slot 1 (in `g`)' })
    const storesIt = prog([[OP.HALT, 0, 0], [OP.LOAD_GLOBAL_LOCAL, 1, 0], [OP.RET, 0, 0], [OP.READ_SERIES, 3, 0], [OP.STORE_LOCAL, 1, 0], [OP.CALL, 0, 0], [OP.EMIT, 0, 0], [OP.HALT, 0, 0]],
      { functions: [{ entry: 1, name: 'g' }], requests: [{ entry: 3 }] })
    expect(requestRegionUnstoredRead(storesIt)).toBe(null)
    const mainOnly = prog([[OP.CALL, 0, 0], [OP.HALT, 0, 0], [OP.LOAD_GLOBAL_LOCAL, 1, 0], [OP.RET, 0, 0], [OP.READ_SERIES, 3, 0], [OP.EMIT, 0, 0], [OP.HALT, 0, 0]],
      { functions: [{ entry: 2, name: 'g' }], requests: [{ entry: 4 }] })
    expect(requestRegionUnstoredRead(mainOnly)).toBe(null)
  })

  it('makeProgram refuses it under the request family\'s guard: the member\'s own script with its store deleted', () => {
    const p = lowered(`${HEAD}${SHAPES[0][1]}plot(request.security("AMEX:SPY", timeframe.period, ${SHAPES[0][2]}))\n`)
    const entry = p.requests[0].entry
    const code = Array.from(p.code)
    let pcStore = -1
    for (let pc = entry; pc < p.instructions; pc += 1) if (code[pc * 3] === OP.STORE_LOCAL) { pcStore = pc; break }
    expect(pcStore).toBeGreaterThanOrEqual(entry)
    // the program as lowered builds; the same program with that one store turned into a DROP is refused
    expect(() => makeProgram({ ...p, code })).not.toThrow()
    code[pcStore * 3] = OP.DROP
    code[pcStore * 3 + 1] = 0
    let err = null
    try { makeProgram({ ...p, code }) } catch (e) { err = e }
    expect(err && err.name).toBe('ProgramError')
    expect(err.guard).toBe(REQUEST_UNSTORED_GUARD)
    expect(REQUEST_UNSTORED_GUARD).toBe('runtime:request')
    expect(err.message).toMatch(/^this request reads .* which its own region never computes/)
  })
})
