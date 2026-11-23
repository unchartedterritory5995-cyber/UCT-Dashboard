// app/src/components/chart/engine/__tests__/e96HlineLevels.test.js
//
// ─── ⭐⭐ e96 — A PINE `hline` IS DRAWN AS THE LEVEL IT IS, ON BOTH DOORS, AND GRADED AS A BAND ──────────────────────
//
// The references are what the TEST writes (the level a script's own text states) and TradingView's own records
// (`vw-hline-written-rddt-1d-2026-11-20`: `study.bands` / `bandState`; the S1 reference
// `transparency-defaults-by-version-rddt-1d-2026-11-14`), never the engine's output.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { translatePine } from '../ast/pine'
import { memberPaneDefinition, __forceRuntimeLaneForTests, WITHHELD_COLOUR_INK } from '../../builder/memberPane/memberPaneDefinition'
import * as registry from '../nativeRegistry'
import { planBindings } from '../pool'
import { hlineGuides, HLINE_DEFAULTS, hlineKeyOf, hlineOrdinalOf } from '../hlineLevels'
import { compareBands } from '../../../../../../tools/vendor_harness/compare.mjs'
import { loadCapture, gradeCapture } from './vendorHarness/harness'

afterEach(() => { vi.unstubAllEnvs(); __forceRuntimeLaneForTests(false) })
const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const withPanes = () => {
  vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
  vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
}
const v = (n, body, decl = 'indicator("t")') => `//@version=${n}\n${decl}\n${body}\n`
const levelsOf = (src) => translatePine(src, { strict: true }).presentation.levels
const guidesOf = (d) => d.definition.plots.filter((p) => p.style === 'hlines')
const REPO = path.resolve(process.cwd(), '..')

describe('the translation reads every `hline` as the level its text states', () => {
  it('bare and bound, a negative literal, in source order', () => {
    const ls = levelsOf(v(6, 'plot(close)\nhline(70, "A")\nh = hline(-5, "B")\nhline(1.5e2)'))
    expect(ls.map((l) => [l.ordinal, l.value, l.title, l.handle || null])).toEqual([[0, 70, 'A', null], [1, -5, 'B', 'h'], [2, 150, null, null]])
  })
  it('a price that is ONE setting is carried as that setting, at its default', () => {
    const [lv] = levelsOf(v(5, 'ob = input.int(70, "Overbought")\nplot(close)\nhline(ob)'))
    expect(lv.value).toBe(70)
    expect(lv.input).toMatchObject({ name: 'ob', call: 'input.int', title: 'Overbought' })
  })
  it('⛔ a price computed from two settings, or from a series, is withheld by name, never drawn', () => {
    const t = translatePine(v(5, 'a = input.int(70)\nb = input.int(5)\nplot(close)\nhline(a + b)\nhline(close)'), { strict: true })
    expect(t.presentation.levels).toEqual([])
    expect(t.presentation.levelsWithheld.map((w) => w.ordinal)).toEqual([0, 1])
    expect(t.presentation.levelsWithheld[0].reason).toMatch(/computed from settings \(`a`, `b`\)/)
  })
  it('linestyle, display and a positional colour are read; display.none is the author hiding it', () => {
    const ls = levelsOf(v(5, 'plot(close)\nhline(10, "x", color.red, hline.style_dotted, 3)\nhline(20, display=display.none)\nhline(30, linestyle=hline.style_solid)'))
    expect(ls[0]).toMatchObject({ value: 10, color: '#FF5252', lineStyle: 'dotted', width: 3 })
    expect(ls[1]).toMatchObject({ value: 20, hidden: true })
    expect(ls[2]).toMatchObject({ value: 30, lineStyle: 'solid' })
  })
  it('a style written in a form this door cannot read is listed as unread, never guessed', () => {
    const [lv] = levelsOf(v(5, 's = input.string("Dotted")\nplot(close)\nhline(10, linestyle = s == "Dotted" ? hline.style_dotted : hline.style_solid)'))
    expect(lv.unread).toEqual(['lineStyle'])
  })
  it('⛔ reading a price mints no parameter and leaves no note behind', () => {
    const base = translatePine(v(5, 'len = input.int(14)\nplot(ta.rsi(close, len))'), { strict: true, paramManifest: true })
    const withLevel = translatePine(v(5, 'len = input.int(14)\nplot(ta.rsi(close, len))\nob = input.int(70)\nhline(ob)'), { strict: true, paramManifest: true })
    expect(withLevel.inputParams).toEqual(base.inputParams)
    expect(withLevel.notes.filter((n) => n.code !== 'pine:chart-only')).toEqual(base.notes.filter((n) => n.code !== 'pine:chart-only'))
  })
})

describe('the guides: the author\'s style where written, a witnessed default, else the neutral ink by name', () => {
  const opts = (version) => ({ version, neutralInk: 'INK', withAlphaByte: (c, a) => `${c}${Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase()}`, bindInput: () => null })
  it('v6 defaults are TradingView\'s captured ones (H5: #808080, dashed, 1)', () => {
    expect(HLINE_DEFAULTS[6]).toMatchObject({ color: '#808080', lineStyle: 'dashed', width: 1 })
    const { guides, notReproduced } = hlineGuides([{ value: 140.25, ordinal: 4, title: 'H5' }], opts(6))
    expect(guides).toEqual([{ key: 'hline5', label: 'H5', style: 'hlines', levels: [140.25], color: '#808080', width: 1, lineStyle: 'dashed' }])
    expect(notReproduced).toEqual([])
  })
  it('v1-v3: a written colour opaque, dashed, 1 (the S1 bands); the default colour is not captured', () => {
    const s1 = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/transparency-defaults-by-version-rddt-1d-2026-11-14.json'), 'utf8'))
    for (const ver of [1, 2, 3]) {
      const band = s1.versions[String(ver)].state.bands[0]
      const { guides } = hlineGuides([{ value: 100, ordinal: 0, color: '#800080' }], opts(ver))
      expect(guides[0]).toMatchObject({ color: band.color, lineStyle: ['solid', 'dotted', 'dashed'][band.linestyle], width: band.linewidth })
    }
    const unstyled = hlineGuides([{ value: 100, ordinal: 0 }], opts(3))
    expect(unstyled.guides[0]).toMatchObject({ color: 'INK', lineStyle: 'solid', width: 1 })
    expect(unstyled.notReproduced[0].fields).toEqual(['color'])
  })
  it('v5 with nothing written: drawn at its exact level in the neutral ink, each unwitnessed field named', () => {
    const { guides, notReproduced } = hlineGuides([{ value: 70, ordinal: 0, title: 'OB' }], opts(5))
    expect(guides[0]).toMatchObject({ levels: [70], color: 'INK', lineStyle: 'solid', width: 1 })
    expect(notReproduced[0]).toMatchObject({ title: 'OB', fields: ['color', 'lineStyle', 'width'] })
    expect(notReproduced[0].reason).toMatch(/default colour for a v5 `hline` is not captured/)
  })
  it('v5 written in full is the author\'s; a colour with transparency draws at that alpha', () => {
    const { guides, notReproduced } = hlineGuides([{ value: 70, ordinal: 0, color: '#FF8800', opacity: 0.6, lineStyle: 'dotted', width: 2 }], opts(5))
    expect(guides[0]).toMatchObject({ color: '#FF880099', lineStyle: 'dotted', width: 2 })
    expect(notReproduced).toEqual([])
  })
  it('display.none draws nothing; an unbindable setting is withheld by name', () => {
    const out = hlineGuides([{ value: 1, ordinal: 0, hidden: true }, { value: 2, ordinal: 1, input: { name: 'x' } }],
      { ...opts(6), bindInput: () => ({ withheld: 'nope' }) })
    expect(out.guides).toEqual([])
    expect(out.withheld).toEqual([{ ordinal: 1, line: undefined, title: 'hline 2', reason: 'nope' }])
  })
  it('the key names the call, and reads back', () => {
    expect(hlineKeyOf(0)).toBe('hline1')
    expect(hlineOrdinalOf('hline12')).toBe(11)
    expect(hlineOrdinalOf('out2')).toBe(null)
  })
})

describe('the member door draws them, on both doors', () => {
  const RSI = v(6, 'ob = input.int(70, "Overbought")\nplot(ta.rsi(close, 14), "RSI")\nhline(ob, "OB", color = color.red, linestyle = hline.style_dotted, linewidth = 2)\nhline(30, "OS")')
  it('host: one guide per level; a setting-bound level names its key, declared once', () => {
    withPanes()
    const d = memberPaneDefinition({ source: RSI, id: 'u_e96_h1', name: 't' })
    expect(d.ok).toBe(true)
    expect(guidesOf(d)).toEqual([
      { key: 'hline1', label: 'OB', style: 'hlines', levels: ['$ob'], color: '#F23645', width: 2, lineStyle: 'dotted' },
      { key: 'hline2', label: 'OS', style: 'hlines', levels: [30], color: '#808080', width: 1, lineStyle: 'dashed' },
    ])
    expect(d.definition.inputs.filter((i) => i.key === 'ob')).toEqual([{ key: 'ob', type: 'int', label: 'Overbought', default: 70 }])
  })
  it('⭐⭐ the member\'s own setting moves the line (the bind path every setting takes)', () => {
    withPanes()
    const d = memberPaneDefinition({ source: RSI, id: 'u_e96_h2', name: 't' })
    const { installed, errors } = registry.installUserDefinitions([d.definition])
    expect(errors).toEqual([])
    try {
      const reg = { getDefinition: (id) => (id === installed[0].id ? installed[0] : null) }
      const levelsAt = (inputs) => planBindings([{ instanceId: 'i:e96', defId: installed[0].id, inputs }], reg, null, {})
        .bind.flatMap((b) => (b.guides || []).map((g) => [g.key, g.levels[0]]))
      expect(levelsAt({})).toEqual([['hline1', 70], ['hline2', 30]])
      expect(levelsAt({ ob: 80 })).toEqual([['hline1', 80], ['hline2', 30]])
    } finally {
      registry.uninstallUserDefinition(installed[0].id)
    }
  })
  it('the neutral ink is the CHART\'s text colour, resolved where the guide is planned (`pool.planBindings`)', () => {
    withPanes()
    const d = memberPaneDefinition({ source: v(5, 'plot(ta.rsi(close, 14), "RSI")\nhline(70, "Overbought")'), id: 'u_e96_h3t', name: 't' })
    const { installed } = registry.installUserDefinitions([d.definition])
    try {
      const reg = { getDefinition: (id) => (id === installed[0].id ? installed[0] : null) }
      const guides = planBindings([{ instanceId: 'i:e96t', defId: installed[0].id, inputs: {} }], reg, null,
        { theme: { fg: '#D1D4DC', bg: '#131722' } }).bind.flatMap((b) => b.guides || [])
      expect(guides.map((g) => g.color)).toEqual(['#D1D4DC'])
    } finally {
      registry.uninstallUserDefinition(installed[0].id)
    }
  })
  it('a v5 unstyled level is drawn in the neutral ink, and the door says so by name', () => {
    withPanes()
    const d = memberPaneDefinition({ source: v(5, 'plot(ta.rsi(close, 14), "RSI")\nhline(70, "Overbought")'), id: 'u_e96_h3', name: 't' })
    expect(guidesOf(d)).toEqual([{ key: 'hline1', label: 'Overbought', style: 'hlines', levels: [70], color: WITHHELD_COLOUR_INK, width: 1, lineStyle: 'solid' }])
    expect(d.notes.find((n) => n.name === 'Overbought').note).toMatch(/^`Overbought`: style not reproduced: TradingView's default colour for a v5 `hline` is not captured/)
  })
  it('⭐ the editor\'s status lists a style not reproduced as a WITHHELD part (the GAPS probe stays listed until Q-HLINE-3)', async () => {
    withPanes()
    const { inspectSource } = await import('../../builder/PineBox')
    const { editorStatus } = await import('../../builder/editorStatus')
    const source = v(5, 'plot(ta.rsi(close, 14), "RSI")\nhline(70, "Overbought")')
    const pane = memberPaneDefinition({ source, id: 'u_e96_h3s', name: 't' })
    const status = editorStatus({ report: inspectSource(source, 'pine'), pane, savedRow: null, inspectedSource: source })
    expect(status.state).toBe('runs-withheld')
    expect(status.items.find((i) => i.name === 'Overbought')).toMatchObject({ severity: 'withheld', guard: 'pine:colour-default-unwitnessed' })
  })
  it('runtime: the same guides, and "a horizontal line" is no longer said to be undrawn', () => {
    withPanes()
    __forceRuntimeLaneForTests(true)
    const d = memberPaneDefinition({ source: RSI, id: 'u_e96_h4', name: 't' })
    expect(d.ok).toBe(true)
    expect(d.lane).toBe('runtime')
    expect(guidesOf(d).map((g) => [g.key, g.levels])).toEqual([['hline1', ['$ob']], ['hline2', [30]]])
    expect(d.notes.some((n) => /a horizontal line/.test(n.note || ''))).toBe(false)
  })
  it('CONTROL — a runtime document with an unreadable level still names it (the ledger accounts every `hline`)', () => {
    withPanes()
    __forceRuntimeLaneForTests(true)
    const d = memberPaneDefinition({ source: v(6, 'plot(close, "c")\nhline(close)'), id: 'u_e96_h5', name: 't' })
    expect(d.ok).toBe(true)
    expect(guidesOf(d)).toEqual([])
    const t = d.translation
    expect(t.notes.find((n) => n.code === 'pine:chart-only').message).toMatch(/^`hline` is not drawn: /)
  })
})

describe('a band between two levels is drawn on the existing band mechanism (e96, unit 3)', () => {
  it('two hidden rows at the two levels, the band between them, in the fill\'s own colour', () => {
    withPanes()
    const src = v(6, 'ob = input.int(70, "OB")\nplot(ta.rsi(close, 14), "RSI")\nh1 = hline(ob, "Up")\nh2 = hline(30, "Down")\nfill(h1, h2, color = color.new(color.purple, 90))')
    const t = translatePine(src, { strict: true })
    expect(t.notes.find((n) => n.code === 'pine:chart-only' && n.line === 7).message).toMatch(/^`fill` is carried as the band between its two levels/)
    expect(t.presentation.levelFills.map((f) => [f.a, f.b])).toEqual([[0, 1]])
    const d = memberPaneDefinition({ source: src, id: 'u_e96_b1', name: 't' })
    expect(d.ok).toBe(true)
    const edge = d.definition.plots.find((p) => p.fill && p.fill.with)
    const other = d.definition.plots.find((p) => p.key === edge.fill.with)
    expect([edge.hidden, other.hidden]).toEqual([true, true])
    expect([d.definition.compute.sources[edge.key], d.definition.compute.sources[other.key]]).toEqual(['ob', '30'])
    expect(edge.fillColor).toBe('#9C27B0')
    expect(edge.fillOpacity).toBeCloseTo(0.1, 12)
    expect(d.notes.some((n) => /^`fill`/.test(n.name || ''))).toBe(false)
  })
  it('⛔ a band one of whose levels is not drawn is not drawn, by name', () => {
    withPanes()
    const src = v(6, 'plot(ta.rsi(close, 14), "RSI")\nh1 = hline(close)\nh2 = hline(30, "Down")\nfill(h1, h2, color = color.blue)')
    const t = translatePine(src, { strict: true })
    expect(t.presentation.levelFills || []).toEqual([])
    expect(t.notes.find((n) => n.code === 'pine:chart-only' && n.line === 6).message).toMatch(/^`fill` is not drawn: one of its two levels is not drawn/)
    const d = memberPaneDefinition({ source: src, id: 'u_e96_b2', name: 't' })
    expect(d.definition.plots.some((p) => p.fill)).toBe(false)
  })
})

describe('the band grade', () => {
  const FILE = path.join(REPO, 'tests/fixtures/vendor/harness/vw-hline-written-rddt-1d-2026-11-20.json')
  it('⭐⭐ vw-hline-written: every one of its 7 hlines agrees in level, colour, style and width', () => {
    withPanes()
    const { capture } = loadCapture(FILE)
    const { verdict } = gradeCapture(capture)
    expect(verdict.bands, JSON.stringify(verdict.bands)).toMatchObject({ verdict: 'MATCH', agreeing: 7, differing: 0, withheld: 0 })
    expect(verdict.verdictWithoutBands).toBeTruthy()
  }, 120_000)
  const cap = (state, bands = state.map((_, i) => ({ id: `hline_${i}`, name: `H${i}` }))) => ({ study: { bands, bandState: state } })
  const S = (value, extra = {}) => ({ color: '#F23645', linestyle: 0, linewidth: 1, value, visible: true, ...extra })
  const O = (ordinal, value, extra = {}) => ({ ordinal, value, color: '#F23645', lineStyle: 'solid', width: 1, ...extra })
  it('a different level is DIVERGE; a different style is DIVERGE; withheld and neutral are named INCONCLUSIVE', () => {
    expect(compareBands(cap([S(70)]), [O(0, 70)]).verdict).toBe('MATCH')
    expect(compareBands(cap([S(70)]), [O(0, 71)]).verdict).toBe('DIVERGE')
    expect(compareBands(cap([S(70)]), [O(0, 70, { lineStyle: 'dashed' })]).verdict).toBe('DIVERGE')
    expect(compareBands(cap([S(70)]), [O(0, 70, { width: 2 })]).verdict).toBe('DIVERGE')
    expect(compareBands(cap([S(70, { color: 'rgba(242,54,69,0.6)' })]), [O(0, 70, { color: '#F2364599' })]).verdict).toBe('MATCH')
    expect(compareBands(cap([S(70)]), [{ ordinal: 0, withheld: 'x' }]).verdict).toBe('INCONCLUSIVE')
    expect(compareBands(cap([S(70)]), [O(0, 70, { neutral: true })]).verdict).toBe('INCONCLUSIVE')
    expect(compareBands(cap([S(70)]), [O(0, 69, { neutral: true })]).verdict).toBe('DIVERGE')
  })
  it('counts and hiding: a missing or extra band DIVERGEs; a band neither side draws is not graded', () => {
    expect(compareBands(cap([S(70), S(30)]), [O(0, 70)]).verdict).toBe('DIVERGE')
    expect(compareBands(cap([S(70)]), [O(0, 70), O(1, 30)]).verdict).toBe('DIVERGE')
    expect(compareBands(cap([S(70, { visible: false })]), [{ ordinal: 0, hidden: true }])).toBe(null)
    expect(compareBands(cap([S(70)]), [{ ordinal: 0, hidden: true }]).verdict).toBe('DIVERGE')
    expect(compareBands({ study: {} }, [O(0, 70)])).toBe(null)
  })
})
