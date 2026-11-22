// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.cbcLiteralText.test.js
//
// ─── CBC-FMT (S17 follow-up) — `str.tostring(<a numeric LITERAL>)` IN FULL, AGAINST TRADINGVIEW ─
//
// S17 `vw-cs2-label-format-rddt-1d-2026-11-15` (our probe,
// `tools/visual_conformance/probes/vw-cs2-label-format.pine`, //@version=5, NYSE:RDDT 1D from the
// listing): six labels on the last bar, each `label.new(…, str.tostring(<x>))` with no format.
//   str.tostring(close)                    -> "98.45"
//   str.tostring(close / 3)                -> "32.8166666667"         (computed: ten decimals)
//   str.tostring(0.8175176096085278)       -> "0.8175176096085278"    (a LITERAL: in full)
//   str.tostring(math.round(close))        -> "98"
//   str.tostring(0.000012345678901234)     -> "0.000012345678901234"  (a LITERAL: in full)
//   str.tostring(close, format.mintick)    -> "98.45"
// ⭐ AND THE VERSION DECIDES (all four cells witnessed: S17 and s21 at v5, S10 and s21 at v6).
// S10 `vw-cs2-label-number-format-rddt-1d-2026-11-15` (//@version=6, the call an argument of
// a helper that concatenates it) printed the SAME literal to TEN decimals ("0.8175176096"). The two
// cells differ in the version AND the shape, so only they are served; every other cell where the
// readings part is withheld by name (`format:literal-uncaptured`, `pineTextFormat.js::literalTostringText`).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { toRenderState } from '../../objectRenderState'
import { literalTostringText, LITERAL_TOSTRING_UNCAPTURED } from '../../pineTextFormat'
import { translatePine } from '../../ast/pine'
import { computeRuntimeColumns } from '../../runtime/runtimeColumns.js'
import { runtimeObjectsOf, runtimeObjectsWithheldOf } from '../../runtime/runtimeObjects.js'

const REPO = path.resolve(process.cwd(), '..')
const DIR = path.join(REPO, 'tests/fixtures/vendor/harness')
const cap = (file) => loadCapture(path.join(DIR, file)).capture
const PROBE = fs.readFileSync(path.join(REPO, 'tools/visual_conformance/probes/vw-cs2-label-format.pine'), 'utf8')
const S17 = 'vw-cs2-label-format-rddt-1d-2026-11-15.json'

afterEach(() => { vi.unstubAllEnvs() })

/** the host lane's label texts (creation order), and the object diagnostics */
function hostLabels(capture, source) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const bars = toProductBars(capture)
  const d = memberPaneDefinition({ source, id: 'u_cbc_lit', name: 'cbclit' })
  expect(d.ok, d.reason || '').toBe(true)
  const reader = objectReaderFor(d.definition, bars, {
    tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: capture.newestBarIsForming ?? null,
    historyFromListing: true,
  })
  const r = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  return toRenderState(r.live, { bars, tf: 'D' }).labels.map((l) => l.text)
}
/** the runtime lane's drawings: their texts, or the name it withheld them by */
function runLabels(capture, source, symbol = undefined) {
  const bars = capture.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
  const doc = { id: 'cbclit', meta: { runtimeHistory: 'listing' },
    compute: { kind: 'runtime', fn: 'runtime:cbclit', outputs: { a: 0 }, objects: true, source } }
  const cols = computeRuntimeColumns(doc, bars, { tf: 'D', newestBarIsForming: false, historyFromListing: true,
    ...(symbol ? { symbol } : {}) })
  const o = runtimeObjectsOf(cols)
  return o ? { texts: o.live.map((x) => (x.props ? x.props.text : x.text)) } : { withheld: runtimeObjectsWithheldOf(cols) }
}
const lit = (src) => {
  // the parsed argument of the probe's one `str.tostring(...)` call
  const m = /str\.tostring\((.*)\)\s*\)\s*$/m.exec(src)
  return m
}
const NUM = (raw) => ({ type: 'number', value: Number(raw), tok: { raw } })
const NEG = (raw) => ({ type: 'unary', op: '-', arg: NUM(raw) })

describe('⭐⭐ the S17 witness: a numeric literal is printed IN FULL (v5, directly the label\'s text)', () => {
  it('the committed capture is what it says (our probe, v5, the six texts)', () => {
    const c = cap(S17)
    expect(c.source.text).toBe(PROBE)
    expect(c.history.startsAtBar0).toBe(true)
    expect(c.objects.texts.labels).toEqual(['98.45', '32.8166666667', '0.8175176096085278', '98',
      '0.000012345678901234', '98.45'])
    expect(lit(PROBE)).not.toBeNull()
  })

  it('⭐⭐ the host lane prints every text exactly', () => {
    const c = cap(S17)
    expect(hostLabels(c, PROBE)).toEqual(c.objects.texts.labels)
  })

  it('⭐ the S10 witness still holds: v6 through a helper prints the literal to ten decimals', () => {
    const c = cap('vw-cs2-label-number-format-rddt-1d-2026-11-15.json')
    const texts = hostLabels(c, c.source.text)
    expect(texts).toEqual(c.objects.texts.labels)
    expect(texts).toContain('F03 0.8175176096085278|0.8175176096')
  })
})

describe('⭐⭐ TC — the runtime lane prints the sixth label too: `format.mintick` at the tick of the binding', () => {
  // ⚰️ CBC-FMT left `str.tostring(close, format.mintick)` refused on this lane (`runtime:call-text-state`).
  // TC serves it with the chart symbol's witnessed tick TEXT (`bind.js::SYMBOL_TICK_SIZE`, NYSE 0.01)
  // through the host lane's one tick formatter (`pineTextFormat.js::tickNumberText`), so the run is
  // asked of all SIX labels on S17's own bars and symbol, and prints TradingView's six texts.
  const RDDT = { ticker: 'RDDT', exchange: 'NYSE' }
  it('⭐⭐ v5 direct, all six texts, the sixth the "98.45" TradingView prints', () => {
    expect(runLabels(cap(S17), PROBE, RDDT)).toEqual({ texts: cap(S17).objects.texts.labels })
  })
  it('⭐ v6 direct (s21), all six texts', () => {
    const c = cap('vw-cs2-label-format-v6-direct-rddt-1d-2026-11-15.json')
    expect(runLabels(c, c.source.text, RDDT)).toEqual({ texts: c.objects.texts.labels })
  })
  it('⛔ with no symbol the run has no tick: its drawings are withheld BY NAME, never a guessed 0.01', () => {
    const r = runLabels(cap(S17), PROBE)
    expect(r.withheld && r.withheld.guard, JSON.stringify(r)).toBe('format:tick-unsettled')
  })
})

describe('⭐⭐ the runtime lane asks the same rule', () => {
  // the probe's sixth label (`format.mintick`) needs the chart's symbol (the TC block above);
  // these runs carry none, so the run is asked of the first five
  const FIVE = PROBE.replace(/^.*format\.mintick.*$/m, '')
  it('⭐ v5 direct: the five texts, the two literals in full', () => {
    expect(runLabels(cap(S17), FIVE)).toEqual({ texts: cap(S17).objects.texts.labels.slice(0, 5) })
  })
  it('⭐ v6 direct (s21): the literals at ten decimals', () => {
    const r = runLabels(cap(S17), FIVE.replace('//@version=5', '//@version=6'))
    expect(r).toEqual({ texts: ['98.45', '32.8166666667', '0.8175176096', '98', '0.0000123457'] })
  })
  it('⛔ v4 (unwitnessed): withheld by the same name', () => {
    const r = runLabels(cap(S17), FIVE.replace('//@version=5', '//@version=4').replace(/str\.tostring/g, 'tostring').replace(/math\.round/g, 'round').replace('indicator(', 'study('))
    expect(r.withheld && r.withheld.guard, JSON.stringify(r)).toBe(LITERAL_TOSTRING_UNCAPTURED)
  })
})

describe('⭐ the rule (`literalTostringText`): the version decides', () => {
  const FULL = '0.8175176096085278'
  const W = { why: LITERAL_TOSTRING_UNCAPTURED }
  it('v5: a literal in FULL (S17 direct, s21 through a helper); v6: ten decimals (S10, s21)', () => {
    expect(literalTostringText(NUM(FULL), { version: 5 })).toEqual({ text: FULL })
    expect(literalTostringText(NUM('0.000012345678901234'), { version: 5 })).toEqual({ text: '0.000012345678901234' })
    for (const n of [NUM(FULL), NEG('0.000000000001'), NUM('1.00000000005'),
      { type: 'binary', op: '/', left: NUM('1.0'), right: NUM('3.0') }]) {
      expect(literalTostringText(n, { version: 6 })).toBeNull()
    }
  })
  it('⛔ every unwitnessed version or spelling is withheld by name', () => {
    expect(literalTostringText(NUM(FULL), { version: 4 })).toEqual(W)
    expect(literalTostringText(NUM(FULL), { version: 3 })).toEqual(W)
    expect(literalTostringText(NUM(FULL), { version: null })).toEqual(W)
    // v5, but not a plain literal: a negated literal, a constant expression, a source text that is not
    // the shortest decimal, an exponent
    expect(literalTostringText(NEG(FULL), { version: 5 })).toEqual(W)
    expect(literalTostringText({ type: 'binary', op: '/', left: NUM('1.0'), right: NUM('3.0') }, { version: 5 })).toEqual(W)
    expect(literalTostringText(NUM('0.81751760960852780'), { version: 5 })).toEqual(W)
    expect(literalTostringText(NUM('0.0000001234567890123'), { version: 5 })).toEqual(W)
  })
  it('where both readings print the same characters, nothing is decided here', () => {
    for (const v of [5, 6, 4, null]) {
      expect(literalTostringText(NUM('0.5'), { version: v })).toBeNull()
      expect(literalTostringText(NUM('5'), { version: v })).toBeNull()
      expect(literalTostringText(NEG('1.25'), { version: v })).toBeNull()
      expect(literalTostringText({ type: 'name', name: 'close' }, { version: v })).toBeNull()
    }
  })
  it('⭐ the host lane, v6 direct (s21): the literals at ten decimals, nothing withheld', () => {
    const v6 = PROBE.replace('//@version=5', '//@version=6')
    const t = translatePine(v6, { strict: true })
    expect(JSON.stringify(t.objectDiagnostics || {})).not.toMatch(/literal-uncaptured/)
    expect(hostLabels(cap(S17), v6)).toEqual(['98.45', '32.8166666667', '0.8175176096', '98', '0.0000123457', '98.45'])
  })
  it('⭐ the host lane, v5 through a helper (s21): S10\'s probe at v5 prints the literal in full', () => {
    const c = cap('vw-cs2-label-number-format-rddt-1d-2026-11-15.json')
    const v5 = c.source.text.replace('//@version=6', '//@version=5')
    const texts = hostLabels(c, v5)
    expect(texts).toContain('F03 0.8175176096085278|0.8175176096085278')
    // the computed rows are unchanged (ten decimals in both versions)
    expect(texts).toContain('F02 close/3|32.8166666667')
  })
})

describe('⭐⭐ the s21 witnesses, committed: v6 direct (ten decimals) and v5 through a helper (in full)', () => {
  const S21 = (v) => `vw-cs2-label-format-${v}-rddt-1d-2026-11-15.json`
  const probe = (v) => fs.readFileSync(path.join(REPO, `tools/visual_conformance/probes/vw-cs2-label-format-${v}.pine`), 'utf8')
  for (const v of ['v6-direct', 'v5-helper']) {
    it(`${v}: the committed capture is our probe, from the listing`, () => {
      const c = cap(S21(v))
      expect(c.source.text).toBe(probe(v))
      expect(c.history.startsAtBar0).toBe(true)
      expect(c.objects.texts.labels).toHaveLength(6)
    })
    it(`⭐⭐ ${v}: the host lane prints all six texts exactly`, () => {
      const c = cap(S21(v))
      expect(hostLabels(c, c.source.text)).toEqual(c.objects.texts.labels)
    })
  }
  it('the two captures differ only where the version decides (the two literals)', () => {
    const six = cap(S21('v6-direct')).objects.texts.labels
    const five = cap(S21('v5-helper')).objects.texts.labels.map((t) => t.replace(/^L\d:/, ''))
    const differ = six.map((t, i) => (t === five[i] ? null : i)).filter((i) => i !== null)
    expect(differ).toEqual([2, 4])
    expect(five[2]).toBe('0.8175176096085278')
    expect(six[2]).toBe('0.8175176096')
  })
  it('⭐ v6 direct on the runtime lane: the five texts it prints are TradingView\'s', () => {
    const c = cap(S21('v6-direct'))
    const five = c.source.text.replace(/^.*format\.mintick.*$/m, '')
    expect(runLabels(c, five)).toEqual({ texts: c.objects.texts.labels.slice(0, 5) })
  })
})
