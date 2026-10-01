// ─── ⭐⭐ C29 (C20) — `color.from_gradient` and fractional transparency ─────────
//
// Read off `vw-gradient-spy-1d-2026-09-30.json` (probe `vw-gradient.pine`),
// every bar, never a typed copy: the runtime lane's `fromGradient` must print the
// vendor's channels (linear, TRUNCATED, clamped outside [0, 1]) and transparency
// (interpolated, truncated) for the five gradients the probe asks, and the plot
// the probe draws in `g1` must wear the vendor's packed colour (0xAABBGGRR).
// `color.new(c, 70.5)` holds 70 (and 70.4 does too).
//
// Then max-pain (C20 withheld its 12 heatmap boxes and 2 legend labels on this
// function): every object is now drawn, value for value, colours included.

import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fromGradient, hexToPacked, pineTransparency } from '../../runtime/colours'
import { unpackColor } from '../../colorInt'
import { withObjectTransparency } from '../../ast/objectProgram'
import { decodePackedColour } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'

const H = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const cap = JSON.parse(fs.readFileSync(path.join(H, 'vw-gradient-spy-1d-2026-09-30.json'), 'utf8'))
const col = (() => {
  const idOf = new Map(cap.study.plots.map((p) => [p.title || p.id, p.id]))
  const idx = new Map(cap.plotValues.fields.map((f, i) => [f, i]))
  return (title) => cap.plotValues.rows.map((r) => r[idx.get(idOf.get(title) || title)])
})()

// Pine v6 colour constants the probe names (`color.blue`, `color.red`).
const BLUE = hexToPacked('#2962FF')
const RED = hexToPacked('#F23645')
const cA = hexToPacked('#0064C8', 70)
const cB = hexToPacked('#FF3232', 70)
// Pine's `color.t` of a packed colour: from its opacity byte (255 − the stored byte).
const tOf = (packed) => Math.round((1 - (255 - unpackColor(packed).transparencyByte) / 255) * 100)
const tvHexOf = (packed) => { const u = unpackColor(packed); return (u.hex + (255 - u.transparencyByte).toString(16).padStart(2, '0')).toLowerCase() }
const rgbt = (p) => { const u = unpackColor(p); return [u.r, u.g, u.b, tOf(p)] }

describe('C29 — the gradient, bar for bar, on the vendor capture', () => {
  const v = col('G01_v')
  const w = col('G06_w')
  const N = v.length

  it('g1 (v in [0,1]) and g2 (w beyond [0,1], clamped): r, g, b, t on all 300 bars', () => {
    expect(N).toBe(300)
    const [r1, g1, b1, t1] = ['G02_g1_r', 'G03_g1_g', 'G04_g1_b', 'G05_g1_t'].map(col)
    const [r2, g2, b2, t2] = ['G07_g2_r_clamp', 'G08_g2_g_clamp', 'G09_g2_b_clamp', 'G10_g2_t_clamp'].map(col)
    let clamped = 0
    for (let i = 0; i < N; i++) {
      expect(rgbt(fromGradient(v[i], 0, 1, cA, cB)), `g1 bar ${i}`).toEqual([r1[i], g1[i], b1[i], t1[i]])
      expect(rgbt(fromGradient(w[i], 0, 1, cA, cB)), `g2 bar ${i}`).toEqual([r2[i], g2[i], b2[i], t2[i]])
      if (w[i] < 0 || w[i] > 1) clamped++
    }
    expect(clamped).toBeGreaterThan(50)
  })

  it('g3 = color.new(gradient(blue→red), 30) and g4 = gradient(blue@0 → red@100)', () => {
    const [r3, g3, b3, t3] = ['G11_g3_r_new30', 'G12_g3_g_new30', 'G13_g3_b_new30', 'G14_g3_t_new30'].map(col)
    const [t4, r4] = ['G15_g4_t_interp_0_to_100', 'G16_g4_r'].map(col)
    const RED100 = hexToPacked('#F23645', 100)
    for (let i = 0; i < N; i++) {
      const g = fromGradient(v[i], 0, 1, BLUE, RED)
      const u = unpackColor(g)
      expect([u.r, u.g, u.b, 30], `g3 bar ${i}`).toEqual([r3[i], g3[i], b3[i], t3[i]])
      const g4 = fromGradient(v[i], 0, 1, BLUE, RED100)
      expect([tOf(g4), unpackColor(g4).r], `g4 bar ${i}`).toEqual([t4[i], r4[i]])
    }
  })

  it('`color.new(c, 70.5)` and `(c, 70.4)` hold 70 — truncated', () => {
    for (const t of ['G17_new_red_70p5_t', 'G19_new_0064C8_70p5_t', 'G20_new_0064C8_70p4_t']) {
      expect(col(t).every((x) => x === 70), t).toBe(true)
    }
    expect(pineTransparency(70.5)).toBe(70)
    expect(pineTransparency(70.4)).toBe(70)
    expect(withObjectTransparency('#0064C8', 70.5)).toBe(withObjectTransparency('#0064C8', 70))
    expect(tOf(hexToPacked('#0064C8', 70.5))).toBe(70)
  })

  it('the drawn plot\'s colorer (0xAABBGGRR) is the gradient at TradingView\'s opacity', () => {
    const colorer = col('plot_23')
    for (let i = 0; i < N; i++) {
      expect(tvHexOf(fromGradient(v[i], 0, 1, cA, cB)), `bar ${i}`).toBe(decodePackedColour(colorer[i]))
    }
  })
})

describe('C29 — max-pain: the heatmap boxes and legend labels C20 withheld are drawn, value for value', () => {
  afterEach(() => { vi.unstubAllEnvs() })
  const tvHex = (n) => {
    const x = Number(n) >>> 0
    const h = (y) => y.toString(16).padStart(2, '0').toUpperCase()
    const a = (x >>> 24) & 0xff
    return `#${h(x & 0xff)}${h((x >>> 8) & 0xff)}${h((x >>> 16) & 0xff)}${a === 0xff ? '' : h(a)}`
  }
  it('13 of 13 boxes and 8 of 8 labels, each at TradingView\'s coordinates and colours', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const loaded = loadCapture(path.join(H, 'options-max-pain-calculator-backquant-rddt-1d-2026-09-28.json'))
    const mp = loaded.capture
    const bars = toProductBars(mp)
    const d = memberPaneDefinition({ source: mp.source.text, id: 'u_c29_maxpain', name: 'mp' })
    expect(d.ok, d.reason).toBe(true)
    const reader = objectReaderFor(d.definition, bars, {
      tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: mp.newestBarIsForming ?? null,
      historyFromListing: true,
    })
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })
    const R = mp.objects.records
    const boxes = run.live.filter((o) => o.family === 'box')
    const labels = run.live.filter((o) => o.family === 'label')
    expect(boxes.length).toBe(R.boxes.length)
    expect(labels.length).toBe(R.labels.length)
    const used = new Set()
    for (const o of boxes) {
      const v = R.boxes.find((b) => !used.has(b.id) && b.y1 === o.props.top && b.y2 === o.props.bottom)
      expect(v, `box ${JSON.stringify(o.props)}`).toBeTruthy()
      used.add(v.id)
      expect([String(o.props.bgcolor).toUpperCase(), String(o.props.border_color).toUpperCase()])
        .toEqual([tvHex(v.bc), tvHex(v.c)])
    }
    for (const o of labels) {
      const v = R.labels.find((b) => !used.has(b.id) && b.t === o.props.text && b.y === o.props.y)
      expect(v, `label ${JSON.stringify(o.props)}`).toBeTruthy()
      used.add(v.id)
      expect(String(o.props.color).toUpperCase()).toBe(tvHex(v.ci))
    }
    expect(run.stats.withheldUnknown || 0).toBe(0)
  })
})
