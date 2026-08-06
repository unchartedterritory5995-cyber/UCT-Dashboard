import { describe, it, expect } from 'vitest'
import { eligibleInstances, VWAP_TIMEFRAMES } from './eligibility'
import * as engineRegistry from './nativeRegistry'

// ─── WHAT THE DEFINITION SCHEMA CANNOT SAY ──────────────────────────────────
//
// Four facts about the shipped VWAP block are facts about the CHART that is
// drawing it, not about the indicator. `eligibility.js` is the pre-pass that
// folds them in; this file is what fails when one of them stops happening.
//
// ⚠️ THE PIXEL GATE CANNOT SEE MOST OF THIS. `chart_parity_cases.json` renders
// through `ChartRender.jsx`, which passes NO `vwapOverride`, NO `boldCandles`
// and NO `modelBookLook` — so the override path, both width fallbacks, and the
// timeframe gate on a DAILY chart are all unreachable from the parity harness.
// A case that measured 0 px would say nothing about any of them. That is why
// these are unit cases and why mutation M4 (drop `meta.timeframes`) is scored
// here rather than in pixels.

const VWAP = {
  instanceId: 'legacy:vwap', defId: 'vwap',
  inputs: { color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 1 },
  placement: { target: 'price' }, hidden: false,
}
const RSI = { instanceId: 'legacy:rsi', defId: 'rsi', inputs: {}, hidden: false }
const run = (instances, ctx) => eligibleInstances(instances, engineRegistry, ctx)

describe('eligibility — what the definition schema cannot say', () => {
  it('VWAP renders on an intraday timeframe', () => {
    expect(VWAP_TIMEFRAMES).toEqual(['1', '5', '15', '30', '60'])
    expect(run([VWAP], { tf: '5' }).kept.map(i => i.defId)).toEqual(['vwap'])
  })

  it('the declared gate IS the shipped VWAP_TFS, read off the definition', () => {
    // `StockChart.jsx:559` — `VWAP_TFS`. The definition has to CARRY it, or the
    // hook is enforcing a list it invented. Mutation M4 removes `meta.timeframes`
    // and this is the first case that goes red.
    const def = engineRegistry.getDefinition('vwap')
    expect(def.meta.timeframes).toEqual([...VWAP_TIMEFRAMES])
  })

  it('VWAP does NOT render on D / W / M', () => {
    for (const tf of ['D', 'W', 'M']) {
      expect(run([VWAP], { tf }).kept, tf).toEqual([])
      expect(run([VWAP], { tf }).hidden.map(h => h.reason), tf).toEqual(['timeframe'])
    }
  })

  it('a definition with NO declared timeframes renders on every one', () => {
    for (const tf of ['5', 'D', 'W']) expect(run([RSI], { tf }).kept.map(i => i.defId)).toEqual(['rsi'])
  })

  it('an ABSENT tf gates nothing — the hook never guesses a timeframe', () => {
    // `ctx.tf === undefined` means the caller did not say. Hiding VWAP there
    // would make a missing prop look like a daily chart, which is the direction
    // that silently deletes a line.
    expect(run([VWAP], {}).kept.map(i => i.defId)).toEqual(['vwap'])
    expect(run([VWAP], undefined).kept.map(i => i.defId)).toEqual(['vwap'])
  })

  it('vwapOverride recolours — and only recolours', () => {
    // `:6001` — the override wins on colour; the user's opacity, style and width
    // still apply. It is "recolour", never "replace the whole configuration".
    const { kept } = run([{ ...VWAP, inputs: { ...VWAP.inputs, opacity: 40, lineWidth: 3 } }],
      { tf: '5', vwapOverride: { color: '#ffffff' } })
    expect(kept[0].inputs.color).toBe('rgba(255, 255, 255, 0.4)')
    expect(kept[0].inputs.lineWidth).toBe(3)
    expect(kept[0].inputs.lineStyle).toBe('solid')
  })

  it('a vwapOverride with NO color falls back to the user’s colour', () => {
    // `vwapOverride?.color || _vwapCfg.color || '#26C6DA'` — the `||` chain,
    // transcribed. A truthy override object carrying no colour must not blank
    // the line, and must not force white either.
    expect(run([VWAP], { tf: '5', vwapOverride: {} }).kept[0].inputs.color).toBe('#26C6DA')
  })

  it('opacity is COMPOSED into the colour, exactly as _withVwapOpacity does', () => {
    // `StockChart.jsx:571-579`: 100 returns the base untouched (so a user who
    // never opened the setting sees no change at all), anything else becomes
    // `rgba(r, g, b, a)` with that spacing.
    expect(run([VWAP], { tf: '5' }).kept[0].inputs.color).toBe('#26C6DA')
    const dim = run([{ ...VWAP, inputs: { ...VWAP.inputs, opacity: 40 } }], { tf: '5' })
    expect(dim.kept[0].inputs.color).toBe('rgba(38, 198, 218, 0.4)')
  })

  it('a NON-NUMERIC opacity is treated as 100 — but `null` is a real ZERO', () => {
    // `Number.isFinite(Number(opacityPct)) ? … : 100` on the legacy side, and
    // `!Number.isFinite(pct) → return color` here. Both mean "leave it alone"
    // for anything that does not read as a number: the other direction would
    // render an INVISIBLE line for a user whose blob carries a string.
    for (const bad of [undefined, 'abc', NaN, {}]) {
      const r = run([{ ...VWAP, inputs: { ...VWAP.inputs, opacity: bad } }], { tf: '5' })
      expect(r.kept[0].inputs.color, String(bad)).toBe('#26C6DA')
    }
    // ⚠️ `null` IS NOT IN THAT LIST, AND THAT IS TRANSCRIPTION, NOT A CHOICE.
    // `Number(null)` is **0**, not NaN, so the shipped block composes a fully
    // transparent line for it — and the hook has to do the same or Flip A moves
    // a pixel for anyone whose stored blob has a null there. Pinned rather than
    // "fixed": correcting it is a change to what the chart draws, which makes it
    // the owner's call and not a migration's. (`normalizeInstances` rejects a
    // null `opacity` on the engine path anyway, so the two lanes only diverge
    // through the LEGACY blob — which is exactly the surface Flip A preserves.)
    const nulled = run([{ ...VWAP, inputs: { ...VWAP.inputs, opacity: null } }], { tf: '5' })
    expect(nulled.kept[0].inputs.color).toBe('rgba(38, 198, 218, 0)')
  })

  it('an unparseable colour falls through untouched rather than guessing', () => {
    const odd = run([{ ...VWAP, inputs: { ...VWAP.inputs, color: 'rebeccapurple', opacity: 50 } }], { tf: '5' })
    expect(odd.kept[0].inputs.color).toBe('rebeccapurple')
  })

  it('an unset COLOUR takes the legacy default before opacity is applied', () => {
    // `_vwapCfg.color || '#26C6DA'`. The default has to be composed WITH the
    // opacity, not returned raw, or a 40%-dim line renders opaque for a user who
    // never picked a colour.
    const bare = { ...VWAP, inputs: { opacity: 40 } }
    expect(run([bare], { tf: '5' }).kept[0].inputs.color).toBe('rgba(38, 198, 218, 0.4)')
  })

  it('an UNSET width takes the render-context fallback', () => {
    // `:6006-6008`. 0.5 under the bold/Model Book look, 1 otherwise. Not
    // expressible as a definition default: it depends on which surface is drawing.
    const bare = { ...VWAP, inputs: { color: '#26C6DA', opacity: 100, lineStyle: 'solid' } }
    expect(run([bare], { tf: '5' }).kept[0].inputs.lineWidth).toBe(1)
    expect(run([bare], { tf: '5', boldCandles: true }).kept[0].inputs.lineWidth).toBe(0.5)
    expect(run([bare], { tf: '5', modelBookLook: true }).kept[0].inputs.lineWidth).toBe(0.5)
    // …and a DECLARED width beats the fallback on every surface.
    expect(run([VWAP], { tf: '5', boldCandles: true }).kept[0].inputs.lineWidth).toBe(1)
  })

  it('a ZERO or negative width is UNSET, matching `Number(x) > 0`', () => {
    // The legacy test is `Number(_vwapCfg.lineWidth) > 0`, not `!= null`. A 0
    // reaches the renderer as an invisible line, so it has to take the fallback.
    for (const w of [0, -2, '', 'x']) {
      const r = run([{ ...VWAP, inputs: { ...VWAP.inputs, lineWidth: w } }], { tf: '5', modelBookLook: true })
      expect(r.kept[0].inputs.lineWidth, String(w)).toBe(0.5)
    }
  })

  it('returns NEW instances — the caller\'s list is never mutated', () => {
    const input = [{ ...VWAP, inputs: { ...VWAP.inputs, opacity: 40 } }]
    const before = JSON.parse(JSON.stringify(input))
    run(input, { tf: '5', vwapOverride: { color: '#ffffff' } })
    expect(input).toEqual(before)
  })

  it('leaves every other instance strictly alone — same object, same identity', () => {
    const { kept } = run([RSI], { tf: '5', vwapOverride: { color: '#fff' }, boldCandles: true })
    expect(kept[0]).toBe(RSI)
  })

  it('an instance of an UNKNOWN definition is kept, not silently dropped', () => {
    // Ownership is `engineOwnedDefIds`'s call and `normalizeInstances`'s call.
    // A hook that also dropped things would be a second, invisible filter.
    const alien = { instanceId: 'x:1', defId: 'not-a-real-def', inputs: {}, hidden: false }
    expect(run([alien], { tf: 'D' }).kept).toEqual([alien])
  })

  it('a HIDDEN VWAP is still hidden-by-timeframe on a daily chart', () => {
    // The visibility projection marks a toggled-off instance `hidden`; the
    // timeframe gate REMOVES it. Both end in "nothing is drawn", but only the
    // second one is allowed to leave the instance out of the binder's list —
    // and `hidden` must not be a way to sneak past the gate.
    const { kept, hidden } = run([{ ...VWAP, hidden: true }], { tf: 'D' })
    expect(kept).toEqual([])
    expect(hidden.map(h => h.reason)).toEqual(['timeframe'])
  })

  it('junk in the list is skipped without taking the pass down', () => {
    const { kept } = run([null, undefined, 42, VWAP], { tf: '5' })
    expect(kept.map(i => i.defId)).toEqual(['vwap'])
    expect(run(null, { tf: '5' })).toEqual({ kept: [], hidden: [] })
  })

  it('accepts a registry FUNCTION as well as a module', () => {
    const get = (id) => engineRegistry.getDefinition(id)
    expect(eligibleInstances([VWAP], get, { tf: 'D' }).kept).toEqual([])
    expect(eligibleInstances([VWAP], get, { tf: '5' }).kept.map(i => i.defId)).toEqual(['vwap'])
    // No registry at all ⇒ nothing resolves ⇒ nothing is narrowed. Fail-open is
    // correct here: the binder's own registry decides what draws.
    expect(eligibleInstances([VWAP], null, { tf: 'D' }).kept).toEqual([VWAP])
  })

  it('the tf is compared as a STRING — 5 and "5" are the same timeframe', () => {
    expect(run([VWAP], { tf: 5 }).kept.map(i => i.defId)).toEqual(['vwap'])
    expect(run([VWAP], { tf: 60 }).kept.map(i => i.defId)).toEqual(['vwap'])
  })
})
