// ─── ⭐⭐ C37 — THE COLOURS OF DRAWING OBJECTS, AGAINST TRADINGVIEW ─────────────
//
// `compareObjects` grades an object's COUNT and TEXT, never its colour, so a
// drawing in the wrong colour graded MATCH. The colour column (`colourColumn.js`)
// pairs every live object with the capture's own record and reads each colour
// slot. At the wave-9 base it counted 345 slots over the 47 graded captures
// where the script names a colour, we carried none, and the renderer's default
// stood in for it. This rail pins, per mechanism, the captures where that is no
// longer true — every paired slot is TradingView's colour:
//
//   color.new(c, <input>)        makuchaku FVG — `color.new(color.black, boxTransparency)`,
//                                51 boxes × border and fill, `#363A45` at alpha 0x0D
//   a `var` never reassigned     contraction-box — `var color LineColorInput = input.color(…)`
//                                artemis — `color.new(thOb, 100 - divRegAlpha)` and
//                                `color.new(thOb, isLight ? 55 : 45)`, 48 slots
//   a one-expression helper      ema-ribbon — `f_trendClr(bull, bear)`, `f_gradeClr(spread)`
//   `na` / `color(na)`           position-size-calculator, zero-lag — the absent colour
//   color.from_gradient, per pass  heat-map-seasons — the 28 cells of its gauge
//   the version's defaults       rsi-swing, fibonacci-pivots (v4 blue / black text),
//                                vw-object-gc (v5 black text, opaque box fill)
//
// ⛔ Each case also proves the check can FAIL (a control), and what is still not
// TradingView's is asserted by name rather than left out.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { runOurSide, toProductBars } from './ourSide'
import { censusOf, pairObjects } from './colourColumn'
import { sealCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectDefaultsFor, OBJECT_DEFAULTS, toRenderState } from '../../objectRenderState'
import * as registry from '../../nativeRegistry'
import { createBinder } from '../../binder'
import { addInstance } from '../../instanceControls'
import { mergeChartSettings } from '../../../chartDefaults'
import { createFakeChart } from '../fakeChart'
import { versionObjectDefaults, VERSIONS_WITH_OBJECT_DEFAULTS } from '../../objectDefaults'

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const load = (id) => {
  const loaded = loadCapture(path.join(DIR, `${id}.json`))
  if (!loaded.capture) throw new Error(`${id}: not a capture — ${loaded.reason}`)
  return loaded.capture
}
const tallyOf = (id) => {
  const row = censusOf(load(id))
  expect(row.objects, `${id}: the object lane did not run (${row.refused || 'no objects'})`).toBeTruthy()
  return row.objects
}
const sum = (objects, state) => Object.values(objects.tally).reduce((n, t) => n + t[state], 0)
/** Every graded slot is TradingView's colour (carried, or the script named none
 *  and the default is the vendor's). */
const expectAllAgree = (id, objects) => {
  const bad = objects.rows.filter((r) => r.state === 'notCarried' || r.state === 'carriedDiffers' || r.state === 'vendorUndecodable')
  expect(bad.map((r) => `${r.kind}.${r.slot} ${r.where}: vendor ${r.vendor} ours ${r.ours} (${r.state})`), id).toEqual([])
}

describe('C37 — `color.new(c, t)` whose transparency is an input: carried, and the knob stays live', () => {
  const ID = 'makuchaku039s-trade-tools-fair-value-gaps-rddt-1d-2026-09-28'

  it('⭐ 51 boxes × border and fill are TradingView\'s `#363A45` at alpha 0x0D', () => {
    const o = tallyOf(ID)
    expectAllAgree(ID, o)
    expect(o.tally['box.border_color'].agree).toBe(51)
    expect(o.tally['box.bgcolor'].agree).toBe(51)
    expect(new Set(o.rows.map((r) => r.ours))).toEqual(new Set(['#363a450d']))
  }, 60000)

  it('the transparency is a per-bar VALUE the program reads, never a number folded at translation', () => {
    const d = memberPaneDefinition({ source: load(ID).source.text, id: 'u_member-pane-c37fvg', name: 'fvg' })
    expect(d.ok, d.reason).toBe(true)
    const creates = d.definition.objects.ops.filter((op) => op.k === 'create' && op.family === 'box')
    expect(creates.length).toBeGreaterThan(0)
    for (const op of creates) {
      for (const slot of ['bgcolor', 'border_color']) {
        expect(op.props[slot].node.c, slot).toBe('new')
        expect(op.props[slot].node.of).toEqual({ c: 'lit', hex: '#363A45' })
        expect(['tree', 'graph', 'param'], slot).toContain(op.props[slot].node.t.v)
      }
    }
    expect(d.translation.objectDiagnostics.droppedPropNames || []).toEqual([])
  }, 60000)

  it('🔴 CONTROL — a vendor colour moved by one channel is SEEN as a difference', () => {
    const c = JSON.parse(JSON.stringify(load(ID)))
    c.objects.records.boxes[0].bc = (c.objects.records.boxes[0].bc ^ 0x01) >>> 0
    const o = censusOf(sealCapture(c)).objects
    expect(sum(o, 'carriedDiffers')).toBe(1)
  }, 60000)
})

describe('C37 — colours reached through a name, a helper or a constant selector', () => {
  it('⭐ a `var` seeded with a colour and never reassigned: contraction-box\'s 78 lines wear the input\'s teal', () => {
    const ID = 'contraction-box-doji-lines-rddt-1d-2026-09-28'
    const o = tallyOf(ID)
    expectAllAgree(ID, o)
    expect(o.tally['line.color'].agree).toBe(78)
    expect(new Set(o.rows.filter((r) => r.kind === 'line').map((r) => r.ours))).toEqual(new Set(['#089784ff']))
  }, 60000)

  it('⭐ `color.new(<the theme colour>, <arithmetic over an input>)`: every colour slot of artemis', () => {
    const ID = 'artemis-oscillator-pro-rddt-1d-2026-09-28'
    const o = tallyOf(ID)
    expectAllAgree(ID, o)
    expect(o.tally['line.color'].agree).toBe(13)
    // 14 theme-coloured labels; the other 3 name no colour and wear the default
    expect(o.tally['label.color'].agree).toBe(14)
    expect(o.tally['label.color'].agreeByDefault).toBe(3)
    // 15 cells before wave 9's C31 served the KNN panel's `O-  V-  S-` cell; with
    // it drawn, its text colour is one more slot — and it is TradingView's too
    expect(o.tally['cell.text_color'].agree).toBe(16)
    expect(o.tally['table.frame_color'].agree + o.tally['table.border_color'].agree).toBe(6)
    // ⛔ NON-VACUITY: several distinct colours, transparent ones among them
    const drawn = new Set(o.rows.map((r) => r.ours))
    expect(drawn.size).toBeGreaterThan(6)
    expect([...drawn].some((c) => !c.endsWith('ff') && c !== '#00000000')).toBe(true)
  }, 120000)

  it('⭐ a one-expression colour helper is read with the call\'s arguments in place: ema-ribbon', () => {
    const ID = 'ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28'
    const o = tallyOf(ID)
    expectAllAgree(ID, o)
    // ⭐ 32 -> 33 in wave 10: C42 serves the strength-bar cell (`ta.highest` under
    // `barstate.islast`, TradingView's `██████████`), so one more cell is drawn and
    // its text colour agrees too. Measured on the merged tree.
    expect(o.tally['cell.text_color'].agree).toBe(33)
  }, 120000)

  it('⭐ `na` as a colour is the absent one (transparent), through a helper too: position-size-calculator', () => {
    const ID = 'position-size-calculator-rddt-1d-2026-09-28'
    const o = tallyOf(ID)
    expectAllAgree(ID, o)
    expect(o.tally['label.color'].agree).toBe(4)
  }, 60000)

  it('⭐ `color = color(na)`: zero-lag\'s eight labels have no background, as on TradingView', () => {
    const ID = 'zero-lag-ma-trend-levels-rddt-1d-2026-09-27'
    const o = tallyOf(ID)
    const labels = o.rows.filter((r) => r.kind === 'label' && r.slot === 'color')
    expect(labels.length).toBe(8)
    for (const r of labels) expect([r.state, r.ours, r.vendor]).toEqual(['agree', '#00000000', '#00000000'])
  }, 60000)
})

describe('C37 — `color.from_gradient` on the host object lane, per pass of a loop', () => {
  const ID = 'heat-map-seasons-rddt-1d-2026-09-28'

  it('⭐ the 27 gauge cells left showing are TradingView\'s gradient — aqua → yellow → red, by the counter', () => {
    const o = tallyOf(ID)
    const cells = o.rows.filter((r) => r.kind === 'cell' && r.slot === 'bgcolor' && r.where.includes(',1) '))
    // 30 loop passes at (i, 1); (0,1) and (29,1) are then overwritten by the
    // static ❆ / ☀︎ cells and (13,1) by the gauge point (the last test here)
    expect(cells.length).toBe(30)
    const agreeing = cells.filter((r) => r.state === 'agree')
    expect(agreeing.length).toBe(29)
    // ⛔ NON-VACUITY: a gradient — 27 distinct blends between the two static ends
    expect(new Set(agreeing.map((r) => r.ours)).size).toBeGreaterThanOrEqual(27)
    // the first pass after aqua: w = 1/15 → (17, 191, 201), each channel truncated
    expect(agreeing.find((r) => r.where.startsWith('cell (1,1)')).ours).toBe('#11bfc9ff')
  }, 60000)

  it('the program says it as one per-pass colour: a test on the counter over two gradients', () => {
    const d = memberPaneDefinition({ source: load(ID).source.text, id: 'u_member-pane-c37heat', name: 'h' })
    const loop = d.definition.objects.ops.find((op) => op.k === 'loop')
    const cell = loop.body.find((op) => op.k === 'cell')
    const n = cell.props.bgcolor.node
    expect(n.c).toBe('if')
    expect(n.cond).toMatchObject({ v: 'cmp', op: '<', args: [{ v: 'loop', id: 'i' }, expect.anything()] })
    expect(n.then).toMatchObject({ c: 'grad', v: { v: 'loop', id: 'i' }, lo: { v: 'const', value: 0 }, hi: { v: 'const', value: 15 } })
    expect(n.else).toMatchObject({ c: 'grad', lo: { v: 'const', value: 15 }, hi: { v: 'const', value: 30 } })
  }, 60000)

  it('⛔ STILL NOT TradingView\'s, by name: the gauge POINT\'s fill (`bgcolor = color`, a variable named `color`)', () => {
    // The statement `color = color_level > 0 ? … : …` binds a name this translator
    // does not read as a variable (`pine:statement`), so the cell's `bgcolor` is
    // dropped and the cell keeps the fill its address was given earlier in the
    // bar (the gauge's). One slot; the capture is the witness when it is served.
    const o = tallyOf(ID)
    const bad = o.rows.filter((r) => r.state === 'carriedDiffers' || r.state === 'notCarried')
    expect(bad.map((r) => `${r.kind}.${r.slot} ${r.where}`)).toEqual(['cell.bgcolor cell (13,1) "𖦹"'])
    const d = memberPaneDefinition({ source: load(ID).source.text, id: 'u_member-pane-c37heat2', name: 'h' })
    expect(d.translation.objectDiagnostics.droppedPropNames).toEqual(['cell.bgcolor@70'])
  }, 60000)
})

describe('C37 — an uncoloured object wears the default of its script\'s Pine version', () => {
  it('⭐ v4: lines and labels in v4\'s `color.blue`, label text in `color.black` — rsi-swing, fibonacci-pivots', () => {
    // ⭐ C44 re-pin, 10 → 11 lines: the pairing now reads an `na` coordinate as `na`
    // on both sides (`objectColours.js::isNa`). rsi-swing's first line (#2) has no
    // second point yet — `y2` is `na` on TradingView and `NaN` here — so it went
    // unpaired and its colour was never read. It is paired now and agrees; nothing
    // about what is drawn changed.
    for (const [id, slot, n, hex] of [
      ['rsi-swing-indicator-rddt-1d-2026-09-28', 'line.color', 11, '#2196f3ff'],
      ['rsi-swing-indicator-rddt-1d-2026-09-28', 'label.textcolor', 11, '#363a45ff'],
      ['fibonacci-pivot-points-cc-rddt-1d-2026-09-28', 'label.color', 7, '#2196f3ff'],
    ]) {
      const o = tallyOf(id)
      expectAllAgree(id, o)
      expect(o.tally[slot].agreeByDefault, `${id} ${slot}`).toBe(n)
      const [kind, s] = slot.split('.')
      const rows = o.rows.filter((r) => r.kind === kind && r.slot === s && r.state === 'agreeByDefault')
      expect(new Set(rows.map((r) => r.ours)), `${id} ${slot}`).toEqual(new Set([hex]))
    }
  }, 120000)

  it('⭐ v5: label text in `color.black`, an unset box fill OPAQUE `color.blue` — vw-object-gc-b', () => {
    const ID = 'vw-object-gc-b-spy-1d-2026-09-28'
    const o = tallyOf(ID)
    expectAllAgree(ID, o)
    expect(o.tally['label.textcolor'].agreeByDefault).toBeGreaterThan(40)
    expect(o.tally['box.bgcolor'].agreeByDefault).toBeGreaterThan(40)
    expect(o.tally['box.text_color'].agreeByDefault).toBeGreaterThan(40)
    expect(new Set(o.rows.filter((r) => r.kind === 'box' && r.slot === 'bgcolor').map((r) => r.ours))).toEqual(new Set(['#2962ffff']))
  }, 120000)

  it('⭐ v5: a table cell\'s unset text is `color.black` — htf-liquidity, keltner-center-of-gravity', () => {
    for (const id of ['htf-liquidity-dashboard-tfo-rddt-1d-2026-09-28', 'keltner-center-of-gravity-channel-rddt-1d-2026-09-30']) {
      const o = tallyOf(id)
      const rows = o.rows.filter((r) => r.kind === 'cell' && r.slot === 'text_color' && r.state === 'agreeByDefault')
      expect(rows.length, id).toBeGreaterThan(0)
      for (const r of rows) expect(r.ours, `${id} ${r.where}`).toBe('#363a45ff')
      expect(o.rows.filter((r) => r.kind === 'cell' && r.slot === 'text_color' && r.state === 'notCarried'), id).toEqual([])
    }
  }, 120000)

  it('🔴 CONTROL — without the program\'s version the SAME objects read against the base default, and differ', () => {
    const c = load('rsi-swing-indicator-rddt-1d-2026-09-28')
    const ours = runOurSide(c)
    expect(ours.objects.pineVersion).toBe(4)
    const stripped = pairObjects(c, { ...ours.objects, pineVersion: undefined })
    const notCarried = stripped.rows.filter((r) => r.state === 'notCarried')
    // ⭐ C44 re-pin, 21 → 22: the eleventh line (an `na` second point) pairs now.
    expect(notCarried.length).toBe(22) // 11 lines + 11 label texts: what the base drew
    const withVersion = pairObjects(c, ours.objects)
    expect(withVersion.rows.filter((r) => r.state === 'notCarried')).toEqual([])
  }, 60000)

  it('⭐ what is DRAWN wears them: the render state reads the version the program states', () => {
    const c = load('rsi-swing-indicator-rddt-1d-2026-09-28')
    const ours = runOurSide(c)
    const bars = toProductBars(c)
    const at = (pineVersion) => toRenderState(ours.objects.held, { bars, tf: 'D', pineVersion })
    const v4 = at(ours.objects.pineVersion)
    expect(v4.lines.length).toBeGreaterThan(5)
    expect(new Set(v4.lines.map((l) => l.color))).toEqual(new Set(['#2196F3']))
    expect(new Set(v4.labels.map((l) => l.textcolor))).toEqual(new Set(['#363A45']))
    // 🔴 CONTROL — with no version the SAME objects draw the base defaults
    const base = at(undefined)
    expect(new Set(base.lines.map((l) => l.color))).toEqual(new Set(['#2962FF']))
    expect(new Set(base.labels.map((l) => l.textcolor))).toEqual(new Set(['#FFFFFF']))
  }, 60000)

  it('⭐ …and so does the chart binding: a v5 label with no text colour is drawn in `color.black`', () => {
    const LF = String.fromCharCode(10)
    const BARS = Array.from({ length: 8 }, (_, i) => ({ t: 1_700_000_000 + i * 86400, o: 100, h: 102, l: 98, c: 100 + i, v: 1000 }))
    const drawn = (version) => {
      const door = memberPaneDefinition({
        source: [`//@version=${version}`, 'indicator("d", overlay=true)', 'if barstate.islast', '    label.new(bar_index, high, "x")', 'plot(close)'].join(LF) + LF,
        id: `u_member-pane-c37bind${version}`, name: 'd',
      })
      expect(door.ok, door.reason).toBe(true)
      const { installed, errors } = registry.installUserDefinitions([door.definition])
      expect(errors).toEqual([])
      const def = installed[0]
      try {
        const fake = createFakeChart()
        const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
        const cs = addInstance(mergeChartSettings({}), def.id, registry)
        let state = null
        binder.sync({
          enabled: true, cs, instances: (cs.indicatorInstances || []).filter((i) => i.defId === def.id), registry,
          bars: BARS, tf: 'D', symbol: { ticker: 'SPY', exchange: 'NYSE Arca' }, newestBarIsForming: false,
          adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
          resolvePlacement: () => ({ paneIndex: 1, scaleId: def.id, scaleOptions: {} }),
          createObjectLayer: () => ({ set: (s) => { state = s }, clear: () => {} }),
        })
        binder.teardown()
        return state.labels.map((l) => l.textcolor)
      } finally { registry.uninstallUserDefinition(def.id) }
    }
    expect(drawn(5)).toEqual(['#363A45'])
    expect(drawn(6)).toEqual(['#FFFFFF']) // v6: white, the base default
  }, 60000)

  it('⛔ only the (version, slot) pairs a capture shows — v6 and unknown versions are the base, untouched', () => {
    expect(VERSIONS_WITH_OBJECT_DEFAULTS).toEqual([4, 5])
    for (const v of [6, 3, undefined, null, 7]) {
      expect(versionObjectDefaults(v), String(v)).toEqual({})
      const d = objectDefaultsFor(v)
      for (const f of Object.keys(OBJECT_DEFAULTS)) expect(d[f], `${v} ${f}`).toEqual(OBJECT_DEFAULTS[f])
      expect(d.cell).toEqual({})
    }
    // v6 keeps WHITE label text (4 labels on the 2026-09-30 probes)
    expect(objectDefaultsFor(6).label.textcolor).toBe('#FFFFFF')
    expect(versionObjectDefaults(4)).toEqual({
      line: { color: '#2196F3' }, label: { color: '#2196F3', textcolor: '#363A45' },
    })
    expect(versionObjectDefaults(5)).toEqual({
      label: { textcolor: '#363A45' }, box: { bgcolor: '#2962FF', text_color: '#363A45' }, cell: { text_color: '#363A45' },
    })
  })

  it('a v6 program states no version (its bytes are unchanged); a v4 / v5 one does', () => {
    const LF = String.fromCharCode(10)
    const prog = (v) => memberPaneDefinition({
      source: [`//@version=${v}`, v >= 5 ? 'indicator("d", overlay=true)' : 'study("d", overlay=true)',
        'if close > open', '    label.new(bar_index, high, "x")', 'plot(close)'].join(LF) + LF,
      id: `u_member-pane-c37v${v}`, name: 'd',
    }).definition.objects
    expect(prog(6).pineVersion).toBeUndefined()
    expect(prog(5).pineVersion).toBe(5)
    expect(prog(4).pineVersion).toBe(4)
  })
})
