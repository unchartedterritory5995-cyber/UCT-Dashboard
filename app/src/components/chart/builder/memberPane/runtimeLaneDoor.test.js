// app/src/components/chart/builder/memberPane/runtimeLaneDoor.test.js
//
// ─── THE RUNTIME-LANE FALLBACK AT THE MEMBER DOOR (2026-09-27) ───────────────
//
// `memberPaneDefinition` — the call `MemberPane` makes — end to end, through the
// REAL install door, `computeFor` and binder. Nothing on the path is mocked; the
// only thing stubbed is the build flag, which is the thing under test.
//
//   · OFF: every script is answered exactly as before
//   · ON:  a script the host refuses for a value-model limit attaches through the
//          runtime lane; the host stays authoritative whenever it succeeds; a
//          ruling refusal is never routed around; a double refusal names both walls
//   · the pane draws it through the SAME renderer: host-read presentation, the
//     runtime lane's own per-bar colour, the partial-drawing rule on its objects
//   · the runtime door draws the same numbers the host door draws, where both can
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { memberPaneDefinition } from './memberPaneDefinition'
import { runtimeLaneDefinition } from './runtimeLaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { createBinder } from '../../engine/binder'
import { addInstance } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from '../../engine/__tests__/fakeChart'
import { pineColourHex } from '../../engine/pinePalette'
import { hexToPacked } from '../../engine/runtime/colours'
import { toCss } from '../../engine/colorInt'
import { DRAWING_NOTE_NAME } from '../../engine/ast/objectLoss'

afterEach(() => {
  vi.unstubAllEnvs()
  for (const d of registry.listUserDefinitions()) registry.uninstallUserDefinition(d.id)
})

const REPO = path.resolve(process.cwd(), '..')
const corpus = (name) => fs.readFileSync(path.join(REPO, 'corpus/committed', `${name}.pine`), 'utf8')
const ADX = 'adx-and-di-for-v4__932'
const on = () => vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
const off = () => vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '')

const SPY = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json'), 'utf8'))
  .bars.slice(-600).map((b, i) => ({ ...b, t: 1700000000 + i * 86400 }))
const CTX = { tf: 'D', newestBarIsForming: false }

function installAndCompute(definition, bars = SPY, inputs = undefined) {
  const { installed, errors } = registry.installUserDefinitions([definition])
  expect(errors, 'the install door refused').toEqual([])
  return { def: installed[0], cols: registry.computeFor(installed[0], bars, inputs, CTX) }
}

describe('⛔ the flag OFF — the door answers exactly as it did before', () => {
  it('a host-refused script is refused with the host sentence and nothing else', () => {
    off()
    const d = memberPaneDefinition({ source: corpus(ADX), id: 'u_member-pane-off' })
    expect(d.ok).toBe(false)
    expect(d.guard).toBe('pine:state')
    expect(d.reason).not.toMatch(/second engine/)
    expect(d.lane).toBeUndefined()
    expect(d.runtimeRefusal).toBeUndefined()
  })
})

describe('⭐⭐ the flag ON — a script the host lane refuses attaches through the runtime lane', () => {
  it('adx-and-di: a runtime document, drawn with the author\'s titles and v4 colours', () => {
    on()
    const d = memberPaneDefinition({ source: corpus(ADX), id: 'u_member-pane-adx' })
    expect(d.ok, d.reason).toBe(true)
    expect(d.lane).toBe('runtime')
    expect(d.hostRefusal.guard).toBe('pine:state')
    expect(d.definition.compute.kind).toBe('pine')
    expect(d.definition.meta.pineLane).toBe('runtime')
    const rows = d.rows.filter((r) => !r.colourFor)
    expect(rows.map((r) => r.label)).toEqual(['DI+', 'DI-', 'ADX'])
    // ⭐ colours come through the host's reader, i.e. `pinePalette.js` BY VERSION (v4)
    expect(rows.map((r) => r.color)).toEqual(['green', 'red', 'navy'].map((c) => pineColourHex(c, 4)))
    // the hline is said, not dropped
    expect(d.notes.map((n) => n.note).join(' ')).toMatch(/hline.*line 32/)
    const { cols } = installAndCompute(d.definition)
    expect(registry.columnErrors(cols)).toEqual({})
    for (const r of rows) {
      const finite = Array.from(cols[r.key]).filter(Number.isFinite).length
      expect(finite, r.label).toBeGreaterThan(500)
    }
  })

  it('⭐ a knob moves the drawn series; a knob that moves nothing drawn is withheld and said', () => {
    on()
    const d = memberPaneDefinition({ source: corpus(ADX), id: 'u_member-pane-adxk' })
    const keys = d.definition.inputs.map((i) => i.key)
    expect(keys).toContain('pine_len')
    // `th` is read only by `hline(th)` (line 32), which this pane does not draw
    expect(keys).not.toContain('pine_th')
    expect(d.notes.map((n) => n.note).join(' ')).toMatch(/`th` only sets something this pane does not draw/)
    const a = installAndCompute(d.definition, SPY, { pine_len: 14 })
    const b = installAndCompute(d.definition, SPY, { pine_len: 30 })
    const di = d.rows.find((r) => r.label === 'DI+').key
    expect(Array.from(a.cols[di])).not.toEqual(Array.from(b.cols[di]))
  })

  it('⛔ an input that sets where a plot is drawn is withheld, with the reason', () => {
    on()
    const d = memberPaneDefinition({ source: corpus('pivot-point-supertrend__HN4w1eNW3B'), id: 'u_member-pane-pp' })
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.inputs.map((i) => i.key)).not.toContain('pine_prd')
    expect(d.notes.map((n) => n.note).join(' ')).toMatch(/`Pivot Point Period` also sets where a plot is drawn/)
    // …and the displacement itself is carried onto the row (offset = -prd at the default 2)
    expect(d.rows.some((r) => r.displace === -2)).toBe(true)
  })
})

describe('⛔ the ORDER and the SCOPE of the fallback', () => {
  it('the host lane stays authoritative whenever it succeeds — even for a script both lanes build', () => {
    on()
    const d = memberPaneDefinition({ source: corpus('keltner-channels-bands__T5FsnX45Dn'), id: 'u_member-pane-k' })
    expect(d.ok).toBe(true)
    expect(d.lane).toBeUndefined()
    expect(d.definition.compute.kind).toBe('ast')
  })

  it('a ruling refusal is never routed around, though the runtime lane builds the script', () => {
    on()
    const d = memberPaneDefinition({ source: corpus('support-and-resistance__UgNPprOr8h'), id: 'u_member-pane-sr' })
    expect(d.ok).toBe(false)
    expect(d.guard).toBe('pine:role-order')
    expect(d.runtimeRefusal).toBeUndefined()
    expect(d.reason).not.toMatch(/second engine/)
  })

  it('both engines refusing is reported with BOTH walls, the host guard kept', () => {
    on()
    const d = memberPaneDefinition({ source: corpus('atr-trailing-stop-by-ceyhun__UMldb6tGLd'), id: 'u_member-pane-2' })
    expect(d.ok).toBe(false)
    expect(d.guard).toBe('pine:state')
    expect(d.runtimeRefusal.guard).toBe('runtime:call-text-state')
    expect(d.reason).toMatch(/second engine, which does handle that, stopped too/)
  })
})

/** The real binder over the recording chart double; per plot key, the colour of
 *  every point the renderer was handed. `ourSide.js::drawnColours`'s recipe. */
function drawnPointColours(def, bars) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const cs = addInstance(mergeChartSettings({}), def.id, registry)
  const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
  binder.sync({
    enabled: true, cs, instances, registry, bars, tf: 'D', newestBarIsForming: false,
    adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
    resolvePlacement: () => ({ paneIndex: 1, scaleId: def.id, scaleOptions: {} }),
  })
  const out = new Map()
  for (const b of binder.bindings()) {
    if (!b || !b.series) continue
    const sets = fake.calls.filter((c) => c.method === 'setData' && c.id === b.series.__id)
    if (sets.length) out.set(b.plotKey, sets[sets.length - 1].args[0].map((p) => p.color || null))
  }
  binder.teardown()
  return out
}

describe('⭐⭐ the colour a host lane cannot fold is the runtime lane\'s own, drawn per point', () => {
  const SRC = '//@version=5\nindicator("c")\nvar float c = 0.0\nc := close > open ? c + 1 : c - 1\n'
    + 'plot(c, "Count", color = c > 0 ? color.green : color.red)\n'

  it('the row reads a packed-colour column, and every point is painted with the palette colour Pine picks', () => {
    on()
    const d = memberPaneDefinition({ source: SRC, id: 'u_member-pane-col' })
    expect(d.ok, d.reason).toBe(true)
    const row = d.rows.find((r) => r.label === 'Count')
    expect(row.colorMode).toMatch(/^rgba:/)
    const { def, cols } = installAndCompute(d.definition)
    const colourKey = row.colorMode.slice('rgba:'.length)
    const green = hexToPacked(pineColourHex('green', 5))
    const red = hexToPacked(pineColourHex('red', 5))
    const vals = cols[row.key]
    const packed = cols[colourKey]
    let seen = 0
    for (let i = 0; i < vals.length; i += 1) {
      if (!Number.isFinite(vals[i])) continue
      expect(packed[i], `bar ${i}`).toBe(vals[i] > 0 ? green : red)
      seen += 1
    }
    expect(seen).toBeGreaterThan(500)
    // ⭐ AND THE BINDER PAINTS IT — read off the points the renderer was handed
    const painted = drawnPointColours(def, SPY).get(row.key)
    expect(painted).toBeTruthy()
    for (let i = 0; i < vals.length; i += 1) {
      if (!Number.isFinite(vals[i])) continue
      expect(painted[i], `bar ${i}`).toBe(toCss(vals[i] > 0 ? green : red))
    }
  })
})

describe('⭐ the partial-drawing rule applies to a runtime-lane document\'s objects', () => {
  const H = '//@version=5\nindicator("t", overlay=true)\nvar float s = 0.0\ns := s + close\nplot(s)\n'

  it('a clean object program is carried and drawn', () => {
    on()
    const d = memberPaneDefinition({ source: H + 'if barstate.islast\n    label.new(bar_index, high, "x")\n', id: 'u_member-pane-o1' })
    expect(d.ok, d.reason).toBe(true)
    expect(d.lane).toBe('runtime')
    expect(d.definition.objects && d.definition.objects.ops.length).toBeGreaterThan(0)
    expect(d.notes.find((n) => n.name === DRAWING_NOTE_NAME)).toBeUndefined()
  })

  it('a partial loss is disclosed "N of M"', () => {
    on()
    const d = memberPaneDefinition({ source: H + 'if barstate.islast\n    label.new(bar_index, s, "x")\n', id: 'u_member-pane-o2' })
    expect(d.ok, d.reason).toBe(true)
    const n = d.notes.find((x) => x.name === DRAWING_NOTE_NAME)
    expect(n && n.note).toMatch(/1 of 1 drawing elements/)
  })

  it('⛔ a lost removal WITHHOLDS the drawings and keeps the plot, said in words', () => {
    on()
    const src = H + 'var lines = array.new_line()\narray.push(lines, line.new(bar_index, high, bar_index + 1, high))\n'
      + 'if array.size(lines) > 3\n    line.delete(array.shift(lines))\n'
    const d = memberPaneDefinition({ source: src, id: 'u_member-pane-o3' })
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.objects).toBeUndefined()
    expect(d.notes.find((x) => x.name === DRAWING_NOTE_NAME).note).toMatch(/plots are shown, but its drawings are not/)
  })
})

describe('⭐⭐ where both lanes can draw a script, they draw the SAME numbers', () => {
  // Every committed script both doors build (measured 2026-09-27). The runtime
  // door is forced here; a member reaches it only when the host refuses.
  const BOTH = ['candlestick-patterns-identified-update-1-17-26__1082', 'cdc-btc-rainbow-road__d880789793',
    'cumulative-volume-delta__K07lTKE3tP', 'donchian-channels__5df15aaa23', 'elliott-wave-3-finder-v2__451cecfc9d',
    'engulfingcandle__0df91dc775', 'keltner-channels-bands__T5FsnX45Dn']

  it.each(BOTH)('%s — row for row, bar for bar', (name) => {
    on()
    const source = corpus(name)
    const h = memberPaneDefinition({ source, id: 'u_member-pane-h' })
    const r = runtimeLaneDefinition({ source, id: 'u_member-pane-r', carryMax: 12, docCarryMax: 36, paneHeight: 0.25 })
    expect(h.ok && r.ok, `${h.reason} | ${r.reason}`).toBe(true)
    expect(h.definition.compute.kind).toBe('ast')
    expect(r.definition.compute.kind).toBe('pine')
    const hc = installAndCompute(h.definition).cols
    const rc = installAndCompute(r.definition).cols
    expect(registry.columnErrors(rc)).toEqual({})
    const hRows = h.rows.filter((x) => !x.conditionFor)
    const rRows = r.rows.filter((x) => !x.colourFor)
    expect(rRows.map((x) => x.label)).toEqual(hRows.map((x) => x.label))
    for (const [i, hr] of hRows.entries()) {
      expect(Array.from(rc[rRows[i].key]), `${name} ${hr.label || hr.key}`).toEqual(Array.from(hc[hr.key]))
    }
  })
})
