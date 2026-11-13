// @vitest-environment node
// app/src/components/chart/builder/memberPane/div4RuntimeReadPaint.test.js
//
// ─── ⭐⭐ DIV-4 — a `barcolor` the host lane withholds for its colour, read from the run ──
//
// The host lane refuses an unbounded `barssince` over a recurrence by name (pine.js,
// "NOT OVER A RECURRENCE"), so `barcolor(b < s ? green : b > s ? red : na)` over two
// such counts is withheld `paint:colour` (SuperTrend STRATEGY's shape). Behind the
// runtime pane's switch the member door now asks the per-bar run for that colour at
// the paint's own statement (`compute.runtimeColours`), and the registry serves the
// column only where the run is exact (`nativeRegistry.js::withRuntimeColours`).
// Pine's reference for the call: `barcolor(color, ...)`, "color (series color) Color
// of bars"; an `na` colour leaves the bar its own colour.
import { describe, it, expect, vi, afterEach } from 'vitest'

import * as registry from '../../engine/nativeRegistry'
import { validateDefinition } from '../../engine/defSchema'
import { memberPaneDefinition } from './memberPaneDefinition'
import { translatePine, PAINT_RUNTIME_COLOUR } from '../../engine/ast/pine'
import fs from 'node:fs'
import path from 'node:path'
import { bindingKey } from '../../engine/pool'
import { paintColoursFor, createBinder } from '../../engine/binder'
import { addInstance } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from '../../engine/__tests__/fakeChart'
import { runtimeErrorNotices } from '../../engine/runtimeErrorNotice'
import { toProductBars } from '../../engine/__tests__/vendorHarness/ourSide'
import { vendorPaints } from '../../engine/__tests__/vendorHarness/paintColours'
import { coloursAgree, normalizeColor, NO_COLOUR } from '../../../../../../tools/vendor_harness/compare.mjs'
import { __resetRuntimePanePermission, __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import {
  setRuntimeKillList, runtimeSourceHash, __resetRuntimeAllowList, __allowEveryRuntimeScriptForTests,
} from '../../engine/runtimeKill'
import { registerObjectRuntimeValues, registeredObjectRuntimeValues } from '../../engine/objectRuntimeSeam'

afterEach(() => {
  vi.unstubAllEnvs()
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
})

// written for this rail (not corpus text): two counts since a latch flipped
const SRC = `//@version=5
indicator("div4 rail", overlay = true)
len = input.int(3, "Len")
hi = ta.highest(high, len)[1]
lo = ta.lowest(low, len)[1]
var int trend = 1
trend := close > hi ? 1 : close < lo ? -1 : trend
up = trend == 1 and trend[1] == -1
dn = trend == -1 and trend[1] == 1
b = ta.barssince(up)
s = ta.barssince(dn)
plot(ta.sma(close, len), "c")
barcolor(b < s ? color.green : b > s ? color.red : na, title = "bc")
`
const PAINT_LINE = 13

const door = (runtime) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', runtime ? '1' : '')
  return memberPaneDefinition({ source: SRC, id: 'u_00000000d4a1', name: 'div4' })
}

// deterministic bars with turns both ways
const BARS = Array.from({ length: 80 }, (_, i) => {
  const c = 100 + 12 * Math.sin(i / 5) + (i % 7) * 0.3
  return { t: 1700000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + i }
})

const GREEN = 0x50af4c // packed 0xTTBBGGRR of #4CAF50
const RED = 0x5252ff //   ... of #FF5252

/** Pine, by hand, for SRC at its defaults: the packed colour per bar, NaN for `na`. */
function expected(bars, len = 3) {
  let trend = 1
  const tr = []
  let lastUp = null
  let lastDn = null
  return bars.map((bar, i) => {
    const hi = i >= len ? Math.max(...bars.slice(i - len, i).map((x) => x.h)) : NaN
    const lo = i >= len ? Math.min(...bars.slice(i - len, i).map((x) => x.l)) : NaN
    if (bar.c > hi) trend = 1
    else if (bar.c < lo) trend = -1
    tr.push(trend)
    const prev = i > 0 ? tr[i - 1] : NaN
    if (trend === 1 && prev === -1) lastUp = i
    if (trend === -1 && prev === 1) lastDn = i
    const b = lastUp === null ? NaN : i - lastUp
    const s = lastDn === null ? NaN : i - lastDn
    return b < s ? GREEN : b > s ? RED : NaN
  })
}
const show = (xs) => Array.from(xs, (x) => (Number.isNaN(x) ? 'na' : x))

describe('⭐⭐ DIV-4 — the host lane withholds this colour, and says why', () => {
  it('the translation withholds it `paint:colour`, carrying where the run can read it (non-enumerable)', () => {
    const t = translatePine(SRC, { strict: true })
    const [p] = t.presentation.paints
    expect(p.withheld.code).toBe('paint:colour')
    expect(p[PAINT_RUNTIME_COLOUR]).toMatchObject({ line: PAINT_LINE, column: 1 })
    expect(JSON.stringify(p)).not.toContain('"node"')
    // and no copy of the record (`{...p}`, as readers spread it) carries it either
    expect(Object.getOwnPropertySymbols({ ...p })).toEqual([])
    // ⛔ a bgcolor carries none: its style transparency is not read from a run
    const bg = translatePine(SRC.replace('barcolor(', 'bgcolor('), { strict: true }).presentation.paints[0]
    expect(bg.withheld.code).toBe('paint:colour')
    expect(bg[PAINT_RUNTIME_COLOUR]).toBeUndefined()
  })
  it('⛔ with the runtime pane OFF the document is exactly what it was', () => {
    const d = door(false)
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.paints).toBeUndefined()
    expect(d.definition.compute.runtimeColours).toBeUndefined()
    expect(d.notes.some((n) => /is not drawn: `barcolor`'s colour/.test(n.note))).toBe(true)
  })
})

describe('⭐⭐ DIV-4 — with the runtime pane on, the colour is read from the run', () => {
  it('the document reads it from a runtime colour column, validates, installs, and says so', () => {
    const d = door(true)
    expect(d.ok, d.reason).toBe(true)
    expect(d.lane).toBeUndefined() // still the host document
    const [paint] = d.definition.paints
    expect(paint).toMatchObject({ kind: 'barcolor', line: PAINT_LINE, title: 'bc', colorMode: 'column:rtcolour1', colorPacked: {} })
    const rc = d.definition.compute.runtimeColours
    expect(rc.keys).toEqual(['rtcolour1'])
    expect(rc.at[0]).toMatchObject({ line: PAINT_LINE, kind: 'colour' })
    expect(d.notes.some((n) => /takes its colour from running the script bar by bar/.test(n.note))).toBe(true)
    expect(validateDefinition(d.definition).errors).toBeUndefined()
    const { installed, errors } = registry.installUserDefinitions([d.definition])
    expect(errors).toEqual([])
    expect(installed).toHaveLength(1)
    registry.uninstallUserDefinition(d.definition.id)
  })

  it("from the listing, at the defaults: the column is Pine's colour on every bar", () => {
    const d = door(true)
    const cols = registry.computeFor(d.definition, BARS, undefined,
      { tf: 'D', symbol: 'AMEX:SPY', historyFromListing: true, newestBarIsForming: false })
    expect(registry.columnErrors(cols).rtcolour1).toBeUndefined()
    const want = expected(BARS)
    // the fixture exercises all three answers
    expect(want.includes(GREEN) && want.includes(RED) && want.some((x) => Number.isNaN(x))).toBe(true)
    expect(show(cols.rtcolour1)).toEqual(show(want))
    expect(cols.value).toBeInstanceOf(Float64Array) // the host column is still there
  })

  it('⛔ ENGINE 53 — the server\'s served stamps refuse it too (not graded, killed); CONTROL: unstamped is served', () => {
    const d = door(true)
    const ctx = { tf: 'D', symbol: 'AMEX:SPY', historyFromListing: true, newestBarIsForming: false }
    expect(registry.computeFor(d.definition, BARS, undefined, ctx).rtcolour1).toBeInstanceOf(Float64Array)
    for (const [stamp, code] of [['runtimeNotGraded', 'pane:not-graded'], ['runtimeKilled', 'pane:killed']]) {
      const stamped = { ...d.definition, meta: { ...d.definition.meta, [stamp]: 'stamped by the server' } }
      const cols = registry.computeFor(stamped, BARS, undefined, ctx)
      expect(cols.rtcolour1, stamp).toBeUndefined()
      expect(registry.columnErrors(cols).rtcolour1.code, stamp).toBe(code)
    }
  })

  it('⛔ off the listing it is NOT served, by name', () => {
    const d = door(true)
    const off = registry.computeFor(d.definition, BARS, undefined, { tf: 'D', symbol: 'AMEX:SPY', newestBarIsForming: false })
    expect(off.rtcolour1).toBeUndefined()
    expect(registry.columnErrors(off).rtcolour1.guard).toBe(registry.RUNTIME_COLOUR_GUARD)
  })

  it('⛔ with the folded `len` edited away from its default it is NOT served', () => {
    const d = door(true)
    const manifest = d.definition.compute.paramManifest || {}
    const pid = Object.keys(manifest).find((k) => manifest[k].default === 3)
    expect(pid).toBeTruthy()
    const edited = JSON.parse(JSON.stringify(d.definition))
    const loc = edited.compute.paramManifest[pid].locators[0]
    let node = loc.treeIndex === null ? edited.compute.ast : edited.compute.trees[loc.treeIndex]
    for (const step of loc.astPath) node = node[step]
    node.value = 5
    const ctx = { tf: 'D', symbol: 'AMEX:SPY', historyFromListing: true, newestBarIsForming: false }
    // control: the unedited document is served on the same bars
    expect(registry.computeFor(d.definition, BARS, undefined, ctx).rtcolour1).toBeInstanceOf(Float64Array)
    const e = registry.computeFor(edited, BARS, undefined, ctx)
    expect(e.rtcolour1).toBeUndefined()
    expect(registry.columnErrors(e).rtcolour1.guard).toBe(registry.RUNTIME_COLOUR_GUARD)
  })
})

describe('⛔ DIV-4 — the schema admits a runtime colour column only as declared', () => {
  const base = () => door(true).definition
  it('a paint naming an undeclared run column is refused', () => {
    const d = base()
    d.compute = { ...d.compute, runtimeColours: { ...d.compute.runtimeColours, keys: ['rtcolourX'] } }
    expect((validateDefinition(d).errors || []).join(' ')).toMatch(/rtcolour1/)
  })
  it('a run column that collides with a plot key is refused', () => {
    const d = base()
    d.compute = { ...d.compute, runtimeColours: { ...d.compute.runtimeColours, keys: ['value'] } }
    expect((validateDefinition(d).errors || []).join(' ')).toMatch(/runtimeColours\.keys\[0\]/)
  })
})

// ─── r1 — on the real script the triage named, and every gate the run answers to ────
const CAPTURE = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'vendor', 'harness',
  'supertrend-strategy-rddt-1d-2026-10-02.json')
const cap = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'))
const ST = cap.source.text // MPL-2.0, committed with the capture
const ST_BARS = toProductBars(cap)
const ST_CTX = { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, historyFromListing: true, newestBarIsForming: false }
const stDoor = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  return memberPaneDefinition({ source: ST, id: 'u_00000000d4b1', name: 'st' })
}

describe('⭐⭐ DIV-4 r1 — SuperTrend STRATEGY (RDDT 1D from the listing)', () => {
  it('its barcolor is read on the PANE lane (the object door refuses `timestamp`) and equals the capture on every bar', () => {
    const d = stDoor()
    expect(d.ok, d.reason).toBe(true)
    const paint = d.definition.paints.find((p) => p.kind === 'barcolor')
    expect(paint && paint.colorMode).toBe('column:rtcolour1')
    const cols = registry.computeFor(d.definition, ST_BARS, undefined, ST_CTX)
    expect(registry.columnErrors(cols).rtcolour1).toBeUndefined()
    const ours = paintColoursFor(paint, 'i', new Map([[bindingKey('i', 'rtcolour1'), cols.rtcolour1]]), ST_BARS.length)
    const [vendor] = vendorPaints(cap).filter((v) => v.kind === 'barcolor')
    const canon = (c) => (c === null || c === undefined ? NO_COLOUR : (normalizeColor(c) || c))
    let differ = 0
    let painted = 0
    vendor.colors.forEach((vc, j) => {
      if (vc === undefined) return
      if (canon(vc) !== NO_COLOUR) painted += 1
      if (!coloursAgree(canon(vc), canon(ours[j]))) differ += 1
    })
    expect(painted).toBeGreaterThan(100)
    expect(differ).toBe(0)
  })

  it('⛔ a moved input, the pane off for the member, the kill list, the allowlist, the build flag off: not served', () => {
    const d = stDoor()
    let overrides
    const served = () => registry.computeFor(d.definition, ST_BARS, overrides, ST_CTX).rtcolour1
    expect(served()).toBeInstanceOf(Float64Array) // control
    const inp = d.definition.inputs.find((i) => typeof i.default === 'number')
    overrides = { [inp.key]: inp.default + 1 }
    expect(served()).toBeUndefined()
    overrides = undefined
    __resetRuntimePanePermission()
    expect(served()).toBeUndefined()
    expect(registry.columnErrors(registry.computeFor(d.definition, ST_BARS, undefined, ST_CTX)).rtcolour1.message)
      .toMatch(/switched off for your account/)
    __permitRuntimePaneForTests()
    setRuntimeKillList([runtimeSourceHash(ST)])
    expect(served()).toBeUndefined()
    setRuntimeKillList([])
    __resetRuntimeAllowList()
    expect(served()).toBeUndefined()
    __allowEveryRuntimeScriptForTests()
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    expect(served()).toBeUndefined()
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    expect(served()).toBeInstanceOf(Float64Array) // and back
  // ⏱ nine full runs of the 636-bar script: measured 8.1 s alone (Node 20, --maxWorkers=1,
  // 2026-11-09); the 15 s default tripped under a loaded box, so ~7x headroom
  }, 60000)

  it('⛔ the door does not lift it for a killed or a not-yet-graded script', () => {
    setRuntimeKillList([runtimeSourceHash(ST)])
    expect(stDoor().definition.compute.runtimeColours).toBeUndefined()
    setRuntimeKillList([])
    __resetRuntimeAllowList()
    expect(stDoor().definition.compute.runtimeColours).toBeUndefined()
    __allowEveryRuntimeScriptForTests()
    expect(stDoor().definition.compute.runtimeColours).toBeTruthy() // control
  })

  it('⛔ a bar the probe runs disagree on withholds the whole column', () => {
    const d = stDoor()
    const real = registeredObjectRuntimeValues()
    try {
      registerObjectRuntimeValues((rt, bars, c) => {
        const v = real(rt, bars, c)
        const unknown = v.unknown.map(() => { const m = new Uint8Array(bars.length); m[7] = 1; return m })
        return { ...v, unknown }
      })
      const cols = registry.computeFor(d.definition, ST_BARS, undefined, ST_CTX)
      expect(cols.rtcolour1).toBeUndefined()
      expect(registry.columnErrors(cols).rtcolour1.message).toMatch(/can't be worked out exactly/)
    } finally {
      registerObjectRuntimeValues(real)
    }
  })

  it('⭐ the member reads why on the chart runtime strip (here: off the listing), and it clears when served', () => {
    const def = stDoor().definition
    const installed = registry.installUserDefinitions([def])
    expect(installed.errors).toEqual([])
    try {
      const fake = createFakeChart()
      const binder = createBinder({ chart: fake.chart, LWC: fake.LWC, scope: 'div4r1' })
      const cs = addInstance(mergeChartSettings({}), def.id, registry)
      const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
      const candles = fake.chart.addSeries(fake.LWC.CandlestickSeries || 'CandlestickSeries', {}, 0)
      const sync = (listing) => binder.sync({
        priceSeries: () => candles, setBarColours: () => {}, enabled: true, cs, instances, registry,
        bars: ST_BARS, tf: 'D', symbol: ST_CTX.symbol, newestBarIsForming: false, historyFromListing: listing,
        adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
        resolvePlacement: () => ({ paneIndex: 0, scaleId: def.id, scaleOptions: {} }),
      })
      sync(false)
      const said = runtimeErrorNotices('div4r1').map(([, s]) => s).join(' | ')
      expect(said).toBe("The colours from `barcolor` (line 56) aren't shown on this chart: this chart's bars don't start "
        + "at the symbol's first trading day, and the colours are only worked out bar by bar from there, so the candles "
        + 'keep their own colours.')
      sync(true)
      expect(runtimeErrorNotices('div4r1')).toEqual([])
      binder.teardown()
    } finally {
      registry.uninstallUserDefinition(def.id)
    }
  })
})

describe('⛔ DIV-4 r1 — a reached runtime.error, and a script below v4', () => {
  it('a reached `runtime.error` draws no run colour either', () => {
    const src = SRC.replace('plot(ta.sma(close, len), "c")',
      'plot(ta.sma(close, len), "c")\nif bar_index == 40\n    runtime.error("stop")')
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const d = memberPaneDefinition({ source: src, id: 'u_00000000d4c1', name: 'rte' })
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.compute.runtimeColours).toBeTruthy()
    const cols = registry.computeFor(d.definition, BARS, undefined,
      { tf: 'D', symbol: 'AMEX:SPY', historyFromListing: true, newestBarIsForming: false })
    const stop = registry.runtimeErrorStopOf(cols)
    expect(stop && stop.reached).toBe(true)
    expect(cols.rtcolour1).toBeUndefined()
    expect(registry.columnErrors(cols).rtcolour1.guard).toBe(registry.RUNTIME_COLOUR_GUARD)
    // the member reads the script's own stop, not a run failure; the code rides apart
    expect(registry.columnErrors(cols).rtcolour1.message).toMatch(/stops itself with its own error/)
    expect(registry.columnErrors(cols).rtcolour1.code).toBe(registry.RUNTIME_ERROR_GUARD)
  })
  it('a v3 script is not lifted', () => {
    const v3 = [
      '//@version=3',
      'study("div4 v3", overlay = true)',
      'hi = highest(high, 3)[1]',
      'lo = lowest(low, 3)[1]',
      // ⭐ engine 50: declared once, then updated with `:=` — the v3 spelling TradingView compiles.
      // (`trend = … nz(trend[1], 1)` reads its own history in its declaration, does not compile in
      // v3+, and since engine 50 refuses `pine:cycle` at every door even when only a paint reads it.)
      'trend = 0',
      'trend := close > hi ? 1 : close < lo ? -1 : nz(trend[1], 1)',
      'b = barssince(trend == 1 and trend[1] == -1)',
      's = barssince(trend == -1 and trend[1] == 1)',
      'plot(close)',
      'barcolor(b < s ? green : b > s ? red : na)',
      '',
    ].join('\n')
    const t = translatePine(v3, { strict: true })
    expect(t.presentation.paints[0].withheld.code).toBe('paint:colour')
    expect(t.presentation.paints[0][PAINT_RUNTIME_COLOUR]).toBeTruthy()
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const d = memberPaneDefinition({ source: v3, id: 'u_00000000d4c2', name: 'v3' })
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.compute.runtimeColours).toBeUndefined()
  })
})

// ─── r2 — what the member READS: a plain cause for every gate and every run refusal ────
const TOKEN = /\b(runtime|pine|pane):/

describe('⭐⭐ DIV-4 r2 — the strip names the cause in plain words, never a code', () => {
  const stripOf = (def, cols) => {
    const st = registry.runtimeColourStopOf(def, cols)
    return st ? st.sentence : ''
  }
  const CAUSES = [
    // [what is refused, how it is caused, the plain cause the member must read]
    ['not from the listing', { ctx: { ...ST_CTX, historyFromListing: false } }, /first trading day/],
    ['a moved setting', { inputs: 'moved' }, /changed from the script's default/],
    ['the build flag off', { build: false }, /isn't part of this version of the app/],
    ['the permission off', { permit: false }, /switched off for your account/],
    ['the kill list', { kill: true }, /this script is switched off for running bar by bar/],
    ['the allowlist', { allow: false }, /hasn't been checked against TradingView/],
    ['the lane not loaded', { fn: null }, /still loading/],
    ['a bar the probes disagree on', { fn: 'unknown' }, /can't be worked out exactly/],
    ['a column of the wrong length', { fn: 'short' }, /can't be run bar by bar here/],
  ]
  // the run's own refusal classes (`runtimeObjectValues`' reasons), each to its plain cause
  const RUN = [
    ['runtime:empty', /can't be run bar by bar here/],
    ['runtime:build', /can't be run bar by bar here/],
    ['runtime:lower', /can't be run bar by bar here/],
    ['runtime:object-kind', /can't be run bar by bar here/],
    ['pine:function', /can't be run bar by bar here/],
    ['runtime:TypeError', /can't be run bar by bar here/],
    ['runtime:limit', /more work than a chart is allowed/],
    ['runtime:TOTAL_INSTRUCTIONS', /more work than a chart is allowed/],
    ['runtime:LOOP_ITERATIONS', /more work than a chart is allowed/],
    ['runtime:INSTRUCTIONS_PER_BAR', /more work than a chart is allowed/],
    ['runtime:request', /another symbol or timeframe/],
    ['runtime:clock-zone', /time zone isn't known/],
    ['runtime:runtime.error', /stops itself with its own error/],
    ['runtime:not-from-listing', /first trading day/],
    ['runtime:member-inputs', /changed from the script's default/],
  ]
  const run = (how) => {
    const d = stDoor()
    const real = registeredObjectRuntimeValues()
    if (how.build === false) vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    if (how.permit === false) __resetRuntimePanePermission()
    if (how.kill) setRuntimeKillList([runtimeSourceHash(ST)])
    if (how.allow === false) __resetRuntimeAllowList()
    if ('fn' in how) {
      registerObjectRuntimeValues(how.fn === null ? null
        : how.fn === 'unknown' ? (rt, bars, c) => {
          const v = real(rt, bars, c)
          return { ...v, unknown: v.unknown.map(() => { const m = new Uint8Array(bars.length); m[3] = 1; return m }) }
        }
          : how.fn === 'short' ? () => ({ served: true, reason: null, cols: [new Float64Array(2)], unknown: [null] })
            : (() => ({ served: false, reason: how.fn, cols: [], unknown: [] })))
    }
    try {
      const inputs = how.inputs === 'moved'
        ? (() => { const i = d.definition.inputs.find((x) => typeof x.default === 'number'); return { [i.key]: i.default + 1 } })()
        : undefined
      const cols = registry.computeFor(d.definition, ST_BARS, inputs, how.ctx || ST_CTX)
      return { cols, def: d.definition }
    } finally {
      registerObjectRuntimeValues(real)
    }
  }
  for (const [what, how, cause] of CAUSES) {
    it(`${what}: the member reads the cause, and no code`, () => {
      const { cols, def } = run(how)
      expect(cols.rtcolour1).toBeUndefined()
      const e = registry.columnErrors(cols).rtcolour1
      expect(e.message).toMatch(cause)
      expect(e.message).not.toMatch(TOKEN)
      expect(typeof e.code).toBe('string') // the code is kept, apart, for diagnostics
      const strip = stripOf(def, cols)
      expect(strip).toMatch(cause)
      expect(strip).not.toMatch(TOKEN)
    })
  }
  for (const [code, cause] of RUN) {
    it(`the run refuses ${code}: the member reads the cause, and no code`, () => {
      const { cols, def } = run({ fn: code })
      const e = registry.columnErrors(cols).rtcolour1
      expect(e.code).toBe(code)
      expect(e.message).toMatch(cause)
      const strip = stripOf(def, cols)
      expect(strip).toMatch(cause)
      expect(strip).not.toMatch(TOKEN)
    })
  }

  it('⭐ the run is asked with ONE spec per document, so its own memo can answer the second paint', () => {
    const d = stDoor()
    const real = registeredObjectRuntimeValues()
    const seen = []
    try {
      registerObjectRuntimeValues((rt, bars, c) => { seen.push(rt); return real(rt, bars, c) })
      registry.computeFor(d.definition, ST_BARS, undefined, ST_CTX)
      registry.computeFor(d.definition, ST_BARS, undefined, ST_CTX)
    } finally {
      registerObjectRuntimeValues(real)
    }
    expect(seen).toHaveLength(2)
    expect(seen[1]).toBe(seen[0])
  })
})

describe('⭐ DIV-4 r3 — every limit the VM declares reads as a limit', () => {
  it('each `runtime:<LIMIT_NAME>` the run can stop with is the limit sentence', async () => {
    const { LIMIT_NAMES } = await import('../../engine/runtime/limits')
    expect(LIMIT_NAMES.length).toBeGreaterThan(5)
    for (const n of LIMIT_NAMES) {
      expect(registry.runtimeColourWhy(`runtime:${n}`), n).toMatch(/more work than a chart is allowed/)
    }
    // control: an unrelated code is not called a limit
    expect(registry.runtimeColourWhy('runtime:build')).not.toMatch(/more work/)
  })
})
