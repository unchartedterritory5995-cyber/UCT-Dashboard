// app/src/components/chart/engine/__tests__/objectWindowSites.test.js
//
// ─── ⭐⭐ C22 — A WINDOW ADDED TO AT SEVERAL PLACES, AND ONE A FUNCTION DECLARES ──
//
// vdubus-pattern-gen-v2 keeps a zigzag per `f_runEngine` call:
//
//     f_runEngine(depth, …) =>
//         var float[] zzP = array.new_float()
//         ph = ta.pivothigh(high, depth, depth)
//         pl = ta.pivotlow(low, depth, depth)
//         if not na(ph)
//             array.unshift(zzP, ph)
//             if array.size(zzP) > 10
//                 array.pop(zzP), array.pop(zzL)
//             if array.size(zzP) >= 5 …        ← reads what its own arm wrote
//         if not na(pl)
//             array.unshift(zzP, pl) …
//     f_runEngine(fastDepth, …)
//     f_runEngine(slowDepth, …)
//
// and guards its drawings with a local an `if` chain sets (`shouldDraw`) and a
// comparison of text a helper picks per bar (`rawName == "Gartley"`). Each is
// served here exactly where it is Pine's, and refused by name elsewhere:
//
//   * several add sites: an event is any site's condition, its element the
//     LAST site's value that ran; a bar two sites may BOTH add on is ambiguous
//     and every read is withheld while it is among the last `cap` events;
//   * a removal in its add's own arm, and a read after both in that arm;
//   * a `var` array declared in a function's body, per call site;
//   * `array.size(w) >= K` as one slot's existence (the node budget);
//   * an `if` chain in an inlined body that only assigns its locals, as a value;
//   * text picked per bar between literals, compared with a literal, as 1 / 0.
//
// Every expectation is Pine's own arrays run by hand over the same bars.
import { describe, it, expect } from 'vitest'
import { translatePine, printFormula } from '../ast/pine'
import { evaluateObjects } from '../objectRuntime'
import { objectReaderFor } from '../objectColumns'

const LF = String.fromCharCode(10)
const Q = String.fromCharCode(34)
const HEAD = `//@version=5${LF}indicator(${Q}w${Q}, overlay=true, max_labels_count=500)${LF}`
const tr = (lines, opts) => translatePine(`${HEAD}${lines.join(LF)}${LF}plot(close)${LF}`, opts)

const N = 160
const BARS = Array.from({ length: N }, (_, i) => {
  const d = new Date(Date.UTC(2021, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  const c = 100 + 9 * Math.sin(i / 5) + 3 * Math.sin(i / 1.7)
  const o = 100 + 9 * Math.sin((i - 1) / 5) + 2 * Math.cos(i / 2.1)
  return { t: d, o, h: Math.max(o, c) + 1 + (i % 5) * 0.25, l: Math.min(o, c) - 1 - (i % 3) * 0.5, c, v: 1 }
})
const run = (t) => {
  const reader = t.objects ? objectReaderFor({ objects: t.objects }, BARS, { tf: 'D', newestBarIsForming: false }) : null
  if (!reader) return { live: [], stats: {}, failed: ['no reader'] }
  const r = evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  return { ...r, failed: reader.failed || [] }
}
const labels = (r, text) => r.live.filter((o) => o.family === 'label' && (text === undefined || o.props.text === text))
  .sort((a, b) => a.createdBar - b.createdBar).map((o) => [o.createdBar, o.props.y])
const up = (i) => BARS[i].c > BARS[i].o
const dn = (i) => BARS[i].c < BARS[i].o
const rise = (i) => i > 0 && BARS[i].c > BARS[i - 1].c
const higher = (i) => i > 0 && BARS[i].h > BARS[i - 1].h
const near = (got, want) => {
  expect(got.length).toBe(want.length)
  got.forEach(([b, y], k) => {
    expect(b).toBe(want[k][0])
    expect(y).toBeCloseTo(want[k][1], 9)
  })
}

describe('⭐⭐ C22 — several add sites, one window', () => {
  it('two sites and one removal after both: slot 1 is Pine\'s on every bar', () => {
    const t = tr([
      'var float[] w = array.new_float()',
      'if close > open',
      '    w.unshift(high)',
      'if close < open',
      '    w.unshift(low)',
      'if w.size() > 3',
      '    w.pop()',
      'if w.size() >= 2',
      `    label.new(bar_index, w.get(1), ${Q}x${Q})`,
    ])
    const want = []
    const w = []
    for (let i = 0; i < N; i += 1) {
      if (up(i)) w.unshift(BARS[i].h)
      if (dn(i)) w.unshift(BARS[i].l)
      if (w.length > 3) w.pop()
      if (w.length >= 2) want.push([i, w[1]])
    }
    const r = run(t)
    expect(r.failed).toEqual([])
    expect(want.length).toBeGreaterThan(20)
    near(labels(r, 'x'), want)
  })

  it('⭐ the removal in each add\'s own arm, and a read after both in that arm (the zigzag)', () => {
    const t = tr([
      'var float[] w = array.new_float()',
      'if close > open and close > close[1]',
      '    w.unshift(high)',
      '    if w.size() > 4',
      '        w.pop()',
      '    if w.size() >= 3',
      `        label.new(bar_index, w.get(2), ${Q}A${Q})`,
      'if close < open',
      '    w.unshift(low)',
      '    if w.size() > 4',
      '        w.pop()',
      '    if w.size() >= 3',
      `        label.new(bar_index, w.get(1), ${Q}B${Q})`,
    ])
    const wantA = []
    const wantB = []
    const w = []
    for (let i = 0; i < N; i += 1) {
      if (up(i) && rise(i)) {
        w.unshift(BARS[i].h)
        if (w.length > 4) w.pop()
        if (w.length >= 3) wantA.push([i, w[2]])
      }
      if (dn(i)) {
        w.unshift(BARS[i].l)
        if (w.length > 4) w.pop()
        if (w.length >= 3) wantB.push([i, w[1]])
      }
    }
    const r = run(t)
    expect(r.failed).toEqual([])
    expect(wantA.length).toBeGreaterThan(5)
    expect(wantB.length).toBeGreaterThan(5)
    near(labels(r, 'A'), wantA)
    near(labels(r, 'B'), wantB)
  })

  it('⛔ a bar BOTH sites add on is ambiguous: every read is withheld while it is among the last `cap` events, never drawn one element short', () => {
    const t = tr([
      'var float[] w = array.new_float()',
      'if close > open',
      '    w.unshift(high)',
      'if high > high[1]',
      '    w.unshift(low)',
      'if w.size() > 3',
      '    w.pop()',
      'if w.size() >= 2',
      `    label.new(bar_index, w.get(1), ${Q}x${Q})`,
    ])
    // Pine's arrays, and the model's one-event-per-bar ledger of doubles
    const want = []
    const w = []
    const events = []
    for (let i = 0; i < N; i += 1) {
      const a = up(i)
      const b = higher(i)
      if (a) w.unshift(BARS[i].h)
      if (b) w.unshift(BARS[i].l)
      if (w.length > 3) w.pop()
      if (a || b) events.unshift(a && b)
      const ambiguous = events.slice(0, 3).some(Boolean)
      if (w.length >= 2) want.push([i, w[1], ambiguous])
    }
    const r = run(t)
    const clean = want.filter((x) => !x[2]).map(([b, y]) => [b, y])
    expect(want.some((x) => x[2])).toBe(true)
    expect(clean.length).toBeGreaterThan(5)
    near(labels(r, 'x'), clean)
    expect(r.stats.withheldUnknown).toBeGreaterThan(0)
  })

  it('⛔ still refused by name: `push` at one site and `unshift` at another', () => {
    const t = tr([
      'var float[] w = array.new_float()',
      'if close > open',
      '    w.unshift(high)',
      'if close < open',
      '    w.push(low)',
      'if w.size() > 3',
      '    w.pop()',
      'if w.size() >= 2',
      `    label.new(bar_index, w.get(1), ${Q}x${Q})`,
    ])
    expect(labels(run(t))).toEqual([])
    expect(t.objectDiagnostics.droppedOps).toBeGreaterThan(0)
  })

  it('⛔ still refused by name: an add guarded by a name its own statement set above it (read at the statement start)', () => {
    const t = tr([
      'var float[] w = array.new_float()',
      'lvl = 0.0',
      'if close > open',
      '    lvl := high - low',
      '    if lvl > 2',
      '        w.unshift(high)',
      'if w.size() > 3',
      '    w.pop()',
      'if w.size() >= 2',
      `    label.new(bar_index, w.get(1), ${Q}x${Q})`,
    ])
    expect(labels(run(t))).toEqual([])
    expect(t.objectDiagnostics.droppedOps).toBeGreaterThan(0)
  })

  it('⭐ …but a condition over something the window does not keep is not its concern', () => {
    const t = tr([
      'var float[] w = array.new_float()',
      'if close > open',
      '    w.unshift(high)',
      '    big = high - low > 2',
      '    note = 0',
      '    if big',
      '        note := 1',
      'if w.size() > 3',
      '    w.pop()',
      'if w.size() >= 2',
      `    label.new(bar_index, w.get(1), ${Q}x${Q})`,
    ])
    const want = []
    const w = []
    for (let i = 0; i < N; i += 1) {
      if (up(i)) w.unshift(BARS[i].h)
      if (w.length > 3) w.pop()
      if (w.length >= 2) want.push([i, w[1]])
    }
    near(labels(run(t), 'x'), want)
  })

  it('⛔ a read in an arm BEFORE that arm’s add, with a later add not excluded, is refused where it stands', () => {
    const t = tr([
      'var float[] w = array.new_float()',
      'if close > open',
      '    if w.size() >= 2',
      `        label.new(bar_index, w.get(1), ${Q}x${Q})`,
      '    w.unshift(high)',
      '    if w.size() > 3',
      '        w.pop()',
      'if close < open',
      '    w.unshift(low)',
      '    if w.size() > 3',
      '        w.pop()',
    ])
    expect(labels(run(t))).toEqual([])
    expect(JSON.stringify(t.objectDiagnostics)).toMatch(/pine:collection/)
  })

  it('⛔ still refused by name: a removal in one arm and not the other', () => {
    const t = tr([
      'var float[] w = array.new_float()',
      'if close > open',
      '    w.unshift(high)',
      '    if w.size() > 3',
      '        w.pop()',
      'if close < open',
      '    w.unshift(low)',
      'if w.size() >= 2',
      `    label.new(bar_index, w.get(1), ${Q}x${Q})`,
    ])
    expect(labels(run(t))).toEqual([])
    expect(t.objectDiagnostics.droppedOps).toBeGreaterThan(0)
  })
})

describe('⭐⭐ C22 — `array.size(w) >= K` is one slot\'s existence', () => {
  it('the guard reads ONE `valuewhen`, not one per slot — and draws what Pine draws', () => {
    const t = tr([
      'var float[] w = array.new_float()',
      'if close > open',
      '    w.unshift(high)',
      'if w.size() > 10',
      '    w.pop()',
      'if array.size(w) >= 4 and 5 > w.size()',
      `    label.new(bar_index, close, ${Q}x${Q})`,
    ])
    const op = t.objects.ops.find((o) => o.k === 'create')
    const guard = printFormula(t.objects.trees[op.when.tree])
    expect(guard.split('valuewhenOccurrence(').length - 1).toBe(2)
    const want = []
    let n = 0
    for (let i = 0; i < N; i += 1) {
      if (up(i)) n = Math.min(10, n + 1)
      if (n >= 4 && n < 5) want.push([i, BARS[i].c])
    }
    expect(want.length).toBeGreaterThan(0)
    near(labels(run(t), 'x'), want)
  })
})

describe('⭐⭐ C22 — a `var` array a drawing function declares is its call site\'s own', () => {
  const FN = [
    'f(len, tag) =>',
    '    var float[] z = array.new_float()',
    '    hh = ta.highest(high, len)',
    '    if high == hh',
    '        z.unshift(high)',
    '        if z.size() > 3',
    '            z.pop()',
    '        if z.size() >= 2',
    '            label.new(bar_index, z.get(1), tag)',
  ]
  it('two calls, two windows, each Pine\'s', () => {
    const t = tr([...FN, `f(3, ${Q}F${Q})`, `f(7, ${Q}S${Q})`])
    const hand = (len) => {
      const z = []
      const out = []
      for (let i = 0; i < N; i += 1) {
        if (i < len - 1) continue
        let hh = -Infinity
        for (let k = i - len + 1; k <= i; k += 1) hh = Math.max(hh, BARS[k].h)
        if (BARS[i].h === hh) {
          z.unshift(BARS[i].h)
          if (z.length > 3) z.pop()
          if (z.length >= 2) out.push([i, z[1]])
        }
      }
      return out
    }
    const r = run(t)
    expect(r.failed).toEqual([])
    const wf = hand(3)
    const ws = hand(7)
    expect(wf.length).toBeGreaterThan(ws.length)
    expect(ws.length).toBeGreaterThan(3)
    near(labels(r, 'F'), wf)
    near(labels(r, 'S'), ws)
  })

  it('⛔ a call under a condition runs on some bars only: its window is refused by name', () => {
    const t = tr([
      'g(tag) =>',
      '    var float[] z = array.new_float()',
      '    z.unshift(high)',
      '    if z.size() > 3',
      '        z.pop()',
      '    if z.size() >= 2',
      '        label.new(bar_index, z.get(1), tag)',
      'if close > open',
      `    g(${Q}G${Q})`,
    ])
    expect(labels(run(t))).toEqual([])
    expect(JSON.stringify(t.objectDiagnostics)).toMatch(/pine:collection/)
  })
})

describe('⭐⭐ C22 — an inlined body\'s `if` chain over its locals is a value', () => {
  it('`ok` after the chain is the chain\'s choice, as Pine runs it', () => {
    const t = tr([
      'g(x) =>',
      '    ok = false',
      '    if x > 1',
      '        ok := true',
      '    else',
      '        if x < -2',
      '            ok := true',
      '        else if x < -1',
      '            ok := false',
      '    if ok',
      `        label.new(bar_index, x, ${Q}G${Q})`,
      'g(close - open)',
    ])
    const want = []
    for (let i = 0; i < N; i += 1) {
      const x = BARS[i].c - BARS[i].o
      if (x > 1 || x < -2) want.push([i, x])
    }
    expect(want.length).toBeGreaterThan(5)
    near(labels(run(t), 'G'), want)
  })

  it('⛔ CONTROL — a chain that also reads what it assigns stays opaque (`pine:state`)', () => {
    const t = tr([
      'g(x) =>',
      '    ok = false',
      '    if x > 1',
      '        ok := not ok',
      '    if ok',
      `        label.new(bar_index, x, ${Q}G${Q})`,
      'g(close - open)',
    ])
    expect(labels(run(t))).toEqual([])
    expect(JSON.stringify(t.objectDiagnostics)).toMatch(/pine:state/)
  })
})

describe('⭐⭐ C22 — text picked per bar between literals, compared with a literal', () => {
  const NM = [
    'nm(x) =>',
    `    n = ${Q}none${Q}`,
    '    if x > 1',
    `        n := ${Q}big${Q}`,
    '    else if x > 0',
    `        n := ${Q}small${Q}`,
    '    n',
  ]
  it('`==` and `!=` are 1 / 0 per bar — no text reaches a tree', () => {
    const t = tr([
      ...NM,
      'h(v) =>',
      '    r = nm(v)',
      `    if r == ${Q}big${Q}`,
      `        label.new(bar_index, v, ${Q}B${Q})`,
      `    if r != ${Q}none${Q}`,
      `        label.new(bar_index, v, ${Q}N${Q})`,
      'h(close - open)',
    ])
    const wantB = []
    const wantN = []
    for (let i = 0; i < N; i += 1) {
      const x = BARS[i].c - BARS[i].o
      if (x > 1) wantB.push([i, x])
      if (x > 0) wantN.push([i, x])
    }
    const r = run(t)
    expect(wantB.length).toBeGreaterThan(3)
    near(labels(r, 'B'), wantB)
    near(labels(r, 'N'), wantN)
  })
})
