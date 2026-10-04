// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.f6SpyDrawings.test.js
//
// ─── F6 (2026-10-03, step 88) — the second CAP3 batch's DRAWING divergences ─────
//
// CAP3 captured AMEX:SPY 1D (1,800 bars from 2019-08-06, NOT from SPY's 1993
// listing). F4 (step 85) showed the method; this file applies it to the second
// batch and says, per script, WHY each drawing divergence exists, proved from the
// capture's own record — never from our output alone:
//
//   (a) WINDOW — TradingView made the objects we lack before our bar 0. Proved by
//       TradingView's creation counter (the capture's `id`), by price range, or —
//       where ids drift — by pairing IN ORDER (a longest common subsequence over
//       family, caption and price): every object we hold is TradingView's, in the
//       same order, and the ones only TradingView holds are its OLDEST.
//   (b) COLLECTOR — the same objects, cut at a different point of Pine's
//       collector cycle (cap + 5, oldest go until cap remain).
//   (c) ENGINE — a step this door cannot serve; fixed here, or withheld by name and
//       owned by the lane named beside it.
//
// The one engine bug F6 FIXED (v4's bare `round_to_mintick` in the runtime lane's
// own drawings) is graded here on parabolic-sar RDDT (runtime state).
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { runOurSide, enterMemberDoor, toProductBars, HARNESS_DEF_ID } from './ourSide'
import * as registry from '../../nativeRegistry'
import { probeRuntimeProgram, runtimeObjectValues } from '../../runtime/runtimeColumns'

afterEach(() => { vi.unstubAllEnvs() })
const T = 600000

const cap = (id) => {
  const c = loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
  expect(c, `${id} is a v1 capture`).toBeTruthy()
  return c
}
const objectsPane = () => vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
const runtimePane = () => { objectsPane(); vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1') }
const graded = (id) => { objectsPane(); return gradeCapture(cap(id)).verdict }
const ours = (id) => { objectsPane(); const o = runOurSide(cap(id)); expect(o.ok, o.refusal).toBe(true); return o }
const family = (v, f) => v.objects.counts.find((c) => c.family === f)

/** What the door carried for a corpus script's drawing (diagnostics only). */
function doorDiagnostics(c) {
  objectsPane()
  const door = enterMemberDoor(c.source.text)
  try {
    return (door.built && door.built.translation && door.built.translation.objectDiagnostics) || {}
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}

const r4 = (v) => (v === null || v === undefined || Number.isNaN(v) ? 'na' : String(Math.round(v * 1e4) / 1e4))
/** Every vendor object as {f, id, y, x, t}, in creation order. */
const vendorObjects = (c) => {
  const r = c.objects.records
  return [
    ...(r.lines || []).map((l) => ({ f: 'line', id: l.id, y: [l.y1, l.y2], x: [l.x1, l.x2], t: '' })),
    ...(r.labels || []).map((l) => ({ f: 'label', id: l.id, y: [l.y], x: [l.x], t: String(l.t ?? '') })),
    ...(r.boxes || []).map((b) => ({ f: 'box', id: b.id, y: [b.y1, b.y2], x: [b.x1, b.x2], t: String(b.t ?? '') })),
  ].sort((a, b) => a.id - b.id)
}
/** Every object our object lane holds at the last bar, same shape. */
const ourObjects = (o) => (o.objects.held || []).filter((h) => ['line', 'label', 'box'].includes(h.family)).map((h) => {
  const p = h.props
  if (h.family === 'line') return { f: 'line', id: h.id, y: [p.y1, p.y2], x: [p.x1, p.x2], t: '' }
  if (h.family === 'label') return { f: 'label', id: h.id, y: [p.y], x: [p.x], t: String(p.text ?? '') }
  return { f: 'box', id: h.id, y: [p.top, p.bottom], x: [p.left, p.right], t: String(p.text ?? '') }
}).sort((a, b) => a.id - b.id)
const key = (o) => `${o.f}|${o.t}|${o.y.map(r4).join(',')}`
const windowRange = (c) => {
  const lo = c.bars.fields.indexOf('low')
  const hi = c.bars.fields.indexOf('high')
  return { minLow: Math.min(...c.bars.rows.map((r) => r[lo])), maxHigh: Math.max(...c.bars.rows.map((r) => r[hi])) }
}
const outsideWindow = (v, { minLow, maxHigh }) => {
  const ys = v.y.filter((y) => y !== null && y !== undefined && !Number.isNaN(y))
  return ys.length > 0 && (Math.max(...ys) < minLow || Math.min(...ys) > maxHigh)
}
/** Pine's collector on one family that creates `k` objects, none spared
 *  (`objectRuntime.js::collect`, triage C7; F4 uses the same). */
const heldAfter = (k, cap5) => (k <= cap5 + 5 ? k : cap5 + ((k - cap5 - 6) % 6))

/** The id offset at which every object we hold is TradingView's (same family,
 *  caption and price), or null; plus the objects that do not pair there. */
function idOffsetPairing(V, O, OFF) {
  const Vm = new Map(V.map((v) => [v.id, v]))
  const misses = O.filter((o) => !(Vm.has(o.id + OFF) && key(Vm.get(o.id + OFF)) === key(o)))
  const paired = new Set(O.filter((o) => !misses.includes(o)).map((o) => o.id + OFF))
  return { misses, extra: V.filter((v) => !paired.has(v.id)) }
}

/** In-order pairing (a longest common subsequence over `key`): the pairs, and the
 *  objects of each side left unpaired. Used where TradingView's ids drift from
 *  ours (a family counted on one side only), so no single offset exists. */
function inOrderPairing(V, O) {
  const n = V.length
  const m = O.length
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      L[i][j] = key(V[i]) === key(O[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
    }
  }
  const pairs = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (key(V[i]) === key(O[j])) { pairs.push([i, j]); i += 1; j += 1 } else if (L[i + 1][j] >= L[i][j + 1]) i += 1; else j += 1
  }
  const pv = new Set(pairs.map((p) => p[0]))
  const po = new Set(pairs.map((p) => p[1]))
  return { pairs, unV: V.filter((_, k) => !pv.has(k)), unO: O.filter((_, k) => !po.has(k)) }
}

// ─── (a)/(b) WINDOW + COLLECTOR — proved exactly ───────────────────────────────
describe('F6 — makuchaku FVGs SPY: boxes 51/55 is the collector\'s cycle (a WINDOW), not a wrong drawing', () => {
  const ID = 'makuchaku039s-trade-tools-fair-value-gaps-spy-1d-2026-10-03'

  it('every box TradingView holds is ours at id + 2096, same prices; our 4 extra are our 4 OLDEST boxes', () => {
    const c = cap(ID)
    const V = vendorObjects(c)
    const O = ourObjects(ours(ID))
    expect([V.length, O.length]).toEqual([51, 55])
    const { misses, extra } = idOffsetPairing(V, O, 2096)
    expect(extra).toEqual([])
    expect(misses.length).toBe(4)
    // …and they are exactly the four lowest ids we hold: what TradingView's
    // collector, at its own point in the cycle, has already taken
    expect(misses.map((o) => o.id)).toEqual(O.slice(0, 4).map((o) => o.id))
    // non-vacuity: a neighbouring offset pairs nothing
    expect(idOffsetPairing(V, O, 2097).extra.length).toBe(51)
  }, T)

  it('⭐ the arithmetic: one box per FVG, TradingView\'s ids run 2701..2751 (2,751 made since SPY\'s listing), ours 2,751 - 2,096 = 655; the collector predicts 51 and 55', () => {
    const c = cap(ID)
    const V = vendorObjects(c)
    // the script makes boxes and nothing else, so TradingView's counter IS its box count
    expect(V.every((v) => v.f === 'box')).toBe(true)
    expect(V.map((v) => v.id)).toEqual(Array.from({ length: 51 }, (_, k) => 2701 + k))
    const o = ours(ID)
    const made = Math.max(...o.objects.held.map((h) => h.id))
    expect(made).toBe(2751 - 2096)
    const v = graded(ID)
    expect(family(v, 'boxes')).toMatchObject({ vendor: heldAfter(2751, 50), ours: heldAfter(made, 50) })
    expect([heldAfter(2751, 50), heldAfter(made, 50)]).toEqual([51, 55])
  }, T)

  it('control: on RDDT (from the listing) the same script MATCHES', () => {
    expect(graded('makuchaku039s-trade-tools-fair-value-gaps-rddt-1d-2026-09-28').objects.verdict).toBe('MATCH')
  }, T)
})

describe('F6 — pro-trading-art, rsi-swing, price-action, trend-duration SPY: the objects we lack were all made before our bar 0', () => {
  const CASES = [
    // [id, offset, ours, vendor, extra made before our first object, of them outside the window's prices]
    ['pro-trading-art-double-top-bottom-with-alert', 267, 39, 306, 267, 234],
    ['rsi-swing-indicator', 360, 85, 100, 15, 0],
    ['price-action-as-in-book-fibonacci-supportresistant-trendline', 3768, 507, 509, 2, 0],
    ['trend-duration-forecast-chartprime', 887, 53, 56, 3, 0],
  ]
  for (const [name, OFF, nOurs, nVendor, nPre, nOutside] of CASES) {
    it(`${name}: all ${nOurs} of ours are TradingView's at id + ${OFF}; its ${nPre} others have ids below our first`, () => {
      const id = `${name}-spy-1d-2026-10-03`
      const c = cap(id)
      const V = vendorObjects(c)
      const O = ourObjects(ours(id))
      expect([O.length, V.length]).toEqual([nOurs, nVendor])
      const { misses, extra } = idOffsetPairing(V, O, OFF)
      expect(misses).toEqual([])
      const first = Math.min(...O.map((o) => o.id)) + OFF
      expect(extra.length).toBe(nPre)
      expect(extra.every((v) => v.id < first)).toBe(true)
      expect(extra.filter((v) => outsideWindow(v, windowRange(c))).length).toBe(nOutside)
      // non-vacuity: the offset is a real pairing
      expect(idOffsetPairing(V, O, OFF + 1).misses.length).toBeGreaterThan(nOurs / 2)
    }, T)

    it(`${name}: control — on RDDT (from the listing) it MATCHES`, () => {
      expect(graded(`${name}-rddt-1d-2026-09-28`).objects.verdict).toBe('MATCH')
    }, T)
  }
})

describe('F6 — liquidity-pools SPY: lines 504/502, labels 504/254 are the WINDOW and the collector', () => {
  const ID = 'liquidity-pools-spy-1d-2026-10-03'

  it('all 756 objects we hold are TradingView\'s IN ORDER; what only it holds is its OLDEST of each family', () => {
    const c = cap(ID)
    const V = vendorObjects(c)
    const O = ourObjects(ours(ID))
    const { pairs, unV, unO } = inOrderPairing(V, O)
    expect([V.length, O.length, pairs.length]).toEqual([1008, 756, 756])
    expect(unO).toEqual([])
    // per family, the unpaired vendor objects are exactly its lowest ids
    for (const f of ['line', 'label']) {
      const fam = V.filter((v) => v.f === f).map((v) => v.id)
      const un = unV.filter((v) => v.f === f).map((v) => v.id)
      expect(un, f).toEqual(fam.slice(0, un.length))
    }
    expect([unV.filter((v) => v.f === 'line').length, unV.filter((v) => v.f === 'label').length]).toEqual([2, 250])
    // 150 of the 252 lie wholly outside the window's prices (pools from years before it)
    expect(unV.filter((v) => outsideWindow(v, windowRange(c))).length).toBe(150)
  }, T)

  it('why there is no single id offset: TradingView\'s counter also counts the `linefill.new` the script runs on every bar', () => {
    const c = cap(ID)
    expect(c.source.text).toMatch(/^linefill\.new\(lin_BSLQ_upper,lin_BSLQ_lower/m)
    const V = vendorObjects(c)
    const O = ourObjects(ours(ID))
    const offs = inOrderPairing(V, O).pairs.map(([a, b]) => V[a].id - O[b].id)
    // the offset only grows: every gap is ids TradingView spent on something we never hold
    // the offset only SHRINKS: every step is ids one counter spent on objects
    // never held (the per-bar `linefill.new` over lines that may be `na`), so the
    // two counters part by a few ids per pool, never a re-ordering
    expect(offs.every((d, k) => k === 0 || d <= offs[k - 1])).toBe(true)
    expect(offs[0] - offs[offs.length - 1]).toBeGreaterThan(3000)
  }, T)

  it('both families sit where Pine\'s collector puts them: lines at the cap band on both sides; TradingView\'s labels at the cap (history from 1993), ours below it', () => {
    const v = graded(ID)
    for (const n of [family(v, 'lines').vendor, family(v, 'lines').ours, family(v, 'labels').vendor]) {
      expect(n).toBeGreaterThanOrEqual(500)
      expect(n).toBeLessThanOrEqual(505)
    }
    expect(family(v, 'labels').ours).toBe(254)
  }, T)

  it('control: on RDDT (from the listing) the same script MATCHES', () => {
    expect(graded('liquidity-pools-rddt-1d-2026-09-28').objects.verdict).toBe('MATCH')
  }, T)
})

// ─── (a) WINDOW + (c) ENGINE, withheld per bar — vdubus ─────────────────────────
/** Pine's `ta.pivothigh/low(src, d, d)` centres over the bars (a tie on the
 *  LEFT pivots, one on the RIGHT does not — `interpret.js::pivotCol`, H1). */
function pivotCentres(c, depth) {
  const hi = c.bars.fields.indexOf('high')
  const lo = c.bars.fields.indexOf('low')
  const H = c.bars.rows.map((r) => r[hi])
  const L = c.bars.rows.map((r) => r[lo])
  const n = H.length
  const at = (S, i, beats) => {
    if (i - depth < 0 || i + depth >= n) return false
    for (let j = i - depth; j <= i + depth; j += 1) {
      if (j !== i && !(beats(S[i], S[j]) || (j < i && S[i] === S[j]))) return false
    }
    return true
  }
  const out = []
  for (let i = 0; i < n; i += 1) {
    if (at(H, i, (a, b) => a > b)) out.push({ bar: i, k: 'H' })
    if (at(L, i, (a, b) => a < b)) out.push({ bar: i, k: 'L' })
  }
  return out
}
const doubledBars = (P) => [...new Set(P.map((p) => p.bar))].filter((b) => P.filter((p) => p.bar === b).length === 2)

describe('F6 — vdubus SPY: lines 504/272, labels 129/23 are the WINDOW plus two zig-zag spans the door withholds (C22)', () => {
  const ID = 'vdubus-pattern-gen-v2-restored-refined-spy-1d-2026-10-03'

  it('every one of our 295 objects is TradingView\'s, in order — nothing we draw is wrong', () => {
    const { pairs, unO } = inOrderPairing(vendorObjects(cap(ID)), ourObjects(ours(ID)))
    expect(pairs.length).toBe(295)
    expect(unO).toEqual([])
  }, T)

  it('the cause: SPY has two bars that are BOTH a 9-bar pivot high and a pivot low (348, 1554); RDDT has none, which is why RDDT MATCHES', () => {
    expect(doubledBars(pivotCentres(cap(ID), 9))).toEqual([348, 1554])
    expect(doubledBars(pivotCentres(cap('vdubus-pattern-gen-v2-restored-refined-rddt-1d-2026-09-28'), 9))).toEqual([])
    expect(graded('vdubus-pattern-gen-v2-restored-refined-rddt-1d-2026-09-28').objects.verdict).toBe('MATCH')
    // on such a bar the fast engine's zig-zag arrays take TWO `array.unshift`s;
    // the host object lane cannot say which is newest per bar, so every drawing
    // step that reads those arrays is withheld while either value is among the
    // ten it keeps (`Resolver.windowAmbiguity`, C22) — withheld, never guessed
    expect(doorDiagnostics(cap(ID)).windowAmbiguousSteps).toBeGreaterThan(0)
  }, T)

  it('⭐ every vendor object we lack is pre-window, made while the zig-zag still held pre-window pivots, or inside one of the two withheld spans (4 pivots before each doubled bar to the 10th after it)', () => {
    const c = cap(ID)
    const V = vendorObjects(c)
    const O = ourObjects(ours(ID))
    const { pairs, unV } = inOrderPairing(V, O)
    const P = pivotCentres(c, 9)
    const spans = doubledBars(P).map((d) => {
      const i = P.findIndex((p) => p.bar === d)
      return [P[i - 4].bar, P[Math.min(P.length - 1, i + 11)].bar + 9]
    })
    expect(spans).toEqual([[287, 523], [1454, 1728]])
    // and the WINDOW's own state: until the fast engine has seen ten pivots of its
    // own, its ten-deep arrays still hold (on TradingView's side) pivots from
    // before our bar 0 — a structure drawn there is a window effect
    const warm = [0, P[9].bar + 9]
    // TradingView's x is a dense rank over the x it holds; read our bar off the pairs
    const rankToBar = new Map()
    for (const [a, b] of pairs) V[a].x.forEach((x, k) => { if (Number.isFinite(x) && Number.isFinite(O[b].x[k])) rankToBar.set(x, O[b].x[k]) })
    const ranks = [...rankToBar.keys()].sort((a, b) => a - b)
    const firstRank = ranks[0]
    const range = windowRange(c)
    const barsOf = (v) => {
      const r = Math.max(...v.x.filter(Number.isFinite))
      const lo = ranks.filter((k) => k <= r).pop()
      const hi = ranks.find((k) => k >= r)
      return [rankToBar.get(lo), rankToBar.get(hi)]
    }
    const pre = unV.filter((v) => outsideWindow(v, range) || Math.max(...v.x.filter(Number.isFinite)) < firstRank)
    const inWin = unV.filter((v) => !pre.includes(v))
    const inSpan = (span, v) => { const [lo, hi] = barsOf(v); return lo <= span[1] && hi >= span[0] }
    const early = inWin.filter((v) => inSpan(warm, v) && !spans.some((s) => inSpan(s, v)))
    expect(inWin.filter((v) => !spans.some((s) => inSpan(s, v)) && !inSpan(warm, v)).map(key)).toEqual([])
    expect([unV.length, pre.length, inWin.length, early.length]).toEqual([338, 277, 61, 9])
    // non-vacuity: the same spans moved 600 bars on would not hold them
    const moved = spans.map(([a, b]) => [a + 600, b + 600])
    expect(inWin.filter((v) => !moved.some((s) => inSpan(s, v))).length).toBeGreaterThan(50)
  }, T)
})

// ─── (c) ENGINE — the runtime lane's own drawings: FIXED ────────────────────────
describe('F6 — parabolic-sar RDDT (runtime state): v4\'s bare `round_to_mintick` is the runtime lane\'s builtin too — 54 labels drawn, MATCH', () => {
  const ID = 'parabolic-sar-rddt-1d-2026-10-03'

  it('the run builds WITH its drawings (it refused `round_to_mintick` as an undeclared builtin)', () => {
    const p = probeRuntimeProgram(cap(ID).source.text, { objectsInRun: true })
    expect(p.ok, JSON.stringify(p.refusal)).toBe(true)
    expect(p.objectOps).toBeGreaterThan(0)
  })

  it('a script\'s OWN `round_to_mintick` keeps its meaning (the builtin is only the unbound name)', () => {
    // the same script on the same bars, with a function of that name defined by
    // the script: every label must print the function's answer, not the tick-rounded SAR
    const c = cap(ID)
    const own = { ...c, source: { ...c.source, text: c.source.text.replace(/(study\([^\n]*\n)/, '$1round_to_mintick(x) => 7.0\n') } }
    expect(own.source.text).toContain('round_to_mintick(x) => 7.0')
    runtimePane()
    const o = runOurSide(own)
    expect(o.ok, o.refusal).toBe(true)
    const texts = (o.objects.held || []).filter((h) => h.family === 'label').map((h) => String(h.props.text))
    expect(texts.length).toBe(54)
    expect(new Set(texts)).toEqual(new Set(['7']))
  }, T)

  it('⭐ the whole capture MATCHES: 54/54 labels, every text and colour TradingView holds', () => {
    runtimePane()
    const v = gradeCapture(cap(ID)).verdict
    expect(v.verdict, v.objects && v.objects.reason).toBe('MATCH')
    expect(family(v, 'labels')).toMatchObject({ vendor: 54, ours: 54 })
  }, T)
})

// ─── (c) ENGINE / WINDOW RULE — objects not drawn, withheld by name, owned elsewhere ───
/** The runtime-values run the host object lane reads for a script's drawings
 *  (`objectColumns.js` → `runtimeObjectValues`), asked on a capture's bars. */
function runtimeValuesOn(c, fromListing) {
  objectsPane()
  const door = enterMemberDoor(c.source.text)
  try {
    const rt = door.def && door.def.objects && door.def.objects.runtime
    expect(rt, 'the drawing reads values from the runtime lane').toBeTruthy()
    return runtimeObjectValues(rt, toProductBars(c), { tf: 'D', fromListing, atDefaults: true })
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}

describe('F6 — what is not drawn on the SPY captures, why, and whose it is', () => {
  it('options-max-pain: every drawing reads runtime values, served only from the listing (`runtime:not-from-listing`) — SPY 0 drawn, RDDT (from the listing) MATCH', () => {
    const spy = cap('options-max-pain-calculator-backquant-spy-1d-2026-10-03')
    expect(spy.history && spy.history.startsAtBar0).not.toBe(true)
    expect(runtimeValuesOn(spy, false)).toMatchObject({ served: false, reason: 'runtime:not-from-listing' })
    const v = graded('options-max-pain-calculator-backquant-spy-1d-2026-10-03')
    expect([family(v, 'lines').ours, family(v, 'labels').ours, family(v, 'boxes').ours]).toEqual([0, 0, 0])
    // control: the same run, from the listing, is served — and the RDDT capture MATCHES
    const rddt = cap('options-max-pain-calculator-backquant-rddt-1d-2026-09-28')
    expect(runtimeValuesOn(rddt, true).served).toBe(true)
    expect(graded('options-max-pain-calculator-backquant-rddt-1d-2026-09-28').objects.verdict).toBe('MATCH')
  }, T)

  it('poor-man\'s volume profile: the 40 row labels read a last-bar loop over the instruction budget (`runtime:INSTRUCTIONS_PER_BAR`), the 2 bound lines a `line.set_xloc` the host lane does not carry — same on RDDT, from the listing', () => {
    for (const id of ['poor-man039s-volume-profile-rddt-1d-2026-09-28', 'poor-man039s-volume-profile-spy-1d-2026-10-03']) {
      const c = cap(id)
      expect(runtimeValuesOn(c, true)).toMatchObject({ served: false, reason: 'runtime:INSTRUCTIONS_PER_BAR' })
      const d = doorDiagnostics(c)
      expect(d.unsupported).toEqual(['line.set_xloc'])
      expect(d.dropReasons).toEqual({ 'geometry:lost': 2 })
      const v = graded(id)
      expect([family(v, 'lines').ours, family(v, 'labels').ours]).toEqual([0, 0])
    }
  }, T)

  it('sector-rotation: every line and box reads `chart.left_visible_bar_time` (what the member has scrolled to — no capture fixes it), and the runtime lane is behind a request', () => {
    const c = cap('sector-rotation-spy-1d-2026-10-03')
    const d = doorDiagnostics(c)
    expect(d.dropReasons).toEqual({ 'guard:loop': 2, 'guard:create': 4 })
    expect(d.guardRefusals.every((g) => / pine:builtin `chart\.left_visible_bar_time`$/.test(g))).toBe(true)
    expect(probeRuntimeProgram(c.source.text, { objectsInRun: true }).refusal.guard).toBe('pine:request')
  }, T)

  it('smt-divergence: the divergences read `XAUUSD`, a bare symbol no exchange resolves (`other-symbol:bare`) — 0 drawn on SPY and RDDT', () => {
    for (const id of ['smt-divergence-ict-01-tradingfinder-smart-money-technique-spy-1d-2026-10-03', 'smt-divergence-ict-01-tradingfinder-smart-money-technique-rddt-1d-2026-09-28']) {
      const o = ours(id)
      expect(o.notes.some((n) => /other symbol XAUUSD: refused \(other-symbol:bare\)/.test(n)), id).toBe(true)
      const v = graded(id)
      expect([family(v, 'lines').ours, family(v, 'labels').ours]).toEqual([0, 0])
    }
  }, T)

  it('volume-profile: the profile lines are moved inside a loop whose bound reads a value the function changes (`loop:bounds` pine:state), and the runtime lane refuses a `ta.highest` whose length is known only while the bar runs', () => {
    const c = cap('volume-profile-spy-1d-2026-10-03')
    const d = doorDiagnostics(c)
    expect(d.loopBoundsWhy.some((w) => /pine:state: `va_up` changes as the function `draw` runs/.test(w))).toBe(true)
    expect(d.lostCreates).toEqual(['line'])
    expect(probeRuntimeProgram(c.source.text, { objectsInRun: true }).refusal.guard).toBe('runtime:history-dynamic-offset')
  }, T)

  it('vold-market-breadth and position-size-calc: the missing cells read `request.security` of other symbols (breadth tickers; an FX rate)', () => {
    const vold = doorDiagnostics(cap('vold-market-breadth-spy-1d-2026-10-03'))
    expect(vold.dropReasons).toEqual({ 'cell:text': 2 })
    expect(cap('vold-market-breadth-spy-1d-2026-10-03').source.text).toMatch(/realS \(t\) => request\.security\(t, timeframe\.period, src\)/)
    const psc = cap('position-size-calc-spy-1d-2026-10-03')
    expect(doorDiagnostics(psc).dropReasons).toEqual({ 'cell:text': 1 })
    // the one cell we lack is "Lots", the only one that divides by the FX rate the request reads
    expect(psc.source.text).toMatch(/var float pos_size_base\s+= pos_size\/userate/)
    const v = graded('position-size-calc-spy-1d-2026-10-03')
    expect(family(v, 'tableCells')).toMatchObject({ vendor: 10, ours: 9 })
  }, T)

  it('trend-lines-supports-and-resistances: the door withholds the whole drawing by name (its loops carried none of 6 steps); the runtime lane stops at `alert.freq_once_per_bar`', () => {
    const c = cap('trend-lines-supports-and-resistances-spy-1d-2026-10-03')
    expect(graded('trend-lines-supports-and-resistances-spy-1d-2026-10-03').objects.withheld).toBe('pine:object-ops-refused')
    const p = probeRuntimeProgram(c.source.text, { objectsInRun: true })
    expect(p.refusal).toMatchObject({ guard: 'pine:builtin', token: 'alert.freq_once_per_bar' })
  }, T)
})
