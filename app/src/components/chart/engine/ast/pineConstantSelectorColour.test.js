// app/src/components/chart/engine/ast/pineConstantSelectorColour.test.js
//
// ─── OWNER RULING 1 (2026-09-28), THE PRESENTATION LANE ────────────────────────
//
// The standing principle: our chart draws EXACTLY what TradingView draws for the
// same script at its DEFAULT settings.
//
// RULING 1 — a colour whose branches are selected by a constant-at-translation
// input default resolves to that default's branch. Measured against TradingView
// (vendor harness, RDDT 1D 2026-09-28): Artemis Oscillator Pro colours seven
// plots through `themeChoice == "Aurora" ? … : themeChoice == "Ember" ? … : …`
// over an `input.string`, and all seven drew in the pane's gold. ⛔ A selector
// that reads a KNOB the member can turn is never folded — the colour rule
// carries it, so the chart follows the member's value rather than the default.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const V5 = '//@version=5\nindicator("t")\n'
const theme = (def) => `theme = input.string("${def}", "Theme", options = ["Aurora", "Ember", "Obsidian"])\n`
  + 'thA = theme == "Aurora" ? #00e5ff : theme == "Ember" ? #ff9d00 : #089981\n'
  + 'thB = theme == "Aurora" ? #ce93d8 : theme == "Ember" ? #419fec : #f23645\n'

const translate = (src, opts = {}) => {
  const t = translatePine(V5 + src, opts)
  expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
  return t
}
const presOf = (src, i = 0, opts = {}) => translate(src, opts).outputs[i].presentation

describe('ruling 1 — a constant-selected colour is the branch the default takes', () => {
  it('⭐⭐ an `input.string` theme chain draws the DEFAULT\'s colour, alpha and all', () => {
    // `color.new` over a chain is Artemis' own shape (`color.new(thVpBuy, 70)`),
    // and it is what the legacy reading could not open.
    const src = `${theme('Aurora')}plot(close, "a", color.new(thA, 0))\nplot(close, "b", color.new(thB, 60))\n`
    const t = translate(src)
    expect(t.outputs[0].presentation.color).toBe('#00e5ff')
    expect(t.outputs[0].presentation.colorDynamic).toBeUndefined()
    expect(t.outputs[1].presentation.color).toBe('#ce93d8')
    expect(t.outputs[1].presentation.opacity).toBeCloseTo(0.4, 10)
  })

  it('⛔ NON-VACUITY: a different default takes a different branch — nothing is hard-coded', () => {
    expect(presOf(`${theme('Ember')}plot(close, "a", color.new(thA, 0))\n`).color).toBe('#ff9d00')
    // …including the ELSE of the chain, reached through every arm.
    expect(presOf(`${theme('Obsidian')}plot(close, "a", color.new(thA, 0))\n`).color).toBe('#089981')
  })

  it('⭐ a chain deeper than the walkers\' depth budget still settles', () => {
    const arms = Array.from({ length: 12 }, (_, i) => `m == "k${i}" ? #0000${String(i).padStart(2, '0')}`).join(' : ')
    const src = `m = input.string("k11", "M")\nc = ${arms} : #ffffff\nplot(close, "a", c)\n`
    expect(presOf(src).color).toBe('#000011')
  })

  it('⭐ a bar-to-bar rule over folded leaves is carried as a rule', () => {
    // `color.new` over a chain is what the legacy reading could not open — it
    // is Artemis' own shape (`color.new(thVpBuy, 70)`).
    const p = presOf(`${theme('Aurora')}plot(close, "a", close > open ? color.new(thA, 0) : color.new(thB, 0))\n`)
    expect(p.colorUp).toBe('#00e5ff')
    expect(p.colorDown).toBe('#ce93d8')
    expect(p.colorCondition.formula).toBe('close > open')
  })

  it('⭐ a default whose branch is `na` is the ABSENT colour, not an unsaid one', () => {
    const p = presOf(`${theme('Aurora')}mode = input.string("off", "Mode")\nplot(close, "a", mode == "off" ? na : color.new(thA, 0))\n`)
    expect(p.color).toBe('#000000')
    expect(p.opacity).toBe(0)
    expect(p.colorDynamic).toBeUndefined()
  })

  it('⛔ CONTROL: a colour this lane already carried keeps its bytes (the legacy reading wins)', () => {
    const p = presOf('plot(close, "a", close > open ? color.green : color.red)\n')
    expect(p.colorCondition.formula).toBe('close > open')
    // A shallow chain of LITERAL leaves was carried before this ruling, as a
    // palette of every arm with the constant selectors inside the index; it
    // stays exactly that (same palette, same ids, same formula) — and draws the
    // default's colour already, because its index folds.
    const q = presOf(`${theme('Aurora')}plot(close, "b", close > open ? thA : thB)\n`)
    expect(q.colorPalette).toEqual(['#00e5ff', '#ff9d00', '#089981', '#ce93d8', '#419fec', '#f23645'])
    const r = presOf(`${theme('Aurora')}plot(close, "c", thA)\n`)
    expect(r.color).toBeUndefined()
    expect(r.colorPalette).toEqual(['#00e5ff', '#ff9d00', '#089981'])
    expect(r.colorIndex.formula).toBe('0')
  })
})

describe('ruling 1 — a selector that reads a KNOB is never folded', () => {
  // Artemis' OB Level shape: the knob gates the VALUE and the colour alike
  // (`plot(obLevelF, …, adaptZones ? color.new(thOb, 0) : na)`).
  const SRC = `${theme('Aurora')}show = input.bool(false, "Show")\n`
    + 'plot(show ? close : open, "a", show ? color.new(thA, 0) : na)\n'

  it('⭐⭐ on the member door the rule reads the member\'s input, live', () => {
    const r = memberPaneDefinition({ source: V5 + SRC, id: 'u_member-pane-knobprobe' })
    expect(r.ok, r.reason).toBe(true)
    const plot = r.rows.find((row) => row.label === 'a')
    expect(plot.colorPalette).toEqual(['#00e5ff', 'rgba(0, 0, 0, 0)'])
    const cond = r.rows.find((row) => plot.colorMode === `column:${row.key}`)
    // The selector is the declared IDENTIFIER — evaluated against whatever the
    // member sets it to — never the author's `false` welded in. (`!= 0` is
    // ruling 2's: an `na` selector takes the else branch.)
    expect(cond.source).toBe('show != 0 ? 0 : 1')
    expect(r.definition.inputs.some((i) => i.key === 'show')).toBe(true)
  })

  it('⭐ an input read ONLY by a colour is a member control too, and the rule reads it live', () => {
    // ⚰️ This was "STATED, NOT HIDDEN: … is no member control, so its default IS
    // the colour" — the member door declared an input only where an output's
    // VALUE read it. Since 2026-09-28 it also declares one only a colour reads
    // (`builderInputs.withColourInputs`), appended after the value inputs, as
    // TradingView lists it: see `memberPane/colourOnlyInputs.test.js`.
    const src = `${theme('Aurora')}show = input.bool(false, "Show")\nplot(close, "a", show ? color.new(thA, 0) : na)\n`
    const r = memberPaneDefinition({ source: V5 + src, id: 'u_member-pane-knobprobe' })
    expect(r.ok, r.reason).toBe(true)
    const plot = r.rows.find((row) => row.label === 'a')
    const cond = r.rows.find((row) => plot.colorMode === `column:${row.key}`)
    expect(cond.source).toBe('show != 0 ? 0 : 1')
    expect(r.definition.inputs.some((i) => i.key === 'show')).toBe(true)
  })

  it('⭐ re-translated with the member\'s value, the rule follows it', () => {
    const off = presOf(SRC, 0, { inputValues: { show: 0 } })
    const on = presOf(SRC, 0, { inputValues: { show: 1 } })
    expect(off.colorPalette).toEqual(on.colorPalette)
    expect(off.colorIndex.formula).not.toBe(on.colorIndex.formula)
  })

  it('⛔⛔ a rule carried for the first time MINTS NOTHING — no parameter id moves', () => {
    // `useAdapt` is read ONLY by the colour. Minting it mid-output would make it
    // a member control for an input only a colour reads. (C46: it could no longer
    // move `len` — an id is the call's place in the source, and `len` is the third
    // input call here whatever else mints — but it would still be a control nobody asked for.)
    const src = `${theme('Aurora')}useAdapt = input.bool(true, "Adaptive")\nlen = input.int(7, "Len")\n`
      + 'plot(close, "a", useAdapt ? thA : color.new(thA, 60))\nplot(ta.sma(close, len), "b")\n'
    const t = translate(src, { paramManifest: true })
    expect(t.outputs[0].presentation.colorPalette).toEqual(['#00e5ff', 'rgba(0, 229, 255, 0.4)'])
    expect(t.inputParams.map((p) => [p.id, p.sourceName])).toEqual([['__uct_param_1003', 'len']])
  })
})
