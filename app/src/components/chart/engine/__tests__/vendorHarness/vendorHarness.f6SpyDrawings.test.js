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
import { runOurSide, enterMemberDoor, toProductBars, warmBarsSupply, HARNESS_DEF_ID } from './ourSide'
import * as registry from '../../nativeRegistry'
import { probeRuntimeProgram, runtimeObjectValues } from '../../runtime/runtimeColumns'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'

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

  // ⭐ DIV-1 RE-PIN (2026-11-09): the harness now replays SPY's proved history from its 1993
  // listing before the window (`ourSide.js`), the series the member's daily chart computes.
  // The WINDOW analysis this block proved (every object we lacked was made before our cold
  // bar 0) is now proved the strongest way: replayed from the listing, our creation
  // counter IS TradingView's, and every object pairs at offset 0.
  it('every box TradingView holds is ours at the SAME id (offset 0), same prices, and we hold no other (DIV-1)', () => {
    const c = cap(ID)
    const V = vendorObjects(c)
    const O = ourObjects(ours(ID))
    expect([V.length, O.length]).toEqual([51, 51])
    const { misses, extra } = idOffsetPairing(V, O, 0)
    expect(misses).toEqual([])
    expect(extra).toEqual([])
    // non-vacuity: a neighbouring offset pairs nothing
    expect(idOffsetPairing(V, O, 1).extra.length).toBe(51)
  }, T)

  it('⭐ the arithmetic: one box per FVG, TradingView\'s ids run 2701..2751 (2,751 made since SPY\'s listing), and so do ours (DIV-1)', () => {
    const c = cap(ID)
    const V = vendorObjects(c)
    expect(V.every((v) => v.f === 'box')).toBe(true)
    expect(V.map((v) => v.id)).toEqual(Array.from({ length: 51 }, (_, k) => 2701 + k))
    const o = ours(ID)
    expect(Math.max(...o.objects.held.map((h) => h.id))).toBe(2751)
    const v = graded(ID)
    expect(family(v, 'boxes')).toMatchObject({ vendor: heldAfter(2751, 50), ours: heldAfter(2751, 50) })
    expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
  }, T)

  it('control: on RDDT (from the listing) the same script MATCHES', () => {
    expect(graded('makuchaku039s-trade-tools-fair-value-gaps-rddt-1d-2026-09-28').objects.verdict).toBe('MATCH')
  }, T)
})

// ⭐ DIV-1 RE-PIN (2026-11-09): the harness now replays SPY's proved history from its 1993
// listing before the window (`ourSide.js`), the series the member's daily chart computes.
// The WINDOW analysis this block proved (every object we lacked was made before our cold
// bar 0) is now proved the strongest way: replayed from the listing, our creation
// counter IS TradingView's, and every object pairs at offset 0.
describe('F6 — pro-trading-art, rsi-swing, price-action, trend-duration SPY: replayed from the listing, every object is TradingView\'s, id for id (DIV-1)', () => {
  const CASES = [
    // [id, TradingView's object count]. Before DIV-1 we held 39 / 85 / 507 / 53 of them,
    // at id offsets 267 / 360 / 3768 / 887 (the objects made before our cold bar 0).
    ['pro-trading-art-double-top-bottom-with-alert', 306],
    ['rsi-swing-indicator', 100],
    ['price-action-as-in-book-fibonacci-supportresistant-trendline', 509],
    ['trend-duration-forecast-chartprime', 56],
  ]
  for (const [name, nVendor] of CASES) {
    it(`${name}: all ${nVendor} of TradingView's objects are ours at the same id, and we hold no other`, () => {
      const id = `${name}-spy-1d-2026-10-03`
      const V = vendorObjects(cap(id))
      const O = ourObjects(ours(id))
      expect([O.length, V.length]).toEqual([nVendor, nVendor])
      const { misses, extra } = idOffsetPairing(V, O, 0)
      expect(misses).toEqual([])
      expect(extra).toEqual([])
      // non-vacuity: the offset is a real pairing
      expect(idOffsetPairing(V, O, 1).misses.length).toBeGreaterThan(nVendor / 2)
    }, T)

    it(`${name}: control — on RDDT (from the listing) it MATCHES`, () => {
      expect(graded(`${name}-rddt-1d-2026-09-28`).objects.verdict).toBe('MATCH')
    }, T)
  }
})

describe('F6 — liquidity-pools SPY: lines 504/502, labels 504/254 are the WINDOW and the collector', () => {
  const ID = 'liquidity-pools-spy-1d-2026-10-03'

  // ⭐ DIV-1 RE-PIN (2026-11-09): was "all 756 objects we hold are TradingView's IN ORDER;
  // what only it holds is its OLDEST of each family" (252 made before our cold bar 0).
  // Replayed from SPY's listing (DIV-1) we hold all 1008, in order, and nothing else.
  it('all 1008 objects TradingView holds are ours, IN ORDER, and we hold no other (DIV-1)', () => {
    const c = cap(ID)
    const V = vendorObjects(c)
    const O = ourObjects(ours(ID))
    const { pairs, unV, unO } = inOrderPairing(V, O)
    expect([V.length, O.length, pairs.length]).toEqual([1008, 1008, 1008])
    expect(unO).toEqual([])
    expect(unV).toEqual([])
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

  // ⭐ DIV-1 RE-PIN (2026-11-09): was "TradingView's labels at the cap (history from 1993),
  // ours below it (254)". Replayed from 1993 (DIV-1), ours sit at the cap too.
  it('both families sit where Pine\'s collector puts them, on both sides, with the history from 1993 (DIV-1)', () => {
    const v = graded(ID)
    for (const n of [family(v, 'lines').vendor, family(v, 'lines').ours, family(v, 'labels').vendor, family(v, 'labels').ours]) {
      expect(n).toBeGreaterThanOrEqual(500)
      expect(n).toBeLessThanOrEqual(505)
    }
    expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
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

/** ⭐ W-C22-DEL — the object lane STEPPED over [listing prehistory + window], the
 *  series `runOurSide` replays (DIV-1), with the runtime's own trace. */
function steppedReplay(c) {
  objectsPane()
  const door = enterMemberDoor(c.source.text)
  try {
    const sup = warmBarsSupply(c)
    expect(sup.kind).toBe('warm')
    const bars = toProductBars({ ...c, bars: { ...c.bars, rows: sup.rows.concat(c.bars.rows) } })
    const reader = objectReaderFor(door.def, bars, { tf: 'D', symbol: { ticker: 'SPY', exchange: 'AMEX' },
      newestBarIsForming: c.newestBarIsForming ?? null, historyFromListing: sup.historyFromListing === true })
    const run = evaluateObjects(reader.program, { barCount: bars.length, readNode: reader.readNode,
      readTime: reader.readTime, readUnknown: reader.readUnknown, offListing: reader.historyFromListing !== true, trace: true })
    return { pre: sup.bars, program: reader.program, def: door.def, run }
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}

// ⭐⭐ W-C22-DEL (2026-11-09) — FIXED: no line TradingView removed is drawn.
// DIV-1 (replayed from SPY's 1993 listing, the series a member's daily chart computes)
// showed ours holding 48 zig-zag LINES TradingView does not (pivots at absolute bars
// 5649..5948, before the window) and lacking 52 in-window lines it holds. The lane's
// suspicion was withheld DELETES. ⚰️ PROVED WRONG by the stepped replay below: the
// script deletes NOTHING (`line.delete` appears nowhere; the program carries no
// delete op). Its lines leave only by Pine's collector (max_lines_count=500). The
// C22 window-ambiguity withholding (doubled 9-bar pivots at window 348 / 1554)
// withheld CREATES on bars where Pine ran them, so this run made fewer objects than
// TradingView (its creation counter reads 2907, ours 2831), its collector lagged
// TradingView's, and the oldest lines TradingView had already collected survived
// here, DRAWN. The fix is C33's existing collector rule (`noteUnknownCreate` →
// `collectorUnknown`, one authority): a create withheld by `op.withhold` is one Pine
// MAY have made, so once ours plus those can pass the trigger, every line TradingView
// may already have collected is held back (r3/r4; r1/r2 held the family whole), by
// name (`withheldBy['objects:collector']`, the member's drawing note). A
// bar the guard's MEASURED conjuncts are false (`withholdRuns`) is a certain skip, so
// only the 20 bars Pine may really have drawn on count: labels stay drawn.
describe('F6 — vdubus SPY (DIV-1, W-C22-DEL fixed): the lines TradingView\'s collector removed are never drawn; older lines are held back by name, labels match', () => {
  const ID = 'vdubus-pattern-gen-v2-restored-refined-spy-1d-2026-10-03'

  it('⭐ the cause, stepped: the program deletes nothing, lines leave only by the collector, and creates Pine may have made were withheld (TradingView\'s counter is past ours)', () => {
    const c = cap(ID)
    const { pre, program, run } = steppedReplay(c)
    const ev = run.events
    const every = (list, fn) => { for (const o of list) { fn(o); if (o.k === 'loop') every(o.body || [], fn) } }
    const kinds = new Set()
    every(program.ops, (o) => kinds.add(o.k))
    expect(kinds.has('delete')).toBe(false)
    expect(ev.filter((e) => e.k === 'delete')).toEqual([])
    const evicts = ev.filter((e) => e.k === 'evict')
    expect(evicts.length).toBeGreaterThan(0)
    expect(new Set(evicts.map((e) => e.family))).toEqual(new Set(['line']))
    // the creates withheld on a bar Pine may have run them: every one in the window,
    // on or after the first doubled pivot's bar (window 348 + the 9-bar confirmation)
    const withheld = ev.filter((e) => e.k === 'withheld')
    expect(withheld.length).toBeGreaterThan(0)
    expect(Math.min(...withheld.map((e) => e.bar))).toBeGreaterThanOrEqual(pre + 348)
    // TradingView made more objects than this run did: its collector is further on
    const vendorMaxId = Math.max(...c.objects.records.lines.map((l) => l.id))
    expect(vendorMaxId).toBe(2907)
    expect(run.stats.nextId - 1).toBe(2831)
    expect(vendorMaxId).toBeGreaterThan(run.stats.nextId - 1)
  }, T)

  it('⭐ FIXED (r3): every object we draw is TradingView\'s, in order; only the lines it certainly still keeps are drawn, the older ones held back BY NAME', () => {
    const c = cap(ID)
    const o = ours(ID)
    const O = ourObjects(o)
    const { pairs, unO } = inOrderPairing(vendorObjects(c), O)
    // ⛔ THE HONESTY PROPERTY: nothing we draw is an object TradingView does not hold
    expect(unO).toEqual([])
    expect(pairs.length).toBe(O.length)
    // ⭐ r4 — 364 of our 500 lines are certainly still kept by TradingView (rank <= 1 +
    // later creates + creates Pine may have made later + one slot per line register,
    // objectPool.js C7); the 136 older ones, and the fills on them, are held back.
    // ⚰️ r1/r2 held back all 500 (the family whole); r3 drew 412 (no register slots).
    expect(O.filter((x) => x.f === 'line').length).toBe(364)
    // a fill spans two lines: every fill we draw joins two lines we draw
    const drawnLines = new Set(o.objects.held.filter((x) => x.family === 'line').map((x) => x.id))
    const fills = o.objects.held.filter((x) => x.family === 'linefill')
    expect(fills.length).toBeGreaterThan(0)
    for (const f of fills) expect([drawnLines.has(f.props.line1.__ref), drawnLines.has(f.props.line2.__ref)], `fill #${f.id}`).toEqual([true, true])
    expect(O.filter((x) => x.f === 'label').length).toBe(129)
    expect(o.objects.withheldFamilies).toEqual(['line', 'linefill'])
    const v = graded(ID)
    expect(v.objects.verdict).toBe('INCONCLUSIVE')
    expect(v.objects.withheld).toBe('objects:collector')
    expect(family(v, 'lines')).toMatchObject({ vendor: 504, ours: null, withheld: true })
    expect(family(v, 'labels')).toMatchObject({ vendor: 129, ours: 129, agree: true })
  }, T)

  it('the trigger: SPY has two bars that are BOTH a 9-bar pivot high and a pivot low (348, 1554); RDDT has none, which is why RDDT MATCHES', () => {
    expect(doubledBars(pivotCentres(cap(ID), 9))).toEqual([348, 1554])
    expect(doubledBars(pivotCentres(cap('vdubus-pattern-gen-v2-restored-refined-rddt-1d-2026-09-28'), 9))).toEqual([])
    expect(graded('vdubus-pattern-gen-v2-restored-refined-rddt-1d-2026-09-28').objects.verdict).toBe('MATCH')
    // on such a bar the fast engine's zig-zag arrays take TWO `array.unshift`s;
    // the host object lane cannot say which is newest per bar, so every drawing
    // step whose guard reads those arrays is withheld while either value is among
    // the ten it keeps (`Resolver.windowAmbiguity`, C22) — withheld, never guessed
    expect(doorDiagnostics(cap(ID)).windowAmbiguousSteps).toBeGreaterThan(0)
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
  it('options-max-pain: every drawing reads runtime values, served only from the listing (`runtime:not-from-listing` on the cold window); replayed from the listing SPY MATCHES (DIV-1), as RDDT does', () => {
    const spy = cap('options-max-pain-calculator-backquant-spy-1d-2026-10-03')
    expect(spy.history && spy.history.startsAtBar0).not.toBe(true)
    expect(runtimeValuesOn(spy, false)).toMatchObject({ served: false, reason: 'runtime:not-from-listing' })
    // ⭐ DIV-1 RE-PIN (2026-11-09): was "SPY 0 drawn". The harness now replays SPY's proved
    // history from its listing (the series the member's daily chart computes), so the run
    // IS from the listing and served: every drawing is drawn and the objects MATCH.
    const v = graded('options-max-pain-calculator-backquant-spy-1d-2026-10-03')
    expect([family(v, 'lines').ours, family(v, 'labels').ours, family(v, 'boxes').ours]).toEqual([24, 15, 13])
    expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
    // control: the same run, from the listing, is served — and the RDDT capture MATCHES
    const rddt = cap('options-max-pain-calculator-backquant-rddt-1d-2026-09-28')
    expect(runtimeValuesOn(rddt, true).served).toBe(true)
    expect(graded('options-max-pain-calculator-backquant-rddt-1d-2026-09-28').objects.verdict).toBe('MATCH')
  }, T)

  // ⭐ P2 RE-PIN (2026-10-30): `line.set_xloc` is carried now — the 2 bound lines are
  // drawn (2 of 2, `vendorHarness.p2SetXloc` grades them id for id). The 40 labels
  // are unchanged: their run is over the per-bar instruction budget.
  it('poor-man\'s volume profile: the 40 row labels read a last-bar loop over the instruction budget (`runtime:INSTRUCTIONS_PER_BAR`); the 2 bound lines are drawn (P2 carries `line.set_xloc`) — same on RDDT, from the listing', () => {
    for (const id of ['poor-man039s-volume-profile-rddt-1d-2026-09-28', 'poor-man039s-volume-profile-spy-1d-2026-10-03']) {
      const c = cap(id)
      expect(runtimeValuesOn(c, true)).toMatchObject({ served: false, reason: 'runtime:INSTRUCTIONS_PER_BAR' })
      const d = doorDiagnostics(c)
      expect(d.unsupported).toEqual([])
      expect(d.dropReasons).toEqual({})
      const v = graded(id)
      // ⭐ OZ RE-PIN (2026-11-09): the 40 labels are now withheld BY NAME
      // (`objects:not-computable`, every one carries a value the run could not compute)
      // rather than counted as 0 — a stated refusal, not a silent zero.
      expect([family(v, 'lines').ours, family(v, 'labels').ours]).toEqual([2, null])
      expect(family(v, 'labels').withheld).toBe(true)
      // ⭐ P2b — and the RENDER state draws them (the grade counts what the script holds)
      const o = ours(id)
      expect(o.objects.drawn.lines, id).toBe(2)
      expect(o.objects.dropped.line, id).toBe(0)
    }
  }, T)

  it('sector-rotation: every line and box reads `chart.left_visible_bar_time` (what the member has scrolled to — no capture fixes it), and the runtime lane is behind a request', () => {
    const c = cap('sector-rotation-spy-1d-2026-10-03')
    const d = doorDiagnostics(c)
    expect(d.dropReasons).toEqual({ 'guard:loop': 2, 'guard:create': 4 })
    expect(d.guardRefusals.every((g) => / pine:builtin `chart\.left_visible_bar_time`$/.test(g))).toBe(true)
    expect(probeRuntimeProgram(c.source.text, { objectsInRun: true }).refusal.guard).toBe('pine:request')
  }, T)

  // ⭐⭐ ENGINE 55 — FLIPPED DELIBERATELY: the bare `XAUUSD` read is refused AT TRANSLATE now
  // (`pine:request`, `other-symbol:bare`, `otherSymbols.staticallyUnservable`), so the member door
  // refuses the script by name instead of drawing nothing under a `sym` the bind starved.
  it('smt-divergence: the divergences read `XAUUSD`, a bare symbol no exchange resolves — refused by name at the door (`other-symbol:bare`), on SPY and RDDT', () => {
    for (const id of ['smt-divergence-ict-01-tradingfinder-smart-money-technique-spy-1d-2026-10-03', 'smt-divergence-ict-01-tradingfinder-smart-money-technique-rddt-1d-2026-09-28']) {
      objectsPane()
      const o = runOurSide(cap(id))
      expect(o.ok, id).toBe(false)
      expect(o.refusal, id).toMatch(/pine:request/)
      expect(o.refusal, id).toMatch(/other-symbol:bare — `"XAUUSD"`/)
      expect(graded(id).verdict, id).toBe('INCONCLUSIVE')
    }
  }, T)

  it('volume-profile: the profile lines are moved inside a loop whose bound reads a value the function changes (`loop:bounds` pine:state); the runtime lane\'s own-drawings build now compiles (W6-T5 serves `array.fill`, the wall it used to stop at)', () => {
    const c = cap('volume-profile-spy-1d-2026-10-03')
    const d = doorDiagnostics(c)
    expect(d.loopBoundsWhy.some((w) => /pine:state: `va_up` changes as the function `draw` runs/.test(w))).toBe(true)
    expect(d.lostCreates).toEqual(['line'])
    const p = probeRuntimeProgram(c.source.text, { objectsInRun: true })
    expect(p.ok, p.refusal && `${p.refusal.guard}: ${p.refusal.message}`).toBe(true)
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

// ─── leviathan — was (a) WINDOW + (c) ENGINE, OPEN ──────────────────────────────
// ⭐ DIV-1 RE-PIN (2026-11-09): this block proved the shortfall was the WINDOW plus ONE
// wrong caption (LH where TradingView prints HH, owner F5: `prevHigh` re-seeded 250 bars
// back). Replayed from SPY's 1993 listing (DIV-1), every object pairs id for id and the
// caption is TradingView's: the "engine defect" was the same window, not the engine.
describe('F6 — market-structure-by-leviathan SPY: replayed from the listing, every object is TradingView\'s id for id, captions included (DIV-1)', () => {
  const ID = 'market-structure-by-leviathan-spy-1d-2026-10-03'

  it('all of TradingView\'s objects are ours at the same id, and we hold no other', () => {
    const V = vendorObjects(cap(ID))
    const O = ourObjects(ours(ID))
    expect(O.length).toBe(V.length)
    const { misses, extra } = idOffsetPairing(V, O, 0)
    expect(misses.map(key)).toEqual([])
    expect(extra.map(key)).toEqual([])
  }, T)

  it('⭐ RESOLVED (was OPEN, owner F5): the swing high at 454.05 is captioned HH, as TradingView prints it', () => {
    const V = vendorObjects(cap(ID))
    const O = ourObjects(ours(ID))
    expect(V.filter((v) => key(v) === 'label|HH|454.05').length).toBe(1)
    expect(O.filter((o) => key(o) === 'label|HH|454.05').length).toBe(1)
    expect(O.filter((o) => key(o) === 'label|LH|454.05')).toEqual([])
  }, T)

  it('control: on RDDT (from the listing) the same script MATCHES', () => {
    expect(graded('market-structure-by-leviathan-rddt-1d-2026-09-28').objects.verdict).toBe('MATCH')
  }, T)
})
