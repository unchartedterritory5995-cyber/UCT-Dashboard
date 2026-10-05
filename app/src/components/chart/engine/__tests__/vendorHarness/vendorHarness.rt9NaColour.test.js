// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.rt9NaColour.test.js
//
// ─── RT9 — WHAT `color.new` / `color.rgb` MAKE OF AN `na` ARGUMENT, GRADED ──────
//
// CAP3 captured `vw-rt6-runtime-colour` on NYSE:RDDT 1D (from the listing, 636 bars)
// and AMEX:SPY 1D (1,800 bars): on every bar of both, TradingView draws
//   C03 `color.new(color(na), 40)`   #00000099   (an `na` base is black)
//   C04 `color.new(color.red, nv)`   #ff525200   (an `na` transparency is 100)
//   C05 `color.rgb(nv, 0, 0)`        #000000ff   (an `na` channel is 0)
// where `nv` is `float nv = na`. Before RT9 every one drew the pane's gold. The rule
// is ONE (`colorInt.js`), used by the host plot fold, the host object runtime and
// the runtime lane; this file grades the first against the captures and rails the
// other two directly.
//
// ⭐ C01 / C02 (a `var` colour switched by a state test, and `color.new` over it)
// diverged for a different cause until F9: the host lane did not carry a `var`
// colour (drawn in the pane's gold). F9 carries it as a palette and a running
// index (`pine.js::colourStateRule`); pinned here as MATCH with colour compared.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { translatePine } from '../../ast/pine.js'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import * as registry from '../../nativeRegistry'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { COLOUR_FNS, packedToObjectHex, hexToPacked } from '../../runtime/colours'

afterEach(() => { vi.unstubAllEnvs() })
const T = 600000

const cap = (id) => loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
const plot = (v, title) => v.plots.find((p) => p.title === title)

describe('RT9 — the na colour edges, graded against CAP3 (vw-rt6-runtime-colour)', () => {
  for (const id of ['vw-rt6-runtime-colour-rddt-1d-2026-10-03', 'vw-rt6-runtime-colour-spy-1d-2026-10-03']) {
    for (const state of ['on', 'runtime']) {
      it(`${id} (${state}): C03, C04 and C05 are MATCH with colour compared`, () => {
        vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
        if (state === 'runtime') vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
        const c = cap(id)
        const v = gradeCapture(c).verdict
        const n = c.bars.rows.length
        expect(n).toBeGreaterThan(600) // non-vacuity: the whole capture was graded
        for (const t of ['C03_new_na_base', 'C04_new_na_transp', 'C05_rgb_na']) {
          const p = plot(v, t)
          expect(p, t).toBeTruthy()
          expect(p.verdict, `${t}: ${p.reason}`).toBe('MATCH')
        }
        // the C06 control (a point coloured `na`, hidden) was MATCH before and stays so
        expect(plot(v, 'C06_cond_or_na').verdict).toBe('MATCH')
        // C01 / C02: the `var` colour, carried since F9 — every bar, colour compared
        for (const t of ['C01_var_colour', 'C02_new_var_40']) {
          const p = plot(v, t)
          expect(p.verdict, `${t}: ${p.reason}`).toBe('MATCH')
          expect(p.color, t).toBe('compared')
        }
      }, T)
    }
  }
})

describe('RT9 — the host plot fold reads a PROVABLY `na` argument, and nothing else', () => {
  const presentation = (expr, extra = '') => {
    const src = ['//@version=5', 'indicator("t")', 'float nv = na', extra, `plot(close, "p", color = ${expr})`].join('\n')
    const t = translatePine(src, { strict: true })
    return t.outputs.find((o) => o.title === 'p').presentation
  }
  it('folds the three witnessed edges', () => {
    expect(presentation('color.new(color(na), 40)')).toMatchObject({ color: '#000000', opacity: 0.6 })
    expect(presentation('color.new(color.red, nv)')).toMatchObject({ opacity: 0 })
    expect(presentation('color.new(color.red, nv)').color).toMatch(/^#/)
    const rgb = presentation('color.rgb(nv, 0, 0)')
    expect(rgb.color).toBe('#000000')
    expect(rgb.opacity === undefined || rgb.opacity === 1).toBe(true)
  })
  it('CONTROL: an `na` only on some bars, or a reassigned name, is still a per-bar colour', () => {
    // ⭐ H11 — a per-bar colour, and (CAP5 Q-F9a) carried: the `na` leaf is black at 40
    const perBar = presentation('color.new(close > open ? color.red : na, 40)')
    expect(perBar.color).toBeUndefined()
    expect(perBar.colorIndex && perBar.colorIndex.palette).toContain('#000000')
    expect(presentation('color.new(color.red, close > open ? 50 : na)').color).toBeUndefined()
    // `nv2` is reassigned, so it is not provably `na`
    const p = presentation('color.new(color.red, nv2)', 'float nv2 = na\nif close > open\n    nv2 := 30')
    expect(p.opacity === 0 && typeof p.color === 'string').toBe(false)
    // `color.rgb`'s fourth argument `na` has no witness: not folded
    expect(presentation('color.rgb(255, 0, 0, nv)').color).toBeUndefined()
  })
})

describe('RT9 — the runtime lane and the host object runtime answer the same', () => {
  it('runtime lane: the three edges', () => {
    expect(packedToObjectHex(COLOUR_FNS['color.new'].fn([NaN, 40]))).toBe('#00000099')
    expect(packedToObjectHex(COLOUR_FNS['color.new'].fn([hexToPacked('#ff5252'), NaN]))).toBe('#FF525200')
    expect(packedToObjectHex(COLOUR_FNS['color.rgb'].fn([NaN, 0, 0]))).toBe('#000000')
  })

  it('host object runtime: a per-bar `na` transparency draws the colour at transparency 100', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const src = ['//@version=5', 'indicator("t", overlay = true)', 'plot(close)',
      'label.new(bar_index, close, "x", color = color.new(color.blue, close > open ? 50 : na))'].join('\n')
    const ID = 'u_rt9-nacolour'
    const built = memberPaneDefinition({ source: src, id: ID })
    expect(built.ok, built.reason).toBe(true)
    try {
      const def = registry.installUserDefinitions([built.definition]).installed[0]
      const bars = Array.from({ length: 6 }, (_, i) => ({
        t: 1700000000 + i * 86400, o: 100, h: 102, l: 98, c: i % 2 ? 99 : 101, v: 1000,
      }))
      const reader = objectReaderFor(def, bars, { tf: 'D', newestBarIsForming: false })
      const run = evaluateObjects(reader.program, {
        barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
      })
      const colours = run.live.filter((o) => o.family === 'label').map((o) => String(o.props.color || ''))
      expect(colours).toHaveLength(6)
      // up bars (c > o): transparency 50 → alpha 0x80; down bars: `na` → alpha 00
      expect(colours.filter((c) => /80$/i.test(c))).toHaveLength(3)
      expect(colours.filter((c) => /00$/i.test(c))).toHaveLength(3)
    } finally {
      registry.uninstallUserDefinition(ID)
    }
  })
})
