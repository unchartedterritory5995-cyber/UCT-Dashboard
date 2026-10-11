// app/src/components/chart/engine/runtime/__tests__/runtimeIncremental.test.js
//
// ⭐⭐⭐ UIE PHASE 5 (M2/M3/M7) — AN INCREMENTAL RUN EQUALS A CLEAN FULL RUN.
//
// A chart's life, replayed on deterministic bars: ticks on the forming bar, the bar
// closing and the next one opening, a correction of an old bar, a settings change, a
// source edit. After EVERY step the session-backed run (`runtimeColumns.js`, the
// product default) is compared with a clean full run of the same bars (`incremental:
// false`, no session): every output column bit for bit (`Object.is`), the warm-up, the
// drawings (every live object's family and properties — positions, colours, text,
// cells), and the refusal. And the session is checked to have DONE something: a tick
// resumes, a correction does not.
import { describe, it, expect, beforeEach } from 'vitest'
import { computeRuntimeColumns, resetRuntimeSessions, runtimeIncrementalOf } from '../runtimeColumns.js'
import { runtimeObjectsOf, runtimeObjectsWithheldOf, runtimeWarmupOf } from '../runtimeObjects.js'

const doc = (body, { objects = false, listing = false } = {}) => ({
  id: 'inc', ...(listing ? { meta: { runtimeHistory: 'listing' } } : {}),
  compute: { kind: 'runtime', fn: 'runtime:inc', outputs: { v: 0, w: 1 }, ...(objects ? { objects: true } : {}),
    source: `//@version=5\nindicator("inc", overlay = true)\n${body}` },
})
// a deterministic random walk
let seed = 7
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const bar = (i, prev) => {
  const c = prev + (rnd() - 0.5) * 2
  return { t: 1700000000 + i * 300, o: prev, h: Math.max(prev, c) + rnd(), l: Math.min(prev, c) - rnd(), c, v: 1000 + Math.round(rnd() * 500) }
}
function makeBars(n) {
  seed = 7
  const out = []
  let p = 100
  for (let i = 0; i < n; i += 1) { const b = bar(i, p); out.push(b); p = b.c }
  return out
}

const fullOf = (d, rows, ctx, inputs) => {
  try { return { cols: computeRuntimeColumns(d, rows, { ...ctx, ...(inputs ? { runtimeInputs: inputs } : {}) }, { incremental: false }) } } catch (e) { return { err: e.guard || e.name } }
}
const incOf = (d, rows, ctx, inputs) => {
  try { return { cols: computeRuntimeColumns(d, rows, { ...ctx, ...(inputs ? { runtimeInputs: inputs } : {}) }) } } catch (e) { return { err: e.guard || e.name } }
}
function expectSame(inc, full, at) {
  expect(inc.err, at).toBe(full.err)
  if (full.err) return
  const keys = Object.keys(full.cols)
  expect(Object.keys(inc.cols), at).toEqual(keys)
  for (const k of keys) {
    const a = inc.cols[k]
    const b = full.cols[k]
    expect(a.length, at).toBe(b.length)
    for (let i = 0; i < b.length; i += 1) if (!Object.is(a[i], b[i])) expect.fail(`${at}: ${k}[${i}] ${a[i]} vs ${b[i]}`)
  }
  // the warm-up withheld is the same; HOW the second run got there (`secondRunStoppedAt`,
  // an early stop a resumed run never needs) is the check's own bookkeeping, not output
  const warm = (c) => { const w = runtimeWarmupOf(c); if (!w) return w; const { secondRunStoppedAt: _s, ...rest } = w; return rest }
  expect(warm(inc.cols), at).toEqual(warm(full.cols))
  const oi = runtimeObjectsOf(inc.cols)
  const of = runtimeObjectsOf(full.cols)
  expect(!!oi, at).toBe(!!of)
  if (of) expect(oi.live, at).toEqual(of.live)
  expect(runtimeObjectsWithheldOf(inc.cols), at).toEqual(runtimeObjectsWithheldOf(full.cols))
}

/** a chart's life: returns how often the incremental run resumed */
function replay(d, { n = 600, ticks = 3, newBars = 4, listing = false, inputs } = {}) {
  resetRuntimeSessions()
  const all = makeBars(n + newBars + 1)
  let rows = all.slice(0, n).map((b) => ({ ...b }))
  const ctx = { tf: '5', newestBarIsForming: true, ...(listing ? { historyFromListing: true } : {}) }
  let resumed = 0
  const step = (label) => {
    const inc = incOf(d, rows, ctx, inputs)
    expectSame(inc, fullOf(d, rows, ctx, inputs), label)
    const info = inc.cols ? runtimeIncrementalOf(inc.cols) : null
    if (info && info.resumedFrom !== null) resumed += 1
    return info
  }
  step('initial')
  for (let b = 0; b < newBars; b += 1) {
    for (let t = 0; t < ticks; t += 1) {
      const last = rows[rows.length - 1]
      const c = last.c + (rnd() - 0.5)
      rows = [...rows.slice(0, -1), { ...last, c, h: Math.max(last.h, c), l: Math.min(last.l, c), v: last.v + 10 }]
      step(`bar ${b} tick ${t}`)
    }
    rows = [...rows, { ...all[n + b], o: rows[rows.length - 1].c }]   // the next bar opens
    step(`bar ${b} opens`)
  }
  return resumed
}

beforeEach(() => resetRuntimeSessions())

const SCRIPTS = {
  'a var recurrence': ['var float x = na\nx := na(x) ? close : 0.9 * x + 0.1 * close\nplot(x)\nplot(x - close)\n'],
  'builtins (ema, rsi, highest)': ['plot(ta.ema(close, 20))\nplot(ta.rsi(close, 14) + ta.highest(high, 30))\n'],
  'arrays (push/shift, a window)': ['var a = array.new_float(0)\narray.push(a, close)\nif array.size(a) > 25\n    array.shift(a)\nplot(array.avg(a))\nplot(array.size(a))\n'],
  'a user-defined type': ['type P\n    float v\n    int n\nvar p = P.new(0, 0)\np.v := 0.5 * p.v + 0.5 * close\np.n += 1\nplot(p.v)\nplot(p.n)\n'],
  'a stateful function': ['f(x) =>\n    var float s = na\n    s := na(s) ? x : 0.8 * s + 0.2 * x\n    s\nplot(f(close))\nplot(f(open))\n'],
  'nested loops over history': ['float t = 0.0\nfor i = 0 to 4\n    for j = 0 to 3\n        t += close[i] * j\nplot(t)\nplot(ta.sma(t, 10))\n'],
  'history of a var (x[k])': ['var float x = 0\nx := 0.5 * x + 0.5 * close\nplot(x - x[7])\nplot(x[1])\n'],
  'bar_index and barstate.islast': ['plot(bar_index)\nplot(barstate.islast ? close : na)\n'],
}
const DRAWINGS = {
  'a line extended and moved every bar': 'var line l = na\nif na(l)\n    l := line.new(bar_index, close, bar_index + 1, close, color = color.red)\nelse\n    line.set_xy2(l, bar_index, close)\n    line.set_color(l, close > open ? color.green : color.red)\nplot(close)\nplot(open)\n',
  'labels made and deleted, newest 5 kept': 'var a = array.new<label>()\nif close > open\n    array.push(a, label.new(bar_index, high, str.tostring(close, "#.##")))\n    if array.size(a) > 5\n        label.delete(array.shift(a))\nplot(close)\nplot(open)\n',
  'a box redrawn on new highs': 'var box b = na\nif high == ta.highest(high, 10)\n    box.delete(b)\n    b := box.new(bar_index - 5, high, bar_index, low, bgcolor = color.new(color.blue, 80), text = str.tostring(volume))\nplot(close)\nplot(open)\n',
  'a table updated on the last bar': 'var t = table.new(position.top_right, 2, 2)\nr = ta.rsi(close, 14)\nif barstate.islast\n    table.cell(t, 0, 0, "RSI")\n    table.cell(t, 1, 0, str.tostring(r, "#.#"), bgcolor = r > 50 ? color.green : color.red)\nplot(r)\nplot(close)\n',
}

describe('⭐⭐ the chart\'s life, step by step: the incremental run equals the full run', () => {
  for (const [name, [body]] of Object.entries(SCRIPTS)) {
    it(name, () => {
      const resumed = replay(doc(body, { listing: true }), { listing: true })
      expect(resumed, 'the session resumed').toBeGreaterThan(0)
    })
  }
  for (const [name, body] of Object.entries(DRAWINGS)) {
    it(`drawings — ${name}`, () => {
      const resumed = replay(doc(body, { objects: true, listing: true }), { listing: true })
      expect(resumed).toBeGreaterThan(0)
    })
  }
  it('off the listing (the warm-up curtain, both of its runs resumed)', () => {
    const resumed = replay(doc(SCRIPTS['a var recurrence'][0], { listing: true }), { n: 1500, listing: false })
    expect(resumed).toBeGreaterThan(0)
  })
  it('drawings off the listing (both runs, and the drawings compared each step)', () => {
    replay(doc(DRAWINGS['labels made and deleted, newest 5 kept'], { objects: true, listing: true }), { n: 1500, listing: false })
  })
})

describe('⛔ when the session must NOT be reused', () => {
  const d = doc(SCRIPTS['a var recurrence'][0], { listing: true })
  const ctx = { tf: '5', newestBarIsForming: true, historyFromListing: true }
  it('a corrected old bar: a full run, and it equals one', () => {
    const rows = makeBars(500)
    incOf(d, rows, ctx)
    const fixed = rows.map((b, i) => (i === 100 ? { ...b, c: b.c + 1 } : b))
    const inc = incOf(d, fixed, ctx)
    expect(runtimeIncrementalOf(inc.cols).resumedFrom).toBeNull()
    expect(runtimeIncrementalOf(inc.cols).why).toMatch(/bars before the checkpoint changed/)
    expectSame(inc, fullOf(d, fixed, ctx), 'corrected')
  })
  it('an inserted bar (a gap filled), a shorter window: full runs', () => {
    const rows = makeBars(500)
    incOf(d, rows, ctx)
    const gap = [...rows.slice(0, 200), { ...rows[200], t: rows[200].t - 150 }, ...rows.slice(200)]
    expect(runtimeIncrementalOf(incOf(d, gap, ctx).cols).resumedFrom).toBeNull()
    expect(runtimeIncrementalOf(incOf(d, rows.slice(100), ctx).cols).resumedFrom).toBeNull()
  })
  it('a source edit, a settings change, a timeframe or symbol change: a different session (cold)', () => {
    const rows = makeBars(500)
    incOf(d, rows, ctx)
    const edited = { ...d, compute: { ...d.compute, source: d.compute.source.replace('0.9', '0.8') } }
    expect(runtimeIncrementalOf(incOf(edited, rows, ctx).cols).why).toBe('cold')
    expect(runtimeIncrementalOf(incOf(d, rows, { ...ctx, tf: '15' }).cols).why).toBe('cold')
    expect(runtimeIncrementalOf(incOf(d, rows, { ...ctx, symbol: { ticker: 'AAPL', exchange: 'NASDAQ' } }).cols).why).toBe('cold')
  })
  it('a script that reads the whole series (`barstate.islast`): on a CLOSED last bar it is not resumed across a new bar; on a forming one it is (its checkpoint was never the last bar) — equal either way', () => {
    const di = doc(SCRIPTS['bar_index and barstate.islast'][0], { listing: true })
    const rows = makeBars(500)
    const more = [...rows, makeBars(501)[500]]
    const closed = { ...ctx, newestBarIsForming: false }
    incOf(di, rows, closed)
    const a = incOf(di, more, closed)
    expect(runtimeIncrementalOf(a.cols).resumedFrom).toBeNull()
    expect(runtimeIncrementalOf(a.cols).why).toMatch(/column before the checkpoint changed/)
    expectSame(a, fullOf(di, more, closed), 'islast closed')
    resetRuntimeSessions()
    incOf(di, rows, ctx)
    const b = incOf(di, more, ctx)
    expect(runtimeIncrementalOf(b.cols).resumedFrom).toBe(498)
    expectSame(b, fullOf(di, more, ctx), 'islast forming')
  })
  it('a run that stops by name (a limit) leaves no session to resume, and stops the same way again', () => {
    const runaway = doc('float s = 0.0\nfor i = 0 to 1000000000\n    s += i\nplot(s)\nplot(s)\n', { listing: true })
    const rows = makeBars(300)
    expect(incOf(runaway, rows, ctx).err).toBe('runtime:limit')
    expect(incOf(runaway, rows, ctx).err).toBe('runtime:limit')
  })
})

describe('⛔ the sessions are bounded', () => {
  it('many indicators on many charts: never more than the count cap or the byte budget, and the oldest go first', async () => {
    const { runtimeSessionStats } = await import('../runtimeColumns.js')
    resetRuntimeSessions()
    const rows = makeBars(2000)
    for (let k = 0; k < 30; k += 1) {
      const d = { ...doc(`var float x = na\nx := na(x) ? close : 0.9 * x + 0.1 * close + ${k}\nplot(x)\nplot(x - close)\n`, { listing: true }), id: `inc${k}` }
      incOf(d, rows, { tf: '5', newestBarIsForming: true, historyFromListing: true })
      const s = runtimeSessionStats()
      expect(s.sessions).toBeLessThanOrEqual(s.cap)
      expect(s.approxBytes).toBeLessThanOrEqual(s.byteCap)
    }
    expect(runtimeSessionStats().sessions).toBe(12)
  })
})
