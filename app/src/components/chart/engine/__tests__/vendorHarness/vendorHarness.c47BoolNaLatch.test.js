// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c47BoolNaLatch.test.js
//
// ─── C47 — A PINE v6 `var x = bool(na)` LATCH, AGAINST TRADINGVIEW ────────────
//
// Captured on a live TradingView chart 2026-09-28 (NYSE:RDDT 1D, 632 bars from
// the listing day): `trend-duration-forecast-chartprime-rddt-1d-2026-09-28`.
//
//     var trend = bool(na)                       // v6
//     if barstate.isconfirmed
//         if ta.rising(hma, trendLength)   → trend := true
//         if ta.falling(hma, trendLength)  → trend := false
//     if trend != trend[1]                       // a flip: label the new trend
//
// In v6 a `bool` is never `na`: the `var` starts `false`, an `if` whose test is
// `na` (bars 0–2: `ta.rising(hma, 3)` has no three bars behind it) does not run,
// and `trend[1]` before bar 0 is `false`.
// So the first `trend := true` (bar 58) IS a flip, and TradingView draws a label
// there — its id 2, the text `6` over `Trend ↑`. This door read `trend` as `na`
// until its first assignment and withheld exactly that label (C22: "withheld by
// construction"). The rule lives in `pine.js::v6BoolNaLatch` and
// `interpret.js::heldFalseSeed`.
//
// ⭐ WHAT IS PINNED, against the capture:
//   * the harness grades the capture MATCH — objects and overall;
//   * every one of TradingView's 28 labels and its one line: the SAME id, text
//     and y, and x at TradingView's rank — id for id, nothing extra;
//   * the witness itself: id 2, made on bar 58;
//   * the latch's column: `false` on bars 0–57, `true` on bar 58.
// ⛔ AND WHAT THE RULE MUST NOT REACH, each with the legacy fold pinned:
//   v5 (a v5 `bool(na)` IS `na`), an arm that is an expression, a plain
//   (non-`var`) declaration, an update that reads `x[1]`, a script's own `bool`.
//   Behind the curtain (no listing statement) the latch is UNKNOWN until its
//   first assignment — never a guessed `false`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture, gradeCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { interpret, heldFalseSeed, switchedVarSeed, readingOf, readingSeed, switchedSeedOf } from '../../ast/interpret'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/trend-duration-forecast-chartprime-rddt-1d-2026-09-28.json')

const capture = () => {
  const loaded = loadCapture(FILE)
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}

/** Every `accum(…)` in a tree, outermost first. */
const accums = (tree) => {
  const out = []
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'call' && n.name === 'accum') out.push(n)
    for (const a of n.args || []) walk(a)
  }
  walk(tree)
  return out
}
const NA = { type: 'op', name: '/', args: [{ type: 'num', value: 0 }, { type: 'num', value: 0 }] }
/** `bool(na)` as this door has always folded the cast: `(0 / 0) != 0`. */
const LEGACY_CAST = { type: 'op', name: '!=', args: [NA, { type: 'num', value: 0 }] }
const HELD = switchedVarSeed(heldFalseSeed())

describe('⭐ C47 — trend-duration-forecast: the v6 `bool(na)` latch draws TradingView\'s first flip', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  const run = (source, historyFromListing) => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const cap = capture()
    const bars = toProductBars(cap)
    const d = memberPaneDefinition({ source: source || cap.source.text, id: 'u_c47_latch', name: 'c47' })
    expect(d.ok, d.reason).toBe(true)
    const reader = objectReaderFor(d.definition, bars, {
      tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
      historyFromListing,
    })
    const out = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })
    const fam = (f) => out.live.filter((o) => o.family === f).sort((a, b) => a.id - b.id)
    return { cap, bars, d, reader, out, lines: fam('line'), labels: fam('label') }
  }

  it('⭐ the harness grades the capture MATCH — objects and overall (was DIVERGE, labels 28 / 27)', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const cap = capture()
    expect(cap.history.startsAtBar0).toBe(true)
    expect(/^\/\/@version=6/m.test(cap.source.text)).toBe(true)
    const { verdict, integrity } = gradeCapture(cap)
    expect(integrity.ok).toBe(true)
    expect(verdict.objects.verdict, verdict.objects.reason).toBe('MATCH')
    expect(verdict.verdict, verdict.reason).toBe('MATCH')
    const counts = Object.fromEntries(verdict.objects.counts.map((c) => [c.family, [c.vendor, c.ours]]))
    expect(counts.labels).toEqual([28, 28])
    expect(counts.lines).toEqual([1, 1])
    for (const t of verdict.objects.texts) {
      expect(t.onlyVendor, t.family).toEqual([])
      expect(t.onlyOurs, t.family).toEqual([])
    }
  }, 60000)

  it('⭐⭐ all 28 labels and the line: TradingView\'s id, text and y, x at its rank — id for id', () => {
    const { cap, labels, lines, out } = run(null, true)
    expect(out.status).toBe('ok')
    const vendor = cap.objects.records.labels
    expect(vendor).toHaveLength(28)
    expect(labels.map((l) => [l.id, l.props.text, l.props.y])).toEqual(vendor.map((l) => [l.id, l.t, l.y]))
    const [vl] = cap.objects.records.lines
    expect(lines.map((l) => [l.id, l.props.y1, l.props.y2])).toEqual([[vl.id, vl.y1, vl.y2]])
    // the capture stores x as a dense rank over all its objects
    const all = [...new Set([...labels.map((l) => l.props.x), ...lines.flatMap((l) => [l.props.x1, l.props.x2])])]
      .sort((a, b) => a - b)
    const rank = (x) => all.indexOf(x)
    expect(labels.map((l) => rank(l.props.x))).toEqual(vendor.map((l) => l.x))
    expect([rank(lines[0].props.x1), rank(lines[0].props.x2)]).toEqual([vl.x1, vl.x2])
  }, 60000)

  it('⭐ THE WITNESS — TradingView\'s id 2: made on bar 58, the first `trend := true`', () => {
    const { cap, labels } = run(null, true)
    const v = cap.objects.records.labels.find((l) => l.id === 2)
    expect(v.t).toBe('\n6\nTrend ↑')
    expect(v.x).toBe(0)                       // the leftmost object TradingView holds
    const ours = labels.find((l) => l.id === 2)
    expect(ours, 'label id 2').toBeTruthy()
    expect(ours.createdBar).toBe(58)
    expect(ours.props.x).toBe(58)
    expect(ours.props.text).toBe(v.t)
    expect(ours.props.y).toBe(v.y)
    expect(ours.props.style).toBe('label_up')
    // nothing we hold is made before it: no flip on bar 0 (TradingView holds none)
    expect(Math.min(...labels.map((l) => l.createdBar))).toBe(58)
  }, 60000)

  it('⭐ the latch\'s own column from the listing: `false` on bars 0–57, `true` on bar 58; `trend[1]` on bar 0 is `false`', () => {
    const { bars, d } = run(null, true)
    // tree 0 is the flip guard `trend != trend[1]`
    const flip = d.definition.objects.trees.find((t) => t.type === 'op' && t.name === '!='
      && t.args[1] && t.args[1].type === 'offset')
    expect(flip, 'the flip guard').toBeTruthy()
    const trend = flip.args[0]
    expect(trend.name).toBe('accum')
    expect(trend.args[0]).toEqual(HELD)
    const opts = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
    const col = Array.from(interpret(trend, bars, {}, undefined, undefined, opts))
    expect(col.slice(0, 58)).toEqual(new Array(58).fill(0))
    expect(col[58]).toBe(1)
    const prev = Array.from(interpret(flip.args[1], bars, {}, undefined, undefined, opts))
    expect(prev[0]).toBe(0)                   // a v6 `bool`'s history before bar 0 is `false`, not `na`
    expect(prev[59]).toBe(1)
    const flips = Array.from(interpret(flip, bars, {}, undefined, undefined, opts))
    expect(flips.slice(0, 58)).toEqual(new Array(58).fill(0))
    expect(flips[58]).toBe(1)
    // ⛔ and the UPDATE's tree is the one it always was: no node added to it
    const json = JSON.stringify(trend.args[1])
    expect(json).not.toContain('"nz"')
    // ⛔ non-vacuity: the tests really are `na` — on bars 0–2, where `ta.rising(x, 3)`
    // has no three bars to look back over. One `na` test carried into the state
    // is what kept it `na` until bar 58.
    const rising = trend.args[1].args[1].args[2].args[0]
    expect(rising.name).toBe('rising')
    const r = Array.from(interpret(rising, bars, {}, undefined, undefined, opts))
    expect(r.slice(0, 3).every((v) => Number.isNaN(v))).toBe(true)
    expect(r[3]).toBe(0)
  }, 60000)

  it('⛔ behind the curtain (no listing statement) the latch is UNKNOWN until its first assignment — never a guessed `false`', () => {
    const { bars, d, labels, cap } = run(null, false)
    const flip = d.definition.objects.trees.find((t) => t.type === 'op' && t.name === '!='
      && t.args[1] && t.args[1].type === 'offset')
    const trend = flip.args[0]
    const opts = { tf: 'D', newestBarIsForming: false }
    const col = Array.from(interpret(trend, bars, {}, undefined, undefined, opts))
    expect(col.slice(0, 58).every((v) => Number.isNaN(v))).toBe(true)
    expect(col[58]).toBe(1)
    const prev = Array.from(interpret(flip.args[1], bars, {}, undefined, undefined, opts))
    expect(Number.isNaN(prev[0])).toBe(true)
    // the first flip is not claimed there: it would be a flip from a state nobody read
    expect(labels.find((l) => l.createdBar === 58)).toBeUndefined()
    // and nothing drawn is something TradingView lacks
    const vend = new Set(cap.objects.records.labels.map((l) => `${l.t}|${l.y}`))
    for (const l of labels) expect(vend.has(`${l.props.text}|${l.props.y}`), l.props.text).toBe(true)
  }, 60000)

  it('⛔ CONTROL — the same script declared `//@version=5` keeps the legacy fold and does NOT draw the first flip', () => {
    const cap = capture()
    const v5 = cap.source.text.replace('//@version=6', '//@version=5')
    expect(v5).not.toBe(cap.source.text)
    const { labels, d } = run(v5, true)
    const flip = d.definition.objects.trees.find((t) => t.type === 'op' && t.name === '!='
      && t.args[1] && t.args[1].type === 'offset')
    expect(flip.args[0].args[0]).toEqual(LEGACY_CAST)
    expect(labels.find((l) => l.createdBar === 58)).toBeUndefined()
    expect(labels).toHaveLength(27)
  }, 60000)
})

describe('⛔ C47 — the latch is exactly the witnessed shape, and nothing wider', () => {
  const seedOf = (source) => {
    const d = memberPaneDefinition({ source, id: 'u_c47_shape', name: 'c47' })
    expect(d.ok, d.reason).toBe(true)
    const out = d.translation.outputs.find((o) => o && o.ast && o.kind !== 'alertcondition')
    const a = accums(out.ast)
    expect(a.length, 'an accumulator in the plot').toBeGreaterThan(0)
    return a[0].args[0]
  }
  const script = (version, decl, update) => [
    `//@version=${version}`,
    'indicator("c47 shape")',
    decl,
    ...update,
    'plot(t ? 1 : 0)',
  ].join('\n')
  const LATCH = ['if close > open', '    t := true', 'if close < open', '    t := false']

  it('⭐ v6 `var t = bool(na)` + literal assignments under `if`s → the held seed', () => {
    expect(seedOf(script(6, 'var t = bool(na)', LATCH))).toEqual(HELD)
  })
  it('⛔ v5: the cast\'s own fold, untouched (a v5 `bool(na)` is `na`)', () => {
    expect(seedOf(script(5, 'var t = bool(na)', LATCH))).toEqual(LEGACY_CAST)
  })
  it('⛔ v6, an arm that is an EXPRESSION (`t := close > open`): untouched', () => {
    const s = seedOf(script(6, 'var t = bool(na)', ['if volume > volume[1]', '    t := close > open']))
    expect(s).not.toEqual(HELD)
    expect(JSON.stringify(s)).not.toContain(JSON.stringify(heldFalseSeed()))
  })
  it('⛔ v6, an update that reads its own history (`not t[1]`): untouched', () => {
    let s = null
    let refused = null
    try { s = seedOf(script(6, 'var t = bool(na)', ['if close > open', '    t := not t[1]'])) } catch (e) { refused = e }
    if (s) expect(JSON.stringify(s)).not.toContain(JSON.stringify(heldFalseSeed()))
    else expect(refused).toBeTruthy()
  })
  it('⛔ v6 `var t = bool(close > open)` — a cast of anything but the bare `na`: untouched', () => {
    const s = seedOf(script(6, 'var t = bool(close > open)', LATCH))
    expect(JSON.stringify(s)).not.toContain(JSON.stringify(heldFalseSeed()))
  })
  it('⛔ v6 `var t = false` (no cast): not this rule\'s — its seed is the literal', () => {
    const s = seedOf(script(6, 'var t = false', LATCH))
    expect(JSON.stringify(s)).not.toContain(JSON.stringify(heldFalseSeed()))
  })
  it('⛔ v6, the script defines its own `bool(x)`: untouched', () => {
    const src = ['//@version=6', 'indicator("c47 shape")', 'bool(x) => x > 0 ? 1 : 0',
      'var t = bool(na)', ...LATCH, 'plot(t ? 1 : 0)'].join('\n')
    const d = memberPaneDefinition({ source: src, id: 'u_c47_shape2', name: 'c47' })
    const json = JSON.stringify(d.translation || {})
    expect(json).not.toContain(JSON.stringify(heldFalseSeed()))
  })

  it('⭐ the mark: `0 != (0 / 0)` reads `held` / `false`; the cast\'s own fold `(0 / 0) != 0` does NOT', () => {
    expect(readingOf(heldFalseSeed())).toEqual({ reading: 'held', seed: { type: 'num', value: 0 } })
    expect(readingOf(LEGACY_CAST)).toBeNull()
    expect(switchedSeedOf(HELD)).toEqual(heldFalseSeed())
    // C29's two readings are what they were
    const five = { type: 'num', value: 5 }
    expect(readingOf(readingSeed(five, 'seed'))).toEqual({ reading: 'seed', seed: five })
    expect(readingOf(readingSeed(five, 'update'))).toEqual({ reading: 'update', seed: five })
  })

  it('⭐ VALUE-SAFE: a reader that does not know the mark reads `na` (the switched mark) and `0` inside it', () => {
    const bars = Array.from({ length: 6 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 1, h: 2, l: 0.5, c: 1 + i, v: 10 }))
    expect(Array.from(interpret(heldFalseSeed(), bars, {})).every((v) => v === 0)).toBe(true)
    expect(Array.from(interpret(HELD, bars, {})).every((v) => Number.isNaN(v))).toBe(true)
  })
})

describe('⭐ C47 — the `held` reading in the listing pass, on hand-built trees', () => {
  const bars = Array.from({ length: 8 }, (_, i) => ({
    t: 1700000000 + i * 86400, o: 10, h: 12, l: 9, c: i === 3 ? 9 : 11, v: 100,
  }))
  const SELF = { type: 'series', name: 'self' }
  const num = (v) => ({ type: 'num', value: v })
  const upDay = { type: 'op', name: '>', args: [{ type: 'series', name: 'close' }, { type: 'series', name: 'open' }] }
  const latch = (test) => ({
    type: 'call', name: 'accum',
    args: [HELD, { type: 'op', name: '?:', args: [test, num(1), SELF] }, num(250)],
  })
  const LISTING = { tf: 'D', newestBarIsForming: false, historyFromListing: true }

  it('⭐ a latch whose test is true on bar 0 is `true` there, known', () => {
    // close 11 > open 10 on bar 0: the arm fires, and a literal arm answers the
    // same whatever the state entering the bar was.
    const col = Array.from(interpret(latch(upDay), bars, {}, undefined, undefined, LISTING))
    expect(col[0]).toBe(1)
    expect(col.every((v) => v === 1)).toBe(true)
  })

  it('⭐ a `na` test holds the state; the SAME body under an unmarked seed carries the `na` into it', () => {
    // `close[2] > open` is `na` on bars 0–1 (no history), true from bar 2 except bar 5.
    const naThenTrue = { type: 'op', name: '?:', args: [
      { type: 'call', name: 'na', args: [{ type: 'offset', value: 2, args: [{ type: 'series', name: 'close' }] }] },
      { type: 'op', name: '/', args: [num(0), num(0)] },
      num(1),
    ] }
    const held = Array.from(interpret(latch(naThenTrue), bars, {}, undefined, undefined, LISTING))
    expect(held.slice(0, 2)).toEqual([0, 0])        // not taken: still `false`
    expect(held[2]).toBe(1)
    const plain = { type: 'call', name: 'accum',
      args: [num(0), { type: 'op', name: '?:', args: [naThenTrue, num(1), SELF] }, num(250)] }
    const col = Array.from(interpret(plain, bars, {}, undefined, undefined, LISTING))
    expect(Number.isNaN(col[1])).toBe(true)         // the legacy carry, untouched for every other `var`
  })

  it('⭐ `x[k]` before bar 0 is `false` for a held latch — and still `na` behind the curtain', () => {
    const prev2 = { type: 'offset', value: 2, args: [latch(upDay)] }
    const listed = Array.from(interpret(prev2, bars, {}, undefined, undefined, LISTING))
    expect(listed.slice(0, 2)).toEqual([0, 0])
    expect(listed[2]).toBe(1)
    const curtained = Array.from(interpret(prev2, bars, {}, undefined, undefined, { tf: 'D', newestBarIsForming: false }))
    expect(curtained.slice(0, 2).every((v) => Number.isNaN(v))).toBe(true)
  })
})

describe('⭐ C47 — `na(X) ? 0 : X` is `X` only where `X` can never be `na`', () => {
  // The object lane writes that guard round every `if` condition it turns into an
  // event. Round a comparison it guards nothing (a comparison against `na` is 0 in
  // both lanes) and costs two evaluation units — the units the seed marks above
  // add to trend-duration's window average, which measures exactly the 128 cap.
  const treesOf = (yExpr) => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const d = memberPaneDefinition({
      source: ['//@version=6', 'indicator("c47 guard", overlay = true)',
        'if barstate.islast', `    label.new(bar_index, ${yExpr})`].join('\n'),
      id: 'u_c47_guard', name: 'c47',
    })
    vi.unstubAllEnvs()
    expect(d.ok, d.reason).toBe(true)
    return JSON.stringify(d.definition.objects.trees)
  }

  it('⭐ round a COMPARISON the guard is dropped: no `na(…)` is left in the tree', () => {
    const json = treesOf('(na(close > open) ? 0 : (close > open)) ? high : low')
    expect(json).toContain('"name":">"')
    expect(json).not.toContain('"name":"na"')
  })
  it('⛔ round a SERIES (`close[1]`, `na` on bar 0) the guard STAYS', () => {
    const json = treesOf('na(close[1]) ? 0 : close[1]')
    expect(json).toContain('"name":"na"')
  })
  it('⛔ round arithmetic over a comparison (`(close > open) * close[1]`) the guard STAYS', () => {
    const json = treesOf('na((close > open ? 1 : 0) * close[1]) ? 0 : ((close > open ? 1 : 0) * close[1])')
    expect(json).toContain('"name":"na"')
  })
  it('⛔ a guard whose taken arm is NOT the literal 0 is left alone', () => {
    const json = treesOf('na(close > open) ? 5 : (close > open)')
    expect(json).toContain('"name":"na"')
  })
  it('⛔ a guard over a DIFFERENT tree is left alone', () => {
    const json = treesOf('na(close > open) ? 0 : (close < open)')
    expect(json).toContain('"name":"na"')
  })
  it('⭐ the cap is where it was: trend-duration\'s program evaluates with nothing refused on the node budget', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const cap = capture()
    const bars = toProductBars(cap)
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c47_budget', name: 'c47' })
    const reader = objectReaderFor(d.definition, bars, {
      tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false, historyFromListing: true,
    })
    vi.unstubAllEnvs()
    expect(reader.failed).toEqual([])
    expect((reader.refusals || []).filter((r) => r.guard === 'budget:nodes')).toEqual([])
    // and no tree of it is withheld on every bar (a probe the budget refuses withholds all 632)
    const all = d.definition.objects.trees.map((_, i) => {
      let n = 0
      for (let b = 0; b < bars.length; b += 1) if (reader.readUnknown(i, b)) n += 1
      return n
    })
    expect(all.filter((n) => n === bars.length)).toEqual([])
  }, 60000)
})

describe('⭐ C47 — a switched `var` read only bare runs its update on bar 0 (C29\'s `update` reading)', () => {
  // trend-duration's `TrendCount`: `var TrendCount = 0`, `+= 1` every bar, `:= 0`
  // at a flip. Pushed into the window on the bar of the FIRST flip — where the
  // count since bar 0 is what Pine holds, and unmarked the listing pass withheld it.
  it('⭐ from the listing the count is exact from bar 0: 1, 2, 3 … 58, then 0 at the first flip', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const cap = capture()
    const bars = toProductBars(cap)
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c47_count', name: 'c47' })
    vi.unstubAllEnvs()
    expect(d.ok, d.reason).toBe(true)
    const count = d.definition.objects.trees.find((t) => t.type === 'call' && t.name === 'accum'
      && JSON.stringify(t.args[1]).includes('"self"') && JSON.stringify(t.args[1]).includes('"+"'))
    expect(count, 'the TrendCount accumulator').toBeTruthy()
    const real = switchedSeedOf(count.args[0])
    expect(readingOf(real)).toEqual({ reading: 'update', seed: { type: 'num', value: 0 } })
    const col = Array.from(interpret(count, bars, {}, undefined, undefined,
      { tf: 'D', newestBarIsForming: false, historyFromListing: true }))
    expect(col.slice(0, 58)).toEqual(Array.from({ length: 58 }, (_, i) => i + 1))
    expect(col[58]).toBe(0)
    expect(col.slice(59, 64)).toEqual([1, 2, 3, 4, 5])
  }, 60000)
})
