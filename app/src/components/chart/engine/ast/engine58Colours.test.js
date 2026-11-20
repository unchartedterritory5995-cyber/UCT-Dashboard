// app/src/components/chart/engine/ast/engine58Colours.test.js
//
// ─── ENGINE 58 — COLOURS FOUND BY FRESH TRADINGVIEW CAPTURES ─────────────────
//
// The rule: never draw a colour TradingView does not draw. Exact where captures
// witness the rule; otherwise withheld BY NAME, never a made-up default.
// Every hex asserted below is either read off a TradingView capture (named) or
// derived from a script written in this repo's own words. The captures named are
// licence-held (sessions S2-S6, 2026-11-13/14); only their numbers appear here.
// See docs/pine/evidence/2026-11-14-engine58-colours/EVIDENCE.md.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine, COLOUR_UNREAD, COLOUR_DEFAULT_UNWITNESSED, colourHexByName } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { memberPaneDefinition, COLOUR_NONE, WITHHELD_COLOUR_INK } from '../../builder/memberPane/memberPaneDefinition.js'
import { paletteFor, PALETTE_BY_VERSION, pineColourHex } from '../pinePalette.js'
import { withThemeColour } from '../pool.js'
import { markersFor } from '../markerPrimitive.js'
import { comparePlot, plotVerdict, COLOUR_WITHHELD_POINT } from '../../../../../../tools/vendor_harness/compare.mjs'

const GOLD = /^#c9a84c/i
const REPO = path.resolve(__dirname, '../../../../../..')
const HARNESS = path.join(REPO, 'tests/fixtures/vendor/harness')
const TRANSP_DEFAULTS = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/transparency-defaults-by-version-rddt-1d-2026-11-14.json'), 'utf8'))
const probeSource = (name) => fs.readFileSync(path.join(REPO, `tools/visual_conformance/probes/${name}.pine`), 'utf8')

const tr = (src) => translatePine(src, { strict: true })
const presOf = (src, i = 0) => (tr(src).outputs || [])[i].presentation

/** The colour each drawn row of the member door's document resolves to (the
 *  plot's `$ref` read through the document's own inputs), with its withhold. */
function door(src) {
  const d = memberPaneDefinition({ source: src, id: 'u_member-pane-e58', name: 'e58' })
  expect(d.ok, d.reason).toBe(true)
  const inputs = new Map((d.definition.inputs || []).map((x) => [x.key, x]))
  const plots = d.definition.plots.map((p) => {
    const raw = typeof p.color === 'string' && p.color.startsWith('$') ? (inputs.get(p.color.slice(1)) || {}).default : p.color
    return { key: p.key, colour: raw, opacity: p.opacity, colorMode: p.colorMode || null, colorWithheld: p.colorWithheld || null,
      palette: p.colorPalette || null, up: p.colorUp || null, down: p.colorDown || null, conditionFor: p.conditionFor || null }
  })
  return { plots: plots.filter((p) => !p.conditionFor), notes: d.notes || [], t: d.translation }
}

describe('C1 — v1, v2 and no-pragma named colours are the v3 (web) palette', () => {
  it('the palette authority: v1 = v2 = null = v3, the v5 table only for an unmeasured version', () => {
    expect(PALETTE_BY_VERSION[1]).toBe(PALETTE_BY_VERSION[3])
    expect(PALETTE_BY_VERSION[2]).toBe(PALETTE_BY_VERSION[3])
    expect(paletteFor(null)).toBe(PALETTE_BY_VERSION[3])
    expect(paletteFor(7)).toBe(PALETTE_BY_VERSION[5])
    // ⛔ a forgotten version is not a script that declares none
    expect(paletteFor(undefined)).toBe(PALETTE_BY_VERSION[5])
    for (const v of [1, 2, null]) {
      expect(pineColourHex('teal', v), String(v)).toBe('#008080')
      expect(pineColourHex('color.red', v), String(v)).toBe('#FF0000')
      expect(colourHexByName('orange', v), String(v)).toBe('#FF7F00')
    }
  })

  it('both translation lanes read the version: a v2 and an unannotated `teal` are #008080', () => {
    expect(presOf('//@version=2\nstudy("t")\nplot(close, color=teal, transp=0)\n').color).toBe('#008080')
    expect(presOf('study("t")\nplot(close, color=teal, transp=0)\n').color).toBe('#008080')
    expect(presOf('//@version=4\nstudy("t")\nplot(close, color=color.teal)\n').color).toBe('#00897B')
  })
})

describe('C2 — a v1-v3 series output with no `transp` draws at 35 (alpha a6), on every colour form', () => {
  it('a named colour: v1, v2, v3 and no pragma (opacity 0.65, the door bakes #RRGGBBA6)', () => {
    for (const head of ['//@version=1\nstudy("t")\n', '//@version=2\nstudy("t")\n', '//@version=3\nstudy("t")\n', 'study("t")\n']) {
      const src = `${head}plot(close, color=teal)\n`
      expect(presOf(src).opacity, head).toBe(0.65)
      expect(door(src).plots[0].colour, head).toBe('#008080A6')
    }
  })

  it('no colour at all: #2962FF at 35 — the transparency is the translation\'s, the hue the door\'s', () => {
    const src = '//@version=3\nstudy("t")\nplot(close)\n'
    expect(presOf(src)).toMatchObject({ opacity: 0.65 })
    expect(presOf(src).color).toBeUndefined()
    expect(door(src).plots[0].colour).toBe('#2962FFA6')
    // and v2 / no pragma, which the door's deleted `version === 3` copy left opaque
    expect(door('//@version=2\nstudy("t")\nplot(close)\n').plots[0].colour).toBe('#2962FFA6')
    expect(door('study("t")\nplot(close)\n').plots[0].colour).toBe('#2962FFA6')
  })

  it('a per-bar (colorer) colour: the rule rides at 0.65 (elliott-wave class, v3)', () => {
    const p = presOf('//@version=3\nstudy("t")\nplot(close, color = close > open ? green : red)\n')
    expect(p.colorUp).toBe('#008000')
    expect(p.colorDown).toBe('#FF0000')
    expect(p.opacity).toBe(0.65)
  })

  it('plotshape and plotchar take it too', () => {
    expect(presOf('//@version=3\nstudy("t")\nplotshape(close > open, color=red)\n').opacity).toBe(0.65)
    expect(presOf('//@version=2\nstudy("t")\nplotchar(close > open, color=red)\n').opacity).toBe(0.65)
  })

  it('⛔ an explicit transp is exact: v2 Bollinger `transp=0` draws #008080ff (capture), 70 draws 70', () => {
    const src = '//@version=2\nstudy("t")\nplot(close, color=teal, transp=0)\n'
    expect(presOf(src).opacity).toBe(1)
    expect(door(src).plots[0].colour).toBe('#008080')
    expect(presOf('//@version=3\nstudy("t")\nplot(close, color=red, transp=70)\n').opacity).toBeCloseTo(0.3, 12)
  })

  it('⛔ v4+ is unchanged: no default transparency', () => {
    expect(presOf('//@version=4\nstudy("t")\nplot(close, color=color.teal)\n').opacity).toBeUndefined()
    expect(presOf('//@version=5\nindicator("t")\nplot(close, color=color.teal)\n').opacity).toBeUndefined()
    expect(door('//@version=4\nstudy("t")\nplot(close)\n').plots[0].colour).toBe('#2962FF')
  })

  it('a positional transp (index 5) is read at v1-v4, and not at v5', () => {
    expect(presOf('//@version=2\nstudy("t")\nplot(close, "T", red, 1, line, 70)\n').opacity).toBeCloseTo(0.3, 12)
    expect(presOf('//@version=4\nstudy("t")\nplot(close, "T", color.red, 1, plot.style_line, 70)\n').opacity).toBeCloseTo(0.3, 12)
    expect(presOf('//@version=3\nstudy("t")\nplotshape(close > open, "T", shape.circle, location.abovebar, red, 0)\n').opacity).toBe(1)
    expect(presOf('//@version=5\nindicator("t")\nplot(close, "T", color.red, 1, plot.style_line, true)\n').opacity).toBeUndefined()
  })

  it('a transp that folds (arithmetic on literals) is read; one that does not withholds the colour by name', () => {
    // ⭐ engine 58 review item 7: a `transp` that reads an INPUT is withheld by name
    // (it would be baked at the default) — `engine58Review.test.jsx`.
    expect(presOf('//@version=4\nstudy("t")\nplot(close, color=color.red, transp=100 - 60)\n').opacity).toBeCloseTo(0.6, 12)
    const p = presOf('//@version=4\nstudy("t")\nplot(close, color=color.red, transp=close > open ? 0 : 50)\n')
    expect(p.colorWithheld.code).toBe(COLOUR_UNREAD)
  })

  it('the default folds into an OPAQUE colour only: an own-alpha colour keeps its alpha (S4 acc/dist volume, v3)', () => {
    // the capture's form: `color=(adr >= 0 ? #65D25B66 : #FE6B6966), style=columns`, drawn at 66
    const p = presOf('//@version=3\nstudy("t")\nplot(volume, color=(close >= open ? #65D25B66 : #FE6B6966), style=columns)\n')
    expect(p.colorWithheld).toBeUndefined()
    expect(p.colorUp.toLowerCase()).toBe('#65d25b66')
    expect(p.colorDown.toLowerCase()).toBe('#fe6b6966')
    expect(p.opacity).toBeUndefined()
    // …the same plot's opaque twin (`#65D25BFF`) takes 35
    expect(presOf('//@version=3\nstudy("t")\nplot(volume, color=(close >= open ? #65D25BFF : #FE6B69FF), style=columns)\n').opacity).toBe(0.65)
    // a flat own-alpha literal keeps its alpha
    const d = door('//@version=3\nstudy("t")\nplot(close, color=#FF000080)\n')
    expect(d.plots[0].colour.toLowerCase()).toBe('#ff000080')
    expect(d.plots[0].colorWithheld).toBeNull()
    // a mixed rule: 35 on its opaque leaf only
    const m = presOf('//@version=3\nstudy("t")\nplot(close, color=close > open ? red : #00FF0080)\n')
    expect(m.colorUp.toLowerCase()).toBe('#ff0000a6')
    expect(m.colorDown.toLowerCase()).toBe('#00ff0080')
    expect(m.opacity).toBeUndefined()
  })

  // ⭐⭐ THE S1 PROBES (committed): `vw-cs1-transp-v{1,2,3}` and their defaults, read
  // from TradingView's own metaInfo/properties after it compiled and drew each one.
  describe.each(['1', '2', '3'])('the S1 transparency probe at v%s (no pragma for v1)', (v) => {
    const want = TRANSP_DEFAULTS.versions[v].defaults
    const src = probeSource(`vw-cs1-transp-v${v}`)
    const t = tr(src)
    const out = (title) => t.outputs.find((o) => o.title === title)
    const alpha = (tp) => Math.round(((100 - tp) * 255) / 100)
    it('the two plots: the v3-table colour at the probe\'s transparency (35)', () => {
      for (const [title, id] of [['P1_close_blue', 'plot_0'], ['P2_open_red', 'plot_1']]) {
        const s0 = want.styles[id]
        expect(s0.transparency).toBe(35)
        expect(out(title).presentation.color).toBe(s0.color)
        expect(Math.round(out(title).presentation.opacity * 255)).toBe(alpha(s0.transparency))
      }
      const d = door(src)
      expect(d.plots[0].colour).toBe(`${want.styles.plot_0.color}A6`)
    })
    it('bgcolor: 90 (the probe\'s plot_2)', () => {
      expect(want.styles.plot_2.transparency).toBe(90)
      const bg = t.presentation.paints.find((x) => x.kind === 'bgcolor')
      expect(bg.withheld).toBeUndefined()
      expect(bg.opacity).toBeCloseTo((100 - want.styles.plot_2.transparency) / 100, 12)
    })
    it('fill between two plots: 90', () => {
      expect(want.filledAreasStyle.fill_0.transparency).toBe(90)
      const f = t.presentation.fills[0]
      expect(f.color).toBe(want.filledAreasStyle.fill_0.color)
      expect(f.opacity).toBeCloseTo((100 - want.filledAreasStyle.fill_0.transparency) / 100, 12)
    })
    it('hline: the v3-table colour, opaque (the capture carries no transparency key)', () => {
      expect(want.bands[0].transparency).toBeUndefined()
      // the probe binds its hlines to names (a band edge); a level the door draws is
      // the statement form, so the same call is asked in that form
      const head = v === '1' ? '' : `//@version=${v}\n`
      const lt = tr(`${head}study("t")\nplot(close)\nhline(100, title="H1_hline_purple", color=purple)\n`)
      const lv = lt.presentation.levels.find((l) => l.title === 'H1_hline_purple')
      expect(lv.color).toBe(want.bands[0].color)
      expect(lv.opacity).toBeUndefined()
    })
    it('plotarrow: its up/down colours are not carried, so withheld by name (never the gold)', () => {
      expect(want.styles.plot_3.transparency).toBe(35)
      const row = door(src).plots.find((x) => x.colorWithheld && x.colorWithheld.code === COLOUR_UNREAD)
      expect(row).toBeTruthy()
      expect(row.colour).toBe(WITHHELD_COLOUR_INK)
    })
    if (v === '3') {
      it('columns and stepline: 35, exact (the probe\'s plot_4 / plot_5)', () => {
        for (const [title, id] of [['S1_columns_navy', 'plot_4'], ['S2_stepline_olive', 'plot_5']]) {
          const s0 = want.styles[id]
          expect(s0.transparency).toBe(35)
          expect(out(title).presentation.color).toBe(s0.color)
          expect(out(title).presentation.colorWithheld).toBeUndefined()
          expect(Math.round(out(title).presentation.opacity * 255)).toBe(alpha(35))
        }
      })
    }
  })

  it('the S1 palette probes: all 17 names at no-pragma (v1) and v2 are the capture\'s colours, at 35', () => {
    for (const name of ['vw-cs1-palette-v1-rddt-1d-2026-11-14.json', 'vw-cs1-palette-v2-rddt-1d-2026-11-14.json']) {
      const cap = JSON.parse(fs.readFileSync(path.join(HARNESS, name), 'utf8'))
      const st = cap.study.styleState
      const byTitle = new Map(cap.study.plots.map((pl) => [pl.title, pl.id]))
      const outs = tr(cap.source.text).outputs
      expect(outs).toHaveLength(17)
      for (const o of outs) {
        const s0 = st[byTitle.get(o.title)]
        expect(s0.transparency, `${name} ${o.title}`).toBe(35)
        expect(o.presentation.color.toLowerCase(), `${name} ${o.title}`).toBe(s0.color.toLowerCase())
        expect(Math.round(o.presentation.opacity * 255), `${name} ${o.title}`).toBe(0xa6)
      }
    }
  })

  it('the runtime lane reads a no-pragma positional transp, as the host lane does', () => {
    const src = 'study("t")\nplot(close, "T", red, 1, line, 70)\n'
    const built = buildRuntimeIr(src, { bars: [], inputs: {}, objectTrees: [], pane: true, symbolAtBind: true, plotColours: true })
    expect(built.ok, JSON.stringify(built.refusal)).toBe(true)
    expect(built.ir.outputs[0].transp).toBe(70)
    expect(presOf(src).opacity).toBeCloseTo(0.3, 12)
  })
})

describe('C3 — an unread author colour is never drawn in the sheet gold', () => {
  it('a colour the door cannot read is withheld by name and drawn in the chart\'s neutral ink, and the member is told', () => {
    const src = '//@version=5\nindicator("t")\nf(x) => x > 0 ? color.red : x < 0 ? color.lime : color.blue\nplot(close, "Line", color = color.from_gradient(close, low, high, color.red, color.rgb(0, 0, close)))\n'
    const d = door(src)
    expect(d.plots[0].colour).toBe(WITHHELD_COLOUR_INK)
    expect(d.plots[0].colorWithheld.code).toBe(COLOUR_UNREAD)
    expect(d.notes.some((n) => /`Line`: colour not reproduced: /.test(n.note))).toBe(true)
    // ⛔ the code never reaches the member's words
    expect(d.notes.some((n) => /pine:colour/.test(n.note))).toBe(false)
  })

  it('a plotarrow: its up/down colours are not carried, withheld by name, and it is never drawn as a line', () => {
    // ⭐ PLOTARROW WITHHELD (coordinator ruling 2026-11-19): TradingView draws up and down arrows; this door drew a LINE
    // of the value. Beside a plot the arrow row is carried, not drawn (`plotarrowWithheld.test.js`), its colours still
    // withheld by name in the neutral ink; alone, the script is refused by that name.
    const d = door('//@version=5\nindicator("t")\nplot(close, "C")\nplotarrow(close - open, "Arr")\n')
    expect(d.plots[1].colour).toBe(WITHHELD_COLOUR_INK)
    expect(d.plots[1].colorWithheld.code).toBe(COLOUR_UNREAD)
    const alone = memberPaneDefinition({ source: '//@version=5\nindicator("t")\nplotarrow(close - open)\n', id: 'u_member-pane-e58', name: 'e58' })
    expect(alone.ok).toBe(false)
    expect(alone.guard).toBe('pine:plotarrow-not-drawn')
  })

  it('a rule row\'s series colour (what a bar with no rule colour falls back to) is none, by name', () => {
    const d = door('//@version=5\nindicator("t")\nplot(close, color = close > open ? color.teal : color.red)\n')
    expect(d.plots[0].colorMode).toMatch(/^column:/)
    expect(d.plots[0].colour).toBe(COLOUR_NONE)
    expect(d.plots[0].colorWithheld).toMatchObject({ code: COLOUR_UNREAD, points: true })
  })

  it('exact: color.new(<a rule>, T) sets every leaf\'s alpha (volume-weighted-bands: #5cf0d766)', () => {
    const p = presOf('//@version=5\nindicator("t")\nc = close > open ? #5cf0d7 : color.new(#ff0000, 20)\nplot(close, color = color.new(c, 60))\n')
    expect(p.colorDynamic).toBeUndefined()
    expect(p.colorUp.toLowerCase()).toBe('#5cf0d7')
    expect(p.colorDown.toLowerCase()).toBe('#ff0000')
    expect(p.opacity).toBeCloseTo(0.4, 12)
    // 0.4 × 255 = 102 = 0x66: the capture's `#5cf0d766`
    expect(Math.round(p.opacity * 255).toString(16)).toBe('66')
    // T = 0 (uptrick): opaque, any leaf alpha replaced
    const q = presOf('//@version=5\nindicator("t")\nc = close > open ? color.new(color.teal, 50) : color.red\nplot(close, color = color.new(c, 0))\n')
    expect(q.colorUp).toBe('#00897B')
    expect(q.opacity).toBeUndefined()
    // an N-way chain with an `na` leaf keeps the leaf absent
    const r = presOf('//@version=5\nindicator("t")\nc = close > open ? color.teal : close < open ? color.red : na\nplot(close, color = color.new(c, 60))\n')
    expect(r.colorPalette).toContain('rgba(0, 0, 0, 0)')
    expect(r.opacity).toBeCloseTo(0.4, 12)
  })

  it('exact: a bar-invariant rule needs no displacement (fikira-pivots: `Show_last ? color.purple : na, offset = -ofs`)', () => {
    // fikira's own shape (v4): `ofs = input(-1)`, so `offset = -ofs` shifts ONE bar right
    const src = '//@version=4\nstudy("t", overlay=true)\nShow_last = input(true)\nofs = input(-1)\nplot(sma(close, 5), color=Show_last ? color.purple : na, transp=0, offset=-ofs)\n'
    const p = presOf(src)
    expect(p.colorDynamic).toBeUndefined()
    expect(p.colorPalette).toEqual(['#9C27B0', 'rgba(0, 0, 0, 0)'])
    expect(p.colorIndex.formula).toBe('0')
    expect(GOLD.test(String(door(src).plots[0].colour))).toBe(false)
  })

  it('exact: color.new(chart.fg_color, 85) is a theme reference on the plot, drawn in THIS chart\'s colour', () => {
    const src = '//@version=5\nindicator("t")\nplot(close, color = color.new(chart.fg_color, 85))\n'
    expect(presOf(src).color).toBe('chart.fg_color@85')
    expect(door(src).plots[0].colour).toBe('chart.fg_color@85')
    expect(withThemeColour({ color: 'chart.fg_color@85' }, { fg: '#CFCFCF', bg: '#0F0F0F' }).color).toBe('#CFCFCF26')
    // ⛔ a theme this chart cannot answer draws in no colour, never a guess
    expect(withThemeColour({ color: 'chart.bg_color' }, { fg: '#CFCFCF', bg: null }).color).toBe('#00000000')
    // control: an ordinary colour through color.new is not a theme reference
    expect(presOf('//@version=5\nindicator("t")\nplot(close, color = color.new(color.red, 85))\n').color).toBe('#FF5252')
  })

  it('a palette-coloured marker picks each glyph\'s colour by the per-point rule, its own colour where none', () => {
    const marks = markersFor({ column: [1, 1, 1], times: [1, 2, 3], marker: { shape: 'circle', position: 'aboveBar' }, color: '#00000000',
      colourAt: (i) => (i === 1 ? null : ['#FF0000', null, '#00FF00'][i]) })
    expect(marks.map((m) => m.color)).toEqual(['#FF0000', '#00000000', '#00FF00'])
  })
})

describe('C4 — the object lane reads transparency through the plot lane\'s one reader (probe5)', () => {
  const mk = (decl) => `//@version=5\nindicator("t", overlay = true)\n${decl}\nif close > open\n    box.new(bar_index - 2, high, bar_index, low, border_color = color.red, bgcolor = z)\nplot(close)\n`
  const bgOf = (decl) => {
    const t = tr(mk(decl))
    const cr = ((t.objects && t.objects.ops) || []).find((o) => o.k === 'create' && o.family === 'box')
    return cr.props.bgcolor.node.hex.toLowerCase()
  }
  it.each([
    ['genericInputNew', "z = input(color.new(#ff5d00, 50), '')"],
    ['inputColorNew', "z = input.color(color.new(#ff5d00, 50), '')"],
    ['plainNew', 'z = color.new(#ff5d00, 50)'],
    ['genericInputHex8', "z = input(#ff5d0080, '')"],
  ])('%s paints #ff5d0080 (ict-ifvg capture)', (_k, decl) => {
    expect(bgOf(decl)).toBe('#ff5d0080')
  })
})

describe('the harness grades a withheld colour as withheld, and a theme reference as theme-relative', () => {
  const times = [1, 2, 3, 4]
  it('a bar our side withheld by name is counted, never compared: INCONCLUSIVE with the name', () => {
    const r = comparePlot({ times, vendor: [1, 2, 3, 4], ours: [1, 2, 3, 4],
      vendorColors: ['#ff0000ff', '#ff0000ff', '#00ff00ff', '#00ff00ff'],
      ourColors: ['#ff0000ff', COLOUR_WITHHELD_POINT, '#00ff00ff', '#00ff00ff'], tol: { abs: 1e-9, rel: 1e-9 } })
    expect(r.colorWithheld).toBe(1)
    expect(r.colorMismatches).toBe(0)
    const v = plotVerdict(r, { colorMeasured: true, colorResolvable: true, ourColorWithheldBy: COLOUR_UNREAD })
    expect(v.verdict).toBe('INCONCLUSIVE')
    expect(v.reason).toContain(COLOUR_UNREAD)
    // control: nothing withheld is a MATCH
    const ok = comparePlot({ times, vendor: [1, 2, 3, 4], ours: [1, 2, 3, 4], vendorColors: ['#ff0000ff', '#ff0000ff', '#ff0000ff', '#ff0000ff'],
      ourColors: ['#ff0000ff', '#ff0000ff', '#ff0000ff', '#ff0000ff'], tol: { abs: 1e-9, rel: 1e-9 } })
    expect(plotVerdict(ok, { colorMeasured: true, colorResolvable: true }).verdict).toBe('MATCH')
  })
})

describe('the rail: no document plot resolves to the sheet gold unless the author wrote it', () => {
  const SOURCES = {
    unreadGradient: '//@version=5\nindicator("t")\nplot(close, color = color.from_gradient(close, low, high, color.red, color.rgb(0, 0, close)))\n',
    // beside a plot: a `plotarrow` alone is refused by name (`plotarrowWithheld.test.js`), so it has no row to read
    plotarrow: '//@version=5\nindicator("t")\nplot(close)\nplotarrow(close - open)\n',
    chain: '//@version=5\nindicator("t")\nplot(close, color = close > open ? color.teal : close < open ? color.red : color.gray)\n',
    v3none: '//@version=3\nstudy("t")\nplot(close)\nplotshape(close > open)\n',
    shapePalette: '//@version=5\nindicator("t")\nplotshape(close > open, color = close > close[1] ? color.teal : close < close[1] ? color.red : color.gray)\n',
  }
  it.each(Object.entries(SOURCES))('%s', (_k, src) => {
    for (const p of door(src).plots) expect(GOLD.test(String(p.colour)), `${p.key} ${p.colour}`).toBe(false)
  })
  it('the anchor row of an objects-only document (never drawn) has no colour, not the gold', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    try {
      const d = door('//@version=5\nindicator("t", overlay=true)\nif barstate.islast\n    label.new(bar_index, high, "x")\n')
      expect(d.plots.length).toBeGreaterThan(0)
      for (const p of d.plots) expect(GOLD.test(String(p.colour)), `${p.key} ${p.colour}`).toBe(false)
    } finally { vi.unstubAllEnvs() }
  })
  it('control: an author who writes the gold gets the gold', () => {
    expect(door('//@version=5\nindicator("t")\nplot(close, color = #c9a84c)\n').plots[0].colour).toBe('#c9a84c')
  })
})
