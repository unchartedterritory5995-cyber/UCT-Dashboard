// app/src/components/chart/builder/memberPane/wsePresentationFromRun.test.js
//
// ─── ⭐⭐ PHASE 3 WS-E — DRAWING AND PRESENTATION FROM THE RUN ────────────────
//
// Rails for what a runtime document now DRAWS, asserted on what the renderer is
// handed — the binder's points and markers, the render state's lines and labels,
// the paint colours — never on a program count. (A rail that counted programs is
// what let a NO-GO through in Phase 2.) Each rule carries a control that must come
// out the other way, so a rail that answers the same for everything cannot pass.
//
//   1. `offset`: a leftward displacement is carried (`plots[].displace`) and drawn
//      where Pine draws it; a setting it reads is pinned; what cannot be read
//      before the run, or points right, stays withheld by name.
//   2. The run's own drawings replace a host object program that LOST drawings
//      (a guard on `var` state, a drawing in a loop) or that the value build
//      cannot stand without (a getter in one arm of `?:`). A clean host program
//      keeps drawing.
//   3. A document whose only output is a bar colour the run computes is a document.
//   4. A run-owned drawing the chart cannot place still reaches the member's note.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

import { memberPaneDefinition } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { computeRuntimeColumns } from '../../engine/runtime/runtimeColumns'
import { runtimeObjectsOf } from '../../engine/runtime/runtimeObjects'
import { toRenderState } from '../../engine/objectRenderState'
import { isArmSafeObjectOp } from '../../engine/runtime/objectStore'
import { createBinder, paintColoursFor } from '../../engine/binder'
import { bindingKey } from '../../engine/pool'
import { createFakeChart } from '../../engine/__tests__/fakeChart'
import { addInstance } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { objectRenderDropsFor, resetObjectRenderDrops } from '../../engine/objectRenderNotice'
import { toProductBars } from '../../engine/__tests__/vendorHarness/ourSide'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const H = '//@version=6\nindicator("t", overlay = true)\n'
const ID = 'u_wse-presentation'
const N = 260
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 9) + i * 0.1
  return { t: 1700000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + (i % 7) }
})
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }

const flags = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
}
const door = (source) => memberPaneDefinition({ source, id: ID, name: 'T' })
/** The document installed and run as the worker runs it. */
function runDoc(d) {
  const { installed, errors } = registry.installUserDefinitions([d.definition])
  expect(errors).toEqual([])
  return computeRuntimeColumns(installed[0], BARS, CTX)
}
/** The running total the host lane cannot fold (a runtime-only value). */
const accOf = () => { let a = 0; return BARS.map((b) => (a += b.c)) }

/** The real binder over the recording chart, fed the run's columns. */
function bind(def, cols) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const reg = {
    getDefinition: (id) => (id === def.id ? def : null),
    computeFor: () => cols,
    hasAnyFinite: (col) => Array.from(col || []).some(Number.isFinite),
    columnKeys: (x) => (x.plots || []).map((p) => p.key),
  }
  const markerSets = []
  binder.sync({
    enabled: true,
    instances: [{ instanceId: `inst:${def.id}:1`, defId: def.id, inputs: {} }],
    registry: reg,
    bars: BARS,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    resolvePlacement: () => ({ paneIndex: 0, scaleId: 's', scaleOptions: {} }),
    createSeriesMarkers: (_s, first) => { markerSets.push(first); return { setMarkers: (m) => markerSets.push(m) } },
  })
  const setData = fake.calls.filter((c) => c.method === 'setData').map((c) => c.args[0])
  binder.teardown()
  return { setData, markerSets }
}
const valuesAt = (pts) => pts.map((p) => (p && 'value' in p ? p.value : null))

afterEach(() => { registry.uninstallUserDefinition(ID); vi.unstubAllEnvs() })

// ─── 1. offset ───────────────────────────────────────────────────────────────

describe('WS-E 1 — a runtime row written with `offset`', () => {
  const ACC = 'var float acc = 0\nacc += close\n'

  it('⭐⭐ `offset = -n` (an input) is drawn n bars LEFT; the input is pinned at its default, by name', () => {
    flags()
    const d = door(`${H}n = input.int(3, "N")\n${ACC}plot(acc, "acc", offset = -n)\n`)
    expect(d.ok, d.reason).toBe(true)
    expect(d.lane).toBe('runtime')
    const plot = d.definition.plots.find((p) => p.label === 'acc')
    expect(plot.displace).toBe(-3)
    expect((d.definition.inputs || []).map((i) => i.key)).not.toContain('n')
    expect(d.notes.find((x) => x.name === 'Settings').note).toMatch(/`n` \(it sets where a plot is drawn \(`offset`\)/)
    const cols = runDoc(d)
    const { setData } = bind(d.definition, cols)
    const pts = setData.find((s) => s.length === N)
    const acc = accOf()
    // bar j shows the value computed at bar j + 3; the last 3 bars carry no point
    expect(pts.map((p) => p.time)).toEqual(BARS.map((b) => b.t))
    const v = valuesAt(pts)
    expect(v[10]).toBeCloseTo(acc[13], 6)
    expect(v[N - 4]).toBeCloseTo(acc[N - 1], 6)
    expect(v.slice(N - 3)).toEqual([null, null, null])
  })

  it('⛔ CONTROL — the same row with no `offset` is drawn where it was computed, and `n` stays a setting', () => {
    flags()
    const d = door(`${H}n = input.int(3, "N")\n${ACC}plot(acc + n, "acc")\n`)
    expect(d.ok, d.reason).toBe(true)
    const plot = d.definition.plots.find((p) => p.label === 'acc')
    expect(plot.displace).toBeUndefined()
    expect((d.definition.inputs || []).map((i) => i.key)).toContain('n')
    const v = valuesAt(bind(d.definition, runDoc(d)).setData.find((s) => s.length === N))
    expect(v[10]).toBeCloseTo(accOf()[10] + 3, 6)
    expect(v[N - 1]).toBeCloseTo(accOf()[N - 1] + 3, 6)
  })

  it('⭐⭐ a plotshape with `offset = -2` puts its glyph on the bar two LEFT of the bar that fired it', () => {
    flags()
    const d = door(`${H}${ACC}plotshape(bar_index % 50 == 10 and acc > 0, "m", shape.circle, location.abovebar, offset = -2)\n`)
    expect(d.ok, d.reason).toBe(true)
    const plot = d.definition.plots.find((p) => p.label === 'm')
    expect(plot.displace).toBe(-2)
    const { markerSets } = bind(d.definition, runDoc(d))
    const last = markerSets[markerSets.length - 1]
    expect(last.map((m) => m.time)).toEqual([10, 60, 110, 160, 210].map((i) => BARS[i - 2].t))
  })

  it('⭐ a name bound ONCE to an input expression resolves (wyckoff\'s `offsetVal = -pivotLen`)', () => {
    flags()
    const d = door(`${H}len = input.int(4, "L")\noffs = -len\n${ACC}plot(acc, "acc", offset = offs)\n`)
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.plots.find((p) => p.label === 'acc').displace).toBe(-4)
    expect((d.definition.inputs || []).map((i) => i.key)).not.toContain('len')
  })

  it('⭐ a TWAP-style `offset = offset` at 0 draws undisplaced, and pins the setting that would move it', () => {
    flags()
    const d = door(`${H}offset = input(0, "Offset")\n${ACC}plot(acc, "acc", offset = offset)\n`)
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.plots.find((p) => p.label === 'acc').displace).toBeUndefined()
    expect((d.definition.inputs || []).map((i) => i.key)).not.toContain('offset')
  })

  it('⛔ a RIGHTWARD offset stays withheld, by name', () => {
    flags()
    const d = door(`${H}${ACC}plot(acc, "acc", offset = 2)\n`)
    expect(d.ok).toBe(false)
    expect(d.runtimeDeclined.code).toBe('runtime:withheld-all')
    expect(d.runtimeDeclined.why).toMatch(/2 bars to the RIGHT/)
  })

  it('⛔ an offset read through a REASSIGNED name stays withheld — its value is not known before the run', () => {
    flags()
    const d = door(`${H}k = 1\nk := 2\n${ACC}plot(acc, "acc", offset = -k)\n`)
    expect(d.ok).toBe(false)
    expect(d.runtimeDeclined.why).toMatch(/not a whole number this door can read before the run/)
  })
})

// ─── 2. the run's own drawings ───────────────────────────────────────────────

describe('WS-E 2 — the run draws what the host object program lost', () => {
  const ACC = 'var float acc = 0\nacc += close\nplot(acc)\n'
  const HOST_LABELS = 'if bar_index % 50 == 0\n    label.new(bar_index, close, "x")\n'
  // `acc > 20000` is first true on bar 191 here (a guard on `var` state)
  const FIRST = accOf().findIndex((a) => a > 20000)

  it('⭐⭐ a line created under a guard on `var` state: the host program dropped it, the run draws it', () => {
    flags()
    const d = door(`${H}${ACC}${HOST_LABELS}var line l = na\nif acc > 20000 and na(l)\n`
      + '    l := line.new(bar_index - 1, close, bar_index, close)\n')
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.compute.objects).toBe(true)
    expect(d.definition.objects).toBeFalsy()
    const payload = runtimeObjectsOf(runDoc(d))
    const rs = toRenderState(payload.live, { bars: BARS, tf: 'D', pineVersion: payload.pineVersion })
    expect(rs.labels.map((l) => l.bx)).toEqual([0, 50, 100, 150, 200, 250])
    expect(rs.lines).toHaveLength(1)
    expect(rs.lines[0].bx1).toBe(FIRST - 1)
    expect(rs.lines[0].bx2).toBe(FIRST)
    expect(rs.lines[0].y1).toBeCloseTo(BARS[FIRST].c, 9)
  })

  it('⭐⭐ drawings made in a LOOP under that guard: three labels per firing bar, each at its own price', () => {
    flags()
    const d = door(`${H}${ACC}${HOST_LABELS}if acc > 20000 and bar_index % 40 == 0\n`
      + '    for i = 0 to 2\n        label.new(bar_index, close + i, "L")\n')
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.compute.objects).toBe(true)
    const payload = runtimeObjectsOf(runDoc(d))
    const rs = toRenderState(payload.live, { bars: BARS, tf: 'D', pineVersion: payload.pineVersion })
    const loop = rs.labels.filter((l) => l.text === 'L')
    const fire = BARS.map((_, i) => i).filter((i) => accOf()[i] > 20000 && i % 40 === 0)
    expect(fire.length).toBeGreaterThan(0)
    expect(loop.map((l) => l.bx)).toEqual(fire.flatMap((i) => [i, i, i]))
    expect(loop.map((l) => l.y)).toEqual(fire.flatMap((i) => [0, 1, 2].map((k) => BARS[i].c + k)))
  })

  it('⭐⭐ a handle held in a `var` and read back with a getter in one arm of `?:`', () => {
    flags()
    const d = door(`${H}${ACC}${HOST_LABELS}var line l = na\nif acc > 20000 and na(l)\n`
      + '    l := line.new(bar_index - 1, close, bar_index, close)\nplot(na(l) ? na : line.get_y1(l), "y1")\n')
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.compute.objects).toBe(true)
    const cols = runDoc(d)
    const key = d.definition.plots.find((p) => p.label === 'y1').key
    const v = valuesAt(bind(d.definition, cols).setData.find((s) => valuesAt(s).some((x) => x === BARS[FIRST].c)) || [])
    // before the line exists the getter's arm is not taken: nothing drawn
    expect(Number.isNaN(cols[key][FIRST - 1])).toBe(true)
    expect(cols[key][FIRST]).toBeCloseTo(BARS[FIRST].c, 9)
    expect(cols[key][N - 1]).toBeCloseTo(BARS[FIRST].c, 9)
    expect(v[FIRST]).toBeCloseTo(BARS[FIRST].c, 9)
    const payload = runtimeObjectsOf(cols)
    expect(toRenderState(payload.live, { bars: BARS, tf: 'D' }).lines).toHaveLength(1)
  })

  it('⛔ CONTROL — a getter in an arm is not a licence to MAKE a drawing there', () => {
    flags()
    const d = door(`${H}${ACC}${HOST_LABELS}x = acc > 20000 ? label.new(bar_index, close, "y") : na\n`)
    expect(d.ok).toBe(false)
    expect(d.runtimeDeclined.why).toMatch(/one arm of `\?:`/)
  })

  it('⛔ CONTROL — a host object program that is CLEAN keeps drawing; the run does not take it', () => {
    flags()
    const d = door(`${H}${ACC}${HOST_LABELS}`)
    expect(d.ok, d.reason).toBe(true)
    expect(d.lane).toBe('runtime')
    expect(d.definition.compute.objects).toBeUndefined()
    expect(d.definition.objects).toBeTruthy()
  })
})

// ─── 3. a bar colour from the run, alone ─────────────────────────────────────

describe('WS-E 3 — a document whose only output is a bar colour the run computes', () => {
  const SUM = 'float s = 0.0\nfor i = 0 to 4\n    s += close[i]\n'

  it('⭐⭐ attaches, and the paint colours bar by bar are the run\'s', () => {
    flags()
    const d = door(`${H}${SUM}barcolor(s > s[1] ? color.green : na)\n`)
    expect(d.ok, d.reason).toBe(true)
    expect(d.lane).toBe('runtime')
    expect(d.definition.paints).toHaveLength(1)
    const paint = d.definition.paints[0]
    expect(paint.kind).toBe('barcolor')
    const cols = runDoc(d)
    const instanceId = 'inst:x'
    const columns = new Map(Object.entries(cols).map(([k, v]) => [bindingKey(instanceId, k), v]))
    const colours = paintColoursFor(paint, instanceId, columns, N)
    const sum = (i) => [0, 1, 2, 3, 4].reduce((a, k) => a + (i - k >= 0 ? BARS[i - k].c : NaN), 0)
    let painted = 0
    for (let i = 6; i < N; i += 1) {
      const up = sum(i) > sum(i - 1)
      if (up) { expect(colours[i], `bar ${i}`).toMatch(/^#4CAF50/i); painted += 1 } else expect(colours[i] === null || /^rgba\(0, 0, 0, 0\)|#00000000/.test(String(colours[i])), `bar ${i}: ${colours[i]}`).toBe(true)
    }
    expect(painted).toBeGreaterThan(10)
  })

  it('⛔ CONTROL — the same script with its paint hidden still draws nothing, and says so', () => {
    flags()
    const d = door(`${H}${SUM}barcolor(s > s[1] ? color.green : na, display = display.none)\n`)
    expect(d.ok).toBe(false)
    expect(d.runtimeDeclined.code).toBe('runtime:nothing-drawn')
  })
})

// ─── 4. the member still reads what the chart could not place ────────────────

describe('WS-E 4 — a run-owned drawing the chart cannot place reaches the drawing note', () => {
  beforeEach(() => { resetObjectRenderDrops() })
  afterEach(() => { resetObjectRenderDrops() })
  // the labels stand under a guard on `var` state, which the host program drops
  const SRC = (x) => `${H}var float acc = 0\nacc += close\nif barstate.islast and acc > 0\n`
    + '    label.new(bar_index, high, str.tostring(acc, "#"))\n'
    + `    label.new(${x}, low, "where", xloc = xloc.bar_time)\n`

  // RDDT's daily bars (date-keyed, from the listing): a future noon has no bar
  const RDDT = toProductBars(JSON.parse(fs.readFileSync(path.join(path.resolve(process.cwd(), '..'),
    'tests/fixtures/vendor/harness/poor-man039s-volume-profile-rddt-1d-2026-09-28.json'), 'utf8')))
  const rddtAcc = () => RDDT.reduce((a, b) => a + b.c, 0)
  function mount(source) {
    flags()
    const d = door(source)
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.compute.objects).toBe(true)
    registry.installUserDefinitions([d.definition])
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const cs = addInstance(mergeChartSettings({}), d.definition.id, registry)
    const instances = (cs.indicatorInstances || []).filter((i) => i.defId === d.definition.id)
    const layers = []
    binder.sync({
      enabled: true, cs, instances, registry, bars: RDDT, tf: 'D',
      symbol: { ticker: 'T', exchange: 'X' }, newestBarIsForming: false, historyFromListing: true,
      adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 0, scaleId: d.definition.id, scaleOptions: {} }),
      createObjectLayer: () => ({ set: (state) => layers.push(state), clear: () => {} }),
    })
    return { binder, id: instances[0].instanceId, layers }
  }

  it('⭐ a label at a future noon (no bar holds it) is counted into the note; the placed one is drawn', () => {
    const m = mount(SRC('time + 3 * 86400000 + 9000000'))
    const drawn = m.layers.filter(Boolean).pop()
    expect(drawn && drawn.labels.map((l) => l.text)).toEqual([String(Math.round(rddtAcc()))])
    expect(objectRenderDropsFor(m.id)).toEqual({ dropped: 1, held: 2 })
    m.binder.teardown()
  })

  it('⛔ CONTROL — both labels placeable ⇒ nothing counted', () => {
    const m = mount(SRC('time'))
    expect(m.layers.filter(Boolean).pop().labels).toHaveLength(2)
    expect(objectRenderDropsFor(m.id)).toBe(null)
    m.binder.teardown()
  })
})

// ─── the arm rule, by name ───────────────────────────────────────────────────

describe('WS-E — which drawing calls may stand in an arm of `?:` (`isArmSafeObjectOp`)', () => {
  it('⭐ a named family\'s getter and `.all` read; nothing that makes, writes, stops or dispatches does', () => {
    for (const n of ['line.get_y1', 'label.get_text', 'box.get_top', 'linefill.get_line1', 'line.all', 'table.all']) {
      expect(isArmSafeObjectOp(n), n).toBe(true)
    }
    for (const n of ['line.new', 'label.new', 'line.set_x2', 'line.delete', 'line.copy', 'table.cell',
      'line.get_price', 'any.get_y1', 'polyline.new', 'nope.get_x']) {
      expect(isArmSafeObjectOp(n), n).toBe(false)
    }
  })
})

// ─── 5. `calc_bars_count`: the run takes the chart's last N bars ─────────────

describe('WS-E 5 — `calc_bars_count = 100` on a 260-bar chart', () => {
  const SRC = '//@version=6\nindicator("t", overlay = true, calc_bars_count = 100)\n'
    + 'var float acc = 0\nacc += close\nplot(acc, "acc")\n'
    // ⭐ WS-E review H1 — the condition is on PRICE (a turn up), not `bar_index % 50`:
    // which bars a phase of `bar_index` picks in the window is uncaptured (Q-WSE1) and
    // refused by name (`wseReviewFixes.test.js`).
    + 'if close > close[1] and close[1] <= close[2] and acc > 0\n    label.new(bar_index, close, "w")\n'

  it('⭐⭐ nothing is drawn before the window; the state starts on its first bar; drawings sit on chart bars', () => {
    flags()
    const d = door(SRC)
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.compute.objects).toBe(true)
    const cols = runDoc(d)
    const key = d.definition.plots.find((p) => p.label === 'acc').key
    expect(cols[key]).toHaveLength(N)
    expect(cols[key].slice(0, 160).every(Number.isNaN)).toBe(true)
    let a = 0
    const want = BARS.slice(160).map((b) => (a += b.c))
    expect(cols[key][160]).toBeCloseTo(want[0], 9)
    expect(cols[key][N - 1]).toBeCloseTo(want[99], 9)
    const v = valuesAt(bind(d.definition, cols).setData.find((s) => s.length === N))
    expect(v.slice(0, 160).every((x) => x === null)).toBe(true)
    const payload = runtimeObjectsOf(cols)
    const rs = toRenderState(payload.live, { bars: BARS, tf: 'D', pineVersion: payload.pineVersion })
    const turns = []
    for (let i = 162; i < N; i += 1) if (BARS[i].c > BARS[i - 1].c && BARS[i - 1].c <= BARS[i - 2].c) turns.push(i)
    expect(turns.length).toBeGreaterThan(0)
    expect(rs.labels.map((l) => l.bx)).toEqual(turns)
    expect(rs.labels.map((l) => l.x)).toEqual(turns.map((i) => BARS[i].t))
  })
})

// ─── 6. a name TYPED `color` holds a colour, whatever its initialiser ────────

describe('WS-E 6 — a per-bar barcolor through a name declared `color`', () => {
  const SUM = 'float s = 0.0\nfor i = 0 to 4\n    s += close[i]\n'
  const paintedBy = (d) => {
    const cols = runDoc(d)
    const instanceId = 'inst:x'
    const columns = new Map(Object.entries(cols).map(([k, v]) => [bindingKey(instanceId, k), v]))
    return paintColoursFor(d.definition.paints[0], instanceId, columns, N)
  }
  const sum = (i) => [0, 1, 2, 3, 4].reduce((a, k) => a + (i - k >= 0 ? BARS[i - k].c : NaN), 0)

  it('⭐⭐ `var color trend = na` carried bar to bar: the bar colours are the run\'s, green and red where Pine paints them', () => {
    flags()
    const d = door(`${H}${SUM}var color trend = na\nif s > s[1]\n    trend := color.green\nelse if s < s[1]\n    trend := color.red\nbarcolor(trend)\n`)
    expect(d.ok, d.reason || (d.runtimeDeclined && d.runtimeDeclined.why)).toBe(true)
    expect(d.lane).toBe('runtime')
    expect(d.definition.paints).toHaveLength(1)
    const colours = paintedBy(d)
    let want = null
    let green = 0
    let red = 0
    for (let i = 6; i < N; i += 1) {
      if (sum(i) > sum(i - 1)) want = 'g'
      else if (sum(i) < sum(i - 1)) want = 'r'
      if (want === 'g') { expect(colours[i], `bar ${i}`).toMatch(/^#4CAF50/i); green += 1 }
      if (want === 'r') { expect(colours[i], `bar ${i}`).toMatch(/^#F23645|^#FF5252/i); red += 1 }
    }
    expect(green).toBeGreaterThan(10)
    expect(red).toBeGreaterThan(10)
  })

  it('⭐ `color c = na` assigned in an `if` and read in a `?:` arm against `na`', () => {
    flags()
    const d = door(`${H}${SUM}color c = na\nif s > s[1]\n    c := color.green\nbarcolor(s > 0 ? c : na)\n`)
    expect(d.ok, d.reason || (d.runtimeDeclined && d.runtimeDeclined.why)).toBe(true)
    const colours = paintedBy(d)
    for (let i = 6; i < N; i += 1) {
      if (sum(i) > sum(i - 1)) expect(colours[i], `bar ${i}`).toMatch(/^#4CAF50/i)
      else expect(colours[i] === null || /^rgba\(0, 0, 0, 0\)|#00000000/.test(String(colours[i])), `bar ${i}: ${colours[i]}`).toBe(true)
    }
  })

  it('⛔ CONTROL — the same script typed `float` still refuses: a number is not a colour', () => {
    flags()
    const d = door(`${H}${SUM}var float trend = na\nif s > s[1]\n    trend := 1.0\nbarcolor(trend)\n`)
    expect(d.ok).toBe(false)
    expect(d.runtimeDeclined.code).toBe('runtime:colour')
  })

  it('⛔ CONTROL — a name typed `color` in one place and declared untyped in another is not trusted', () => {
    flags()
    const d = door(`${H}${SUM}f() =>\n    color trend = color.red\n    trend\nvar trend = 0.0\nif s > s[1]\n    trend := 1.0\nbarcolor(trend)\nplot(f() == color.red ? 1 : 0)\n`)
    expect(d.ok).toBe(false)
    expect(d.runtimeDeclined.code).toBe('runtime:colour')
  })
})

// ─── 7. a fill from the run is named, never silently dropped ─────────────────

describe('WS-E 7 — a run\'s fills are named in the document\'s "Not drawn" note', () => {
  const ACC = 'var float acc = 0.0\nacc += close\np1 = plot(acc, "A")\np2 = plot(acc * 0.9, "B")\n'
  const notDrawn = (d) => (d.notes || []).find((n) => n.name === 'Not drawn by this pane')

  it('⭐⭐ a GRADIENT fill no longer declines the script: its lines draw, and the fill is named', () => {
    flags()
    const d = door(`${H}${ACC}fill(p1, p2, acc, acc * 0.9, color.new(color.green, 50), color.new(color.red, 50))\n`)
    expect(d.ok, d.runtimeDeclined && d.runtimeDeclined.why).toBe(true)
    expect(d.lane).toBe('runtime')
    expect(d.definition.plots.filter((p) => !p.hidden).map((p) => p.label)).toEqual(['A', 'B'])
    expect(notDrawn(d) && notDrawn(d).note).toMatch(/a fill between two plots/)
  })

  it('⭐ a SOLID fill from the run is named too (it was dropped with nothing said)', () => {
    flags()
    const d = door(`${H}${ACC}fill(p1, p2, color = color.new(color.green, 80))\n`)
    expect(d.ok).toBe(true)
    expect(notDrawn(d) && notDrawn(d).note).toMatch(/a fill between two plots/)
  })

  it('⛔ CONTROL — the same lines with no fill carry no "Not drawn" note', () => {
    flags()
    const d = door(`${H}${ACC}`)
    expect(d.ok).toBe(true)
    expect(notDrawn(d)).toBeUndefined()
  })
})
